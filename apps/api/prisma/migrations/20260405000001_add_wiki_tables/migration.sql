-- CreateEnum
CREATE TYPE "WikiArticleType" AS ENUM ('article', 'case_study');

-- CreateEnum
CREATE TYPE "WikiArticleStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateTable
CREATE TABLE "WikiCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "parentId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WikiCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WikiArticle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "updatedById" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "type" "WikiArticleType" NOT NULL DEFAULT 'article',
    "status" "WikiArticleStatus" NOT NULL DEFAULT 'draft',
    "caseProblem" TEXT,
    "caseSolution" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WikiArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WikiTag" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WikiTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WikiArticleTag" (
    "articleId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "WikiArticleTag_pkey" PRIMARY KEY ("articleId","tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "WikiCategory_slug_organizationId_key" ON "WikiCategory"("slug", "organizationId");

-- CreateIndex
CREATE INDEX "WikiCategory_organizationId_idx" ON "WikiCategory"("organizationId");

-- CreateIndex
CREATE INDEX "WikiCategory_parentId_idx" ON "WikiCategory"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "WikiArticle_slug_organizationId_key" ON "WikiArticle"("slug", "organizationId");

-- CreateIndex
CREATE INDEX "WikiArticle_organizationId_idx" ON "WikiArticle"("organizationId");

-- CreateIndex
CREATE INDEX "WikiArticle_categoryId_idx" ON "WikiArticle"("categoryId");

-- CreateIndex
CREATE INDEX "WikiArticle_authorId_idx" ON "WikiArticle"("authorId");

-- CreateIndex
CREATE INDEX "WikiArticle_status_idx" ON "WikiArticle"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WikiTag_name_organizationId_key" ON "WikiTag"("name", "organizationId");

-- CreateIndex
CREATE INDEX "WikiTag_organizationId_idx" ON "WikiTag"("organizationId");

-- CreateIndex
CREATE INDEX "WikiArticleTag_tagId_idx" ON "WikiArticleTag"("tagId");

-- AddForeignKey
ALTER TABLE "WikiCategory" ADD CONSTRAINT "WikiCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiCategory" ADD CONSTRAINT "WikiCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WikiCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiArticle" ADD CONSTRAINT "WikiArticle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiArticle" ADD CONSTRAINT "WikiArticle_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "WikiCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiArticle" ADD CONSTRAINT "WikiArticle_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiArticle" ADD CONSTRAINT "WikiArticle_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiTag" ADD CONSTRAINT "WikiTag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiArticleTag" ADD CONSTRAINT "WikiArticleTag_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "WikiArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiArticleTag" ADD CONSTRAINT "WikiArticleTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "WikiTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
