'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── Types ───

export interface WikiCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  parentId: string | null;
  order: number;
  _count: { articles: number };
  children?: WikiCategory[];
}

export interface WikiTag {
  id: string;
  name: string;
  color: string;
}

export interface WikiArticle {
  id: string;
  title: string;
  slug: string;
  content: unknown;
  type: 'article' | 'case_study';
  status: 'draft' | 'published';
  caseProblem: string | null;
  caseSolution: string | null;
  viewCount: number;
  authorId: string;
  author: { id: string; name: string };
  updatedBy?: { id: string; name: string } | null;
  category: {
    id: string;
    name: string;
    slug: string;
    parentId: string | null;
    parent?: { id: string; name: string; slug: string } | null;
  };
  tags: WikiTag[];
  createdAt: string;
  updatedAt: string;
}

interface CategoriesResponse {
  categories: WikiCategory[];
}

interface ArticlesResponse {
  articles: WikiArticle[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface TagsResponse {
  tags: WikiTag[];
}

export interface ArticleFilters {
  categoryId?: string;
  type?: 'article' | 'case_study';
  status?: 'draft' | 'published';
  search?: string;
  tagId?: string;
  page?: number;
  limit?: number;
}

export interface CreateArticleInput {
  title: string;
  content: unknown;
  categoryId: string;
  type: 'article' | 'case_study';
  status?: 'draft' | 'published';
  caseProblem?: string;
  caseSolution?: string;
  tagIds?: string[];
}

export interface UpdateArticleInput {
  title?: string;
  content?: unknown;
  categoryId?: string;
  type?: 'article' | 'case_study';
  status?: 'draft' | 'published';
  caseProblem?: string | null;
  caseSolution?: string | null;
  tagIds?: string[];
}

export interface CreateCategoryInput {
  name: string;
  parentId?: string;
  icon?: string;
  description?: string;
}

export interface UpdateCategoryInput {
  name?: string;
  icon?: string;
  description?: string;
  order?: number;
  parentId?: string | null;
}

// ─── Categories ───

export function useWikiCategories() {
  return useQuery({
    queryKey: ['wiki-categories'],
    queryFn: () => api.get<CategoriesResponse>('/api/wiki/categories'),
  });
}

export function useCreateWikiCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) =>
      api.post<WikiCategory>('/api/wiki/categories', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki-categories'] });
    },
  });
}

export function useUpdateWikiCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateCategoryInput & { id: string }) =>
      api.patch<WikiCategory>(`/api/wiki/categories/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki-categories'] });
    },
  });
}

export function useDeleteWikiCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/wiki/categories/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki-categories'] });
    },
  });
}

// ─── Articles ───

export function useWikiArticles(filters?: ArticleFilters) {
  return useQuery({
    queryKey: ['wiki-articles', filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters?.categoryId) params.set('categoryId', filters.categoryId);
      if (filters?.type) params.set('type', filters.type);
      if (filters?.status) params.set('status', filters.status);
      if (filters?.search) params.set('search', filters.search);
      if (filters?.tagId) params.set('tagId', filters.tagId);
      if (filters?.page) params.set('page', String(filters.page));
      if (filters?.limit) params.set('limit', String(filters.limit));
      const query = params.toString();
      return api.get<ArticlesResponse>(`/api/wiki/articles${query ? `?${query}` : ''}`);
    },
  });
}

export function useWikiArticle(slug: string | undefined) {
  return useQuery({
    queryKey: ['wiki-article', slug],
    queryFn: () => api.get<WikiArticle>(`/api/wiki/articles/${slug}`),
    enabled: !!slug,
  });
}

export function useCreateWikiArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateArticleInput) =>
      api.post<WikiArticle>('/api/wiki/articles', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki-articles'] });
    },
  });
}

export function useUpdateWikiArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateArticleInput & { id: string }) =>
      api.patch<WikiArticle>(`/api/wiki/articles/${id}`, input),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['wiki-articles'] });
      qc.invalidateQueries({ queryKey: ['wiki-article'] });
    },
  });
}

export function useDeleteWikiArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/wiki/articles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki-articles'] });
    },
  });
}

// ─── Tags ───

export function useWikiTags() {
  return useQuery({
    queryKey: ['wiki-tags'],
    queryFn: () => api.get<TagsResponse>('/api/wiki/tags'),
  });
}

export function useCreateWikiTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; color?: string }) =>
      api.post<WikiTag>('/api/wiki/tags', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki-tags'] });
    },
  });
}

export function useDeleteWikiTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/wiki/tags/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki-tags'] });
    },
  });
}
