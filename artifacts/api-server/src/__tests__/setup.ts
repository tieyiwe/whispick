import { vi, afterEach, afterAll } from "vitest";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/whispick_test";
process.env.PORT ??= "0";
process.env.NODE_ENV = "test";
process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";

export const TEST_USER_HEADER = "x-test-user";

vi.mock("@clerk/express", () => ({
  getAuth: (req: any) => ({ userId: req.headers[TEST_USER_HEADER] ?? null }),
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

// Global mock so every test file gets a harmless, controllable Claude client
// instead of making real API calls. Import this from a test file and use
// mockResolvedValueOnce/mockRejectedValueOnce to script specific responses.
export const anthropicMessagesCreateMock = vi.fn(async () => ({
  content: [{ type: "text", text: "Default mock takeaway." }],
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: anthropicMessagesCreateMock };
  },
}));

// Global default: skip the one-time demographic-confirmation gate (see
// lib/demographics.ts) so the hundred-plus existing tests that send a whisp
// without first answering it aren't all forced to do that dance — same
// spirit as mocking Clerk/Anthropic above, a cross-cutting concern unrelated
// tests shouldn't have to think about. demographics.test.ts overrides this
// back to the real implementation to actually exercise the gate.
vi.mock("../lib/demographics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/demographics")>();
  return { ...actual, needsDemographics: () => false };
});

afterEach(async () => {
  anthropicMessagesCreateMock.mockClear();
  const { pool } = await import("@workspace/db");
  await pool.query(
    "TRUNCATE TABLE tracking_events, whisp_replies, credit_transactions, push_subscriptions, whisp_categories, whisps, circle_members, circles, whisper_group_members, whisper_groups, uploaded_videos, match_subscribers, suggested_videos, suggestion_agent_status, delivery_attempts, notification_reads, notifications, moderation_flags, users RESTART IDENTITY CASCADE",
  );
});

afterAll(async () => {
  const { pool } = await import("@workspace/db");
  await pool.end();
});
