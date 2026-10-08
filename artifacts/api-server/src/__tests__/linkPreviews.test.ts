import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";
import { db, whispsTable, invitesTable, textWhispsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { inviteShareUrl, textWhispShareUrl, isLinkPreviewBot, isPublicCrawler } from "../lib/linkPreview";

// Captures what the invite dispatch actually sends, without a real provider.
const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn(async (..._args: unknown[]) => true) }));
vi.mock("../lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/email")>();
  return { ...actual, sendEmail: sendEmailMock };
});

const BROWSER_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const WHATSAPP_UA = "WhatsApp/2.23.20 A";
const IMESSAGE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0";

// One real-world-shaped UA per messaging/social app the previews must unfurl in.
const PREVIEW_BOT_UAS: Record<string, string> = {
  iMessage: IMESSAGE_UA,
  WhatsApp: WHATSAPP_UA,
  Signal: "WhatsApp/2",
  Telegram: "TelegramBot (like TwitterBot)",
  Discord: "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
  Slack: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  Snapchat: "Mozilla/5.0 (compatible; Snap URL Preview Service; bot; snapchat; https://developers.snap.com/robots)",
  LinkedIn: "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
  X: "Twitterbot/1.0",
  Facebook: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  Reddit: "Mozilla/5.0 (compatible; redditbot/1.0; +http://www.reddit.com/feedback)",
  Bluesky: "Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)",
  Mastodon: "http.rb/5.1.1 (Mastodon/4.2.0; +https://mastodon.social/)",
  GoogleMessages: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 GoogleMessages",
  Teams: "Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5 skype-url-preview@microsoft.com",
  Outlook: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MicrosoftPreview/2.0 +https://aka.ms/MicrosoftPreview",
};
const AI_CRAWLER_UAS = [
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
  "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
];

const ogImage = (html: string) => html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];

async function ensureUserId(clerkId: string): Promise<string> {
  const res = await request(app).get("/api/user/profile").set(TEST_USER_HEADER, clerkId);
  return res.body.id as string;
}

async function insertWhisp(overrides: Partial<typeof whispsTable.$inferInsert> = {}) {
  const publicToken = randomUUID().replace(/-/g, "");
  await db.insert(whispsTable).values({
    id: randomUUID(),
    senderId: await ensureUserId(`clerk_preview_sender_${randomUUID()}`),
    videoUrl: "https://youtu.be/dQw4w9WgXcQ",
    videoTitle: "My Secret Crush Confession",
    videoThumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    deliveryMethod: "whisper_link",
    whisperChannel: "email",
    recipientEmail: "recipient.person@example.com",
    anonymousNote: "I have always admired you from afar",
    senderAlias: "Your Secret Admirer Jamie",
    moodTag: "i-love-you",
    status: "delivered",
    deliveredAt: new Date(),
    publicToken,
    ...overrides,
  });
  return publicToken;
}

function expectPrivatePreview(res: request.Response) {
  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toContain("text/html");
  expect(res.text).toContain('<meta name="robots" content="noindex, nofollow" />');
  expect(res.headers["x-robots-tag"]).toContain("noindex");
  expect(res.text).toContain('property="og:site_name" content="Blind Whisper"');
  expect(res.text).toContain('name="twitter:card" content="summary_large_image"');
  expect(res.text).toContain('property="og:image:width" content="1200"');
  expect(res.text).toContain('property="og:image:height" content="630"');
  expect(res.text).toMatch(/property="og:image:alt" content="[^"]+"/);
  const image = ogImage(res.text);
  expect(image).toBeDefined();
  expect(() => new URL(image!)).not.toThrow();
  expect(image).toContain("/api/og/");
}

describe("whisp links (/api/l/:token)", () => {
  it("redirects a real browser into the app", async () => {
    const token = await insertWhisp();
    const res = await request(app).get(`/api/l/${token}`).set("User-Agent", BROWSER_UA);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`/w/${token}`);
  });

  it("gives crawlers a curiosity card that leaks nothing about the whisp", async () => {
    const token = await insertWhisp();
    const res = await request(app).get(`/api/l/${token}`).set("User-Agent", WHATSAPP_UA);

    expectPrivatePreview(res);
    expect(res.text).toContain("Someone sent you something 👀");
    expect(res.text).toContain("It&#39;s anonymous. Open it to see what they wanted you to hear.");
    // No title, thumbnail, note, alias, or recipient contact.
    for (const secret of ["Secret Crush", "ytimg.com", "admired you", "Admirer Jamie", "recipient.person", "example.com"]) {
      expect(res.text, secret).not.toContain(secret);
    }
    // The mood tints the card; the image URL never carries the token.
    expect(ogImage(res.text)).toMatch(/\/api\/og\/whisp\/i-love-you\.png$/);
    expect(ogImage(res.text)).not.toContain(token);
    // og:url is the preview URL itself, not the SPA page (Facebook re-scrapes og:url).
    expect(res.text).toContain(`property="og:url" content="http://`);
    expect(res.text).toContain(`/api/l/${token}"`);
  });

  it("uses a neutral card when the whisp has no mood", async () => {
    const token = await insertWhisp({ moodTag: null });
    const res = await request(app).get(`/api/l/${token}`).set("User-Agent", WHATSAPP_UA);
    expect(ogImage(res.text)).toMatch(/\/api\/og\/whisp\/none\.png$/);
  });

  it("frames a Blind Circle post as one, still without the poster or video", async () => {
    const token = await insertWhisp({ deliveryMethod: "circle_drop", whisperChannel: null, recipientEmail: null });
    const res = await request(app).get(`/api/l/${token}`).set("User-Agent", WHATSAPP_UA);

    expectPrivatePreview(res);
    expect(res.text).toContain("An anonymous post on Blind Circle");
    expect(res.text).toContain("join the conversation");
    expect(ogImage(res.text)).toMatch(/\/api\/og\/circle\.png$/);
    expect(res.text).not.toContain("Secret Crush");
    expect(res.text).not.toContain("Admirer Jamie");
  });

  it("never unfurls a taken-down, scheduled, cancelled or unknown whisp", async () => {
    const removed = await insertWhisp({ removedByAdminAt: new Date() });
    const scheduled = await insertWhisp({ status: "scheduled", deliveredAt: null });
    const cancelled = await insertWhisp({ status: "cancelled", deliveredAt: null });
    for (const token of [removed, scheduled, cancelled, "does-not-exist"]) {
      const res = await request(app).get(`/api/l/${token}`).set("User-Agent", WHATSAPP_UA);
      expect(res.status, token).toBe(302);
    }
  });

  it("unfurls in every major messaging/social app", async () => {
    const token = await insertWhisp();
    for (const [app_, ua] of Object.entries(PREVIEW_BOT_UAS)) {
      const res = await request(app).get(`/api/l/${token}`).set("User-Agent", ua);
      expect(res.status, `${app_} should get the preview`).toBe(200);
    }
  });

  it("doesn't render private links for AI crawlers", async () => {
    const token = await insertWhisp();
    for (const ua of AI_CRAWLER_UAS) {
      const res = await request(app).get(`/api/l/${token}`).set("User-Agent", ua);
      expect(res.status, ua).toBe(302);
    }
  });
});

describe("Whisper Box links (/wb/:handle)", () => {
  async function enableBox() {
    const clerkId = `clerk_preview_wb_${randomUUID()}`;
    await ensureUserId(clerkId);
    const res = await request(app).post("/api/whisper-box/enable").set(TEST_USER_HEADER, clerkId);
    return { clerkId, handle: res.body.handle as string };
  }

  it("invites people to send the owner an anonymous message, with a generated card", async () => {
    const { handle } = await enableBox();
    const res = await request(app).get(`/wb/${handle}`).set("User-Agent", IMESSAGE_UA);

    expect(res.status).toBe(200);
    expect(res.text).toContain(`property="og:title" content="Send @${handle} an anonymous message 🤫"`);
    expect(res.text).toContain("They&#39;ll never know it was you. 100% anonymous — no account needed.");
    expect(ogImage(res.text)).toMatch(new RegExp(`/api/og/whisperbox/${handle}\\.png$`));
    // Shared publicly by its owner — not a private link.
    expect(res.text).not.toContain("noindex");
  });

  it("redirects a browser, and never unfurls an unknown handle", async () => {
    const { handle } = await enableBox();
    const browser = await request(app).get(`/wb/${handle}`).set("User-Agent", BROWSER_UA);
    expect(browser.status).toBe(302);
    expect(browser.headers.location).toContain(`/whisper-box/${handle}`);

    const unknown = await request(app).get(`/wb/${randomUUID()}`).set("User-Agent", IMESSAGE_UA);
    expect(unknown.status).toBe(302);
  });
});

describe("invite links (/iv/:token)", () => {
  async function insertInvite() {
    const publicToken = randomUUID().replace(/-/g, "");
    await db.insert(invitesTable).values({
      id: randomUUID(),
      inviterUserId: await ensureUserId(`clerk_preview_inviter_${randomUUID()}`),
      channel: "email",
      recipientEmail: "invitee.person@example.com",
      publicToken,
    });
    return publicToken;
  }

  it("sends new invites as the /iv preview link", async () => {
    sendEmailMock.mockClear();
    const res = await request(app)
      .post("/api/invites")
      .set(TEST_USER_HEADER, `clerk_preview_inviter_${randomUUID()}`)
      .send({ channel: "email", recipientEmail: "friend@example.com" });
    expect(res.status).toBe(201);
    await vi.waitFor(() => expect(sendEmailMock).toHaveBeenCalled());
    const html = String(sendEmailMock.mock.calls[0][2]);
    expect(html).toMatch(/\/iv\/[0-9a-f]{32}/);
    expect(html).not.toMatch(/\/invite\/[0-9a-f]{32}/);
  });

  it("builds /iv URLs", () => {
    expect(inviteShareUrl("https://blindwhisper.com", "abc123")).toBe("https://blindwhisper.com/iv/abc123");
  });

  it("redirects a browser to the invite page (where old /invite/ links already go)", async () => {
    const token = await insertInvite();
    const res = await request(app).get(`/iv/${token}`).set("User-Agent", BROWSER_UA);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`/invite/${token}`);
  });

  it("gives crawlers an anonymous, curiosity-first invite card", async () => {
    const token = await insertInvite();
    const res = await request(app).get(`/iv/${token}`).set("User-Agent", WHATSAPP_UA);

    expectPrivatePreview(res);
    expect(res.text).toContain("Someone invited you to Blind Whisper 👀");
    expect(res.text).toContain("Someone thinks you should be here.");
    expect(ogImage(res.text)).toMatch(/\/api\/og\/invite\.png$/);
    expect(ogImage(res.text)).not.toContain(token);
    expect(res.text).not.toContain("invitee.person");
  });

  it("doesn't unfurl an unknown invite", async () => {
    const res = await request(app).get(`/iv/${randomUUID().replace(/-/g, "")}`).set("User-Agent", WHATSAPP_UA);
    expect(res.status).toBe(302);
  });
});

describe("Text Whisp links (/tx/:token)", () => {
  async function insertTextWhisp(overrides: Partial<typeof textWhispsTable.$inferInsert> = {}) {
    const publicToken = randomUUID().replace(/-/g, "");
    const id = randomUUID();
    await db.insert(textWhispsTable).values({
      id,
      senderId: await ensureUserId(`clerk_preview_tw_${randomUUID()}`),
      recipientPhone: "+15557654321",
      messageText: "You light up every room you walk into",
      senderAlias: "Mystery Morgan",
      publicToken,
      ...overrides,
    });
    return { id, publicToken };
  }

  it("builds /tx URLs", () => {
    expect(textWhispShareUrl("https://blindwhisper.com", "abc123")).toBe("https://blindwhisper.com/tx/abc123");
  });

  it("redirects a browser to the guest page (where old /tw/ links already go)", async () => {
    const { publicToken } = await insertTextWhisp();
    const res = await request(app).get(`/tx/${publicToken}`).set("User-Agent", BROWSER_UA);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`/tw/${publicToken}`);
  });

  it("gives crawlers a card without the note, alias or phone — and doesn't mark it read", async () => {
    const { id, publicToken } = await insertTextWhisp();
    const res = await request(app).get(`/tx/${publicToken}`).set("User-Agent", WHATSAPP_UA);

    expectPrivatePreview(res);
    expect(res.text).toContain("Someone wrote you an anonymous note ✉️");
    expect(res.text).toContain("they&#39;ll stay anonymous unless they choose otherwise");
    expect(ogImage(res.text)).toMatch(/\/api\/og\/textwhisp\.png$/);
    for (const secret of ["light up every room", "Mystery Morgan", "5557654321"]) {
      expect(res.text, secret).not.toContain(secret);
    }
    const row = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, id)).then((r) => r[0]!);
    expect(row.readAt).toBeNull();
    expect(row.status).toBe("sent");
  });

  it("doesn't unfurl a removed, scheduled or cancelled note", async () => {
    const removed = await insertTextWhisp({ removedByAdminAt: new Date() });
    const scheduled = await insertTextWhisp({ status: "scheduled" });
    const cancelled = await insertTextWhisp({ status: "cancelled" });
    for (const { publicToken } of [removed, scheduled, cancelled]) {
      const res = await request(app).get(`/tx/${publicToken}`).set("User-Agent", WHATSAPP_UA);
      expect(res.status).toBe(302);
    }
  });
});

describe("debate topic links (/dt/:id)", () => {
  it("points og:image at a generated card for the question, keeping the crawler content", async () => {
    const res0 = await request(app)
      .post("/api/debate-topics")
      .set(TEST_USER_HEADER, `clerk_preview_dt_${randomUUID()}`)
      .send({ topicText: "Would you rather know every truth or keep your illusions?" });
    const id = res0.body.id as string;

    const res = await request(app).get(`/dt/${id}`).set("User-Agent", WHATSAPP_UA);
    expect(res.status).toBe(200);
    expect(ogImage(res.text)).toMatch(new RegExp(`/api/og/debate/${id}\\.png$`));
    expect(res.text).toContain('property="og:image:alt"');
    expect(res.text).toContain("Join this debate and answer 100% anonymously");
    expect(res.text).toContain("application/ld+json");
  });
});

describe("crawler detection", () => {
  it("keeps AI/search-only crawlers out of the private-link list but in the public one", () => {
    for (const ua of AI_CRAWLER_UAS) {
      expect(isLinkPreviewBot(ua), ua).toBe(false);
      expect(isPublicCrawler(ua), ua).toBe(true);
    }
    expect(isLinkPreviewBot(BROWSER_UA)).toBe(false);
    expect(isPublicCrawler(BROWSER_UA)).toBe(false);
  });
});

describe("GET /api/og/* (generated preview images)", () => {
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  async function getPng(path: string) {
    const res = await request(app).get(path).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    return res as request.Response & { body: Buffer };
  }

  function expectCard(res: request.Response & { body: Buffer }) {
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.body.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    // WhatsApp ignores og:images over ~300 KB.
    expect(res.body.length).toBeGreaterThan(10_000);
    expect(res.body.length).toBeLessThan(300_000);
    // 1200×630, read straight from the IHDR chunk.
    expect(res.body.readUInt32BE(16)).toBe(1200);
    expect(res.body.readUInt32BE(20)).toBe(630);
  }

  it("serves the default card, cached for a day", { timeout: 30_000 }, async () => {
    const res = await getPng("/api/og/default.png");
    expectCard(res);
    expect(res.headers["cache-control"]).toBe("public, max-age=86400");
  });

  it("serves the fixed cards for private links, ignoring any id", { timeout: 60_000 }, async () => {
    for (const path of ["/api/og/whisp/i-love-you.png", "/api/og/whisp/none.png", "/api/og/invite.png", "/api/og/textwhisp.png", "/api/og/circle.png", "/api/og/debate.png"]) {
      expectCard(await getPng(path));
    }
    // A token-shaped id (or any unknown mood) gets the same neutral card —
    // the endpoint is no oracle for whether a token exists.
    const neutral = await getPng("/api/og/whisp/none.png");
    const withToken = await getPng(`/api/og/whisp/${randomUUID().replace(/-/g, "")}.png`);
    expect(withToken.body.equals(neutral.body)).toBe(true);
    const invite = await getPng("/api/og/invite.png");
    const inviteWithId = await getPng(`/api/og/invite/${randomUUID()}.png`);
    expect(inviteWithId.body.equals(invite.body)).toBe(true);
  });

  it("renders a live debate's question, and the default card for an unknown or retracted one", { timeout: 60_000 }, async () => {
    const userId = `clerk_preview_og_dt_${randomUUID()}`;
    const created = await request(app).post("/api/debate-topics").set(TEST_USER_HEADER, userId).send({ topicText: "Is it ever okay to read your partner's texts?" });
    const id = created.body.id as string;

    const fallback = await getPng("/api/og/default.png");
    const live = await getPng(`/api/og/debate/${id}.png`);
    expectCard(live);
    expect(live.headers["cache-control"]).toBe("public, max-age=3600");
    expect(live.body.equals(fallback.body)).toBe(false);

    const unknown = await getPng(`/api/og/debate/${randomUUID()}.png`);
    expect(unknown.status).toBe(200);
    expect(unknown.body.equals(fallback.body)).toBe(true);

    await request(app).delete(`/api/debate-topics/${id}`).set(TEST_USER_HEADER, userId);
    const retracted = await getPng(`/api/og/debate/${id}.png`);
    expect(retracted.body.equals(fallback.body)).toBe(true);
  });

  it("renders an enabled Whisper Box, and the default card once it's disabled", { timeout: 60_000 }, async () => {
    const clerkId = `clerk_preview_og_wb_${randomUUID()}`;
    await ensureUserId(clerkId);
    const handle = (await request(app).post("/api/whisper-box/enable").set(TEST_USER_HEADER, clerkId)).body.handle as string;

    const fallback = await getPng("/api/og/default.png");
    const box = await getPng(`/api/og/whisperbox/${handle}.png`);
    expectCard(box);
    expect(box.headers["cache-control"]).toBe("public, max-age=3600");
    expect(box.body.equals(fallback.body)).toBe(false);

    await request(app).post("/api/whisper-box/disable").set(TEST_USER_HEADER, clerkId);
    const disabled = await getPng(`/api/og/whisperbox/${handle}.png`);
    expect(disabled.body.equals(fallback.body)).toBe(true);
  });

  it("falls back to the default card for an unknown kind", { timeout: 30_000 }, async () => {
    const fallback = await getPng("/api/og/default.png");
    const unknown = await getPng("/api/og/nonsense.png");
    expect(unknown.status).toBe(200);
    expect(unknown.body.equals(fallback.body)).toBe(true);
  });
});
