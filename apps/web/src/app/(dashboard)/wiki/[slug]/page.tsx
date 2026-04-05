'use client';

import { useParams, useRouter } from 'next/navigation';
import { WikiSidebar } from '@/components/wiki/WikiSidebar';
import { WikiArticleView } from '@/components/wiki/WikiArticleView';
import { useWikiArticle, useDeleteWikiArticle } from '@/hooks/useWiki';

export default function WikiArticlePage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const { data: article, isLoading } = useWikiArticle(slug);
  const deleteArticle = useDeleteWikiArticle();

  const handleDelete = () => {
    if (!article) return;
    if (!confirm('Delete this article?')) return;
    deleteArticle.mutate(article.id, {
      onSuccess: () => router.push('/wiki'),
    });
  };

  return (
    <div className="flex h-full">
      <WikiSidebar
        activeCategoryId={article?.category?.id}
        onCategorySelect={(catId) => router.push(`/wiki${catId ? `?categoryId=${catId}` : ''}`)}
      />
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : article ? (
          <WikiArticleView article={article} onDelete={handleDelete} />
        ) : (
          <div className="flex items-center justify-center py-20 text-slate-400">
            Article not found
          </div>
        )}
      </div>
    </div>
  );
}
