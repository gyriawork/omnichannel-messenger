# Mobile Adaptation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all screens of Messengly fully usable on mobile devices (< 768px) by adding responsive Tailwind classes, a bottom tab bar, and full-screen messenger views.

**Architecture:** Mobile-first responsive approach using Tailwind `md:` breakpoint. Three new components (BottomNav, MobileHeader, useIsMobile hook). Messenger uses Zustand state to switch between full-screen views on mobile. Existing desktop layout is preserved via `md:` modifiers.

**Tech Stack:** Next.js 14, Tailwind CSS, Zustand, Lucide React icons

**Spec:** `docs/superpowers/specs/2026-04-05-mobile-adaptation-design.md`

---

## File Structure

### New files (3):
| File | Purpose |
|------|---------|
| `apps/web/src/hooks/useIsMobile.ts` | Hook returning `boolean` based on `matchMedia('(max-width: 767px)')` |
| `apps/web/src/components/layout/BottomNav.tsx` | Fixed bottom navigation bar with 5 tabs, visible only on mobile |
| `apps/web/src/components/layout/MobileHeader.tsx` | Top header bar with back button + title for mobile screens |

### Modified files (~22):
| File | Change |
|------|--------|
| `apps/web/src/stores/chat.ts` | Add `mobileView` state |
| `apps/web/src/app/globals.css` | Add safe-area utility |
| `apps/web/src/app/(dashboard)/layout.tsx` | Hide sidebar on mobile, add BottomNav, use `100dvh` |
| `apps/web/src/components/layout/Sidebar.tsx` | Add `hidden md:flex` |
| `apps/web/src/app/(dashboard)/messenger/page.tsx` | Mobile view switching logic |
| `apps/web/src/components/messenger/ChatList.tsx` | Responsive width `w-full md:w-[300px]` |
| `apps/web/src/components/messenger/ChatArea.tsx` | Mobile header with back/info buttons |
| `apps/web/src/components/messenger/ChatInfo.tsx` | Responsive width `w-full md:w-[320px]` |
| `apps/web/src/app/(dashboard)/page.tsx` | Responsive grid columns |
| `apps/web/src/app/(dashboard)/chats/page.tsx` | Table → card list on mobile |
| `apps/web/src/app/(dashboard)/broadcast/page.tsx` | Responsive layout |
| `apps/web/src/components/broadcast/BroadcastWizard.tsx` | Responsive step layout |
| `apps/web/src/app/(dashboard)/templates/page.tsx` | Responsive padding/layout |
| `apps/web/src/app/(dashboard)/wiki/page.tsx` | Hide WikiSidebar on mobile |
| `apps/web/src/components/wiki/WikiArticleList.tsx` | Add mobile category chips |
| `apps/web/src/app/(dashboard)/tags/page.tsx` | Responsive padding/layout |
| `apps/web/src/app/(dashboard)/activity/page.tsx` | Responsive padding/layout |
| `apps/web/src/app/(dashboard)/settings/page.tsx` | Scrollable tab pills |
| `apps/web/src/app/(auth)/login/page.tsx` | Responsive padding |
| `apps/web/src/app/(auth)/register/page.tsx` | Responsive padding |
| `apps/web/src/components/broadcast/BroadcastWizard.tsx` | Responsive step layout |
| `apps/web/src/components/messenger/ImportChatsModal.tsx` | Full-screen modal on mobile |

---

## Task 1: Foundation — useIsMobile hook + globals.css

**Files:**
- Create: `apps/web/src/hooks/useIsMobile.ts`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Create useIsMobile hook**

```typescript
// apps/web/src/hooks/useIsMobile.ts
'use client';

import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 767;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    setIsMobile(mql.matches);

    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
}
```

- [ ] **Step 2: Add safe-area utility to globals.css**

In `apps/web/src/app/globals.css`, after the `scrollbar-thin` block inside `@layer utilities`, add:

```css
  .safe-bottom {
    padding-bottom: env(safe-area-inset-bottom);
  }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useIsMobile.ts apps/web/src/app/globals.css
git commit -m "feat: add useIsMobile hook and safe-area CSS utility"
```

---

## Task 2: Zustand store — add mobileView state

**Files:**
- Modify: `apps/web/src/stores/chat.ts`

- [ ] **Step 1: Add mobileView to ChatStore interface**

In `apps/web/src/stores/chat.ts`, add to the `ChatStore` interface (after line 15 `replyingTo: Message | null;`):

```typescript
  mobileView: 'list' | 'chat' | 'info';
  setMobileView: (view: 'list' | 'chat' | 'info') => void;
```

- [ ] **Step 2: Add mobileView to store implementation**

In the `create<ChatStore>` call, add initial state (after line 39 `replyingTo: null,`):

```typescript
  mobileView: 'list',
```

And add the setter (after line 72 `setReplyingTo: (replyingTo) => set({ replyingTo }),`):

```typescript
  setMobileView: (mobileView) => set({ mobileView }),
```

- [ ] **Step 3: Update setActiveChat to also set mobileView**

Change the existing `setActiveChat` implementation from:

```typescript
  setActiveChat: (chat) =>
    set({ activeChat: chat, messages: [], replyingTo: null }),
```

to:

```typescript
  setActiveChat: (chat) =>
    set({ activeChat: chat, messages: [], replyingTo: null, mobileView: chat ? 'chat' : 'list' }),
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/stores/chat.ts
git commit -m "feat: add mobileView state to chat store"
```

---

## Task 3: BottomNav component

**Files:**
- Create: `apps/web/src/components/layout/BottomNav.tsx`

- [ ] **Step 1: Create BottomNav component**

```typescript
// apps/web/src/components/layout/BottomNav.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Inbox,
  MessageSquare,
  Send,
  MoreHorizontal,
  FileText,
  BookOpen,
  Tag,
  Activity,
  Settings,
  ShieldCheck,
  Shield,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

const tabs = [
  { icon: LayoutDashboard, href: '/', label: 'Dashboard' },
  { icon: Inbox, href: '/chats', label: 'Chats' },
  { icon: MessageSquare, href: '/messenger', label: 'Messenger' },
  { icon: Send, href: '/broadcast', label: 'Broadcast' },
];

const moreItems = [
  { icon: FileText, href: '/templates', label: 'Templates' },
  { icon: BookOpen, href: '/wiki', label: 'Wiki' },
  { icon: Tag, href: '/tags', label: 'Tags' },
  { icon: Activity, href: '/activity', label: 'Activity' },
  { icon: Settings, href: '/settings', label: 'Settings' },
];

export function BottomNav() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const [showMore, setShowMore] = useState(false);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const isMoreActive = moreItems.some((item) => isActive(item.href));

  return (
    <>
      {/* More sheet backdrop */}
      {showMore && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={() => setShowMore(false)}
        />
      )}

      {/* More sheet */}
      <div
        className={cn(
          'fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-white px-4 pb-[calc(56px+env(safe-area-inset-bottom))] pt-4 shadow-lg transition-transform duration-200',
          showMore ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-900">More</span>
          <button
            onClick={() => setShowMore(false)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {moreItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setShowMore(false)}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-xl py-3 text-slate-500 transition-colors',
                isActive(item.href)
                  ? 'bg-accent/10 text-accent'
                  : 'hover:bg-slate-50',
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          ))}
          {user?.role === 'superadmin' && (
            <>
              <Link
                href="/admin"
                onClick={() => setShowMore(false)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl py-3 text-slate-500 transition-colors',
                  isActive('/admin') && !isActive('/admin/platform')
                    ? 'bg-accent/10 text-accent'
                    : 'hover:bg-slate-50',
                )}
              >
                <ShieldCheck className="h-5 w-5" />
                <span className="text-[10px] font-medium">Admin</span>
              </Link>
              <Link
                href="/admin/platform"
                onClick={() => setShowMore(false)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl py-3 text-slate-500 transition-colors',
                  isActive('/admin/platform')
                    ? 'bg-accent/10 text-accent'
                    : 'hover:bg-slate-50',
                )}
              >
                <Shield className="h-5 w-5" />
                <span className="text-[10px] font-medium">Platform</span>
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-slate-200 bg-white px-2 safe-bottom md:hidden"
        style={{ height: 56 }}
      >
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 text-slate-400 transition-colors',
              isActive(tab.href) && 'text-accent',
            )}
          >
            <tab.icon className="h-5 w-5" />
            <span className="text-[10px] font-medium">{tab.label}</span>
          </Link>
        ))}
        <button
          onClick={() => setShowMore(!showMore)}
          className={cn(
            'flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 text-slate-400 transition-colors',
            isMoreActive && 'text-accent',
          )}
        >
          <MoreHorizontal className="h-5 w-5" />
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/layout/BottomNav.tsx
git commit -m "feat: add BottomNav component for mobile navigation"
```

---

## Task 4: MobileHeader component

**Files:**
- Create: `apps/web/src/components/layout/MobileHeader.tsx`

- [ ] **Step 1: Create MobileHeader component**

```typescript
// apps/web/src/components/layout/MobileHeader.tsx
'use client';

import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileHeaderProps {
  title: string;
  onBack?: () => void;
  actions?: React.ReactNode;
  className?: string;
}

export function MobileHeader({ title, onBack, actions, className }: MobileHeaderProps) {
  return (
    <div
      className={cn(
        'flex h-12 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 md:hidden',
        className,
      )}
    >
      {onBack && (
        <button
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      )}
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900">
        {title}
      </h1>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/layout/MobileHeader.tsx
git commit -m "feat: add MobileHeader component for mobile back navigation"
```

---

## Task 5: Dashboard layout — hide sidebar, add BottomNav

**Files:**
- Modify: `apps/web/src/app/(dashboard)/layout.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Update dashboard layout**

In `apps/web/src/app/(dashboard)/layout.tsx`:

1. Add import at top:
```typescript
import { BottomNav } from '@/components/layout/BottomNav';
```

2. Change loading state `h-screen` to `h-[100dvh]`:
```
className="flex h-[100dvh] items-center justify-center bg-[#f8fafc]"
```

3. Change the main layout return from:
```tsx
    <div className="flex h-screen bg-[#f8fafc]">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
```
to:
```tsx
    <div className="flex h-[100dvh] bg-[#f8fafc]">
      <Sidebar />
      <main className="flex-1 overflow-auto pb-14 md:pb-0">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
      <BottomNav />
    </div>
```

- [ ] **Step 2: Hide sidebar on mobile**

In `apps/web/src/components/layout/Sidebar.tsx`, change the `<aside>` className (line 58-61) from:

```tsx
        'flex h-screen flex-col bg-gradient-to-b from-[#1e1b4b] to-[#312e81] py-4 transition-all duration-200',
```

to:

```tsx
        'hidden h-[100dvh] flex-col bg-gradient-to-b from-[#1e1b4b] to-[#312e81] py-4 transition-all duration-200 md:flex',
```

- [ ] **Step 3: Verify**

Run: `npm run dev` from `apps/web`. Open browser at 375px width.
Expected: Sidebar is hidden, bottom tab bar is visible with 5 tabs. All tab links work.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/layout.tsx apps/web/src/components/layout/Sidebar.tsx
git commit -m "feat: hide sidebar on mobile, show BottomNav, use 100dvh"
```

---

## Task 6: Messenger — mobile view switching

**Files:**
- Modify: `apps/web/src/app/(dashboard)/messenger/page.tsx`
- Modify: `apps/web/src/components/messenger/ChatList.tsx`
- Modify: `apps/web/src/components/messenger/ChatArea.tsx`
- Modify: `apps/web/src/components/messenger/ChatInfo.tsx`

- [ ] **Step 1: Update messenger page layout**

Replace the entire content of `apps/web/src/app/(dashboard)/messenger/page.tsx` with:

```tsx
'use client';

import { ChatList } from '@/components/messenger/ChatList';
import { ChatArea } from '@/components/messenger/ChatArea';
import { ChatInfo } from '@/components/messenger/ChatInfo';
import { useChatStore } from '@/stores/chat';
import { useIsMobile } from '@/hooks/useIsMobile';

export default function MessengerPage() {
  const mobileView = useChatStore((s) => s.mobileView);
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="flex h-full flex-col">
        {mobileView === 'list' && <ChatList />}
        {mobileView === 'chat' && <ChatArea />}
        {mobileView === 'info' && <ChatInfo />}
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <ChatList />
      <ChatArea />
      <ChatInfo />
    </div>
  );
}
```

- [ ] **Step 2: Make ChatList responsive**

In `apps/web/src/components/messenger/ChatList.tsx`, change the outer div className (line 257) from:

```
"flex h-full w-[300px] flex-shrink-0 flex-col border-r border-slate-200 bg-white"
```

to:

```
"flex h-full w-full flex-col border-r border-slate-200 bg-white md:w-[300px] md:flex-shrink-0"
```

- [ ] **Step 3: Add mobile header to ChatArea**

In `apps/web/src/components/messenger/ChatArea.tsx`:

1. Add imports at top:
```typescript
import { ArrowLeft, Info } from 'lucide-react';
import { useIsMobile } from '@/hooks/useIsMobile';
```

2. Inside the component function, add:
```typescript
const isMobile = useIsMobile();
const setMobileView = useChatStore((s) => s.setMobileView);
```

3. At the top of the component's return JSX (before the existing header), add a mobile header that shows only on mobile when a chat is active. Find the existing chat header section and add `md:flex` + `hidden` appropriately, or add a separate mobile header block:

```tsx
{/* Mobile header */}
{isMobile && activeChat && (
  <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
    <button
      onClick={() => setMobileView('list')}
      className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-semibold text-slate-900">{activeChat.name}</p>
    </div>
    <button
      onClick={() => setMobileView('info')}
      className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
    >
      <Info className="h-5 w-5" />
    </button>
  </div>
)}
```

Note: The existing desktop header should be wrapped in `{!isMobile && (...)}` or given `className="hidden md:flex ..."` to avoid duplicate headers.

- [ ] **Step 4: Make ChatInfo responsive with back button**

In `apps/web/src/components/messenger/ChatInfo.tsx`:

1. Add imports:
```typescript
import { ArrowLeft } from 'lucide-react';
import { useIsMobile } from '@/hooks/useIsMobile';
```

2. Add inside component:
```typescript
const isMobile = useIsMobile();
const setMobileView = useChatStore((s) => s.setMobileView);
```

3. Change the outer div className (line 229) from:
```
"flex h-full w-[320px] flex-shrink-0 flex-col border-l border-slate-200 bg-white"
```
to:
```
"flex h-full w-full flex-col border-l border-slate-200 bg-white md:w-[320px] md:flex-shrink-0"
```

4. Replace the existing close button (X icon at top) — on mobile use a MobileHeader with back arrow, on desktop keep the X button. Add at the top of the panel JSX:

```tsx
{isMobile && (
  <div className="flex h-12 flex-shrink-0 items-center gap-3 border-b border-slate-200 px-3 md:hidden">
    <button
      onClick={() => setMobileView('chat')}
      className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
    <span className="text-base font-semibold text-slate-900">Chat Info</span>
  </div>
)}
```

- [ ] **Step 5: Verify messenger flow**

Open browser at 375px width, navigate to Messenger.
Expected:
1. See chat list full-width
2. Tap a chat → chat opens full-screen with ← back and (i) buttons
3. Tap ← → back to list
4. Tap (i) → info panel full-screen with ← back
5. Resize to > 768px → 3-column layout restored

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/messenger/page.tsx apps/web/src/components/messenger/ChatList.tsx apps/web/src/components/messenger/ChatArea.tsx apps/web/src/components/messenger/ChatInfo.tsx
git commit -m "feat: full-screen messenger views on mobile with back navigation"
```

---

## Task 7: Dashboard page — responsive grids

**Files:**
- Modify: `apps/web/src/app/(dashboard)/page.tsx`

- [ ] **Step 1: Update dashboard grid classes**

In `apps/web/src/app/(dashboard)/page.tsx`:

1. Find the metric cards grid (should have `grid grid-cols-1 ... sm:grid-cols-2 lg:grid-cols-4`) and change to:
```
grid grid-cols-2 gap-4 md:grid-cols-4
```

2. Find the activity/charts section grid (should have `grid grid-cols-1 ... lg:grid-cols-3`) and change to:
```
grid grid-cols-1 gap-6 md:grid-cols-3
```

3. Change page container padding from `px-6 py-8` to `px-4 py-6 md:px-6 md:py-8`.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/page.tsx
git commit -m "feat: responsive dashboard grid for mobile"
```

---

## Task 8: Chats page — table to cards on mobile

**Files:**
- Modify: `apps/web/src/app/(dashboard)/chats/page.tsx`

- [ ] **Step 1: Update page container padding**

Change `px-6 py-8` to `px-4 py-6 md:px-6 md:py-8` in the outer container.

- [ ] **Step 2: Make header responsive**

Find the header section with title + "Add Chat" button. Change `flex items-center justify-between` to stack on mobile:
```
flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between
```

- [ ] **Step 3: Add mobile card view**

Find the `<table>` element. Wrap it with `hidden md:table` (or wrap the table's parent `<div>` with `hidden md:block`).

Before the table, add a mobile card list:

```tsx
{/* Mobile card list */}
<div className="flex flex-col gap-2 md:hidden">
  {filteredChats.map((chat) => {
    const messengerInfo = messengerConfig[chat.messengerType];
    return (
      <div
        key={chat.id}
        className={cn(
          'rounded-xl border border-slate-200 bg-white p-3 transition-colors',
          selectedIds.has(chat.id) && 'border-accent bg-accent/5',
        )}
        onClick={() => toggleSelect(chat.id)}
      >
        <div className="flex items-center gap-3">
          <div className={cn('h-2 w-2 rounded-full', messengerInfo.dotColor)} />
          <span className="flex-1 truncate text-sm font-medium text-slate-900">
            {chat.name}
          </span>
          <span className="text-xs text-slate-400">
            {chat.lastMessageDate ? formatTime(chat.lastMessageDate) : ''}
          </span>
        </div>
        {chat.lastMessage && (
          <p className="mt-1 truncate pl-5 text-xs text-slate-500">
            {chat.lastMessage}
          </p>
        )}
      </div>
    );
  })}
</div>
```

Note: Adapt this to the exact variables and functions available in the component (check `filteredChats`, `selectedIds`, `toggleSelect`, `formatTime`). The implementer should read the full component to get the exact variable names.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/chats/page.tsx
git commit -m "feat: mobile card list for chats page"
```

---

## Task 9: Broadcast page — responsive layout

**Files:**
- Modify: `apps/web/src/app/(dashboard)/broadcast/page.tsx`

- [ ] **Step 1: Update container and header**

1. Change outer container `px-6 py-8` to `px-4 py-6 md:px-6 md:py-8`
2. Make header flex stack on mobile: `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`
3. Make the status tab pills horizontally scrollable on mobile: wrap in `overflow-x-auto flex-nowrap`

- [ ] **Step 2: Make broadcast list responsive**

If broadcasts are shown in a table, add `hidden md:table` to table and a mobile card list (`md:hidden`) similar to Task 8 pattern. Each card shows: broadcast name, status badge, date, messenger type.

If broadcasts are shown as cards, ensure grid changes to `grid-cols-1 md:grid-cols-2`.

- [ ] **Step 3: Make side panels (antiban/analytics) responsive**

If the antiban or analytics panels appear as a side panel, on mobile they should be full-width below the list or as a bottom sheet. Add responsive classes: `w-full md:w-[400px]`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/broadcast/page.tsx
git commit -m "feat: responsive broadcast page for mobile"
```

---

## Task 10: Templates, Tags, Activity — responsive padding

**Files:**
- Modify: `apps/web/src/app/(dashboard)/templates/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/tags/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/activity/page.tsx`

- [ ] **Step 1: Templates page**

In `apps/web/src/app/(dashboard)/templates/page.tsx`:
1. Change `mx-auto max-w-4xl px-6 py-8` to `mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8`
2. Make header `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`
3. Template cards grid (if any): `grid-cols-1 md:grid-cols-2`

- [ ] **Step 2: Tags page**

In `apps/web/src/app/(dashboard)/tags/page.tsx`:
1. Change container padding to `px-4 py-6 md:px-6 md:py-8`
2. Tag grid: `grid-cols-2 md:grid-cols-3 lg:grid-cols-4`
3. Modals: add `w-full md:max-w-md` to modal container

- [ ] **Step 3: Activity page**

In `apps/web/src/app/(dashboard)/activity/page.tsx`:
1. Change `mx-auto max-w-4xl px-6 py-8` to `mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8`
2. Filter row: `flex flex-col gap-2 sm:flex-row sm:items-center`
3. Activity list items: ensure they don't overflow on narrow screens

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/templates/page.tsx apps/web/src/app/\(dashboard\)/tags/page.tsx apps/web/src/app/\(dashboard\)/activity/page.tsx
git commit -m "feat: responsive padding and layout for templates, tags, activity"
```

---

## Task 11: Wiki page — hide sidebar, add category chips

**Files:**
- Modify: `apps/web/src/app/(dashboard)/wiki/page.tsx`
- Modify: `apps/web/src/components/wiki/WikiArticleList.tsx`

- [ ] **Step 1: Hide WikiSidebar on mobile**

In `apps/web/src/app/(dashboard)/wiki/page.tsx`, wrap the `<WikiSidebar>` component:

Change from:
```tsx
    <div className="flex h-full">
      <WikiSidebar
```
to:
```tsx
    <div className="flex h-full">
      <div className="hidden md:block">
        <WikiSidebar
```

And close the wrapping `</div>` after `WikiSidebar`'s closing tag.

- [ ] **Step 2: Add mobile category chips to WikiArticleList**

In `apps/web/src/components/wiki/WikiArticleList.tsx`, the component receives `categories` data via its parent. Add a prop for categories and render horizontal chips on mobile.

At the top of the returned JSX (inside the `flex flex-col gap-4` div), add:

```tsx
{/* Mobile category filter — only on mobile */}
<div className="flex gap-2 overflow-x-auto pb-2 md:hidden">
  <button
    onClick={() => onCategoryChange?.(undefined)}
    className={cn(
      'flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
      !activeCategoryId ? 'bg-accent text-white' : 'bg-slate-100 text-slate-600',
    )}
  >
    All
  </button>
  {categories?.map((cat) => (
    <button
      key={cat.id}
      onClick={() => onCategoryChange?.(cat.id)}
      className={cn(
        'flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
        activeCategoryId === cat.id ? 'bg-accent text-white' : 'bg-slate-100 text-slate-600',
      )}
    >
      {cat.name}
    </button>
  ))}
</div>
```

Note: This requires adding `categories`, `activeCategoryId`, and `onCategoryChange` props to `WikiArticleListProps`. The implementer should check what data is available from the parent `wiki/page.tsx` and pass it down.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/wiki/page.tsx apps/web/src/components/wiki/WikiArticleList.tsx
git commit -m "feat: hide wiki sidebar on mobile, add category filter chips"
```

---

## Task 12: Settings page — scrollable tabs

**Files:**
- Modify: `apps/web/src/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Make tab pills scrollable on mobile**

In `apps/web/src/app/(dashboard)/settings/page.tsx`:

1. Change container padding to `px-4 py-6 md:px-6 md:py-8`
2. Find the tab pills container (likely `flex gap-1 rounded-lg bg-slate-100 p-1`) and add `overflow-x-auto flex-nowrap`:
```
flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1
```
3. Add `flex-shrink-0` to each tab button so they don't compress.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/settings/page.tsx
git commit -m "feat: scrollable settings tabs on mobile"
```

---

## Task 13: Final verification

- [ ] **Step 1: Full mobile walkthrough**

Open browser at 375px width (iPhone SE) and check:
1. Bottom nav appears, sidebar hidden
2. All 5 tabs navigate correctly
3. "More" sheet opens with Templates, Wiki, Tags, etc.
4. Dashboard: 2-column metric cards, stacked activity
5. Chats: card list, bulk actions work
6. Messenger: list → chat → info flow with back buttons
7. Broadcasts: responsive layout
8. Templates/Tags/Activity: proper padding, no overflow
9. Wiki: sidebar hidden, category chips work
10. Settings: tabs scroll horizontally

- [ ] **Step 2: Tablet check (768px)**

Resize to 768px. Expected: all desktop layouts appear (sidebar, 3-column messenger, tables).

- [ ] **Step 3: No horizontal scroll check**

At 375px width, scroll through every page. No horizontal scrollbar should appear.

- [ ] **Step 4: Touch targets check**

All buttons and interactive elements should be at least 44x44px tap area on mobile.

---

## Task 14: Auth pages — padding fix

**Files:**
- Modify: `apps/web/src/app/(auth)/login/page.tsx`
- Modify: `apps/web/src/app/(auth)/register/page.tsx`

- [ ] **Step 1: Fix login page padding**

In `apps/web/src/app/(auth)/login/page.tsx`, find the form container and ensure it has responsive padding: `px-4 md:px-0`. Also ensure inputs have `text-base` (16px) to prevent iOS auto-zoom.

- [ ] **Step 2: Fix register page padding**

Same changes in `apps/web/src/app/(auth)/register/page.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(auth\)/login/page.tsx apps/web/src/app/\(auth\)/register/page.tsx
git commit -m "feat: responsive padding for auth pages on mobile"
```

---

## Task 15: BroadcastWizard — responsive step layout

**Files:**
- Modify: `apps/web/src/components/broadcast/BroadcastWizard.tsx`

- [ ] **Step 1: Make step indicator scrollable**

Find the step indicator/stepper at the top of the wizard. Wrap it in `overflow-x-auto` and add `flex-nowrap flex-shrink-0` to step items so they scroll horizontally on mobile.

- [ ] **Step 2: Stack form sections vertically**

If the wizard has any side-by-side panels (e.g., form + preview), change to:
```
flex flex-col md:flex-row
```
The preview section should appear below the form on mobile.

- [ ] **Step 3: Full-width inputs**

Ensure all form inputs in the wizard are `w-full` and have `text-base` (prevents iOS auto-zoom).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/broadcast/BroadcastWizard.tsx
git commit -m "feat: responsive broadcast wizard for mobile"
```

---

## Task 16: Full-screen modals on mobile

**Files:**
- Global pattern to apply in any modal/dialog across the app

- [ ] **Step 1: Identify all modals**

Search for modal/dialog patterns in the codebase. Common patterns: `fixed inset-0`, `rounded-xl`, `max-w-`. Key files:
- `apps/web/src/app/(dashboard)/tags/page.tsx` — TagModal
- `apps/web/src/components/messenger/ImportChatsModal.tsx`
- Any other modal component

- [ ] **Step 2: Apply responsive modal pattern**

For each modal's inner content container, change from fixed width (e.g., `max-w-md rounded-xl`) to:
```
w-full max-h-[100dvh] overflow-y-auto md:max-w-lg md:rounded-xl
```

On mobile this makes modals full-screen. On desktop they stay centered with rounded corners.

- [ ] **Step 3: Commit**

```bash
git add -u
git commit -m "feat: full-screen modals on mobile"
```

---

## Task 17: Emoji picker bottom sheet on mobile

**Files:**
- Modify: `apps/web/src/components/messenger/ChatArea.tsx`

- [ ] **Step 1: Convert emoji picker to bottom sheet on mobile**

Find the emoji picker in ChatArea (it should be rendered as a popover/dropdown near the emoji button in the message input area).

On mobile, change its positioning from absolute/popover to a fixed bottom sheet:

```tsx
{isMobile ? (
  // Bottom sheet
  <div className="fixed inset-x-0 bottom-14 z-50 max-h-[50vh] overflow-y-auto rounded-t-2xl bg-white shadow-lg">
    {/* emoji picker content */}
  </div>
) : (
  // Desktop popover (existing code)
)}
```

The `bottom-14` accounts for the BottomNav height. Add a backdrop overlay on mobile.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/messenger/ChatArea.tsx
git commit -m "feat: emoji picker as bottom sheet on mobile"
```

---

## Task 18: BottomNav hide on messenger chat view

**Files:**
- Modify: `apps/web/src/components/layout/BottomNav.tsx`

- [ ] **Step 1: Hide BottomNav when in messenger chat/info view**

The BottomNav should be hidden when the user is inside a chat conversation (to not overlap the message input).

Add to BottomNav component:

```tsx
import { useChatStore } from '@/stores/chat';
import { useIsMobile } from '@/hooks/useIsMobile';

// Inside component:
const mobileView = useChatStore((s) => s.mobileView);
const isMobile = useIsMobile();
const pathname = usePathname();
const hideOnMessenger = isMobile && pathname === '/messenger' && mobileView !== 'list';

// In the nav element, add conditional:
if (hideOnMessenger) return null;
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/layout/BottomNav.tsx
git commit -m "feat: hide BottomNav when inside chat conversation on mobile"
```

---

## Task 19: MobileHeader safe area + minor fixes

**Files:**
- Modify: `apps/web/src/components/layout/MobileHeader.tsx`
- Modify: `apps/web/src/app/globals.css`

- [ ] **Step 1: Add safe-area-inset-top to MobileHeader**

In `MobileHeader.tsx`, update the outer div className to include top safe area:
```
'flex h-12 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 pt-[env(safe-area-inset-top)] md:hidden'
```

- [ ] **Step 2: Add @supports wrapper to safe-bottom utility**

In `globals.css`, change the safe-bottom utility to:

```css
  @supports (padding-bottom: env(safe-area-inset-bottom)) {
    .safe-bottom {
      padding-bottom: env(safe-area-inset-bottom);
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/layout/MobileHeader.tsx apps/web/src/app/globals.css
git commit -m "fix: safe area support for MobileHeader and BottomNav"
```
