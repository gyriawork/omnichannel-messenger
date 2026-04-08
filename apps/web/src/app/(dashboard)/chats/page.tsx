'use client';

import { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  Filter,
  MoreHorizontal,
  Trash2,
  UserCheck,
  Tag,
  MessageSquare,
  Users,
  Hash,
  Mail,
  ChevronDown,
  X,
  Loader2,
  ArrowUpDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useChats, useBulkDeleteChats, useBulkAssignChats, useBulkTagChats } from '@/hooks/useChats';
import { useTags } from '@/hooks/useTags';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ImportChatsModal } from '@/components/messenger/ImportChatsModal';
import { ChatAvatar } from '@/components/ui/ChatAvatar';
import type { Chat, MessengerType } from '@/types/chat';
import { RequireOrgContext } from '@/components/layout/RequireOrgContext';
import { groupGmailChats, isChatGroup, type ChatRow, type ChatGroup } from '@/lib/chat-grouping';

// ─── Constants ───

const messengerConfig: Record<
  MessengerType,
  { label: string; abbr: string; bgClass: string; textClass: string; dotColor: string }
> = {
  telegram: { label: 'Telegram', abbr: 'TG', bgClass: 'bg-messenger-tg-bg', textClass: 'text-messenger-tg-text', dotColor: 'bg-[#0088cc]' },
  slack: { label: 'Slack', abbr: 'SL', bgClass: 'bg-messenger-sl-bg', textClass: 'text-messenger-sl-text', dotColor: 'bg-[#611f69]' },
  whatsapp: { label: 'WhatsApp', abbr: 'WA', bgClass: 'bg-messenger-wa-bg', textClass: 'text-messenger-wa-text', dotColor: 'bg-[#25D366]' },
  gmail: { label: 'Gmail', abbr: 'GM', bgClass: 'bg-messenger-gm-bg', textClass: 'text-messenger-gm-text', dotColor: 'bg-[#EA4335]' },
};

const chatTypeIcons: Record<string, typeof MessageSquare> = {
  direct: MessageSquare,
  group: Users,
  channel: Hash,
};

// ─── Assign Owner Dropdown ───

function AssignOwnerDropdown({
  selectedIds,
  onDone,
}: {
  selectedIds: string[];
  onDone: () => void;
}) {
  const [ownerInput, setOwnerInput] = useState('');
  const assignMutation = useBulkAssignChats();

  const handleAssign = () => {
    const trimmed = ownerInput.trim();
    if (!trimmed) {
      toast.error('Please enter an owner ID');
      return;
    }
    assignMutation.mutate(
      { chatIds: selectedIds, ownerId: trimmed },
      {
        onSuccess: () => {
          toast.success(`Owner assigned to ${selectedIds.length} chat(s)`);
          onDone();
        },
        onError: () => toast.error('Failed to assign owner'),
      },
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onDone} />
      <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
        <p className="mb-2 text-xs font-medium text-slate-600">Assign owner by ID</p>
        <input
          value={ownerInput}
          onChange={(e) => setOwnerInput(e.target.value)}
          placeholder="Enter user ID..."
          autoFocus
          className="mb-2 w-full rounded border-[1.5px] border-slate-200 px-2.5 py-1.5 text-xs transition-colors placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
        />
        <button
          onClick={handleAssign}
          disabled={assignMutation.isPending || !ownerInput.trim()}
          className="flex w-full items-center justify-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-accent-hover disabled:opacity-50"
        >
          {assignMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <UserCheck className="h-3 w-3" />
          )}
          Assign
        </button>
      </div>
    </>
  );
}

// ─── Add Tag Dropdown ───

function AddTagDropdown({
  selectedIds,
  onDone,
}: {
  selectedIds: string[];
  onDone: () => void;
}) {
  const { data } = useTags();
  const tagMutation = useBulkTagChats();
  const tags = data?.tags ?? [];

  const handleAddTag = (tagId: string, tagName: string) => {
    tagMutation.mutate(
      { chatIds: selectedIds, tagId, action: 'add' },
      {
        onSuccess: () => {
          toast.success(`Tag "${tagName}" added to ${selectedIds.length} chat(s)`);
          onDone();
        },
        onError: () => toast.error('Failed to add tag'),
      },
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onDone} />
      <div className="absolute left-0 top-full z-20 mt-1 w-52 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
        <p className="px-3 py-1.5 text-xs font-medium text-slate-400">Add tag</p>
        {tags.length === 0 ? (
          <p className="px-3 py-2 text-xs text-slate-400">No tags available</p>
        ) : (
          tags.map((tag) => (
            <button
              key={tag.id}
              onClick={() => handleAddTag(tag.id, tag.name)}
              disabled={tagMutation.isPending}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: tag.color }}
              />
              {tag.name}
            </button>
          ))
        )}
      </div>
    </>
  );
}

// ─── Bulk Actions ───

function BulkActions({
  selectedIds,
  onClear,
}: {
  selectedIds: string[];
  onClear: () => void;
}) {
  const [showAssign, setShowAssign] = useState(false);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const deleteMutation = useBulkDeleteChats();

  const handleDelete = () => {
    deleteMutation.mutate(selectedIds, {
      onSuccess: () => {
        toast.success(`${selectedIds.length} chat(s) deleted`);
        onClear();
        setShowDeleteConfirm(false);
      },
      onError: () => toast.error('Failed to delete chats'),
    });
  };

  return (
    <div className="flex items-center gap-3 rounded-lg bg-accent-bg px-4 py-2.5">
      <span className="text-sm font-medium text-accent">
        {selectedIds.length} selected
      </span>
      <div className="h-4 w-px bg-accent/20" />

      {/* Assign Owner */}
      <div className="relative">
        <button
          onClick={() => { setShowAssign(!showAssign); setShowTagMenu(false); }}
          className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100"
        >
          <UserCheck className="h-3.5 w-3.5" />
          Assign Owner
        </button>
        {showAssign && (
          <AssignOwnerDropdown
            selectedIds={selectedIds}
            onDone={() => { setShowAssign(false); onClear(); }}
          />
        )}
      </div>

      {/* Add Tag */}
      <div className="relative">
        <button
          onClick={() => { setShowTagMenu(!showTagMenu); setShowAssign(false); }}
          className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100"
        >
          <Tag className="h-3.5 w-3.5" />
          Add Tag
        </button>
        {showTagMenu && (
          <AddTagDropdown
            selectedIds={selectedIds}
            onDone={() => { setShowTagMenu(false); onClear(); }}
          />
        )}
      </div>

      {/* Delete */}
      <div className="relative">
        <button
          onClick={() => setShowDeleteConfirm(true)}
          disabled={deleteMutation.isPending}
          className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
        >
          {deleteMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          Delete
        </button>
        {showDeleteConfirm && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowDeleteConfirm(false)} />
            <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
              <p className="mb-2 text-sm font-medium text-slate-700">
                Delete {selectedIds.length} chat(s)?
              </p>
              <p className="mb-3 text-xs text-slate-500">This action cannot be undone.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 rounded border-[1.5px] border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                  className="flex flex-1 items-center justify-center gap-1 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {deleteMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  Delete
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <button
        onClick={onClear}
        className="flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100"
      >
        <X className="h-3.5 w-3.5" />
        Cancel
      </button>
    </div>
  );
}

// ─── Chat Row Actions ───

function ChatRowActions({ chat }: { chat: Chat }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/chats/${chat.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      toast.success(`Chat "${chat.name}" deleted`);
    },
    onError: () => toast.error('Failed to delete chat'),
  });

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            <a
              href={`/messenger?chatId=${chat.id}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Open in Messenger
            </a>
            <button
              onClick={() => {
                deleteMutation.mutate();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Chat
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Relative-time formatter shared by ChatsPage and GroupRow.
function formatTime(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diffH = (now.getTime() - d.getTime()) / (1000 * 60 * 60);
  if (diffH < 1) return `${Math.round(diffH * 60)}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── GroupRow ───
// Renders a virtual row representing a group of Gmail chats from the same
// sender domain. Visually identical to a normal chat row. Click navigates
// to /messenger?search=<domain> so the existing left-panel search shows
// the constituent threads.

function GroupRow({ group }: { group: ChatGroup }) {
  const cfg = messengerConfig.gmail;
  const subjectPreview = group.latestChat.lastMessage?.text ?? group.latestChat.name;

  return (
    <tr className="transition-colors hover:bg-slate-50/50">
      {/* Empty checkbox cell — groups are not bulk-selectable */}
      <td className="px-4 py-3" />

      {/* Chat: avatar + label + subject preview */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <ChatAvatar name={group.label} messenger="gmail" size={36} />
          <div className="min-w-0">
            <a
              href={`/messenger?search=${encodeURIComponent(group.domain)}`}
              className="text-sm font-medium text-slate-800 hover:text-accent"
            >
              {group.label}
            </a>
            <div className="truncate text-xs text-slate-400">{subjectPreview}</div>
          </div>
        </div>
      </td>

      {/* Messenger badge */}
      <td className="px-4 py-3">
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
            cfg.bgClass,
            cfg.textClass,
          )}
        >
          {cfg.label}
        </span>
      </td>

      {/* Type — N/A for groups */}
      <td className="px-4 py-3 text-xs text-slate-300">—</td>

      {/* Owner — N/A for groups */}
      <td className="px-4 py-3 text-xs text-slate-300">—</td>

      {/* Total messages */}
      <td className="px-4 py-3 text-xs font-medium text-slate-600">
        {group.totalMessages.toLocaleString()}
      </td>

      {/* Tags union */}
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {group.tags.length === 0 ? (
            <span className="text-[10px] text-slate-300">—</span>
          ) : (
            group.tags.map((tag) => (
              <span
                key={tag.id}
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: tag.color + '18', color: tag.color }}
              >
                {tag.name}
              </span>
            ))
          )}
        </div>
      </td>

      {/* Last active */}
      <td className="px-4 py-3 text-xs text-slate-500">
        {formatTime(group.lastActivityAt)}
      </td>

      {/* Actions — N/A for groups */}
      <td className="px-3 py-3" />
    </tr>
  );
}

// ─── Main Page ───

export default function ChatsPage() {
  const [search, setSearch] = useState('');
  const [messengerFilter, setMessengerFilter] = useState<MessengerType | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [sortBy, setSortBy] = useState<'lastActivityAt' | 'name' | 'messageCount' | 'chatType' | 'tags' | 'lastMessageDate'>('lastActivityAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [chatTypeFilter, setChatTypeFilter] = useState<string | null>(null);

  const { data: tagsData } = useTags();

  const { data, isLoading } = useChats({
    search: search || undefined,
    messenger: messengerFilter,
    status: statusFilter || undefined,
    ownerId: ownerFilter || undefined,
    tagId: tagFilter || undefined,
  });

  const chats = data?.chats ?? [];
  const total = data?.total ?? 0;

  const sorted = useMemo<ChatRow[]>(() => {
    // 1. Apply chat-type filter (existing logic).
    let filtered = chats;
    if (chatTypeFilter) {
      filtered = filtered.filter((c) => c.chatType === chatTypeFilter);
    }

    // 2. Group eligible Gmail chats by sender domain.
    const rows = groupGmailChats(filtered);

    // 3. Sort. Helper functions handle both Chat and ChatGroup.
    const getName = (r: ChatRow) => (isChatGroup(r) ? r.label : r.name);
    const getMessageCount = (r: ChatRow) =>
      isChatGroup(r) ? r.totalMessages : (r.messageCount ?? 0);
    const getChatType = (r: ChatRow) => (isChatGroup(r) ? '' : (r.chatType ?? ''));
    const getFirstTagName = (r: ChatRow) =>
      isChatGroup(r) ? r.tags[0]?.name : r.tags?.[0]?.name;
    const getLastMessageTime = (r: ChatRow) => {
      if (isChatGroup(r)) return new Date(r.lastActivityAt).getTime();
      return r.lastMessage?.createdAt ? new Date(r.lastMessage.createdAt).getTime() : 0;
    };
    const getLastActivity = (r: ChatRow) =>
      new Date(r.lastActivityAt ?? 0).getTime();

    return [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') {
        cmp = getName(a).localeCompare(getName(b));
      } else if (sortBy === 'messageCount') {
        cmp = getMessageCount(a) - getMessageCount(b);
      } else if (sortBy === 'chatType') {
        cmp = getChatType(a).localeCompare(getChatType(b));
      } else if (sortBy === 'tags') {
        const aTag = getFirstTagName(a);
        const bTag = getFirstTagName(b);
        if (!aTag && !bTag) cmp = 0;
        else if (!aTag) cmp = 1;
        else if (!bTag) cmp = -1;
        else cmp = aTag.localeCompare(bTag);
      } else if (sortBy === 'lastMessageDate') {
        cmp = getLastMessageTime(a) - getLastMessageTime(b);
      } else {
        cmp = getLastActivity(a) - getLastActivity(b);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    // `search` intentionally absent from deps: server-side filtering already
    // narrows `chats` for that input, so adding it would only cause redundant
    // recomputes.
  }, [chats, chatTypeFilter, sortBy, sortDir]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleSelectAll = () => {
    const selectableIds = sorted.filter((r) => !isChatGroup(r)).map((r) => (r as Chat).id);
    if (selectedIds.length === selectableIds.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(selectableIds);
    }
  };

  return (
    <RequireOrgContext>
    <div className="px-4 py-6 md:px-6 md:py-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Chats</h1>
          <p className="text-sm text-slate-500">
            {total} chat{total !== 1 ? 's' : ''} imported across all messengers
          </p>
        </div>
        <button
          onClick={() => setShowImport(true)}
          className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:bg-accent-hover hover:-translate-y-px"
        >
          <Plus className="h-4 w-4" />
          Import Chats
        </button>
      </div>

      {/* Filters bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative min-w-0 flex-1 sm:min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats..."
            className="w-full rounded border-[1.5px] border-slate-200 py-2 pl-9 pr-3 text-sm transition-colors placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
          />
        </div>

        {/* Messenger filter */}
        <select
          value={messengerFilter ?? ''}
          onChange={(e) => setMessengerFilter((e.target.value as MessengerType) || null)}
          className="rounded border-[1.5px] border-slate-200 px-3 py-2 text-xs text-slate-600 focus:border-accent focus:outline-none"
        >
          <option value="">All Messengers</option>
          {(Object.keys(messengerConfig) as MessengerType[]).map((m) => (
            <option key={m} value={m}>{messengerConfig[m].label}</option>
          ))}
        </select>

        {/* Status filter */}
        <select
          value={statusFilter ?? ''}
          onChange={(e) => setStatusFilter(e.target.value || null)}
          className="rounded border-[1.5px] border-slate-200 px-3 py-2 text-xs text-slate-600 focus:border-accent focus:outline-none"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="read-only">Read-only</option>
        </select>

        {/* Chat type filter */}
        <select
          value={chatTypeFilter ?? ''}
          onChange={(e) => setChatTypeFilter(e.target.value || null)}
          className="rounded border-[1.5px] border-slate-200 px-3 py-2 text-xs text-slate-600 focus:border-accent focus:outline-none"
        >
          <option value="">All types</option>
          <option value="direct">Direct</option>
          <option value="group">Group</option>
          <option value="channel">Channel</option>
        </select>

        {/* Tag filter */}
        <select
          value={tagFilter ?? ''}
          onChange={(e) => setTagFilter(e.target.value || null)}
          className="rounded border-[1.5px] border-slate-200 px-3 py-2 text-xs text-slate-600 focus:border-accent focus:outline-none"
        >
          <option value="">All tags</option>
          {(tagsData?.tags ?? []).map((tag) => (
            <option key={tag.id} value={tag.id}>{tag.name}</option>
          ))}
        </select>

        {/* Owner filter */}
        <input
          value={ownerFilter ?? ''}
          onChange={(e) => setOwnerFilter(e.target.value || null)}
          placeholder="Filter by owner..."
          className="rounded border-[1.5px] border-slate-200 py-2 pl-3 pr-3 text-xs text-slate-600 placeholder:text-slate-400 focus:border-accent focus:outline-none w-full sm:w-36"
        />

        {/* Sort dropdown */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="rounded border-[1.5px] border-slate-200 px-3 py-2 text-xs text-slate-600 focus:border-accent focus:outline-none"
        >
          <option value="lastActivityAt">Sort: Last Active</option>
          <option value="lastMessageDate">Sort: Last Message</option>
          <option value="name">Sort: Name</option>
          <option value="messageCount">Sort: Messages</option>
          <option value="chatType">Sort: Type</option>
          <option value="tags">Sort: Tags</option>
        </select>

        {/* Sort direction toggle */}
        <button
          onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          className="flex items-center gap-1 rounded border-[1.5px] border-slate-200 px-2.5 py-2 text-xs text-slate-600 transition-colors hover:bg-slate-50"
          title={sortDir === 'desc' ? 'Descending' : 'Ascending'}
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
          {sortDir === 'desc' ? '\u2193' : '\u2191'}
        </button>
      </div>

      {/* Bulk actions */}
      {selectedIds.length > 0 && (
        <div className="mb-4">
          <BulkActions
            selectedIds={selectedIds}
            onClear={() => setSelectedIds([])}
          />
        </div>
      )}

      {/* Mobile card list */}
      <div className="flex flex-col gap-2 md:hidden">
        {sorted.map((row) => {
          if (isChatGroup(row)) {
            const cfg = messengerConfig.gmail;
            return (
              <a
                key={`group-${row.domain}`}
                href={`/messenger?search=${encodeURIComponent(row.domain)}`}
                className="rounded-xl border border-slate-200 bg-white p-3 transition-colors block"
              >
                <div className="flex items-center gap-3">
                  <div className={cn('h-2 w-2 rounded-full', cfg.dotColor)} />
                  <span className="flex-1 truncate text-sm font-medium text-slate-900">
                    {row.label}
                  </span>
                  <span className="text-xs text-slate-400">
                    {row.totalMessages} msgs
                  </span>
                </div>
                <p className="mt-1 truncate pl-5 text-xs text-slate-500">
                  {row.latestChat.lastMessage?.text ?? row.latestChat.name}
                </p>
              </a>
            );
          }
          const chat = row;
          const cfg = messengerConfig[chat.messenger];
          const isSelected = selectedIds.includes(chat.id);
          return (
            <div
              key={chat.id}
              className={cn(
                'rounded-xl border border-slate-200 bg-white p-3 transition-colors',
                isSelected && 'border-accent bg-accent/5',
              )}
              onClick={() => toggleSelect(chat.id)}
            >
              <div className="flex items-center gap-3">
                <div className={cn('h-2 w-2 rounded-full', cfg.dotColor)} />
                <span className="flex-1 truncate text-sm font-medium text-slate-900">
                  {chat.name}
                </span>
                <span className="text-xs text-slate-400">
                  {chat.lastMessage?.createdAt
                    ? new Date(chat.lastMessage.createdAt).toLocaleDateString()
                    : ''}
                </span>
              </div>
              {chat.lastMessage && (
                <p className="mt-1 truncate pl-5 text-xs text-slate-500">
                  {chat.lastMessage.text ?? ''}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Table */}
      <div className="hidden overflow-hidden rounded-lg bg-white shadow-xs md:block">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="py-20 text-center">
            <MessageSquare className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="text-sm font-medium text-slate-600">No chats found</p>
            <p className="mt-1 text-xs text-slate-400">
              Import chats from your connected messengers
            </p>
            <button
              onClick={() => setShowImport(true)}
              className="mt-4 inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:bg-accent-hover hover:-translate-y-px"
            >
              <Plus className="h-4 w-4" />
              Import Chats
            </button>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={
                      selectedIds.length > 0 &&
                      selectedIds.length === sorted.filter((r) => !isChatGroup(r)).length
                    }
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent/30"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Chat
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Messenger
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Owner
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Messages
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Tags
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  Last Active
                </th>
                <th className="w-10 px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((row) => {
                if (isChatGroup(row)) {
                  return <GroupRow key={`group-${row.domain}`} group={row} />;
                }
                const chat = row;
                const mcfg = messengerConfig[chat.messenger];
                const TypeIcon = chatTypeIcons[chat.chatType] ?? MessageSquare;
                const isSelected = selectedIds.includes(chat.id);

                return (
                  <tr
                    key={chat.id}
                    className={cn(
                      'transition-colors hover:bg-slate-50/50',
                      isSelected && 'bg-accent-bg/30',
                    )}
                  >
                    {/* Checkbox */}
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(chat.id)}
                        className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent/30"
                      />
                    </td>

                    {/* Chat name + avatar */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ChatAvatar name={chat.name} messenger={chat.messenger} size={36} />
                        <div>
                          <a
                            href={`/messenger?chatId=${chat.id}`}
                            className="text-sm font-medium text-slate-800 hover:text-accent"
                          >
                            {chat.name}
                          </a>
                          {chat.status === 'read-only' && (
                            <span className="ml-1.5 text-[10px] text-slate-400">read-only</span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Messenger */}
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                          mcfg.bgClass,
                          mcfg.textClass,
                        )}
                      >
                        {mcfg.label}
                      </span>
                    </td>

                    {/* Type */}
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        <TypeIcon className="h-3.5 w-3.5" />
                        {chat.chatType.charAt(0).toUpperCase() + chat.chatType.slice(1)}
                      </span>
                    </td>

                    {/* Owner */}
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {chat.ownerName ?? '—'}
                    </td>

                    {/* Messages */}
                    <td className="px-4 py-3 text-xs text-slate-600 font-medium">
                      {chat.messageCount.toLocaleString()}
                    </td>

                    {/* Tags */}
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {(chat.tags ?? []).map((tag) => (
                          <span
                            key={tag.id}
                            className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor: tag.color + '18',
                              color: tag.color,
                            }}
                          >
                            {tag.name}
                          </span>
                        ))}
                        {(!chat.tags || chat.tags.length === 0) && (
                          <span className="text-[10px] text-slate-300">—</span>
                        )}
                      </div>
                    </td>

                    {/* Last active */}
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {formatTime(chat.lastActivityAt)}
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-3">
                      <ChatRowActions chat={chat} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Import Modal */}
      <ImportChatsModal open={showImport} onClose={() => setShowImport(false)} />
    </div>
    </RequireOrgContext>
  );
}
