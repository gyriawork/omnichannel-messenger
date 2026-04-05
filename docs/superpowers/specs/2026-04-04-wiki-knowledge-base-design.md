# Wiki — База знаний организации

## Контекст

Пользователям Omnichannel Messenger нужно место для хранения инструкций, решений типовых проблем и документации внутри организации. Сейчас такой функциональности нет — знания теряются в чатах и личных заметках. Wiki решает эту проблему: каждая организация получает свою базу знаний с двумя типами контента — статьями и кейсами.

## Общие решения

- **Scope**: Wiki привязана к организации (одна организация = одна Wiki)
- **Контент**: два типа — статьи (инструкции, документация) и кейсы (проблема → решение)
- **Редактор**: WYSIWYG (TipTap на основе ProseMirror)
- **Иерархия**: категория → подкатегория → статья (двухуровневая)
- **Права**: все создают/редактируют свои статьи, админы управляют чужими и категориями
- **Интеграция с чатами**: не в этой версии (запланирована на будущее)
- **UI-подход**: Notion-style — дерево категорий слева, контент справа

## Модели данных

### WikiCategory

| Поле | Тип | Описание |
|------|-----|----------|
| id | String @default(uuid()) | PK |
| organizationId | String | FK → Organization |
| name | String | Название категории |
| slug | String | URL-slug |
| description | String? | Описание |
| icon | String? | Emoji-иконка |
| parentId | String? | FK → WikiCategory (для подкатегорий, только 1 уровень вложенности) |
| order | Int (default 0) | Порядок сортировки |
| createdAt | DateTime | Дата создания |
| updatedAt | DateTime | Дата обновления |

**Уникальный constraint**: `(slug, organizationId)` — slug уникален в рамках организации (без parentId, т.к. NULL не работает в unique)

**Валидация глубины**: API при создании подкатегории проверяет, что `parent.parentId === null` — нельзя вложить подкатегорию в подкатегорию (максимум 2 уровня).

**Связи**:
- `organization` → Organization (обратная: `Organization.wikiCategories`)
- `parent` → WikiCategory? (self-relation)
- `children` → WikiCategory[]
- `articles` → WikiArticle[]

### WikiArticle

| Поле | Тип | Описание |
|------|-----|----------|
| id | String @default(uuid()) | PK |
| organizationId | String | FK → Organization |
| categoryId | String | FK → WikiCategory |
| authorId | String | FK → User (создатель) |
| updatedById | String? | FK → User (кто последний редактировал) |
| title | String | Заголовок (1-200 символов) |
| slug | String | URL-slug (не меняется при редактировании title) |
| content | Json | Rich-text контент (ProseMirror JSON, лимит ~5MB) |
| type | Enum: article, case | Тип контента |
| status | Enum: draft, published | Статус публикации |
| caseProblem | String? | Краткое описание проблемы (для кейсов) |
| caseSolution | String? | Краткое описание решения (для кейсов) |
| viewCount | Int (default 0) | Счётчик просмотров (инкремент через Redis-буфер, flush каждые 60с) |
| createdAt | DateTime | Дата создания |
| updatedAt | DateTime | Дата обновления |
| deletedAt | DateTime? | Soft delete |

**Уникальный constraint**: `(slug, organizationId)`

**Индексы**:
- `(organizationId, categoryId, createdAt)`
- `(organizationId, type)`
- `(organizationId, status)`
- `(authorId)`

**Связи**:
- `organization` → Organization (обратная: `Organization.wikiArticles`)
- `category` → WikiCategory
- `author` → User (обратная: `User.wikiArticles`)
- `updatedBy` → User? (обратная: `User.wikiArticlesUpdated`)
- `tags` → WikiTag[] (через WikiArticleTag)

### WikiTag

Отдельная модель тегов для Wiki, не пересекается с тегами чатов (модель `Tag`).

| Поле | Тип | Описание |
|------|-----|----------|
| id | String @default(uuid()) | PK |
| organizationId | String | FK → Organization |
| name | String | Название тега |
| color | String (default "#6366f1") | Цвет тега |
| createdAt | DateTime | Дата создания |

**Уникальный constraint**: `(name, organizationId)`

**Связи**:
- `organization` → Organization (обратная: `Organization.wikiTags`)
- `articles` → WikiArticle[] (через WikiArticleTag)

### WikiArticleTag

| Поле | Тип | Описание |
|------|-----|----------|
| articleId | String | FK → WikiArticle |
| tagId | String | FK → WikiTag |

**Составной PK**: `(articleId, tagId)`

## API-эндпоинты

Все маршруты: `/api/wiki/...`, авторизация через JWT, organizationId из токена.

### Категории

| Метод | Путь | Права | Описание |
|-------|------|-------|----------|
| GET | /api/wiki/categories | user+ | Дерево категорий с подкатегориями |
| POST | /api/wiki/categories | admin | Создать категорию/подкатегорию |
| PATCH | /api/wiki/categories/:id | admin | Переименовать, переместить, изменить порядок |
| DELETE | /api/wiki/categories/:id | admin | Удалить (только если нет статей внутри) |

### Статьи

| Метод | Путь | Права | Описание |
|-------|------|-------|----------|
| GET | /api/wiki/articles | user+ | Список с фильтрами (categoryId, type, status, search, tagId) |
| GET | /api/wiki/articles/:slug | user+ | Получить статью + инкремент viewCount |
| POST | /api/wiki/articles | user+ | Создать статью/кейс |
| PATCH | /api/wiki/articles/:id | автор или admin | Редактировать |
| DELETE | /api/wiki/articles/:id | admin | Soft delete |

### Wiki-теги

| Метод | Путь | Права | Описание |
|-------|------|-------|----------|
| GET | /api/wiki/tags | user+ | Список Wiki-тегов организации |
| POST | /api/wiki/tags | admin | Создать Wiki-тег |
| DELETE | /api/wiki/tags/:id | admin | Удалить Wiki-тег |

### Валидация (Zod)

**Создание статьи:**
- `title`: string, 1-200 символов, обязательно
- `content`: json, обязательно (лимит ~5MB)
- `categoryId`: string (uuid), обязательно
- `type`: enum `article` | `case`, обязательно
- `status`: enum `draft` | `published`, default `draft`
- `caseProblem`: string, обязательно если type = `case`
- `caseSolution`: string, обязательно если type = `case`
- `tagIds`: string[], опционально

**Создание категории:**
- `name`: string, 1-100 символов, обязательно
- `parentId`: string?, опционально (для подкатегорий). Если указан — проверяем, что parent.parentId === null (максимум 2 уровня)
- `icon`: string?, опционально
- `description`: string?, опционально

### Activity logging

Все мутации Wiki (создание/редактирование/удаление статей и категорий) логируются через `logActivity()` в ActivityLog — аналогично остальным роутам.

### Матрица прав

| Действие | user | admin | superadmin |
|----------|------|-------|------------|
| Читать статьи | да | да | да |
| Создавать статьи | да | да | да |
| Редактировать свои | да | да | да |
| Редактировать чужие | нет | да | да |
| Удалять статьи | нет | да | да |
| Создавать категории | нет | да | да |
| Редактировать категории | нет | да | да |
| Удалять категории | нет | да | да |

## Фронтенд

### Роутинг

```
apps/web/src/app/(dashboard)/wiki/
  ├── page.tsx              — главная Wiki (дерево + список статей)
  ├── [slug]/page.tsx       — просмотр статьи
  ├── new/page.tsx          — создание статьи
  └── [slug]/edit/page.tsx  — редактирование статьи
```

### Навигация

В Sidebar (`apps/web/src/components/layout/Sidebar.tsx`) добавляется пункт **Wiki** с иконкой `BookOpen` из Lucide — между Templates и Tags.

### Раскладка

Notion-style: две колонки на странице Wiki.

- **Левая панель (220px)**: дерево категорий с разворачиваемыми подкатегориями, поиск по Wiki, кнопка «+ Добавить категорию» (только для admin)
- **Центральная область**: контент — список статей или содержимое статьи

### Компоненты

| Компонент | Файл | Назначение |
|-----------|------|------------|
| WikiSidebar | `wiki/WikiSidebar.tsx` | Дерево категорий, поиск, кнопка добавления |
| WikiArticleList | `wiki/WikiArticleList.tsx` | Список статей с фильтрами (Все/Статьи/Кейсы), карточки |
| WikiArticleView | `wiki/WikiArticleView.tsx` | Просмотр: хлебные крошки, заголовок, метаданные, контент, теги |
| WikiArticleEditor | `wiki/WikiArticleEditor.tsx` | Форма создания/редактирования + WYSIWYG |
| WikiCaseCard | `wiki/WikiCaseCard.tsx` | Блоки «Проблема» (красный) и «Решение» (зелёный) для кейсов |

### WYSIWYG-редактор: TipTap

- Библиотека: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-*`
- Расширения: заголовки (h2, h3), списки (ul, ol), bold/italic/underline, ссылки, изображения, блоки кода, callout-блоки (важно/предупреждение)
- Хранение: JSON-формат ProseMirror в поле `content`
- Тулбар: жирный, курсив, заголовки, списки, ссылка, изображение, блок кода

### React Query хуки

| Хук | Назначение |
|-----|------------|
| `useWikiCategories()` | Дерево категорий |
| `useWikiArticles(filters)` | Список статей с фильтрами и пагинацией |
| `useWikiArticle(slug)` | Одна статья по slug |
| `useCreateWikiArticle()` | Мутация создания |
| `useUpdateWikiArticle()` | Мутация обновления |
| `useDeleteWikiArticle()` | Мутация удаления |
| `useCreateWikiCategory()` | Мутация создания категории |
| `useUpdateWikiCategory()` | Мутация обновления категории |
| `useDeleteWikiCategory()` | Мутация удаления категории |

### Визуальный дизайн

**Цветовая схема** (из Design System):
- Accent: `#6366f1` (индиго)
- Background: `#f8fafc` (сайдбар), `#ffffff` (контент)
- Borders: `#e2e8f0`

**Бейджи типов контента:**
- Статья: индиго фон (`#eef2ff`), индиго текст (`#6366f1`)
- Кейс: оранжевый фон (`#fef3c7`), оранжевый текст (`#d97706`)

**Статусы:**
- Опубликовано: зелёный фон (`#dcfce7`), зелёный текст (`#16a34a`)
- Черновик: серый фон (`#f1f5f9`), серый текст (`#94a3b8`), пониженная прозрачность карточки

**Кейс — визуал:**
- Блок «Проблема»: красный фон (`#fef2f2`), красная рамка (`#fecaca`)
- Блок «Решение»: зелёный фон (`#f0fdf4`), зелёная рамка (`#bbf7d0`)

## Бэкенд

### Файлы

| Файл | Назначение |
|------|------------|
| `apps/api/src/routes/wiki.ts` | Все Wiki-эндпоинты |
| `apps/api/prisma/schema.prisma` | Модели WikiCategory, WikiArticle, WikiArticleTag |

### Паттерны (как в существующем коде)

- Zod-валидация через `safeParse()`
- Redis-кеширование списков (TTL 60s), инвалидация при мутациях
- Soft delete через `deletedAt`
- Все запросы фильтруются по `organizationId`
- `sendError()` для ошибок в едином формате
- Пагинация: `page` + `limit` параметры

### Slug-генерация

- Автоматическая транслитерация из title (кириллица → латиница)
- При конфликте — добавление числового суффикса (`-1`, `-2`)
- Библиотека: `slugify` или ручная транслитерация

## Что НЕ входит в эту версию

- Интеграция с чатами (вставка статей в сообщения)
- Полнотекстовый поиск (PostgreSQL tsvector) — используем ILIKE на первом этапе
- Версионирование статей (история изменений)
- Комментарии к статьям
- Экспорт/импорт статей
- Публичный доступ по ссылке

## Верификация

1. Создать миграцию Prisma и проверить, что схема применяется без ошибок
2. Проверить все API-эндпоинты через HTTP-запросы (CRUD категорий и статей)
3. Убедиться, что права работают: user не может удалять чужие статьи и управлять категориями
4. Проверить фронтенд: навигация по дереву, создание статьи/кейса, WYSIWYG-редактор
5. Проверить визуал: бейджи, цвета, блоки проблема/решение в кейсах
6. Проверить поиск и фильтрацию по типу/статусу/тегам
