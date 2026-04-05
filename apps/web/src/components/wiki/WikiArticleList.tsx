'use client';

import type { WikiArticle } from '@/hooks/useWiki';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Eye, Clock, User } from 'lucide-react';

type FilterType = 'all' | 'article' | 'case_study';

interface WikiArticleListProps {
  articles: WikiArticle[];
  activeFilter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  categoryName?: string;
  breadcrumbs?: { name: string; slug: string }[];
  onNewArticle: () => void;
  categories?: Array<{ id: string; name: string; slug: string }>;
  activeCategoryId?: string;
  onCategoryChange?: (categoryId: string | undefined) => void;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHours < 24) return `${diffHours} h ago`;
  if (diffDays < 7) return `${diffDays} d ago`;
  if (diffWeeks < 5) return `${diffWeeks} w ago`;
  return `${diffMonths} mo ago`;
}

const filters: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'article', label: 'Articles' },
  { key: 'case_study', label: 'Cases' },
];

export function WikiArticleList({
  articles,
  activeFilter,
  onFilterChange,
  categoryName,
  breadcrumbs,
  onNewArticle,
  categories,
  activeCategoryId,
  onCategoryChange,
}: WikiArticleListProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Mobile category filter */}
      {categories && categories.length > 0 && (
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
          {categories.map((cat) => (
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
      )}
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          {breadcrumbs && breadcrumbs.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-[#94a3b8] mb-1">
              {breadcrumbs.map((crumb, i) => (
                <span key={crumb.slug} className="flex items-center gap-1">
                  {i > 0 && <span>&rsaquo;</span>}
                  <Link
                    href={`/wiki/${crumb.slug}`}
                    className="hover:text-[#64748b] transition-colors"
                  >
                    {crumb.name}
                  </Link>
                </span>
              ))}
            </div>
          )}
          {categoryName && (
            <h2 className="text-[18px] font-semibold text-[#1e293b]">
              {categoryName}
            </h2>
          )}
        </div>

        <button
          onClick={onNewArticle}
          className="flex items-center justify-center rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          + New article
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => onFilterChange(f.key)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              activeFilter === f.key
                ? 'bg-accent text-white'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Article cards */}
      {articles.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-sm text-[#94a3b8]">
          No articles in this category
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {articles.map((article) => (
            <Link
              key={article.id}
              href={`/wiki/${article.slug}`}
              className={cn(
                'block rounded-[10px] border border-[#e2e8f0] bg-white px-4 py-[14px] cursor-pointer hover:border-[#cbd5e1] transition-colors',
                article.status === 'draft' && 'opacity-70'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-2 min-w-0">
                  {/* Badges */}
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
                        article.type === 'article'
                          ? 'bg-[#eef2ff] text-[#6366f1]'
                          : 'bg-[#fef3c7] text-[#d97706]'
                      )}
                    >
                      {article.type === 'article' ? 'Article' : 'Case'}
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
                        article.status === 'published'
                          ? 'bg-[#dcfce7] text-[#16a34a]'
                          : 'bg-[#f1f5f9] text-[#94a3b8]'
                      )}
                    >
                      {article.status === 'published'
                        ? 'Published'
                        : 'Draft'}
                    </span>
                  </div>

                  {/* Title */}
                  <span className="text-[14px] font-semibold text-[#1e293b] truncate">
                    {article.title}
                  </span>

                  {/* Meta */}
                  <div className="flex items-center gap-3 text-xs text-[#94a3b8]">
                    <span className="flex items-center gap-1">
                      <User size={12} />
                      {article.author.name}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={12} />
                      {formatRelativeTime(article.updatedAt)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Eye size={12} />
                      {article.viewCount}
                    </span>
                  </div>
                </div>

                {/* Tags */}
                {article.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 shrink-0">
                    {article.tags.map((tag) => (
                      <span
                        key={tag.id}
                        className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500"
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
