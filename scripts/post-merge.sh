#!/bin/bash
set -e

pnpm install --frozen-lockfile

# IMPORTANT: we deliberately do NOT run `drizzle-kit push` automatically here.
#
# `drizzle-kit push` reconciles the live database to the schema, and when the
# live tables have drifted from the schema it does that by DROPPING AND
# RECREATING tables — which permanently erases their rows. Running it
# unattended on every merge already wiped `text_whisps` and `whisp_replies`
# once. Schema changes must be applied deliberately, by a human, with a
# database backup taken first.
#
# When the schema has genuinely changed, apply it by hand after reviewing the
# plan drizzle prints (it prompts before any destructive change):
#   pnpm --filter db push
# Never `push --force` against a database that holds real data without a
# backup — force skips the very confirmation that would have stopped the wipe.

# Surface a loud reminder (but take no destructive action) when this merge
# actually touched the schema, so a needed migration isn't silently forgotten.
if git diff --name-only ORIG_HEAD HEAD 2>/dev/null | grep -q '^lib/db/src/schema/'; then
  echo ""
  echo "⚠️  Schema files changed in this merge — the database was NOT auto-migrated."
  echo "    Back up the database, then apply deliberately:"
  echo "      pnpm --filter db push   (review the plan; it prompts before destructive changes)"
  echo ""
fi
