'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Search,
  ChevronRight,
  ChevronDown,
  Plus,
  MoreHorizontal,
  Trash2,
  Edit3,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';
import {
  useWikiCategories,
  useCreateWikiCategory,
  useDeleteWikiCategory,
  type WikiCategory,
} from '@/hooks/useWiki';

interface WikiSidebarProps {
  activeCategoryId?: string;
  onCategorySelect: (categoryId: string | undefined) => void;
}

export function WikiSidebar({ activeCategoryId, onCategorySelect }: WikiSidebarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const { data, isLoading } = useWikiCategories();
  const createCategory = useCreateWikiCategory();
  const deleteCategory = useDeleteWikiCategory();

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [searchValue, setSearchValue] = useState(searchParams.get('search') ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  const categories = data?.categories ?? [];

  // Build tree: top-level categories with nested children
  const rootCategories = categories.filter((c) => !c.parentId);

  const toggleExpand = useCallback((categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }, []);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchValue(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (value.trim()) {
          router.push(`/wiki?search=${encodeURIComponent(value.trim())}`);
        } else {
          router.push('/wiki');
        }
      }, 400);
    },
    [router],
  );

  const handleAddCategory = useCallback(() => {
    if (!newCategoryName.trim()) return;
    createCategory.mutate(
      { name: newCategoryName.trim() },
      {
        onSuccess: () => {
          setNewCategoryName('');
          setShowCategoryForm(false);
        },
        onError: () => {
          toast.error('Failed to create category');
        },
      },
    );
  }, [createCategory, newCategoryName]);

  const handleDeleteCategory = useCallback(
    (e: React.MouseEvent, categoryId: string) => {
      e.stopPropagation();
      if (!confirm('Delete this category and all its articles?')) return;
      deleteCategory.mutate(categoryId);
      if (activeCategoryId === categoryId) {
        onCategorySelect(undefined);
      }
    },
    [deleteCategory, activeCategoryId, onCategorySelect],
  );

  const getChildCount = (category: WikiCategory): number => {
    const directCount = category._count.articles;
    const childrenCount = (category.children ?? []).reduce(
      (sum, child) => sum + getChildCount(child),
      0,
    );
    return directCount + childrenCount;
  };

  const renderCategory = (category: WikiCategory, depth: number = 0) => {
    const children = category.children ?? [];
    const hasChildren = children.length > 0;
    const isExpanded = expandedCategories.has(category.id);
    const isActive = activeCategoryId === category.id;
    const articleCount = getChildCount(category);

    return (
      <div key={category.id}>
        <button
          onClick={() => onCategorySelect(category.id)}
          className={cn(
            'group flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors',
            depth > 0 && 'pl-7',
            isActive
              ? 'bg-[#eef2ff] text-[#6366f1] font-medium'
              : 'text-[#1e293b] hover:bg-slate-100',
          )}
        >
          {hasChildren ? (
            <span
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(category.id);
              }}
              className="flex-shrink-0 cursor-pointer p-0.5 rounded hover:bg-slate-200"
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-[#94a3b8]" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-[#94a3b8]" />
              )}
            </span>
          ) : (
            <span className="w-[18px] flex-shrink-0" />
          )}

          <span className="flex-1 truncate">{category.name}</span>

          <span
            className={cn(
              'flex-shrink-0 text-[11px] tabular-nums',
              isActive ? 'text-[#6366f1]/60' : 'text-[#94a3b8]',
            )}
          >
            {articleCount}
          </span>

          {isAdmin && (
            <span
              onClick={(e) => handleDeleteCategory(e, category.id)}
              className="hidden flex-shrink-0 cursor-pointer rounded p-0.5 text-[#94a3b8] hover:bg-red-50 hover:text-red-500 group-hover:inline-flex"
            >
              <Trash2 className="h-3 w-3" />
            </span>
          )}
        </button>

        {hasChildren && isExpanded && (
          <div>{children.map((child) => renderCategory(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <aside
      className="flex h-full w-[220px] flex-shrink-0 flex-col border-r border-[#e2e8f0] bg-[#f8fafc] p-3"
      style={{ fontSize: 13 }}
    >
      {/* Search */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94a3b8]" />
        <input
          type="text"
          placeholder="Search..."
          value={searchValue}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full rounded-md border border-[#e2e8f0] bg-white py-1.5 pl-7 pr-2 text-[13px] text-[#1e293b] placeholder:text-[#94a3b8] outline-none focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1]/20"
        />
      </div>

      {/* Section header */}
      <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">
        Categories
      </div>

      {/* "All" option */}
      <button
        onClick={() => onCategorySelect(undefined)}
        className={cn(
          'mb-0.5 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors',
          !activeCategoryId
            ? 'bg-[#eef2ff] text-[#6366f1] font-medium'
            : 'text-[#1e293b] hover:bg-slate-100',
        )}
      >
        <span className="w-[18px] flex-shrink-0" />
        <span className="flex-1">All articles</span>
      </button>

      {/* Categories list */}
      <div className="flex-1 space-y-0.5 overflow-y-auto">
        {isLoading ? (
          <div className="px-2 py-4 text-center text-[12px] text-[#94a3b8]">Loading...</div>
        ) : rootCategories.length === 0 ? (
          <div className="px-2 py-4 text-center text-[12px] text-[#94a3b8]">No categories</div>
        ) : (
          rootCategories.map((category) => renderCategory(category))
        )}
      </div>

      {/* Add category (admin only) */}
      {isAdmin && (
        <>
          <div className="my-2 border-t border-[#e2e8f0]" />
          {showCategoryForm ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddCategory();
                    if (e.key === 'Escape') {
                      setShowCategoryForm(false);
                      setNewCategoryName('');
                    }
                  }}
                  placeholder="Category name..."
                  autoFocus
                  className="flex-1 rounded-md border border-[#e2e8f0] bg-white px-2 py-1.5 text-[13px] text-[#1e293b] placeholder:text-[#94a3b8] outline-none focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1]/20"
                />
                <button
                  onClick={() => {
                    setShowCategoryForm(false);
                    setNewCategoryName('');
                  }}
                  className="rounded p-1 text-[#94a3b8] hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <button
                onClick={handleAddCategory}
                disabled={createCategory.isPending || !newCategoryName.trim()}
                className="flex w-full items-center justify-center rounded-lg bg-[#6366f1] px-2 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#5558e6] disabled:opacity-50"
              >
                {createCategory.isPending ? 'Creating...' : 'Add'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowCategoryForm(true)}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-[#6366f1] transition-colors hover:bg-[#eef2ff]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>+ Add category</span>
            </button>
          )}
        </>
      )}
    </aside>
  );
}
