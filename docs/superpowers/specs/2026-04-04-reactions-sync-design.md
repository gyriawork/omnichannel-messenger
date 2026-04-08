# Синхронизация эмодзи-реакций с мессенджерами

**Дата:** 2026-04-04
**Статус:** Утверждён
**Мессенджеры:** Telegram, Slack (двусторонняя синхронизация)
**Scope exclusion:** WhatsApp технически поддерживает реакции (Baileys), но исключён из V1 для упрощения. Можно добавить позже.

## Контекст

Реакции на сообщения сейчас работают только внутри приложения — сохраняются в нашу БД и видны через WebSocket. Нужно синхронизировать их с реальными мессенджерами: когда пользователь ставит реакцию в нашем приложении — она появляется в Telegram/Slack, и наоборот.

Gmail не поддерживает реакции. WhatsApp исключён из V1. Кнопка эмодзи для этих чатов скрыта.

## Решения

- **Подход:** Прямые вызовы через адаптеры (не через очередь BullMQ). Реакция — мгновенное действие, очередь избыточна.
- **Ограничения эмодзи:** Пикер фильтрует эмодзи по мессенджеру (Telegram ~75 штук, Slack — почти все).
- **Gmail/WhatsApp:** Кнопка эмодзи скрыта на фронтенде. Адаптеры не реализуют методы реакций.

## 1. Адаптеры: отправка реакций

### Интерфейс (`apps/api/src/integrations/base.ts`)

Добавить **опциональные** методы в `MessengerAdapter`:

```typescript
addReaction?(chatExternalId: string, messageExternalId: string, emoji: string): Promise<void>
removeReaction?(chatExternalId: string, messageExternalId: string, emoji: string): Promise<void>
```

Опциональные, чтобы Gmail и WhatsApp адаптеры не требовали stub-реализаций. Перед вызовом проверяем `if (adapter.addReaction)`.

### Telegram (`apps/api/src/integrations/telegram.ts`)

**addReaction:**
```typescript
await client.invoke(
  new Api.messages.SendReaction({
    peer: peer,
    msgId: messageId,
    reaction: [new Api.ReactionEmoji({ emoticon: emoji })],
  })
);
```

**removeReaction:**
Telegram не позволяет удалить одну реакцию — `SendReaction` заменяет весь список реакций пользователя. Поэтому:
1. Запросить текущие реакции пользователя на сообщении из нашей БД
2. Отфильтровать удаляемую
3. Отправить `SendReaction` с оставшимся списком (или пустой массив `reaction: []` если ничего не осталось)

Принимает только Unicode-эмодзи из разрешённого списка Telegram.

### Slack (`apps/api/src/integrations/slack.ts`)

- `client.reactions.add({ channel, timestamp, name })` — отправка
- `client.reactions.remove({ channel, timestamp, name })` — удаление (Slack поддерживает поштучное удаление)
- Для маппинга Unicode → Slack shortcode использовать npm-пакет `node-emoji` (содержит полный маппинг), дополнить кастомными эмодзи воркспейса при необходимости в будущем

### Gmail / WhatsApp

Методы не реализуются. Кнопка эмодзи скрыта на фронтенде.

## 2. Входящие реакции

### Telegram

Проект использует gramjs (MTProto user sessions). Входящие реакции приходят через gramjs event handler, а **не** через Bot API webhook. Нужно:
1. Подписаться на событие `UpdateMessageReactions` в gramjs-клиенте
2. При получении — вызвать `ingestReaction()` с данными (chatId, messageId, реакции)

Это отличается от текущих Bot API вебхуков для сообщений — обработчик добавляется в Telegram-адаптер, а не в `webhooks.ts`.

### Slack (`POST /webhooks/slack`)

Добавить обработку событий `reaction_added` и `reaction_removed`. Slack отправляет:
- `item.channel` + `item.ts` — идентификация сообщения
- `reaction` — shortcode эмодзи (обратный маппинг через `node-emoji`)

Требуется подписка на эти типы событий в конфигурации Slack App (Event Subscriptions → добавить `reaction_added`, `reaction_removed`).

### Обработка: `ingestReaction()` (`apps/api/src/services/message-service.ts`)

Размещаем в `message-service.ts` (не `message-ingestion.ts`), т.к. вебхуки используют именно этот модуль.

Новая функция:
1. Найти `Message` по `externalMessageId`
2. Резолвить отправителя: найти `ChatParticipant` по `externalUserId` → использовать его `userId`. Если участник не найден (внешний пользователь, не зарегистрированный в приложении) — сохранить с `externalUserId` (новое поле, см. секцию 4)
3. Upsert / delete в таблице `Reaction` с `externalSynced: true`
4. Отправить WebSocket-событие `new_reaction` / `reaction_removed`

## 3. Маппинг эмодзи

Новый файл: `packages/shared/src/emoji-map.ts`

### Содержимое

- `TELEGRAM_ALLOWED_EMOJI: string[]` — массив ~75 разрешённых Unicode-эмодзи Telegram
- `getReactionSupport(messenger: string): 'full' | 'limited' | 'none'` — хелпер для фронтенда
  - Telegram → `'limited'`, Slack → `'full'`, Gmail/WhatsApp → `'none'`

### Slack маппинг

Использовать npm-пакет `node-emoji` для маппинга Unicode ↔ shortcode. Не строить свой справочник. Кастомные эмодзи воркспейса — out of scope для V1.

### Использование

- **Бэкенд:** Валидация эмодзи перед отправкой в мессенджер, конвертация для Slack. Также обновить Zod-схему `addReactionBodySchema` в `messages.ts`: текущий `.max(2)` отсекает emoji с skin-tone и флаги. Заменить на `.max(20)` или валидировать по списку допустимых.
- **Фронтенд:** Фильтрация пикера по типу мессенджера, скрытие кнопки для unsupported

## 4. Изменение схемы БД

Модель `Reaction` (`apps/api/prisma/schema.prisma`):

Добавить поля:
```prisma
externalSynced  Boolean  @default(false)
externalUserId  String?
```

- `externalSynced` — реакция синхронизирована с мессенджером (отправлена или пришла из него)
- `externalUserId` — внешний ID отправителя в мессенджере. Нужен для входящих реакций от пользователей, не зарегистрированных в приложении
- `userId` остаётся **обязательным** (`String`). Для внешних пользователей — генерируем детерминистический UUID из `external:{messenger}:{externalUserId}` (через uuid v5 с фиксированным namespace). Так unique constraint `@@unique([messageId, userId, emoji])` работает без изменений, и Prisma не ломается на nullable unique.

Дополнительно обновить unique constraint, добавив:
```prisma
@@unique([messageId, externalUserId, emoji])
```
Как дополнительную защиту от дупликатов входящих реакций (externalUserId nullable — PostgreSQL допускает множественные NULL, поэтому для внутренних реакций constraint не срабатывает, что корректно).

## 5. Поток данных

### Исходящая реакция (пользователь → мессенджер)

1. Фронтенд → `POST /api/chats/:id/messages/:id/reactions` с `{ emoji }`
2. API проверяет, что у Message есть `externalMessageId` (если нет — сохраняем только локально)
3. API сохраняет в БД (`externalSynced: false`)
4. API проверяет `adapter.addReaction` существует → вызывает
5. При успехе → ставит `externalSynced: true`
6. При ошибке → реакция остаётся локальной, пользователь видит тост «Не удалось отправить реакцию в мессенджер»
7. WebSocket `new_reaction` → другие пользователи приложения видят реакцию

**Важно:** При удалении реакции — если предыдущий add ещё in-flight, DELETE должен пометить реакцию как `deleted` в БД. Когда add вернётся — проверить текущее состояние перед установкой `externalSynced`. Если запись уже удалена — вызвать `adapter.removeReaction()`.

### Псевдокод: изменение POST handler (`messages.ts`)

```typescript
// Existing: upsert reaction in DB
const reaction = await prisma.reaction.upsert({ ... , externalSynced: false });

// NEW: sync to messenger
const message = await prisma.message.findUnique({
  where: { id: messageId },
  select: { externalMessageId: true, chat: { select: { externalChatId: true, messenger: true, organizationId: true } } }
});

if (message?.externalMessageId && message.chat) {
  const adapter = getAdapter(message.chat.messenger, message.chat.organizationId);
  if (adapter?.addReaction) {
    try {
      await adapter.addReaction(message.chat.externalChatId, message.externalMessageId, emoji);
      // Re-check: reaction may have been deleted while adapter call was in-flight
      const current = await prisma.reaction.findUnique({ where: { messageId_userId_emoji: { messageId, userId, emoji } } });
      if (current) {
        await prisma.reaction.update({ where: { id: current.id }, data: { externalSynced: true } });
      } else {
        // User deleted while we were syncing — remove from messenger too
        await adapter.removeReaction?.(message.chat.externalChatId, message.externalMessageId, emoji);
      }
    } catch (err) {
      // Leave externalSynced: false, return warning in response
      reply.send({ ...reactionData, syncWarning: 'Reaction saved locally but failed to sync to messenger' });
      return;
    }
  }
}
// emit WebSocket event as before
```

### Псевдокод: изменение DELETE handler (`messages.ts`)

```typescript
// Delete reaction from DB
await prisma.reaction.delete({ where: { messageId_userId_emoji: { messageId, userId, emoji } } });

// NEW: remove from messenger
const message = await prisma.message.findUnique({ ... }); // same select as above
if (message?.externalMessageId && message.chat) {
  const adapter = getAdapter(message.chat.messenger, message.chat.organizationId);
  if (adapter?.removeReaction) {
    try {
      await adapter.removeReaction(message.chat.externalChatId, message.externalMessageId, emoji);
    } catch (err) {
      // Log but don't fail — reaction already removed locally
      fastify.log.warn({ err, messageId, emoji }, 'Failed to remove reaction from messenger');
    }
  }
}
// emit WebSocket event as before
```

### Входящая реакция (мессенджер → приложение)

1. Gramjs event (Telegram) или вебхук (Slack)
2. Обработчик определяет тип события (реакция)
3. Вызывает `ingestReaction()` → находит Message по `externalMessageId`
4. Сохраняет в БД с `externalSynced: true`
5. WebSocket `new_reaction` → фронтенд обновляет UI

### Удаление реакции

Аналогично в обе стороны: `DELETE` на API → `adapter.removeReaction()`, или вебхук `reaction_removed` → `ingestReaction()` с удалением.

## 6. Фронтенд

### Кнопка эмодзи в hover-панели (`ChatArea.tsx`)

- Кнопка `Smile` видна только для чатов Telegram и Slack
- Тип мессенджера берётся из текущего чата (`chat.messenger`)
- Условие: `getReactionSupport(chat.messenger) !== 'none'`

### Пикер эмодзи

- Для Telegram: фильтр по `TELEGRAM_ALLOWED_EMOJI`
- Для Slack: полный набор эмодзи

### Дебаунс

Добавить дебаунс 200ms на клики по реакциям, чтобы быстрые тоглы не генерировали лишние запросы.

## Файлы для изменения

| Файл | Что делаем |
|------|-----------|
| `apps/api/src/integrations/base.ts` | Добавить опциональные `addReaction?`, `removeReaction?` |
| `apps/api/src/integrations/telegram.ts` | Реализовать `addReaction`, `removeReaction` через `Api.messages.SendReaction` + подписка на `UpdateMessageReactions` |
| `apps/api/src/integrations/slack.ts` | Реализовать через `reactions.add` / `reactions.remove` |
| `apps/api/src/services/message-service.ts` | Добавить `ingestReaction()` |
| `apps/api/src/routes/webhooks.ts` | Обработка `reaction_added/removed` для Slack |
| `apps/api/src/routes/messages.ts` | Вызов адаптера при POST/DELETE реакций, проверка `externalMessageId` |
| `apps/api/prisma/schema.prisma` | Поля `externalSynced`, `externalUserId` в Reaction (userId остаётся required) |
| `packages/shared/src/emoji-map.ts` | `TELEGRAM_ALLOWED_EMOJI`, `getReactionSupport()` |
| `apps/web/src/components/messenger/ChatArea.tsx` | Скрытие кнопки по мессенджеру, фильтрация пикера, дебаунс |
| `packages/shared/package.json` | Добавить зависимость `node-emoji` (API использует транзитивно) |
