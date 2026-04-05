# Mobile Adaptation Design Spec

## Context

Messengly (messengly.app) is a SaaS unified inbox for Telegram, Slack, WhatsApp, and Gmail. The current web UI is desktop-only: fixed-width columns, no responsive breakpoints, no mobile navigation. Users cannot use the product from a phone or tablet — layouts overflow, navigation is inaccessible, touch targets are too small.

This spec defines a full mobile adaptation of all screens using Tailwind CSS responsive classes (approach A — no separate mobile components).

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | All screens | Users need full app access on mobile |
| Navigation | Bottom tab bar | Standard mobile pattern (Telegram, WhatsApp) |
| Messenger layout | Full-screen views | 3-column layout doesn't fit on mobile |
| Breakpoint | `md` (768px) | Standard tablet/mobile threshold |
| Approach | Tailwind responsive classes | Minimal new files, single source of truth |

## Breakpoint Strategy

- **< 768px (default)**: Mobile layout — bottom nav, stacked views, single-column grids
- **>= 768px (`md:`)**: Desktop layout — sidebar, multi-column, current behavior preserved

All styles are written mobile-first: base classes define mobile, `md:` modifiers add desktop.

## New Components

### 1. `BottomNav.tsx`
**Path:** `apps/web/src/components/layout/BottomNav.tsx`

Fixed bottom navigation bar, visible only on mobile (`md:hidden`).

**Tabs (5):**

| Tab | Icon | Route |
|-----|------|-------|
| Dashboard | LayoutDashboard | `/` |
| Chats | Inbox | `/chats` |
| Messenger | MessageSquare | `/messenger` |
| Broadcasts | Send | `/broadcast` |
| More | MoreHorizontal | opens sheet |

*Icons match the Sidebar exactly (see `Sidebar.tsx` baseNavItems).*

**"More" sheet contents:** Templates, Wiki, Tags, Activity, Settings, Admin (if superadmin), Platform (if superadmin).

**Sheet implementation:** CSS-only bottom sheet using fixed positioning + `translate-y` transition. Backdrop: `bg-black/40`. Z-index: `z-50`. Slides up from bottom with `transition-transform duration-200`. Closes on backdrop click or swipe down.

**Styling:**
- Height: 56px + `pb-[env(safe-area-inset-bottom)]` for iPhone notch
- Background: white, border-top: 1px solid slate-200
- Active tab: accent color (`#6366f1`), inactive: slate-400
- Icon size: 20px, label font-size: 10px
- Touch targets: minimum 44x44px per tab

### 2. `MobileHeader.tsx`
**Path:** `apps/web/src/components/layout/MobileHeader.tsx`

Top header bar for mobile screens that need back navigation.

**Props:**
- `title: string` — page title
- `onBack?: () => void` — back button handler (shows ← arrow when provided)
- `actions?: ReactNode` — right-side action buttons

**Styling:**
- Height: 48px + `pt-[env(safe-area-inset-top)]`
- Background: white, border-bottom: 1px solid slate-200
- Title: font-semibold, text-base, truncate

### 3. `useIsMobile.ts`
**Path:** `apps/web/src/hooks/useIsMobile.ts`

Hook using `window.matchMedia('(max-width: 767px)')` with event listener. Returns `boolean`. Used for JS-level decisions (messenger view switching), not for CSS hiding (use Tailwind for that).

## Screen-by-Screen Changes

### Dashboard Layout (`apps/web/src/app/(dashboard)/layout.tsx`)

**Current:** `flex h-screen` → Sidebar + main content

**Changes:**
- Replace `h-screen` with `h-[100dvh]` (fixes iOS address bar bug)
- Sidebar: add `hidden md:flex` — hidden on mobile
- Main content: add `pb-14 md:pb-0` — padding for bottom nav
- Add `<BottomNav />` after main, visible only on mobile

```
Mobile:              Desktop (unchanged):
┌──────────────┐     ┌────┬──────────────┐
│  MobileHeader│     │    │              │
├──────────────┤     │Side│   Content    │
│              │     │bar │              │
│   Content    │     │    │              │
│              │     │    │              │
├──────────────┤     └────┴──────────────┘
│  BottomNav   │
└──────────────┘
```

### Messenger (`apps/web/src/app/(dashboard)/messenger/page.tsx`)

**Current:** 3 columns always visible — ChatList (w-[300px]) + ChatArea (flex-1) + ChatInfo (w-80)

**Changes — Zustand state:**

Add to existing `useChatStore` (`apps/web/src/stores/chat.ts`):
```typescript
mobileView: 'list' | 'chat' | 'info'
setMobileView: (view: 'list' | 'chat' | 'info') => void
```

**Changes — Layout logic:**
- On mobile: render ONE view at a time based on `mobileView` state
- On desktop: render all 3 columns as before (no change)

**Mobile flow:**
1. **List view** (`mobileView === 'list'`): ChatList at 100% width. Tapping a chat → calls `setActiveChat(chat)` + `setMobileView('chat')`
2. **Chat view** (`mobileView === 'chat'`): ChatArea at 100% width. MobileHeader with ← back (→ list) and (i) button (→ info)
3. **Info view** (`mobileView === 'info'`): ChatInfo at 100% width. MobileHeader with ← back (→ chat)

**ChatList changes:**
- Remove `w-[300px] flex-shrink-0` on mobile → `w-full md:w-[300px] md:flex-shrink-0`
- Search input and filters: full width on mobile

**ChatArea changes:**
- Remove fixed positioning assumptions
- Message input: full width, larger touch targets for send/emoji/attach buttons (44x44px)
- Emoji picker: bottom sheet instead of popover on mobile

**ChatInfo changes:**
- Remove `w-80` on mobile → `w-full md:w-80`
- Full-screen presentation on mobile

### Dashboard (`apps/web/src/app/(dashboard)/page.tsx`)

**Current:** `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` (partially responsive)

**Changes:**
- Metric cards: `grid-cols-2 md:grid-cols-4` (2 per row on mobile)
- Activity/charts section: `grid-cols-1 md:grid-cols-3` (stacked on mobile)
- Cards: slightly smaller padding on mobile (`p-3 md:p-4`)

### Chats Table (`apps/web/src/app/(dashboard)/chats/page.tsx`)

**Current:** Full table with 7+ columns

**Changes:**
- On mobile: hide table, show card list
- Each card: chat name + messenger icon + last message preview + date
- Bulk actions: checkbox per card, action bar slides up from bottom
- Use `hidden md:table` for table, `md:hidden` for card list

### Broadcasts

**List page:** Same pattern as chats — table → cards on mobile

**Wizard (`BroadcastWizard.tsx`):**
- Step indicator: horizontal scroll if needed
- Each step form: full width, inputs stack vertically
- Preview panel: below form (not side-by-side)

### Wiki

**Current:** Flex layout — WikiSidebar (category tree) + WikiArticleList (content area)

**Changes:**
- On mobile: wrap WikiSidebar in `hidden md:block` in `wiki/page.tsx`, article list full width
- Add category filter horizontal chips to `WikiArticleList.tsx` (`md:hidden`) as mobile replacement for sidebar tree
- Article detail pages: full width with MobileHeader (← back to list)
- On desktop: no change

### Templates, Tags, Activity

**Common pattern:**
- Grid layouts: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`
- Tables: `hidden md:table` + `md:hidden` card list
- Modals: full-screen on mobile (add `max-h-[100dvh] w-full md:max-w-lg md:rounded-xl`)

### Settings

**Current:** Horizontal tab pills at the top (Integrations | Workspace | Profile) + content below

**Changes:**
- On mobile: tab pills become horizontally scrollable, full-width content below
- If tabs don't fit: horizontal scroll with `overflow-x-auto flex-nowrap`
- Tab content sections: full width, inputs stack vertically
- On desktop: no change

### Auth (Login/Register)

**Changes:** Minor — fix padding (`px-4 md:px-0`), ensure form is centered and readable on small screens. Already mostly single-column.

## CSS Utilities

### Global changes to `globals.css`

```css
/* Safe area support for bottom nav */
@supports (padding-bottom: env(safe-area-inset-bottom)) {
  .safe-bottom {
    padding-bottom: env(safe-area-inset-bottom);
  }
}
```

### Tailwind config additions

None required — using default breakpoints and existing theme tokens.

## Touch & Mobile UX Guidelines

- **Touch targets:** All interactive elements minimum 44x44px
- **Viewport height:** Use `100dvh` instead of `100vh` everywhere
- **Scrolling:** Native smooth scroll via `scroll-behavior: smooth` where appropriate
- **Text size:** Minimum 16px for inputs (prevents iOS auto-zoom)
- **Spacing:** Bottom padding on all pages to account for BottomNav (56px + safe area)
- **Modals:** Full-screen sheets on mobile, centered modals on desktop

## Files to Modify

### New files (3):
1. `apps/web/src/components/layout/BottomNav.tsx`
2. `apps/web/src/components/layout/MobileHeader.tsx`
3. `apps/web/src/hooks/useIsMobile.ts`

### Modified files (~18):
1. `apps/web/src/app/(dashboard)/layout.tsx` — hide sidebar, add BottomNav, dvh
2. `apps/web/src/components/layout/Sidebar.tsx` — add `hidden md:flex`
3. `apps/web/src/app/(dashboard)/messenger/page.tsx` — mobile view switching
4. `apps/web/src/components/messenger/ChatList.tsx` — responsive width
5. `apps/web/src/components/messenger/ChatArea.tsx` — mobile header, responsive
6. `apps/web/src/components/messenger/ChatInfo.tsx` — responsive width
7. `apps/web/src/app/(dashboard)/page.tsx` — dashboard grid responsive
8. `apps/web/src/app/(dashboard)/chats/page.tsx` — table → cards
9. `apps/web/src/app/(dashboard)/broadcast/page.tsx` — table → cards
10. `apps/web/src/components/broadcast/BroadcastWizard.tsx` — step layout
11. `apps/web/src/app/(dashboard)/templates/page.tsx` — responsive grid
12. `apps/web/src/app/(dashboard)/wiki/page.tsx` — responsive grid
13. `apps/web/src/app/(dashboard)/tags/page.tsx` — responsive layout
14. `apps/web/src/app/(dashboard)/activity/page.tsx` — responsive layout
15. `apps/web/src/app/(dashboard)/settings/page.tsx` — scrollable tabs
16. `apps/web/src/stores/chat.ts` — add mobileView state
17. `apps/web/src/app/globals.css` — safe area utility
18. `apps/web/src/components/wiki/WikiArticleList.tsx` — add mobile category filter chips

## Verification

1. **Resize browser** to < 768px and check every page
2. **Chrome DevTools** → Device toolbar → iPhone 14 Pro, Galaxy S23
3. **Check bottom nav** appears on mobile, sidebar disappears
4. **Messenger flow:** list → tap chat → chat opens full-screen → back button works → info panel opens full-screen
5. **Dashboard:** metric cards 2-per-row, activity stacked
6. **Tables** (chats, broadcasts): show as card lists on mobile
7. **Settings:** tab pills scroll horizontally on mobile, content is full width
8. **Safe areas:** bottom nav has padding on iPhone notch
9. **Touch targets:** all buttons ≥ 44x44px
10. **No horizontal scroll** on any page at 375px width
