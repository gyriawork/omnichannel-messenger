# Gmail Chat Grouping by Sender Domain — Design

**Date:** 2026-04-08
**Status:** Approved
**Scope:** `apps/web` (client-side grouping) + small extension to `apps/api/src/routes/chats.ts` (search by `fromEmail`)

## Problem

The `/chats` page lists every imported Gmail thread as its own row. For organizations that receive many transactional emails from the same sender (Google security alerts, Allegro newsletters, GitHub notifications, etc.), this creates dozens of nearly-duplicate rows that drown out other chats and add no value:

```
Google — Security alert                Apr 7
Google — Anton, review your account    Apr 7
Google — Оповещение системы            Apr 7
Google — Оповещение системы            Apr 6
Google — Security alert                Apr 2
…
```

The same problem does not apply to Telegram / Slack / WhatsApp because those mediums naturally have one chat per conversation partner — Gmail is unique in producing many threads from one sender.

## Goal

On the `/chats` page, collapse multiple Gmail chats from the same sender domain into a single row that:

1. Looks visually identical to a normal chat row (no special folder UI, no accordions)
2. Shows the company name as the row title
3. On click, navigates to `/messenger` with the search field pre-filled by the domain so the user sees all matching threads in the existing left panel

Other messengers (Telegram / Slack / WhatsApp) are unchanged.

## Non-goals

- Server-side grouping or new API endpoints
- Pagination changes
- A toggle to disable grouping (YAGNI — can be added later if needed)
- Bulk operations on a group (the underlying chats are still individually accessible from Messenger)
- Grouping in the Messenger left panel itself
- A new "group" entity in the database

## User-facing decisions

The following were confirmed by the user during brainstorming:

| Question | Decision |
|---|---|
| Click behavior | Display-only aggregation: clicking the group navigates to `/messenger?search=<domain>` and the existing Messenger search field handles filtering |
| Group label source | `From`-name from the most recent email (majority vote across the group); fallback to capitalized second-level domain (`google.com` → `Google`) |
| Free-mail handling | A built-in list of ~20 free-mail domains (gmail.com, yahoo.com, outlook.com, hotmail.com, icloud.com, mail.ru, yandex.ru, proton.me, aol.com, gmx.com, fastmail.com, hey.com, …) is **never** grouped — every personal email stays as its own row |
| Minimum group size | 2 — a single chat from a non-free-mail domain is also kept as its own row, only ≥ 2 chats collapse |
| On/off toggle | Always on, no toggle |
| Visual style | Identical to a normal chat row |

## Architecture

```
Browser
└── /chats page (apps/web/src/app/(dashboard)/chats/page.tsx)
    │
    ├── useChats() ─── unchanged ───→ GET /api/chats (returns all chats)
    │
    ├── groupGmailChats(chats) ─── NEW ───
    │       └── apps/web/src/lib/chat-grouping.ts (pure functions, unit-tested)
    │
    └── render rows: (Chat | ChatGroup)[]
            │
            └── click on group ──→ router.push(`/messenger?search=${domain}`)
                                          │
                                          └── /messenger reads ?search and
                                              prefills useChatStore.searchQuery
                                              (existing left-panel search behavior)

Server
└── apps/api/src/routes/chats.ts
    └── GET /api/chats ── small change ── extend search OR clause
                          to also match message.fromEmail
```

All grouping logic lives in the browser. No DB schema changes. No new types in `packages/shared`.

## Components & contracts

### `apps/web/src/lib/chat-grouping.ts` (new)

```ts
export interface ChatGroup {
  isGroup: true;
  domain: string;          // canonical registrable domain, e.g. "google.com"
  label: string;           // display name, e.g. "Google"
  chats: Chat[];           // ≥ 2 chats
  latestChat: Chat;        // chat with the most recent lastActivityAt
  totalMessages: number;   // sum of messageCount across chats
  lastActivityAt: string;  // max lastActivityAt across chats
  messenger: 'gmail';
  tags: ChatTag[];         // union of all chat tags, deduplicated
}

export type ChatRow = Chat | ChatGroup;

export function isChatGroup(row: ChatRow): row is ChatGroup;

export function groupGmailChats(chats: Chat[]): ChatRow[];

// Internal helpers (also exported for tests)
export function extractDomain(email: string): string | null;
export function isFreeMailDomain(domain: string): boolean;
export function buildGroupLabel(chats: Chat[], fallbackDomain: string): string;

export const FREEMAIL_DOMAINS: ReadonlySet<string>;
```

**`extractDomain` rules:**
- Lowercase
- Strip everything before `@`
- Compute the registrable domain ("eTLD+1") using a small built-in list of multi-part suffixes (`co.uk`, `com.au`, `co.jp`, `org.uk`, `gov.uk`, `com.br`, …). For everything else, take the last two labels.
- Return `null` for unparseable input

A full Public Suffix List is **not** required — we cover the common multi-part TLDs and accept that exotic ones may collapse imperfectly. Cost of getting a few exotic TLDs wrong is low (one extra row), and pulling in `psl` adds ~150KB to the bundle.

**`groupGmailChats` algorithm:**

```
1. Split chats into gmail and other.
2. For each gmail chat:
   - Pull fromEmail from chat.lastMessage (if absent, mark as ungroupable).
   - domain = extractDomain(fromEmail)
   - If domain is null or in FREEMAIL_DOMAINS, mark as ungroupable.
3. Bucket the remaining chats by domain.
4. For each bucket:
   - If bucket.length < 2, treat its chats as ungroupable.
   - Else build a ChatGroup:
       latestChat        = max by lastActivityAt
       totalMessages     = sum of messageCount
       lastActivityAt    = latestChat.lastActivityAt
       label             = buildGroupLabel(chats, domain)
       tags              = dedupe(flatMap(chats, c => c.tags))
5. Return [other chats, ungroupable gmail chats, groups] as a flat ChatRow[].
   Sorting is performed by the caller, not here.
```

**`buildGroupLabel` rules:**
- Collect `lastMessage.senderName` (or `fromName`) from each chat in the group.
- Pick the most frequent non-empty value.
- If none exists: capitalize the first label of the domain (`google.com` → `Google`, `paypal-business.com` → `Paypal-business`).

### `apps/web/src/app/(dashboard)/chats/page.tsx` (modify)

Apply grouping inside the existing `sorted` `useMemo` so that filters and sort still work:

```ts
const rows: ChatRow[] = useMemo(() => {
  // 1. apply chatTypeFilter (existing logic)
  let filtered = chats;
  if (chatTypeFilter) {
    filtered = filtered.filter((c) => c.chatType === chatTypeFilter);
  }

  // 2. group gmail chats
  const grouped = groupGmailChats(filtered);

  // 3. sort (extend existing sortBy logic to handle ChatGroup)
  return sortRows(grouped, sortBy, sortDir);
}, [chats, chatTypeFilter, sortBy, sortDir]);
```

`sortRows` is a small helper that, for groups, uses:
- `name`     → `group.label`
- `messageCount` → `group.totalMessages`
- `chatType` → `''` (groups sort to the bottom of this column)
- `tags`     → first tag of `group.tags`
- `lastMessageDate` / `lastActivityAt` → `group.lastActivityAt`

The existing `sorted.map((chat) => …)` rendering switches on `isChatGroup(row)` to render either the existing `<tr>` or a group `<tr>`.

### Group `<tr>` rendering

The group row uses the same `<tr>` markup as a chat row. Per-column content:

| Column     | Group content                                                                |
|------------|------------------------------------------------------------------------------|
| Checkbox   | Hidden (`<td/>` left empty so column alignment stays)                         |
| Chat       | `<ChatAvatar name={group.label} messenger="gmail" size={36}/>` + group.label as link to `/messenger?search=${group.domain}`. Subtext: latest chat's subject/name. |
| Messenger  | Same Gmail badge as a normal Gmail chat                                       |
| Type       | `—`                                                                          |
| Owner      | `—`                                                                          |
| Messages   | `group.totalMessages.toLocaleString()`                                       |
| Tags       | The union pills (or `—`)                                                     |
| Last Active | `formatTime(group.lastActivityAt)`                                          |
| Actions    | `—` (no row actions for groups; managing individual chats happens in Messenger) |

Mobile card list mirrors the same fields with the same click target.

### `/messenger` URL handling

The Messenger page's chat-list left panel already has a debounced search field bound to `useChatStore.searchQuery`. The change:

1. On mount of the messenger page, read `searchParams.get('search')`.
2. If present, call `setSearchQuery(value)` once.
3. The existing chat-list query re-runs with `search=<domain>`.

Implementation lives in the existing messenger page (likely `apps/web/src/app/(dashboard)/messenger/page.tsx`) — a small `useEffect` reading `useSearchParams()`. No changes to `ChatList.tsx`.

### `apps/api/src/routes/chats.ts` (modify)

Extend the search OR clause at line ~130 to also match `message.fromEmail`:

```ts
if (search) {
  where.OR = [
    { name: { contains: search, mode: 'insensitive' } },
    { messages: { some: { text: { contains: search, mode: 'insensitive' } } } },
    { messages: { some: { fromEmail: { contains: search, mode: 'insensitive' } } } }, // NEW
  ];
}
```

Without this change, navigating to `/messenger?search=google.com` would return zero chats because the existing search only looks at chat names (which contain the email subject, not the sender domain).

No new index is added at this point; we accept the small additional cost on the existing `Message` table scan. If this becomes slow we can revisit and add `Message_fromEmail_idx`.

## Data flow on click

```
User clicks "Google" row in /chats
   │
   ▼
<a href={`/messenger?search=google.com`}>
   │
   ▼
Next router navigates to /messenger?search=google.com
   │
   ▼
Messenger page mount effect:
   const search = useSearchParams().get('search');
   if (search) useChatStore.getState().setSearchQuery(search);
   │
   ▼
ChatList re-renders with searchQuery = "google.com"
   │
   ▼
useChats({ search: "google.com" })
   │
   ▼
GET /api/chats?search=google.com
   │
   ▼
API: messages.some.fromEmail.contains("google.com") matches all
     Gmail chats whose latest sender is *@google.com or *@*.google.com
   │
   ▼
Left panel shows only those threads. No specific thread is opened.
User can click any thread to read it.
```

## Edge cases

| Case | Behavior |
|---|---|
| Gmail chat with no `lastMessage` (just imported) | Not groupable; renders as normal row |
| `lastMessage.fromEmail` is null/empty | Not groupable; renders as normal row |
| `extractDomain` returns null (malformed address) | Not groupable; renders as normal row |
| Domain is in `FREEMAIL_DOMAINS` | Not grouped; each chat is its own row |
| Bucket has only 1 chat | Not grouped; renders as normal row |
| Two chats from `accounts.google.com` and `mail.google.com` | Both map to `google.com` → grouped together |
| Two chats from `service.allegro.pl` and `news.allegro.pl` | Both map to `allegro.pl` → grouped together |
| Chat from `john@gmail.com` (free-mail personal) | Not grouped (free-mail) |
| User filters by `messenger=telegram` | No Gmail rows visible at all → no groups |
| User searches "Goo" in /chats search | Server-side filter narrows to chats whose name/text/fromEmail contains "Goo"; remaining gmail chats may still be grouped if ≥ 2 share a domain |
| User clicks group, but has no Gmail integration | Messenger page shows empty list with "No chats found" — same as any other empty search |
| Group's tags union is huge | Render is allowed to wrap to multiple lines like normal rows |

## Rules of Hooks / SSR

The grouping is a pure synchronous function called inside an existing `useMemo`. No new hooks, no async, no effects. SSR-safe.

## Testing

### Unit tests (`apps/web/src/lib/chat-grouping.test.ts`)

| Case | Assertion |
|---|---|
| Empty input | `[]` |
| Only non-gmail chats | Returned as-is, no groups |
| One gmail chat | Returned as-is (below threshold) |
| Two gmail chats, different domains | Two separate rows, no group |
| Two gmail chats, same domain | One group |
| Three chats: same domain | One group of three |
| Free-mail domain (`gmail.com`, `yahoo.com`, …) | Never grouped, each remains a row |
| Subdomains (`mail.google.com`, `accounts.google.com`) | Grouped under `google.com` |
| Multi-part TLD (`co.uk`, `com.au`) | Correct eTLD+1 |
| Group label = majority `senderName` | Verified |
| Group label fallback = capitalized domain label | Verified |
| `totalMessages` = sum of `messageCount` | Verified |
| `lastActivityAt` = max | Verified |
| Tags union deduplicated | Verified |
| Mixed input (gmail + telegram + slack) | Telegram/Slack untouched, gmail grouped |

### Integration / manual checks

1. Open `/chats` with the seed Gmail data — confirm grouping is visible.
2. Click a group → navigate to `/messenger`, search field pre-filled, list filtered.
3. Clear the search in Messenger → all chats return.
4. Switch the messenger filter on `/chats` to `Telegram` → no groups.
5. Type a domain into the `/chats` search box → groups still appear if surviving chats meet the threshold.
6. Bulk-select still works on individual chats; group rows have no checkbox.
7. Sort by Name / Messages / Last Active — groups sort consistently.
8. Verify Telegram / Slack / WhatsApp rendering is unchanged.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `extractDomain` mishandles exotic TLDs | low | low | Fallback to full domain; group still works, just labeled by domain |
| API search by `fromEmail` is slow on large Message tables | low | medium | Existing `text` search already does the same kind of nested `some` query; add an index later if needed |
| Free-mail list is incomplete and a personal-mail provider gets grouped | low | low | Easy to extend the constant list |
| Users miss the "ungrouped" view | unknown | low | If reported, add a toggle (deferred per YAGNI) |
| Click navigation conflicts with existing query params on `/messenger` | low | low | Mount effect overwrites `searchQuery` only if `?search` param is present |

**Overall risk: low.** No DB changes, no schema changes, no migrations, no breaking changes for other messengers.

## Files changed

| File | Change | Type |
|---|---|---|
| `apps/web/src/lib/chat-grouping.ts` | New utility module | New |
| `apps/web/src/lib/chat-grouping.test.ts` | Unit tests | New |
| `apps/web/src/app/(dashboard)/chats/page.tsx` | Use grouping inside `sorted` memo; render group rows | Modify |
| `apps/web/src/app/(dashboard)/messenger/page.tsx` | Read `?search=` and prefill `searchQuery` on mount | Modify |
| `apps/api/src/routes/chats.ts` | Extend search OR clause to match `message.fromEmail` | Modify |

No changes to: Prisma schema, migrations, `packages/shared`, websocket layer, worker, integrations, other messenger UIs.
