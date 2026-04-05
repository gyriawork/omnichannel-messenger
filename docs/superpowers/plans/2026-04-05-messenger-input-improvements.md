# Messenger Input Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix file sending, rename header, add emoji picker and template insertion to the message composer.

**Architecture:** All 4 tasks modify the messenger UI. Tasks 2-4 are frontend-only. Task 1 requires fixes on both frontend (field name mapping) and backend (creating Attachment records in DB). The emoji picker reuses the existing `emoji-picker-react` library. Templates reuse existing `useTemplates` hook.

**Tech Stack:** React, TypeScript, emoji-picker-react, Prisma, Fastify

---

## Task 1: Fix File Sending (2 bugs)

**Root cause analysis:**

**Bug A — Field name mismatch:** The upload endpoint (`POST /api/uploads`) returns `originalName` in the response, but the frontend expects `filename`. This means `attachment.filename` is `undefined`, which fails the API validation schema (`filename: z.string().min(1)`).

**Bug B — Attachment records never created:** The message creation code stores attachments in `attachmentsLegacy` (JSON field) but later queries `prisma.attachment.findMany()` to send them to the messenger adapter. Those `Attachment` table records are never created, so the adapter receives no attachments.

**Files:**
- Fix: `apps/api/src/routes/uploads.ts:60-68` — rename `originalName` → `filename`
- Fix: `apps/api/src/routes/messages.ts:208-233` — create Attachment records in transaction

- [ ] **Step 1: Fix upload response field name**

In `apps/api/src/routes/uploads.ts`, line 66, change `originalName` to `filename`:

```typescript
// Before:
return reply.status(201).send({
  file: {
    key: result.key,
    url: result.url,
    size: result.size,
    mimeType: result.mimeType,
    originalName: result.originalName,  // ← wrong field name
  },
});

// After:
return reply.status(201).send({
  file: {
    key: result.key,
    url: result.url,
    size: result.size,
    mimeType: result.mimeType,
    filename: result.originalName,  // ← matches frontend expectation
  },
});
```

- [ ] **Step 2: Create Attachment records in the transaction**

In `apps/api/src/routes/messages.ts`, after the message is created in the transaction (around line 233), add Attachment record creation:

```typescript
// After the transaction, create Attachment records if attachments provided
if (attachments && attachments.length > 0) {
  await prisma.attachment.createMany({
    data: attachments.map((att) => ({
      messageId: message.id,
      url: att.url,
      filename: att.filename,
      mimeType: att.mimeType,
      size: att.size,
    })),
  });
}
```

- [ ] **Step 3: Test file sending end-to-end**

1. Start dev servers: `npm run dev` from root
2. Open messenger, select a chat
3. Click paperclip → select a file
4. Verify preview appears with correct filename and size
5. Click send → message should send with attachment
6. Verify attachment appears in the chat for the recipient

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/uploads.ts apps/api/src/routes/messages.ts
git commit -m "fix: file sending — fix field name mismatch and create Attachment records"
```

---

## Task 2: Header "Chats" → "Messenger"

**Files:**
- Fix: `apps/web/src/components/messenger/ChatList.tsx:261`

- [ ] **Step 1: Replace header text**

In `apps/web/src/components/messenger/ChatList.tsx`, line 261:

```typescript
// Before:
<h2 className="text-base font-semibold text-slate-800">Chats</h2>

// After:
<h2 className="text-base font-semibold text-slate-800">Messenger</h2>
```

- [ ] **Step 2: Verify in browser**

Open messenger page → left panel should show "Messenger" instead of "Chats".

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/messenger/ChatList.tsx
git commit -m "fix: rename Chats header to Messenger"
```

---

## Task 3: Emoji Picker in Composer

**Files:**
- Modify: `apps/web/src/components/messenger/ChatArea.tsx` — ComposeBar component (~lines 745-928)

**Existing patterns to reuse:**
- `emoji-picker-react` library (already installed, used in ReactionsPicker and message reactions)
- `EmojiPicker` component with `Theme.LIGHT`, width 350, height 400
- Click-outside-to-close pattern (ref + useEffect)

- [ ] **Step 1: Add emoji state and refs to ComposeBar**

In `ChatArea.tsx`, inside the `ComposeBar` component (after existing state declarations around line 751), add:

```typescript
const [showComposerEmoji, setShowComposerEmoji] = useState(false);
const composerEmojiRef = useRef<HTMLDivElement>(null);
const composerEmojiBtnRef = useRef<HTMLButtonElement>(null);
```

- [ ] **Step 2: Add click-outside handler**

Add useEffect for closing picker on outside click (after existing useEffects):

```typescript
useEffect(() => {
  const handleClickOutside = (e: MouseEvent) => {
    if (
      showComposerEmoji &&
      composerEmojiRef.current &&
      !composerEmojiRef.current.contains(e.target as Node) &&
      composerEmojiBtnRef.current &&
      !composerEmojiBtnRef.current.contains(e.target as Node)
    ) {
      setShowComposerEmoji(false);
    }
  };
  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, [showComposerEmoji]);
```

- [ ] **Step 3: Add emoji insert handler**

```typescript
const handleComposerEmojiSelect = useCallback((emojiData: EmojiClickData) => {
  const emoji = emojiData.emoji;
  const textarea = textareaRef.current;
  if (textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = text.slice(0, start) + emoji + text.slice(end);
    setText(newText);
    // Restore cursor position after emoji
    requestAnimationFrame(() => {
      textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
      textarea.focus();
    });
  } else {
    setText((prev) => prev + emoji);
  }
  setShowComposerEmoji(false);
}, [text]);
```

Note: Import `EmojiClickData` from `emoji-picker-react` (check if already imported at the top of the file).

- [ ] **Step 4: Add emoji button JSX in the form**

In the `<form>` JSX (around line 881), add the emoji button right after the paperclip button:

```jsx
{/* Emoji picker button */}
<div className="relative">
  <button
    ref={composerEmojiBtnRef}
    type="button"
    onClick={() => setShowComposerEmoji(!showComposerEmoji)}
    className="mb-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
    title="Insert emoji"
  >
    <Smile className="h-5 w-5" />
  </button>
  {showComposerEmoji && (
    <div
      ref={composerEmojiRef}
      className="absolute bottom-full left-0 mb-2 z-50 shadow-lg rounded-lg overflow-hidden"
    >
      <EmojiPicker
        onEmojiClick={handleComposerEmojiSelect}
        theme={Theme.LIGHT}
        width={350}
        height={400}
        searchPlaceHolder="Search emoji..."
      />
    </div>
  )}
</div>
```

Ensure `Smile` is imported from `lucide-react` (check existing imports at top of file).

- [ ] **Step 5: Verify in browser**

1. Open messenger → select a chat
2. Click 😊 button → emoji picker should appear above the input
3. Select an emoji → it should insert into the textarea at cursor position
4. Click outside → picker should close
5. Type text, place cursor in middle, insert emoji → should insert at cursor position

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/messenger/ChatArea.tsx
git commit -m "feat: add emoji picker to message composer"
```

---

## Task 4: Templates Button in Composer

**Files:**
- Modify: `apps/web/src/components/messenger/ChatArea.tsx` — ComposeBar component

**Existing patterns to reuse:**
- `useTemplates(search)` hook from `apps/web/src/hooks/useTemplates.ts`
- `useTemplateUse()` hook for incrementing usage counter
- Click-outside-to-close pattern (same as emoji picker)

- [ ] **Step 1: Add template state, refs, and hooks to ComposeBar**

Add imports at top of file:
```typescript
import { useTemplates, useTemplateUse } from '@/hooks/useTemplates';
import { FileText } from 'lucide-react';  // add to existing lucide import
```

Inside ComposeBar component, add state:
```typescript
const [showTemplates, setShowTemplates] = useState(false);
const [templateSearch, setTemplateSearch] = useState('');
const templatesRef = useRef<HTMLDivElement>(null);
const templatesBtnRef = useRef<HTMLButtonElement>(null);
const { data: templatesData } = useTemplates(templateSearch || undefined);
const { mutate: trackTemplateUse } = useTemplateUse();
```

- [ ] **Step 2: Add click-outside handler for templates**

```typescript
useEffect(() => {
  const handleClickOutside = (e: MouseEvent) => {
    if (
      showTemplates &&
      templatesRef.current &&
      !templatesRef.current.contains(e.target as Node) &&
      templatesBtnRef.current &&
      !templatesBtnRef.current.contains(e.target as Node)
    ) {
      setShowTemplates(false);
      setTemplateSearch('');
    }
  };
  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, [showTemplates]);
```

- [ ] **Step 3: Add template select handler**

```typescript
const handleTemplateSelect = useCallback((template: { id: string; messageText: string }) => {
  setText(template.messageText);
  trackTemplateUse(template.id);
  setShowTemplates(false);
  setTemplateSearch('');
  textareaRef.current?.focus();
}, [trackTemplateUse]);
```

- [ ] **Step 4: Add templates button JSX**

Add right after the emoji picker `<div>`, before the `<textarea>`:

```jsx
{/* Templates button */}
<div className="relative">
  <button
    ref={templatesBtnRef}
    type="button"
    onClick={() => setShowTemplates(!showTemplates)}
    className="mb-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
    title="Insert template"
  >
    <FileText className="h-5 w-5" />
  </button>
  {showTemplates && (
    <div
      ref={templatesRef}
      className="absolute bottom-full left-0 mb-2 z-50 w-72 rounded-lg border border-slate-200 bg-white shadow-lg"
    >
      <div className="border-b border-slate-100 p-2">
        <input
          type="text"
          value={templateSearch}
          onChange={(e) => setTemplateSearch(e.target.value)}
          placeholder="Search templates..."
          className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-accent focus:bg-white"
          autoFocus
        />
      </div>
      <div className="max-h-60 overflow-y-auto p-1">
        {templatesData?.length ? (
          templatesData.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => handleTemplateSelect(tpl)}
              className="flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-slate-50"
            >
              <span className="text-sm font-medium text-slate-700">{tpl.name}</span>
              <span className="line-clamp-2 text-xs text-slate-400">{tpl.messageText}</span>
            </button>
          ))
        ) : (
          <div className="px-3 py-4 text-center text-sm text-slate-400">
            {templateSearch ? 'Nothing found' : 'No templates yet'}
          </div>
        )}
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 5: Verify in browser**

1. Open messenger → select a chat
2. Click 📋 button → dropdown with search should appear
3. Type in search → templates should filter
4. Click a template → its text should appear in the textarea
5. Click outside → dropdown should close
6. If no templates exist → should show "No templates yet"

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/messenger/ChatArea.tsx
git commit -m "feat: add template insertion button to message composer"
```

---

## Final Verification

- [ ] **Step 1: Full end-to-end test**

1. Open messenger page → header shows "Messenger" (not "Chats")
2. Attach a file → preview appears with size → send → message with attachment delivered
3. Click emoji button → picker opens → select emoji → inserts at cursor
4. Click template button → dropdown opens → search works → select template → text inserted
5. All three buttons visible: 📎 😊 📋 [textarea] ➤

- [ ] **Step 2: Final commit (if any remaining changes)**

```bash
git add -A
git commit -m "chore: messenger input improvements - final polish"
```
