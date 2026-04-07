'use client';

import { useRouter } from 'next/navigation';
import { WikiArticleEditor } from '@/components/wiki/WikiArticleEditor';
import { useCreateWikiArticle, type CreateArticleInput } from '@/hooks/useWiki';
import { RequireOrgContext } from '@/components/layout/RequireOrgContext';

export default function NewWikiArticlePage() {
  const router = useRouter();
  const createArticle = useCreateWikiArticle();

  return (
    <RequireOrgContext>
    <div className="h-full overflow-auto">
      <WikiArticleEditor
        onSubmit={(data: CreateArticleInput) => {
          createArticle.mutate(data, {
            onSuccess: (article) => {
              router.push(`/wiki/${article.slug}`);
            },
          });
        }}
        isSubmitting={createArticle.isPending}
      />
    </div>
    </RequireOrgContext>
  );
}
