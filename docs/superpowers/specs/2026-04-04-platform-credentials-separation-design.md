# Platform Credentials Separation: Superadmin vs User Integration Flow

**Date:** 2026-04-04
**Status:** Draft

## Problem

All messenger integrations currently require users to provide platform-level credentials (Telegram API ID/Hash, Google Client ID/Secret, Slack Client ID/Secret) alongside their personal account credentials. Regular users should not need to know or enter these — they should be configured once by the superadmin.

## Solution

Separate authentication into two layers:

1. **Platform credentials** — configured by superadmin globally, stored encrypted in DB (with env var fallback)
2. **User credentials** — each user connects their personal account using a simplified flow that leverages platform credentials

## Scope: Intentionally Global

Platform credentials are **global** (one set for the entire SaaS platform), not per-organization. This is a deliberate design choice:
- The SaaS operator (superadmin) owns the Telegram API app, Google OAuth app, and Slack OAuth app
- Individual organizations do not create their own API apps
- The `PlatformConfig` table has `messenger` as `@unique` with no `organizationId`

## Data Model

### New table: `PlatformConfig`

```prisma
model PlatformConfig {
  id          String   @id @default(uuid())
  messenger   String   @unique  // telegram | slack | gmail | whatsapp
  credentials Json     // encrypted via AES-256-GCM (same as Integration.credentials)
  enabled     Boolean  @default(true)
  updatedBy   String?  // userId of last superadmin who modified
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### Credentials per messenger

| Messenger | Platform credentials (superadmin) | User credentials (user) |
|-----------|-----------------------------------|------------------------|
| Telegram  | `apiId`, `apiHash` | session string (from phone verification) |
| Slack     | `clientId`, `clientSecret` | OAuth `botToken` / `userToken` |
| Gmail     | `clientId`, `clientSecret` | OAuth `refreshToken` only |
| WhatsApp  | none (QR-only) | Baileys auth state |

### Runtime credential resolution (C1/C2 fix)

User integrations store **only user-level tokens**, not platform credentials. Adapters resolve platform credentials at runtime:

- **Gmail adapter**: User's `Integration.credentials` stores only `refreshToken`. At runtime, `clientId`/`clientSecret` are fetched from `getPlatformCredentials('gmail')` and combined with the user's `refreshToken` to create the OAuth2 client.
- **Telegram adapter**: User's `Integration.credentials` stores only `session` string. At runtime, `apiId`/`apiHash` are fetched from `getPlatformCredentials('telegram')` and combined with the session to create the TelegramClient.
- **Slack adapter**: User's `Integration.credentials` stores `botToken`/`userToken`. These are self-contained — no platform credentials needed at runtime (Slack tokens work independently after OAuth exchange).

**Migration**: Existing user integrations that have `clientId`/`clientSecret` or `apiId`/`apiHash` baked into their credentials will continue to work. The adapter falls back to user-stored values if platform credentials are unavailable. Over time, as users reconnect, credentials will be stored in the new slim format.

## Credential Resolution

New function in `apps/api/src/lib/platform-credentials.ts`:

```typescript
async function getPlatformCredentials(messenger: string): Promise<Record<string, string> | null>
```

Resolution order:
1. Query `PlatformConfig` table for the messenger
2. If found and `enabled === true` → decrypt and return credentials
3. If not found → check env vars (`GOOGLE_CLIENT_ID`, `SLACK_CLIENT_ID`, `TELEGRAM_API_ID`, etc.)
4. If neither → return `null` (messenger not configured)

**Caching**: Results are cached in-memory with a 60-second TTL to avoid hitting DB on every adapter creation.

This function replaces direct `process.env` reads in:
- `apps/api/src/routes/oauth.ts` — `gmailOAuthConfigured()`, `slackOAuthConfigured()`, `getGmailOAuthConfig()`
- `apps/api/src/routes/integrations.ts` — Telegram connect/send-code endpoints

### New env vars for Telegram (fallback only)

```
TELEGRAM_API_ID=your-api-id
TELEGRAM_API_HASH=your-api-hash
```

## Credential Rotation

When a superadmin changes platform credentials:

- **Slack**: No impact. User tokens are self-contained after OAuth exchange.
- **Gmail**: Existing refresh tokens were issued under the old OAuth app and will fail on next token refresh. The adapter catches `invalid_grant` errors and updates the integration status to `token_expired`. Users see a "Reconnect" prompt.
- **Telegram**: Existing sessions are tied to the API ID that created them. Changing API ID invalidates all sessions. Same behavior: status → `session_expired`, users reconnect.

The `PUT /api/admin/platform-config/:messenger` endpoint shows a confirmation warning for Gmail and Telegram: "Changing these credentials will require all connected users to reconnect."

## API Endpoints

### Superadmin endpoints (require `superadmin` role)

**`GET /api/admin/platform-config`**
Returns all four messengers with their configuration status. Never returns raw credential values — only masked hints (e.g., last 4 chars).
```json
[
  { "messenger": "telegram", "configured": true, "source": "database", "enabled": true, "hint": "...4567" },
  { "messenger": "slack", "configured": true, "source": "env", "enabled": true, "hint": "...890" },
  { "messenger": "gmail", "configured": false, "source": null, "enabled": false },
  { "messenger": "whatsapp", "configured": true, "source": "none_required", "enabled": true }
]
```

**`PUT /api/admin/platform-config/:messenger`**
Body validated per messenger:
```typescript
// Telegram
{ apiId: number, apiHash: string }
// Slack
{ clientId: string, clientSecret: string }
// Gmail
{ clientId: string, clientSecret: string }
// WhatsApp — not accepted (400 error)
```
Encrypts and stores in `PlatformConfig`. Logs to `ActivityLog`. Returns updated status.

**`DELETE /api/admin/platform-config/:messenger`**
Removes DB override. If env vars exist for this messenger, the API returns `{ fallback: "env" }`. If no fallback exists, the API returns `{ fallback: null, warning: "This messenger will become unavailable for users" }` and requires `?confirm=true` query param to proceed.

### User-facing endpoint

**`GET /api/integrations/available`**
Returns which messengers are available (configured) for the current user to connect. Used by frontend to show/hide integration cards.
```json
{
  "available": ["telegram", "slack", "whatsapp"],
  "unavailable": ["gmail"]
}
```

## UI Changes

### New: Superadmin page `/admin/platform`

Visible only to `superadmin` role via a "Platform Settings" item in the sidebar (under the existing admin section if present, or as a new top-level item with Shield icon).

Each messenger displayed as a card with:
- **Status badge**: "Configured", "Configured (env)", "Not configured", "Always available" (WhatsApp)
- **Credential fields**: shown masked (••••) for configured messengers, with Edit/Remove buttons
- **Source indicator**: info banner when credentials come from env vars, with "Override" button
- **Setup CTA**: "Configure" button for unconfigured messengers
- GET endpoint never returns raw values; Edit mode re-enters all fields

### Changed: User integrations page `/settings` → Integrations tab

- **Hide unconfigured messengers**: If `GET /api/integrations/available` returns a messenger as unavailable, its card is not rendered
- **Telegram form simplified**: Remove API ID and API Hash fields. Only show phone number → verification code → optional 2FA. Backend uses platform credentials automatically.
- **Gmail**: Already shows "Connect with Google" button when OAuth is configured. No form change needed — just ensure it checks the new `getPlatformCredentials` function.
- **Slack**: Already shows "Connect with Slack" button when OAuth is configured. Same as Gmail.
- **WhatsApp**: No changes. QR flow is self-contained.

### Sidebar changes

Add conditional sidebar item visible only to superadmin:
```
Platform Settings  (icon: Shield)
  └─ /admin/platform
```

## Files to Modify

### Backend
- `apps/api/prisma/schema.prisma` — add `PlatformConfig` model
- `apps/api/src/routes/admin.ts` — new file, superadmin platform config CRUD
- `apps/api/src/lib/platform-credentials.ts` — new file, `getPlatformCredentials()` resolver with 60s TTL cache
- `apps/api/src/routes/oauth.ts` — replace `gmailOAuthConfigured()`, `slackOAuthConfigured()`, `getGmailOAuthConfig()` with `getPlatformCredentials` calls
- `apps/api/src/routes/integrations.ts` — Telegram send-code/verify-code: read apiId/apiHash from platform credentials instead of user input; new `GET /integrations/available` endpoint
- `apps/api/src/lib/crypto.ts` — reuse existing `encryptCredentials`/`decryptCredentials`

### Frontend
- `apps/web/src/app/(dashboard)/admin/platform/page.tsx` — new page
- `apps/web/src/components/admin/PlatformConfigCard.tsx` — new component
- `apps/web/src/components/layout/Sidebar.tsx` — add "Platform Settings" link for superadmin
- `apps/web/src/components/settings/IntegrationsTab.tsx` — hide unavailable messengers, simplify Telegram form
- `apps/web/src/hooks/useAvailableIntegrations.ts` — new hook calling `GET /api/integrations/available`

### Shared
- `packages/shared/src/index.ts` — add `MESSENGER_PLATFORM_FIELDS` constant defining which fields each messenger needs at platform level

## Activity Logging

All `PUT` and `DELETE` operations on platform config are logged to `ActivityLog` with:
- `action`: `platform_config_updated` / `platform_config_deleted`
- `entityType`: `PlatformConfig`
- `entityId`: messenger name
- `metadata`: `{ messenger, source: "database" }` (never credential values)

## Verification

1. **Superadmin flow**: Log in as superadmin → navigate to /admin/platform → configure Telegram (API ID + Hash) → see status change to "Configured"
2. **User flow (configured)**: Log in as regular user → Integrations tab → Telegram card visible with simplified form (phone only) → complete auth
3. **User flow (unconfigured)**: Gmail not configured by superadmin → Gmail card hidden from user's Integrations tab
4. **Env var fallback**: Set `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET` as env vars, don't configure in DB → Slack shows as "Configured (env)" for superadmin, available for users
5. **Override**: Superadmin overrides Slack credentials via UI → source changes from "env" to "database"
6. **Credential rotation**: Superadmin changes Gmail Client ID → existing Gmail users see "Token expired, reconnect" on next refresh attempt
7. **Delete with no fallback**: Superadmin tries to delete Telegram config (no env vars) → API requires `?confirm=true` with warning
8. **Backward compat**: Existing user integrations with baked-in platform creds continue to work without migration
9. **TypeScript**: `npx tsc --noEmit` passes for api, worker, and web
