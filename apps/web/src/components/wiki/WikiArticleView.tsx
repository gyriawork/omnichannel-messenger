'use client';

import { WikiArticle } from '@/hooks/useWiki';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Edit3, Trash2, Eye, Clock } from 'lucide-react';

interface WikiArticleViewProps {
  article: WikiArticle;
  onDelete?: () => void;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function formatRelativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return 'только что';
  if (diffMin < 60) {
    const mod = diffMin % 10;
    const label =
      diffMin >= 11 && diffMin <= 19
        ? 'минут'
        : mod === 1
          ? 'минуту'
          : mod >= 2 && mod <= 4
            ? 'минуты'
            : 'минут';
    return `${diffMin} ${label} назад`;
  }
  if (diffHours < 24) {
    const mod = diffHours % 10;
    const label =
      diffHours >= 11 && diffHours <= 19
        ? 'часов'
        : mod === 1
          ? 'час'
          : mod >= 2 && mod <= 4
            ? 'часа'
            : 'часов';
    return `${diffHours} ${label} назад`;
  }

  const mod = diffDays % 10;
  const label =
    diffDays >= 11 && diffDays <= 19
      ? 'дней'
      : mod === 1
        ? 'день'
        : mod >= 2 && mod <= 4
          ? 'дня'
          : 'дней';
  return `${diffDays} ${label} назад`;
}

export function WikiArticleView({ article, onDelete }: WikiArticleViewProps) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const canEdit =
    user?.id === article.authorId ||
    user?.role === 'admin' ||
    user?.role === 'superadmin';

  const canDelete =
    user?.role === 'admin' || user?.role === 'superadmin';

  const isCaseStudy = article.type === 'case_study';

  // Render content — for now just stringify JSON (TipTap rendering will be added later)
  const renderedContent =
    typeof article.content === 'string'
      ? article.content
      : JSON.stringify(article.content, null, 2);

  return (
    <div className="max-w-[820px] mx-auto px-6 py-8">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1 mb-5" style={{ fontSize: 12 }}>
        <Link href="/wiki" className="hover:underline" style={{ color: '#6366f1' }}>
          Wiki
        </Link>
        <span style={{ color: '#cbd5e1' }}>&rsaquo;</span>

        {article.category.parent && (
          <>
            <Link
              href={`/wiki?category=${article.category.parent.slug}`}
              className="hover:underline"
              style={{ color: '#6366f1' }}
            >
              {article.category.parent.name}
            </Link>
            <span style={{ color: '#cbd5e1' }}>&rsaquo;</span>
          </>
        )}

        <Link
          href={`/wiki?category=${article.category.slug}`}
          className="hover:underline"
          style={{ color: '#6366f1' }}
        >
          {article.category.name}
        </Link>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          {isCaseStudy && (
            <span
              className="inline-block mb-2 font-semibold uppercase"
              style={{
                fontSize: 11,
                backgroundColor: '#fef3c7',
                color: '#d97706',
                padding: '2px 8px',
                borderRadius: 4,
              }}
            >
              КЕЙС
            </span>
          )}
          <h1
            className="font-bold"
            style={{ fontSize: 22, color: '#1e293b', lineHeight: 1.3 }}
          >
            {article.title}
          </h1>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 pt-1">
          {canEdit && (
            <Link
              href={`/wiki/${article.slug}/edit`}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg',
                'text-[13px] font-medium transition-colors',
                'bg-[#f1f5f9] text-[#475569] hover:bg-[#e2e8f0]'
              )}
            >
              <Edit3 size={14} />
              Редактировать
            </Link>
          )}
          {canDelete && onDelete && (
            <button
              onClick={onDelete}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg',
                'text-[13px] font-medium transition-colors',
                'bg-[#fef2f2] text-[#dc2626] hover:bg-[#fee2e2]'
              )}
            >
              <Trash2 size={14} />
              Удалить
            </button>
          )}
        </div>
      </div>

      {/* Meta line */}
      <div
        className="flex items-center gap-2 pb-4 mb-6"
        style={{ borderBottom: '1px solid #e2e8f0' }}
      >
        <div
          className="flex items-center justify-center rounded-full font-semibold"
          style={{
            width: 28,
            height: 28,
            backgroundColor: '#c7d2fe',
            color: '#4338ca',
            fontSize: 11,
          }}
        >
          {getInitials(article.author.name)}
        </div>
        <span style={{ fontSize: 13, color: '#64748b' }}>{article.author.name}</span>
        <span style={{ fontSize: 13, color: '#94a3b8' }}>&bull;</span>
        <span className="inline-flex items-center gap-1" style={{ fontSize: 13, color: '#94a3b8' }}>
          <Clock size={13} />
          {formatRelativeTime(article.createdAt)}
        </span>
        <span style={{ fontSize: 13, color: '#94a3b8' }}>&bull;</span>
        <span className="inline-flex items-center gap-1" style={{ fontSize: 13, color: '#94a3b8' }}>
          <Eye size={13} />
          {article.viewCount}
        </span>
      </div>

      {/* Case study blocks */}
      {isCaseStudy && (
        <div className="flex flex-col gap-3 mb-6">
          {article.caseProblem && (
            <div
              className="rounded-[10px]"
              style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                padding: '16px 20px',
              }}
            >
              <div className="font-semibold mb-1" style={{ color: '#991b1b', fontSize: 14 }}>
                <span className="mr-1.5">&#128308;</span>
                Проблема
              </div>
              <div style={{ color: '#7f1d1d', fontSize: 14, lineHeight: 1.6 }}>
                {article.caseProblem}
              </div>
            </div>
          )}

          {article.caseSolution && (
            <div
              className="rounded-[10px]"
              style={{
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                padding: '16px 20px',
              }}
            >
              <div className="font-semibold mb-1" style={{ color: '#166534', fontSize: 14 }}>
                <span className="mr-1.5">&#128994;</span>
                Решение
              </div>
              <div style={{ color: '#14532d', fontSize: 14, lineHeight: 1.6 }}>
                {article.caseSolution}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main content */}
      <div
        className="whitespace-pre-wrap mb-8"
        style={{ fontSize: 14, color: '#334155', lineHeight: 1.7 }}
      >
        {renderedContent}
      </div>

      {/* Tags */}
      {article.tags.length > 0 && (
        <div
          className="flex flex-wrap gap-1.5 pt-4"
          style={{ borderTop: '1px solid #e2e8f0' }}
        >
          {article.tags.map((tag) => (
            <span
              key={tag.id}
              className="rounded"
              style={{
                fontSize: 11,
                backgroundColor: '#f1f5f9',
                color: '#64748b',
                padding: '3px 10px',
              }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
