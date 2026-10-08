import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import app from "../app";
import { db, usersTable, deliveryAttemptsTable, notificationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";
import { restoreEnv } from "./phoneChannelTestUtils";
import { isSmsDeliveryEnabled, isWhatsAppDeliveryEnabled } from "../lib/messagingChannels";
import { deliverWhisperLink } from "../lib/deliver";

// SMS/WhatsApp ship OFF at launch (A2P 10DLC rejected third-party consent —
// see lib/messagingChannels.ts). These tests pin the default-off behavior:
// every intake route refuses a phone-channel send, the public config says
// so, and delivery-time sends of anything already queued never reach Twilio.

const SENDER = "clerk_messaging_channels_sender";

function asUser(clerkId: string) {
  return { [TEST_USER_HEADER]: clerkId };
}

let prevSms: string | undefined;
let prevWhatsApp: string | undefined;

beforeEach(() => {
  prevSms = process.env.SMS_DELIVERY_ENABLED;
  prevWhatsApp = process.env.WHATSAPP_DELIVERY_ENABLED;
  delete process.env.SMS_DELIVERY_ENABLED;
  delete process.env.WHATSAPP_DELIVERY_ENABLED;
});

afterEach(() => {
  restoreEnv("SMS_DELIVERY_ENABLED", prevSms);
  restoreEnv("WHATSAPP_DELIVERY_ENABLED", prevWhatsApp);
});

describe("messaging channel flags", () => {
  it("default to off and only the string \"true\" (any case) turns them on", () => {
    expect(isSmsDeliveryEnabled()).toBe(false);
    expect(isWhatsAppDeliveryEnabled()).toBe(false);

    process.env.SMS_DELIVERY_ENABLED = "1";
    process.env.WHATSAPP_DELIVERY_ENABLED = "yes";
    expect(isSmsDeliveryEnabled()).toBe(false);
    expect(isWhatsAppDeliveryEnabled()).toBe(false);

    process.env.SMS_DELIVERY_ENABLED = "TRUE";
    process.env.WHATSAPP_DELIVERY_ENABLED = "true";
    expect(isSmsDeliveryEnabled()).toBe(true);
    expect(isWhatsAppDeliveryEnabled()).toBe(true);
  });
});

describe("GET /api/config", () => {
  it("is public and reports both phone channels disabled by default", async () => {
    const res = await request(app).get("/api/config");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ smsDeliveryEnabled: false, whatsappDeliveryEnabled: false, billingEnabled: false });
    expect(res.headers["cache-control"]).toMatch(/max-age=\d+/);
  });

  it("reflects the env flags when turned on", async () => {
    process.env.SMS_DELIVERY_ENABLED = "true";
    const res = await request(app).get("/api/config");
    expect(res.body).toEqual({ smsDeliveryEnabled: true, whatsappDeliveryEnabled: false, billingEnabled: false });
  });
});

describe("POST /api/whisps with a phone channel", () => {
  const smsWhisp = {
    videoUrl: "https://youtu.be/x",
    deliveryMethod: "whisper_link",
    whisperChannel: "sms",
    recipientPhone: "+15551234567",
    smsConsentConfirmed: true,
  };

  it("rejects SMS while SMS delivery is off", async () => {
    const res = await request(app).post("/api/whisps").set(asUser(SENDER)).send(smsWhisp);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("channel_disabled");
    expect(res.body.error).toMatch(/SMS delivery isn't available yet/i);
  });

  it("rejects WhatsApp while WhatsApp delivery is off", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(SENDER))
      .send({ ...smsWhisp, whisperChannel: "whatsapp" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/WhatsApp delivery isn't available yet/i);
  });

  it("still accepts email while the phone channels are off", async () => {
    const res = await request(app).post("/api/whisps").set(asUser(SENDER)).send({
      videoUrl: "https://youtu.be/x",
      deliveryMethod: "whisper_link",
      whisperChannel: "email",
      recipientEmail: "friend@example.com",
    });
    expect(res.status).toBe(201);
  });

  it("accepts SMS once SMS_DELIVERY_ENABLED=true", async () => {
    process.env.SMS_DELIVERY_ENABLED = "true";
    const res = await request(app).post("/api/whisps").set(asUser(SENDER)).send(smsWhisp);
    expect(res.status).toBe(201);
    expect(res.body.whisperChannel).toBe("sms");
  });
});

describe("POST /api/text-whisps", () => {
  it("rejects creation entirely while SMS delivery is off", async () => {
    const res = await request(app)
      .post("/api/text-whisps")
      .set(asUser(SENDER))
      .send({ recipientPhone: "+15557654321", messageText: "hi", smsConsentConfirmed: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("channel_disabled");
  });
});

describe("POST /api/invites with a phone channel", () => {
  it("rejects SMS and WhatsApp invites while off", async () => {
    for (const channel of ["sms", "whatsapp"]) {
      const res = await request(app)
        .post("/api/invites")
        .set(asUser(SENDER))
        .send({ channel, recipientPhone: "+15551234567", smsConsentConfirmed: true });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("channel_disabled");
    }
  });
});

describe("POST /api/debate-topics/:id/whisp with a phone channel", () => {
  it("rejects SMS while off", async () => {
    await request(app).get("/api/user/profile").set(asUser(SENDER));
    const topic = await request(app)
      .post("/api/debate-topics")
      .set(asUser(SENDER))
      .send({ topicText: "Is a hot dog a sandwich?" });
    expect(topic.status).toBe(201);

    const res = await request(app)
      .post(`/api/debate-topics/${topic.body.id}/whisp`)
      .set(asUser(SENDER))
      .send({ channel: "sms", recipientPhone: "+15551234567", smsConsentConfirmed: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("channel_disabled");
  });
});

describe("delivery-time gate (already-queued sends)", () => {
  it("never calls Twilio while off, logs why, and still delivers in-app to a matched user", async () => {
    const matchedUserId = randomUUID();
    await db.insert(usersTable).values({
      id: matchedUserId,
      clerkId: `clerk_${matchedUserId}`,
      email: `${matchedUserId}@example.com`,
      phone: "+15559871111",
      phoneVerifiedAt: new Date(),
      plan: "free",
      boostCredits: 0,
      whisperLinksUsed: 0,
    });
    const whisp = {
      id: randomUUID(),
      publicToken: randomUUID().replace(/-/g, ""),
      whisperChannel: "sms",
      recipientEmail: null,
      recipientPhone: "+15559871111",
    };

    const success = await deliverWhisperLink(whisp, "https://example.com");
    expect(success).toBe(true);

    const attempts = await db.select().from(deliveryAttemptsTable).where(eq(deliveryAttemptsTable.whispId, whisp.id));
    const sms = attempts.find((a) => a.channel === "sms");
    expect(sms?.success).toBe(false);
    expect(sms?.providerStatus).toBe("channel_disabled");
    expect(attempts.find((a) => a.channel === "in_app")?.success).toBe(true);

    const notifications = await db.select().from(notificationsTable).where(eq(notificationsTable.targetUserId, matchedUserId));
    expect(notifications).toHaveLength(1);
  });

  it("reports failure for an unmatched recipient while off", async () => {
    const whisp = {
      id: randomUUID(),
      publicToken: randomUUID().replace(/-/g, ""),
      whisperChannel: "whatsapp",
      recipientEmail: null,
      recipientPhone: "+15550002222",
    };
    expect(await deliverWhisperLink(whisp, "https://example.com")).toBe(false);

    const attempts = await db.select().from(deliveryAttemptsTable).where(eq(deliveryAttemptsTable.whispId, whisp.id));
    expect(attempts).toHaveLength(1);
    expect(attempts[0].channel).toBe("whatsapp");
    expect(attempts[0].providerStatus).toBe("channel_disabled");
  });
});
