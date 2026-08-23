import { vi, afterEach, afterAll } from "vitest";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/whispick_test";
process.env.PORT ??= "0";
process.env.NODE_ENV = "test";
process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";

// lib/adminMfa.ts signs unlock tokens with this (falls back to
// CLERK_SECRET_KEY in production, which tests don't set).
process.env.ADMIN_MFA_TOKEN_SECRET = "test-admin-mfa-secret";

export const TEST_USER_HEADER = "x-test-user";

// Defaults every mocked Clerk account to 2FA-enabled so the ~400 existing
// tests that never think about MFA (and every admin-route test that isn't
// specifically exercising the requirement) aren't all forced to opt in —
// same "harmless, controllable default" spirit as anthropicMessagesCreateMock
// below. adminAuth.test.ts overrides this per-test (mockResolvedValueOnce)
// to actually exercise the requireAdmin MFA gate.
export const clerkGetUserMock = vi.fn(async (_userId: string) => ({ twoFactorEnabled: true }));

vi.mock("@clerk/express", () => ({
  getAuth: (req: any) => ({ userId: req.headers[TEST_USER_HEADER] ?? null }),
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  clerkClient: { users: { getUser: (userId: string) => clerkGetUserMock(userId) } },
}));

// Global mock so every test file gets a harmless, controllable Claude client
// instead of making real API calls. Import this from a test file and use
// mockResolvedValueOnce/mockRejectedValueOnce to script specific responses.
export const anthropicMessagesCreateMock = vi.fn(async (..._args: any[]) => ({
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
  // mockReset (not mockClear) — a test that queued a one-off override via
  // mockResolvedValueOnce/mockRejectedValueOnce must never have it carry
  // over and silently affect the next, unrelated test's admin requests.
  clerkGetUserMock.mockReset();
  clerkGetUserMock.mockResolvedValue({ twoFactorEnabled: true });
  const { pool } = await import("@workspace/db");
  await pool.query(
    "TRUNCATE TABLE tracking_events, whisp_replies, credit_transactions, push_subscriptions, whisp_categories, whisps, circle_members, circles, circle_comments, circle_post_likes, whisper_group_members, whisper_groups, uploaded_videos, match_subscribers, suggested_videos, suggestion_agent_status, delivery_attempts, notification_reads, notifications, moderation_flags, content_reports, admin_mfa, policy_versions, policy_acceptances, feature_events, admin_grants, hq_task_comments, hq_tasks, hq_projects, concierge_requests, invites, text_whisp_replies, text_whisps, debate_topic_comments, debate_topics, debate_agent_settings, circle_agent_settings, anonymous_handles, comment_reactions, debate_topic_rewhisps, follows, admin_audit_log, whisper_box_messages, users RESTART IDENTITY CASCADE",
  );
});

afterAll(async () => {
  const { pool } = await import("@workspace/db");
  await pool.end();
});
