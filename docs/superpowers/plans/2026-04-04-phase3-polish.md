# Phase 3: Polish — Testing, Analytics, Settings, Deployment

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add comprehensive test coverage, complete analytics dashboards, finish settings pages, and prepare for deployment.

**Architecture:** Vitest for unit/integration tests, Playwright for E2E tests. Analytics via SQL aggregation queries. Deployment to Railway (API + Worker) and Netlify (Frontend).

**Tech Stack:** Vitest, Playwright, PostgreSQL aggregation queries, Railway, Netlify

**Spec Reference:** `docs/superpowers/specs/2026-04-04-user-stories-design.md` — Epics 7 (analytics), 9, 10, 11

**Dependencies:** Phase 1 + Phase 2 must be complete

---

## Task 1: Unit Tests — Broadcasts

**Files:**
- Create: `apps/api/src/routes/broadcasts.test.ts`

Covers: US-7.1 through US-7.17

- [ ] **Step 1: Write broadcast CRUD tests**

Test cases:
- Create broadcast (valid input → 201)
- Create broadcast (missing messageText → 422)
- List broadcasts (returns org-scoped results)
- Update draft broadcast (valid → 200)
- Update non-draft broadcast (→ 400)
- Delete draft broadcast (→ 200)
- Delete sent broadcast (→ 400)
- Duplicate broadcast (→ 201, status=draft)
- User role can only see own broadcasts
- Admin role sees all org broadcasts

- [ ] **Step 2: Run tests**

Run: `cd apps/api && npx vitest run src/routes/broadcasts.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/broadcasts.test.ts
git commit -m "test: add comprehensive broadcast route tests"
```

---

## Task 2: Unit Tests — Messages

**Files:**
- Create: `apps/api/src/routes/messages.test.ts`

Covers: US-6.9 through US-6.14

- [ ] **Step 1: Write message CRUD tests**

Test cases:
- Send message (valid → 201)
- Send message to non-existent chat (→ 404)
- Send message to other org's chat (→ 403)
- List messages with cursor pagination
- Edit own message (→ 200, editedAt set)
- Edit other's message (→ 403)
- Delete own message (→ 200)
- Delete other's message (→ 403)
- Pin message (→ 200, isPinned=true)
- Forward message (→ 201, forwarded text format)
- Search messages by text
- Add/remove reactions

- [ ] **Step 2: Run tests**

Run: `cd apps/api && npx vitest run src/routes/messages.test.ts`

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/messages.test.ts
git commit -m "test: add message route tests (send, edit, delete, pin, forward, reactions)"
```

---

## Task 3: Unit Tests — Auth (Password Reset)

**Files:**
- Modify: `apps/api/src/routes/auth.test.ts`

Covers: US-1.6

- [ ] **Step 1: Add password reset tests to existing auth.test.ts**

Test cases:
- Forgot password with existing email → 200 (token created)
- Forgot password with non-existing email → 200 (same response, no token created)
- Reset password with valid token → 200
- Reset password with expired token → 400
- Reset password with used token → 400
- Reset password with invalid token → 400
- After reset: old refresh tokens invalidated
- Rate limiting: 5 requests per minute

- [ ] **Step 2: Run tests**

Run: `cd apps/api && npx vitest run src/routes/auth.test.ts`

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/auth.test.ts
git commit -m "test: add password reset tests to auth route tests"
```

---

## Task 4: Unit Tests — Worker (Broadcast Processing)

**Files:**
- Create: `apps/worker/src/broadcast.test.ts`

Covers: US-7.6, US-7.9, US-7.15, US-7.16

- [ ] **Step 1: Write worker tests with mocked adapters**

Test cases:
- processBroadcastSend: groups by messenger, respects antiban delays
- processBroadcastSend: marks failed chats, calculates delivery rate
- processBroadcastRetry: exponential backoff (delay × 2^attempt)
- processBroadcastRetry: marks retry_exhausted after max attempts
- finalizeBroadcast: status=sent when all succeed
- finalizeBroadcast: status=partially_failed when some fail
- finalizeBroadcast: status=failed when all fail
- Idempotency: re-processing already-sent broadcast skips sent chats
- Rate limit: stops sending when daily limit reached

- [ ] **Step 2: Run tests**

Run: `cd apps/worker && npx vitest run src/broadcast.test.ts`

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/broadcast.test.ts
git commit -m "test: add broadcast worker tests with mocked adapters"
```

---

## Task 5: Broadcast Analytics API

**Files:**
- Create: `apps/api/src/routes/broadcast-analytics.ts`

Covers: US-7.11

- [ ] **Step 1: Create analytics endpoint**

```typescript
// GET /api/broadcasts/analytics
// Query params: period (week|month|quarter), messengerFilter, createdBy
// Returns: global metrics + per-messenger breakdown

fastify.get('/broadcasts/analytics', { preHandler: [authenticate] }, async (request, reply) => {
  const { period, messenger, createdBy } = request.query as { period?: string; messenger?: string; createdBy?: string };

  const orgId = request.user.organizationId!;
  const dateFilter = getDateFilter(period ?? 'month'); // Helper: returns { gte: Date }

  const where: Record<string, unknown> = {
    organizationId: orgId,
    createdAt: dateFilter,
  };
  if (messenger) where.messenger = messenger;
  if (createdBy) where.createdById = createdBy;
  // User role: only own broadcasts
  if (request.user.role === 'user') where.createdById = request.user.id;

  const broadcasts = await prisma.broadcast.findMany({
    where,
    include: { broadcastChats: { select: { status: true, chat: { select: { messenger: true } } } } },
  });

  // Aggregate metrics
  const total = broadcasts.length;
  let totalSent = 0, totalDelivered = 0, totalFailed = 0;
  const byMessenger: Record<string, { sent: number; delivered: number; failed: number }> = {};

  for (const b of broadcasts) {
    for (const bc of b.broadcastChats) {
      const m = bc.chat.messenger;
      if (!byMessenger[m]) byMessenger[m] = { sent: 0, delivered: 0, failed: 0 };
      totalSent++;
      byMessenger[m].sent++;
      if (bc.status === 'sent') { totalDelivered++; byMessenger[m].delivered++; }
      if (bc.status === 'failed' || bc.status === 'retry_exhausted') { totalFailed++; byMessenger[m].failed++; }
    }
  }

  return reply.send({
    global: {
      totalBroadcasts: total,
      totalMessages: totalSent,
      deliveryRate: totalSent > 0 ? totalDelivered / totalSent : 0,
      failedCount: totalFailed,
    },
    byMessenger: Object.entries(byMessenger).map(([m, stats]) => ({
      messenger: m,
      ...stats,
      deliveryRate: stats.sent > 0 ? stats.delivered / stats.sent : 0,
    })),
  });
});
```

- [ ] **Step 2: Register route in main app**

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/broadcast-analytics.ts apps/api/src/app.ts
git commit -m "feat: add broadcast analytics API endpoint"
```

---

## Task 6: Frontend — Broadcast Analytics Page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/broadcast/analytics/page.tsx`

Covers: US-7.11

- [ ] **Step 1: Implement analytics page**

Layout:
1. Period selector (Week / Month / Quarter / Custom)
2. Messenger filter (multi-select chips)
3. Global metrics cards (Total Broadcasts, Messages Sent, Delivery Rate, Failed)
4. Per-messenger breakdown table
5. Optional: simple bar chart using CSS (no chart library needed for MVP)

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/(dashboard)/broadcast/analytics/page.tsx
git commit -m "feat: implement broadcast analytics page with metrics and messenger breakdown"
```

---

## Task 7: Frontend — Activity Log Page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/activity/page.tsx`

Covers: US-9.1 through US-9.5

- [ ] **Step 1: Implement activity log page**

Layout:
1. Filter bar: User dropdown, Action category checkboxes, Date range picker
2. Activity feed: chronological list with timestamps, user name, action, clickable target
3. Pagination (load more button)

Use `GET /api/activity?userId=X&category=Y&from=Z&to=W&limit=50&offset=0`

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/(dashboard)/activity/page.tsx
git commit -m "feat: implement activity log page with filters and navigation"
```

---

## Task 8: Frontend — Complete Settings Page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/settings/page.tsx`
- Modify: `apps/web/src/components/settings/AntibanSliders.tsx`

Covers: US-11.1 through US-11.10

- [ ] **Step 1: Add tab navigation to settings page**

Tabs: Profile | Workspace | Integrations | Broadcast Settings | General

- [ ] **Step 2: Complete AntibanSliders with per-messenger sections**

4 sections (Telegram, Slack, WhatsApp, Gmail), each with 5 sliders + RiskMeter component.

- [ ] **Step 3: Add auto-retry settings section**

Toggle + max attempts slider + retry window slider.

- [ ] **Step 4: Add notification settings to General tab**

Email toggle + Desktop toggle.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/(dashboard)/settings/page.tsx apps/web/src/components/settings/AntibanSliders.tsx
git commit -m "feat: complete settings page with antiban sliders, risk meter, and notification settings"
```

---

## Task 9: E2E Tests — Core User Flows

**Files:**
- Create: `apps/web/e2e/auth.spec.ts`
- Create: `apps/web/e2e/messenger.spec.ts`
- Create: `apps/web/e2e/broadcast.spec.ts`

Covers: E2E validation of core flows

- [ ] **Step 1: Create auth E2E test**

```typescript
// apps/web/e2e/auth.spec.ts
import { test, expect } from '@playwright/test';

test('login flow', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name="email"]', 'admin@example.com');
  await page.fill('input[name="password"]', 'password123');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL('/');
  await expect(page.locator('text=Dashboard')).toBeVisible();
});

test('login with invalid credentials shows error', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name="email"]', 'admin@example.com');
  await page.fill('input[name="password"]', 'wrongpassword');
  await page.click('button[type="submit"]');
  await expect(page.locator('text=Invalid')).toBeVisible();
});

test('redirect to login when not authenticated', async ({ page }) => {
  await page.goto('/messenger');
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 2: Create messenger E2E test**

Test: login → navigate to messenger → open chat → send message → verify message appears.

- [ ] **Step 3: Create broadcast E2E test**

Test: login → new broadcast → fill wizard steps → submit → verify broadcast in list.

- [ ] **Step 4: Run E2E tests**

Run: `cd apps/web && npx playwright test`

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/
git commit -m "test: add E2E tests for auth, messenger, and broadcast flows"
```

---

## Task 10: Deployment Configuration

**Files:**
- Create: `apps/api/Dockerfile`
- Create: `apps/worker/Dockerfile`
- Create: `apps/web/netlify.toml`
- Modify: `docker-compose.yml` (production mode)

- [ ] **Step 1: Create API Dockerfile**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/shared/package*.json ./packages/shared/
RUN npm ci
COPY . .
RUN npm run build --workspace=apps/api

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/package.json ./
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Create Worker Dockerfile** (similar pattern)

- [ ] **Step 3: Create Netlify config**

```toml
[build]
  command = "npm run build --workspace=apps/web"
  publish = "apps/web/.next"

[build.environment]
  NODE_VERSION = "20"
```

- [ ] **Step 4: Verify docker build**

Run: `docker build -f apps/api/Dockerfile -t omni-api .`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add apps/api/Dockerfile apps/worker/Dockerfile apps/web/netlify.toml
git commit -m "chore: add deployment configs (Dockerfiles, Netlify)"
```

---

## Task 11: Environment & Security Hardening

**Files:**
- Modify: `apps/api/src/app.ts` (or main server file)

Covers: CC-5 (Security cross-cutting criteria)

- [ ] **Step 1: Verify security headers (Helmet)**

Ensure `@fastify/helmet` is registered.

- [ ] **Step 2: Verify CORS configuration**

CORS should only allow `APP_URL` origin.

- [ ] **Step 3: Verify body size limit**

Fastify body limit should be 10MB: `fastify.register(require('@fastify/multipart'), { limits: { fileSize: 10 * 1024 * 1024 } })`

- [ ] **Step 4: Verify rate limiting**

100 req/min general, 10 req/min for auth endpoints.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.ts
git commit -m "chore: verify and harden security settings (CORS, Helmet, rate limits, body size)"
```

---

## Verification

1. **Run all unit tests:** `cd apps/api && npx vitest run` — all pass
2. **Run worker tests:** `cd apps/worker && npx vitest run` — all pass
3. **Run E2E tests:** `cd apps/web && npx playwright test` — all pass
4. **Docker build:** `docker build -f apps/api/Dockerfile .` — succeeds
5. **Analytics page:** Navigate to `/broadcast/analytics` — metrics display
6. **Activity log:** Navigate to `/activity` — events display with filters
7. **Settings:** Navigate to `/settings` — all tabs functional
8. **Security scan:** Run `npm audit` — no critical vulnerabilities
