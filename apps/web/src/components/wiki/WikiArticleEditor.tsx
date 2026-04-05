'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Save,
  ArrowLeft,
  Bold,
  Italic,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Link2,
  Code,
  Minus,
} from 'lucide-react';
import { useWikiCategories, useWikiTags, type WikiArticle, type WikiCategory } from '@/hooks/useWiki';
import { cn } from '@/lib/utils';

interface WikiArticleEditorProps {
  article?: WikiArticle;
  onSubmit: (data: {
    title: string;
    content: unknown;
    categoryId: string;
    type: 'article' | 'case_study';
    status: 'draft' | 'published';
    caseProblem?: string;
    caseSolution?: string;
    tagIds?: string[];
  }) => void;
  isSubmitting?: boolean;
}

/**
 * Flatten categories tree into a list with depth info for indented rendering.
 */
function flattenCategories(
  categories: WikiCategory[],
  depth = 0,
): Array<WikiCategory & { depth: number }> {
  const result: Array<WikiCategory & { depth: number }> = [];
  for (const cat of categories) {
    result.push({ ...cat, depth });
    if (cat.children && cat.children.length > 0) {
      result.push(...flattenCategories(cat.children, depth + 1));
    }
  }
  return result;
}

export function WikiArticleEditor({
  article,
  onSubmit,
  isSubmitting = false,
}: WikiArticleEditorProps) {
  const router = useRouter();
  const { data: categoriesData } = useWikiCategories();
  const { data: tagsData } = useWikiTags();

  const categories = categoriesData?.categories ?? [];
  const tags = tagsData?.tags ?? [];

  // Extract initial text content from article.content if editing
  const initialContent =
    article?.content &&
    typeof article.content === 'object' &&
    article.content !== null &&
    'content' in (article.content as Record<string, unknown>)
      ? String((article.content as Record<string, unknown>).content)
      : '';

  const [title, setTitle] = useState(article?.title ?? '');
  const [content, setContent] = useState(initialContent);
  const [categoryId, setCategoryId] = useState(article?.category?.id ?? '');
  const [type, setType] = useState<'article' | 'case_study'>(article?.type ?? 'article');
  const [caseProblem, setCaseProblem] = useState(article?.caseProblem ?? '');
  const [caseSolution, setCaseSolution] = useState(article?.caseSolution ?? '');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    article?.tags?.map((t) => t.id) ?? [],
  );

  const handleToggleTag = useCallback((tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  }, []);

  const handleSubmit = useCallback(
    (status: 'draft' | 'published') => {
      onSubmit({
        title,
        content: { type: 'text', content },
        categoryId,
        type,
        status,
        ...(type === 'case_study' ? { caseProblem, caseSolution } : {}),
        tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      });
    },
    [title, content, categoryId, type, caseProblem, caseSolution, selectedTagIds, onSubmit],
  );

  const flatCategories = flattenCategories(categories);
  const isEditing = !!article;

  return (
    <div className="min-h-screen bg-white">
      {/* ─── Top bar ─── */}
      <div className="sticky top-0 z-10 border-b border-[#e2e8f0] bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-800"
            >
              <ArrowLeft className="h-4 w-4" />
              Назад
            </button>
            <span className="text-slate-300">/</span>
            <h1 className="text-sm font-semibold text-slate-800">
              {isEditing ? 'Редактирование' : 'Новая статья'}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleSubmit('draft')}
              className={cn(
                'rounded-lg border border-[#e2e8f0] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors',
                'hover:bg-slate-50 disabled:opacity-50',
              )}
            >
              Сохранить как черновик
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleSubmit('published')}
              className={cn(
                'flex items-center gap-2 rounded-lg bg-[#6366f1] px-4 py-2 text-sm font-medium text-white transition-colors',
                'hover:bg-[#5558e6] disabled:opacity-50',
              )}
            >
              <Save className="h-4 w-4" />
              Опубликовать
            </button>
          </div>
        </div>
      </div>

      {/* ─── Form ─── */}
      <div className="mx-auto max-w-[720px] px-6 py-8">
        {/* Title */}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Заголовок статьи"
          className="w-full border-0 border-b border-[#e2e8f0] pb-3 text-[22px] font-bold text-slate-900 placeholder:text-slate-300 focus:border-[#6366f1] focus:outline-none focus:ring-0"
        />

        {/* Meta row */}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          {/* Category select */}
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={cn(
              'rounded-lg border-[1.5px] border-[#e2e8f0] bg-white px-3 py-2 text-sm text-slate-700',
              'focus:border-[#6366f1] focus:outline-none focus:ring-2 focus:ring-[#6366f1]/20',
            )}
          >
            <option value="">Выберите категорию</option>
            {flatCategories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {'\u00A0\u00A0'.repeat(cat.depth)}
                {cat.name}
              </option>
            ))}
          </select>

          {/* Type toggle */}
          <div className="flex overflow-hidden rounded-lg border border-[#e2e8f0]">
            <button
              type="button"
              onClick={() => setType('article')}
              className={cn(
                'px-4 py-2 text-sm font-medium transition-colors',
                type === 'article'
                  ? 'bg-[#6366f1] text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              Статья
            </button>
            <button
              type="button"
              onClick={() => setType('case_study')}
              className={cn(
                'px-4 py-2 text-sm font-medium transition-colors',
                type === 'case_study'
                  ? 'bg-[#6366f1] text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              Кейс
            </button>
          </div>
        </div>

        {/* Case fields */}
        {type === 'case_study' && (
          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Проблема</label>
              <textarea
                value={caseProblem}
                onChange={(e) => setCaseProblem(e.target.value)}
                placeholder="Опишите проблему..."
                rows={3}
                className={cn(
                  'w-full rounded-lg border-[1.5px] border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-sm text-slate-800',
                  'placeholder:text-red-300 focus:border-[#6366f1] focus:outline-none focus:ring-2 focus:ring-[#6366f1]/20',
                )}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Решение</label>
              <textarea
                value={caseSolution}
                onChange={(e) => setCaseSolution(e.target.value)}
                placeholder="Опишите решение..."
                rows={3}
                className={cn(
                  'w-full rounded-lg border-[1.5px] border-[#bbf7d0] bg-[#f0fdf4] px-3 py-2 text-sm text-slate-800',
                  'placeholder:text-green-300 focus:border-[#6366f1] focus:outline-none focus:ring-2 focus:ring-[#6366f1]/20',
                )}
              />
            </div>
          </div>
        )}

        {/* Content editor */}
        <div className="mt-6">
          {/* Toolbar (placeholder for future TipTap toolbar) */}
          <div className="flex items-center gap-1 rounded-t-lg border border-b-0 border-[#e2e8f0] bg-slate-50 px-2 py-1.5">
            {[Bold, Italic, Heading2, Heading3, List, ListOrdered, Link2, Code, Minus].map(
              (Icon, i) => (
                <button
                  key={i}
                  type="button"
                  disabled
                  className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Available after TipTap integration"
                >
                  <Icon className="h-4 w-4" />
                </button>
              ),
            )}
          </div>

          {/* TODO: Replace with TipTap editor */}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Содержание статьи..."
            className={cn(
              'w-full rounded-b-lg border-[1.5px] border-[#e2e8f0] px-4 py-3 text-sm leading-relaxed text-slate-800',
              'placeholder:text-slate-300 focus:border-[#6366f1] focus:outline-none focus:ring-2 focus:ring-[#6366f1]/20',
            )}
            style={{ minHeight: 300 }}
          />
        </div>

        {/* Tags */}
        <div className="mt-6">
          <label className="mb-2 block text-sm font-medium text-slate-700">Теги</label>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const isSelected = selectedTagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => handleToggleTag(tag.id)}
                  className={cn(
                    'rounded-full px-3 py-1 text-sm font-medium transition-colors',
                    isSelected
                      ? 'bg-[#6366f1] text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                  )}
                >
                  {tag.name}
                </button>
              );
            })}
            {tags.length === 0 && (
              <span className="text-sm text-slate-400">Нет доступных тегов</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
