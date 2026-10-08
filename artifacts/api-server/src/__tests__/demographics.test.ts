import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";

// Overrides setup.ts's blanket "skip the gate" mock back to the real
// implementation — this file is specifically about testing that gate, every
// other test file gets the bypass so it doesn't have to care.
vi.mock("../lib/demographics", async (importOriginal) => importOriginal());

const { needsDemographics, GENDER_OPTIONS, AGE_RANGE_OPTIONS } = await import("../lib/demographics");
const { default: app } = await import("../app");

const USER_A = "clerk_demographics_sender";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

describe("needsDemographics", () => {
  it("is true until gender, ageRange, and preferredLanguage are all answered", () => {
    expect(needsDemographics({ gender: null, ageRange: null, preferredLanguage: null })).toBe(true);
    expect(needsDemographics({ gender: "woman", ageRange: null, preferredLanguage: null })).toBe(true);
    expect(needsDemographics({ gender: null, ageRange: "25-34", preferredLanguage: null })).toBe(true);
    expect(needsDemographics({ gender: "woman", ageRange: "25-34", preferredLanguage: null })).toBe(true);
    expect(needsDemographics({ gender: "woman", ageRange: "25-34", preferredLanguage: "en" })).toBe(false);
  });

  it("treats 'prefer_not_to_say' as a real, satisfying answer for gender/ageRange", () => {
    expect(needsDemographics({ gender: "prefer_not_to_say", ageRange: "prefer_not_to_say", preferredLanguage: "en" })).toBe(false);
  });

  it("has no 'prefer not to say' escape hatch for preferredLanguage — it must be a real supported code", () => {
    expect(needsDemographics({ gender: "woman", ageRange: "25-34", preferredLanguage: "prefer_not_to_say" })).toBe(true);
    expect(needsDemographics({ gender: "woman", ageRange: "25-34", preferredLanguage: "xx" })).toBe(true);
  });
});

describe("first-whisp demographic gate", () => {
  it("blocks sending until gender, ageRange, and preferredLanguage are confirmed, then lets the same send through", async () => {
    const blocked = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop" });

    expect(blocked.status).toBe(428);
    expect(blocked.body.code).toBe("demographics_required");

    // Confirming gender/ageRange alone still isn't enough — preferredLanguage
    // has no "prefer not to say" escape hatch.
    const partial = await request(app)
      .patch("/api/user/profile")
      .set(asUser(USER_A))
      .send({ gender: "nonbinary", ageRange: "25-34" });
    expect(partial.status).toBe(200);
    const stillBlocked = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop" });
    expect(stillBlocked.status).toBe(428);

    const confirm = await request(app)
      .patch("/api/user/profile")
      .set(asUser(USER_A))
      .send({ preferredLanguage: "en" });
    expect(confirm.status).toBe(200);
    expect(confirm.body.gender).toBe("nonbinary");
    expect(confirm.body.ageRange).toBe("25-34");
    expect(confirm.body.preferredLanguage).toBe("en");

    const retried = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop" });
    expect(retried.status).toBe(201);
  });

  it("never re-blocks after all three fields are answered once", async () => {
    await request(app)
      .patch("/api/user/profile")
      .set(asUser(USER_A))
      .send({ gender: "prefer_not_to_say", ageRange: "prefer_not_to_say", preferredLanguage: "sw" });

    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/whisps")
        .set(asUser(USER_A))
        .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop" });
      expect(res.status).toBe(201);
    }
  });

  it("rejects a value outside the fixed option set", async () => {
    await request(app).get("/api/user/profile").set(asUser(USER_A)); // ensure the row exists
    const res = await request(app)
      .patch("/api/user/profile")
      .set(asUser(USER_A))
      .send({ gender: "not-a-real-option", ageRange: "25-34" });
    expect(res.status).toBe(400);

    const user = await db.select().from(usersTable).where(eq(usersTable.clerkId, USER_A)).then((r) => r[0]);
    expect(user?.gender).toBeNull();
  });

  it("rejects a preferredLanguage outside the supported set", async () => {
    await request(app).get("/api/user/profile").set(asUser(USER_A));
    const res = await request(app)
      .patch("/api/user/profile")
      .set(asUser(USER_A))
      .send({ preferredLanguage: "xx" });
    expect(res.status).toBe(400);
  });

  it("keeps the fixed option sets small and exact", () => {
    expect(GENDER_OPTIONS).toEqual(["woman", "man", "nonbinary", "prefer_not_to_say"]);
    expect(AGE_RANGE_OPTIONS).toEqual(["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+", "prefer_not_to_say"]);
  });
});
