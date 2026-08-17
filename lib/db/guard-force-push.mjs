// Safety gate in front of `drizzle-kit push --force`.
//
// Plain `drizzle-kit push` prompts for confirmation before any destructive
// change (and aborts rather than applying one when it's run without a
// terminal, e.g. in automation) — that prompt is the safety net. `--force`
// deliberately skips it, which is exactly how a schema drift can silently
// DROP AND RECREATE tables and erase their rows.
//
// So force-push is refused unless a human explicitly acknowledges the risk
// via an env var. Nothing in the deploy/merge/startup pipeline sets it, so no
// deployment can ever reach the destructive path — only a person who has
// taken a backup and typed the acknowledgement on purpose.
if (process.env.I_UNDERSTAND_FORCE_PUSH_CAN_DELETE_DATA !== "yes") {
  console.error(
    [
      "",
      "  ✋ Refusing to run `drizzle-kit push --force`.",
      "",
      "  --force skips the confirmation that stops destructive changes and CAN",
      "  DROP TABLES AND PERMANENTLY ERASE DATA if the live database has drifted",
      "  from the schema.",
      "",
      "  If you really mean it: take a database backup first, then re-run with",
      "",
      "    I_UNDERSTAND_FORCE_PUSH_CAN_DELETE_DATA=yes pnpm --filter db push-force",
      "",
      "  For ordinary schema changes use `pnpm --filter db push` instead — it",
      "  prompts before anything destructive.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
