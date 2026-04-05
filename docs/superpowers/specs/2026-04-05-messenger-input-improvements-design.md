# Messenger Input Improvements — Design Spec

**Date:** 2026-04-05

## Context

The messenger input area needs 4 improvements: fix file sending, correct the panel header, add emoji insertion, and add template insertion into the message composer.

## Task 1: Fix File Sending

**Problem:** Files upload successfully (preview with size appears), but the message fails to send with attachments.

**Investigation areas:**
- Frontend: verify `attachments` array format matches API schema
- API route `POST /chats/:chatId/messages`: check attachment validation and DB creation
- Messenger adapter: check if `sendMessage()` handles attachments correctly
- Check if the `Attachment` model creation works (relation to Message)

**Expected flow:**
1. User selects file → `POST /api/uploads` → returns `{ file: { url, filename, mimeType, size } }`
2. Attachment preview shown (already works)
3. User clicks send → `POST /api/chats/:chatId/messages` with `{ text, attachments: [...] }`
4. API creates Message + Attachment records
5. Adapter sends to messenger with attachment URLs
6. WebSocket emits `new_message` with attachments

## Task 2: Header "Chats" → "Messenger"

**File:** `apps/web/src/components/messenger/ChatList.tsx`

**Change:** Replace the `"Chats"` heading text with `"Messenger"`.

## Task 3: Emoji Button in Composer

**What:** Add emoji picker button next to the paperclip in the message input area.

**Components involved:**
- `apps/web/src/components/messenger/ChatArea.tsx` — main composer area

**Behavior:**
- Button with `Smile` icon (lucide-react) placed to the right of paperclip
- Click toggles emoji picker popup (using existing `emoji-picker-react` library)
- Selected emoji inserts at cursor position in the textarea
- Picker closes after emoji selection
- Click outside closes picker

**Layout:** `📎 Paperclip | 😊 Emoji | 📋 Templates | [textarea] | ➤ Send`

## Task 4: Templates Button in Composer

**What:** Add button to insert pre-made template text into the message input.

**Components involved:**
- `apps/web/src/components/messenger/ChatArea.tsx` — add button and dropdown
- `apps/web/src/hooks/useTemplates.ts` — reuse existing `useTemplates()` and `useTemplateUse()`

**Behavior:**
- Button with `FileText` icon (lucide-react) placed to the right of emoji button
- Click opens dropdown panel above the input area
- Dropdown shows list of templates with search input
- Each item shows: template name + truncated message preview
- Click on template → its `messageText` inserts into the textarea (replaces current text)
- `useTemplateUse()` called to increment usage counter
- Dropdown closes after selection
- Click outside closes dropdown
- Empty state: "No templates yet" with link to Templates page

**Data:** Uses existing `GET /api/templates` endpoint via `useTemplates(search)` hook.

## Button Layout

```
┌──────────────────────────────────────────────────────┐
│ [📎] [😊] [📋]  [        textarea        ]  [➤]    │
└──────────────────────────────────────────────────────┘
```

## Files to Modify

1. `apps/web/src/components/messenger/ChatArea.tsx` — emoji button, templates button, fix attachment sending
2. `apps/web/src/components/messenger/ChatList.tsx` — header text
3. `apps/api/src/routes/messages.ts` — debug/fix attachment handling (if needed)
4. `apps/api/src/routes/uploads.ts` — debug/fix upload endpoint (if needed)
