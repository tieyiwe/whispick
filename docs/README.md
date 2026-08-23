# Blind Whisper — Technical Documentation

Living technical documentation for the Blind Whisper platform (blindwhisper.com).
It lives in the repository so it versions with the code.

> **Maintenance rule:** every implementation batch that changes behavior must update the
> relevant page(s) here in the same commit series. If a change adds a table, endpoint,
> scheduler, env var, or user-facing feature and no doc page changed, the batch is not done.

## Pages

| Page | Covers |
|---|---|
| [architecture.md](architecture.md) | Monorepo layout, stack, request flow, API codegen workflow, build pipeline |
| [database.md](database.md) | Every table, grouped by domain, with purpose and key columns |
| [api.md](api.md) | Router mount map and endpoint inventory by area |
| [features-whisps.md](features-whisps.md) | Video Whisps: creation, delivery, replies, credits, AI takeaways, expiration |
| [features-text-whisps.md](features-text-whisps.md) | Text Whisps, scheduling, SMS/phone verification, subscribe & matching |
| [features-community.md](features-community.md) | Blind Circles, Debate Now, follows, handles/avatars, AI content agents |
| [admin-hq.md](admin-hq.md) | The admin HQ: panel, theme, MFA, staff access control, reports, policies, analytics, projects |
| [security-auth.md](security-auth.md) | Clerk auth, admin TOTP 2FA, permissions model, rate limiting, privacy rules |
| [i18n.md](i18n.md) | Languages, namespaces, translation conventions, RTL |
| [operations.md](operations.md) | Environments, deploy runbook, databases, env vars, testing, schedulers |

## Ground rules that apply everywhere

- **Product terms stay in English in all languages:** Blind Whisper, Whisp(s), Whisper Link(s),
  Whisperer(s), Blind Circle(s), Debate Now, Town Crier, Circle Scout, Ghost Boost.
- **Ghost Boost is currently disabled** and must not appear in public metadata or marketing.
- Private links (`/w/…`, `/tw/…`) are secrets — never logged, never indexed, never shared in
  marketing material.
- The admin panel and legal pages are English-only by convention.
