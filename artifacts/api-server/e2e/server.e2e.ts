import { it } from "vitest";

// Boots the real API on E2E_API_PORT and stays up until killed. Runs under
// vitest only so e2e/setup.ts's module mocks apply (see vitest.e2e.config.ts).
it("serves the API for end-to-end runs", async () => {
  const port = Number(process.env.E2E_API_PORT ?? 4100);
  const { default: app } = await import("../src/app");
  const { startScheduledWhispDispatcher } = await import("../src/lib/scheduler");
  const { startScheduledTextWhispDispatcher } = await import("../src/lib/textWhispScheduler");
  const { startReplyNotificationScheduler } = await import("../src/lib/replyNotificationScheduler");
  await new Promise<void>((resolve) => app.listen(port, () => resolve()));
  startScheduledWhispDispatcher();
  startScheduledTextWhispDispatcher();
  startReplyNotificationScheduler();
  // eslint-disable-next-line no-console
  console.log(`[e2e] API listening on ${port}`);
  await new Promise(() => {});
});
