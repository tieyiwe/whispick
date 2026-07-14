import { vi, afterEach, afterAll } from "vitest";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/whispick_test";
process.env.PORT ??= "0";
process.env.NODE_ENV = "test";

export const TEST_USER_HEADER = "x-test-user";

vi.mock("@clerk/express", () => ({
  getAuth: (req: any) => ({ userId: req.headers[TEST_USER_HEADER] ?? null }),
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

afterEach(async () => {
  const { pool } = await import("@workspace/db");
  await pool.query(
    "TRUNCATE TABLE tracking_events, whisp_replies, credit_transactions, push_subscriptions, whisps, circle_members, circles, users RESTART IDENTITY CASCADE",
  );
});

afterAll(async () => {
  const { pool } = await import("@workspace/db");
  await pool.end();
});
