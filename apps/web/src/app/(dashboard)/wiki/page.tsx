'use client';

import { useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { WikiSidebar } from '@/components/wiki/WikiSidebar';
import { WikiArticleList } from '@/components/wiki/WikiArticleList';
import { useWikiArticles, useWikiCategories } from '@/hooks/useWiki';

export default function WikiPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeCategoryId, setActiveCategoryId] = useState<string | undefined>();
  const [activeFilter, setActiveFilter] = useState<'all' | 'article' | 'case_study'>('all');

  const searchQuery = searchParams.get('search') || undefined;

  const { data: categoriesData } = useWikiCategories();
  const { data: articlesData, isLoading } = useWikiArticles({
    categoryId: activeCategoryId,
    type: activeFilter === 'all' ? undefined : activeFilter,
    search: searchQuery,
  });

  // Find current category info for breadcrumbs
  const activeCategory = useMemo(() => {
    if (!activeCategoryId || !categoriesData?.categories) return undefined;
    for (const cat of categoriesData.categories) {
      if (cat.id === activeCategoryId) return cat;
      if (cat.children) {
        const child = cat.children.find((c) => c.id === activeCategoryId);
        if (child) return { ...child, parent: { name: cat.name, slug: cat.slug } };
      }
    }
    return undefined;
  }, [activeCategoryId, categoriesData]);

  const breadcrumbs = useMemo(() => {
    if (!activeCategory) return undefined;
    const crumbs: { name: string; slug: string }[] = [];
    if ('parent' in activeCategory && activeCategory.parent) {
      crumbs.push(activeCategory.parent as { name: string; slug: string });
    }
    crumbs.push({ name: activeCategory.name, slug: activeCategory.slug });
    return crumbs;
  }, [activeCategory]);

  return (
    <div className="flex h-full">
      <WikiSidebar
        activeCategoryId={activeCategoryId}
        onCategorySelect={setActiveCategoryId}
      />
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : (
          <WikiArticleList
            articles={articlesData?.articles || []}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            categoryName={activeCategory?.name}
            breadcrumbs={breadcrumbs}
            onNewArticle={() => router.push('/wiki/new')}
          />
        )}
      </div>
    </div>
  );
}
