# SenOS take-home PoC

A minimal multi-tenant AI chat platform: one shared API key behind N organisations, each
with its own budget, department, and users — proving that per-tenant cost control and
data isolation both hold **by construction**, not by convention.

Full reasoning behind every decision below lives in the accompanying `take-home-assumptions.md`
(assumption → reason → alternative considered & its cost, submitted alongside this repo).
This README is the short version.

## Run it

```bash
cp .env.example .env      # fill in ANTHROPIC_API_KEY
docker-compose up --build
```

One command brings up Mongo + the API, seeds two demo tenants on first run, and serves
the static frontend from the same server:

- Admin dashboard: http://localhost:3000/admin.html
- Chat: http://localhost:3000/chat.html

Seeded logins (see `src/seed.ts`), each department capped at **8 requests/month** on
purpose, so the 80%/100% budget banners are reachable in a live demo without sending
hundreds of messages:

| Tenant | Admin | User | Password |
|---|---|---|---|
| Acme Corp | admin@acme.demo | user@acme.demo | `demo1234` |
| Beta Inc | admin@beta.demo | user@beta.demo | `demo1234` |

Run tests: `npm test` (unit: tenant isolation + budget logic; e2e: cross-tenant HTTP checks).

## In scope

- JWT auth, 2 roles (admin/user), invite-only onboarding (admin creates invite → gets a
  link back in the API response → shares it manually — no email infra).
- Tenant isolation enforced at the data-access layer: every tenant-scoped Mongoose model
  runs through a plugin that fails closed (throws) if a query/save happens with no
  `AsyncLocalStorage` tenant context, instead of silently leaking cross-tenant data.
- 3-tier budget: platform capacity (env var) → tenant (fixed droplist: 5k/10k/20k
  req/month) → department (free-form, admin-managed, shared pool for its users).
- Admission control at **budget-configuration time**: setting/raising a tenant's budget
  is rejected (409) if the new platform-wide total would exceed capacity — no tenant is
  ever blocked at runtime for another tenant's behaviour.
- Atomic per-department usage counter (`findOneAndUpdate` gate) so two concurrent chat
  requests near the cap can't both slip through.
- Claude API integration with the built-in `web_search` tool, toggleable per tenant.
- Usage tracking: users see only their own request count; admins see usage rolled up by
  user and by department, plus the money-shaped settings (budgets) users never see.

## Out of scope (and why)

- **Platform-admin console for SenOS itself** — brief only asked for 2 roles
  (admin/user) per tenant; a platform-wide operator console is a different product.
- **Public self-serve signup** — tenants + their first admin exist only via the seed
  script. Real B2B SaaS onboarding is usually sales-assisted anyway; building a signup
  flow doesn't prove anything the core multi-tenancy/budget logic doesn't already show.
- **Real email delivery for invites** — admin gets the raw invite link back from the API
  and shares it manually (Slack/DM/etc). No SMTP/SendGrid integration.
- **Per-head budget splitting inside a department** — a department's budget is one
  shared first-come-first-served pool, not divided per user. Simpler, avoids a
  re-slicing bug every time headcount changes mid-month; admin can still see per-user
  usage and intervene manually.
- **Browser execution / third-party search providers** — Claude's built-in web_search
  tool already demonstrates "per-tenant tools," at a fraction of the integration cost.

## Known gaps (honest about money & boundaries)

- **Admin is not budget-limited.** Admin is the account owner; this PoC doesn't handle
  an admin abusing their own unlimited access.
- **Usage tracking doesn't distinguish web-search requests from plain ones**, even
  though a search-triggering request costs more in reality ($10/1000 searches + tokens
  on top). All requests count as 1 unit for budget purposes.
- **No load-tested proof for the race condition fix.** The atomic
  `findOneAndUpdate`-based counter is designed to prevent two concurrent requests near
  the cap from both slipping through, and unit-tested for the boundary case, but never
  exercised under real concurrent load.
- **XSS vs CSRF tradeoff**: JWT lives in `localStorage`, sent via `Authorization`
  header — simpler than cookie+CSRF for a PoC, at the cost of a theoretical XSS-driven
  token theft.
- **Design bug we caught ourselves and fixed**: the first admission-control design was
  a runtime circuit-breaker blocking *all* chat platform-wide once total usage hit
  capacity — which punishes every tenant for one tenant's behaviour. Replaced with
  admission-control at budget-*configuration* time instead, so no tenant is ever
  collateral damage for another's usage. See `take-home-assumptions.md`, "Centralised
  key / cost & trust."
- **A real bug this test suite caught**: the tech-spec's original pseudocode combined
  `upsert: true` with a `count: {$lt: cap}` filter in one `findOneAndUpdate` — once a
  department's counter hit its cap, no document matches that filter, so Mongo tries to
  *insert* a new one and collides with the existing unique index entry, throwing
  `E11000` instead of returning "blocked". Fixed in `src/services/budgetService.ts` by
  separating "ensure the counter row exists" from the atomic gated increment. Caught by
  `tests/unit/budgetService.test.ts`, not by manual testing.

## If this were a real product, not an 8-hour PoC

- Silo (or hybrid) multi-tenancy instead of a shared pool, once tenant count is large.
- Real email infra (SMTP/SendGrid) for invites.
- Load-test the budget counter's atomicity under real concurrency.
- Some fairness/limit on admin usage.
