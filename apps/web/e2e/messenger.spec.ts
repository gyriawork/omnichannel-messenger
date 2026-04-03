import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Messenger', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/messenger');
    await expect(page.getByRole('heading', { name: 'Chats', level: 2 })).toBeVisible({ timeout: 15000 });
  });

  test('should display the 3-column layout', async ({ page }) => {
    // Column 1: Chat list with "Chats" heading
    await expect(page.getByRole('heading', { name: 'Chats', level: 2 })).toBeVisible();

    // Column 2: Chat area (shows empty state when no chat selected)
    await expect(page.getByRole('heading', { name: 'Select a chat to start messaging' })).toBeVisible();

    // Search input and messenger filter should be in the chat list
    await expect(page.locator('input[placeholder="Search chats..."]')).toBeVisible();
    await expect(page.locator('select').filter({ hasText: 'All Messengers' })).toBeVisible();
  });

  test('should show seeded chats in the chat list', async ({ page }) => {
    // Verify seeded chats are rendered
    await expect(page.getByText('Dmitry Volkov').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('#general').first()).toBeVisible();
    await expect(page.getByText('Client Group').first()).toBeVisible();
    await expect(page.getByText('Partnership Inquiry').first()).toBeVisible();
  });

  test('should search chats by name', async ({ page }) => {
    // Wait for chats to load
    await expect(page.getByText('Dmitry Volkov').first()).toBeVisible({ timeout: 10000 });

    // Type in the search input
    const searchInput = page.locator('input[placeholder="Search chats..."]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Dmitry');

    // Dmitry Volkov should still be visible
    await expect(page.getByText('Dmitry Volkov').first()).toBeVisible({ timeout: 5000 });

    // Other chats should be filtered out
    await expect(page.getByText('#general')).toBeHidden({ timeout: 5000 });
    await expect(page.getByText('Client Group')).toBeHidden();

    // Clear search — all chats should reappear
    await searchInput.clear();
    await expect(page.getByText('#general').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Client Group').first()).toBeVisible();
  });

  test('should filter chats by messenger type', async ({ page }) => {
    // Wait for chats to load
    await expect(page.getByText('Dmitry Volkov').first()).toBeVisible({ timeout: 10000 });

    // The messenger filter is a <select> with "All Messengers" as the default option
    const messengerSelect = page.locator('select').filter({ hasText: 'All Messengers' });
    await expect(messengerSelect).toBeVisible();

    // Filter by Telegram — "Dmitry Volkov" is Telegram, others should be hidden
    await messengerSelect.selectOption('telegram');
    await expect(page.getByText('Dmitry Volkov').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('#general')).toBeHidden({ timeout: 5000 });
    await expect(page.getByText('Client Group')).toBeHidden();

    // Filter by Slack — "#general" should be visible
    await messengerSelect.selectOption('slack');
    await expect(page.getByText('#general').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Dmitry Volkov')).toBeHidden({ timeout: 5000 });

    // Reset to All Messengers
    await messengerSelect.selectOption('');
    await expect(page.getByText('Dmitry Volkov').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('#general').first()).toBeVisible();
  });

  test('should open a chat and display messages', async ({ page }) => {
    // Wait for chats to load, then click on Dmitry Volkov
    const chatItem = page.getByText('Dmitry Volkov').first();
    await expect(chatItem).toBeVisible({ timeout: 10000 });
    await chatItem.click();

    // Empty state should disappear, replaced by message feed
    await expect(page.getByText('Select a chat to start messaging')).toBeHidden({ timeout: 5000 });

    // The chat header should show the contact name
    await expect(page.locator('h3', { hasText: 'Dmitry Volkov' })).toBeVisible();

    // Should display seeded messages (whitespace-pre-wrap.break-words elements)
    await expect(
      page.locator('.whitespace-pre-wrap.break-words', { hasText: 'discuss the new proposal' }).first()
    ).toBeVisible({ timeout: 10000 });

    // The compose bar should be visible with the textarea and send button
    const textarea = page.locator('textarea[placeholder="Type a message..."]');
    await expect(textarea).toBeVisible();

    const sendButton = page.locator('button[type="submit"]');
    await expect(sendButton).toBeVisible();
  });

  test('should type and send a message', async ({ page }) => {
    // Open a chat first
    const chatItem = page.getByText('Dmitry Volkov').first();
    await expect(chatItem).toBeVisible({ timeout: 10000 });
    await chatItem.click();

    // Wait for messages to load
    await expect(
      page.locator('.whitespace-pre-wrap.break-words').first()
    ).toBeVisible({ timeout: 10000 });

    // Type a message in the compose textarea
    const textarea = page.locator('textarea[placeholder="Type a message..."]');
    await expect(textarea).toBeVisible();
    await textarea.fill('Hello from Playwright E2E test');

    // Verify the text was entered
    await expect(textarea).toHaveValue('Hello from Playwright E2E test');

    // Click the send button
    const sendButton = page.locator('button[type="submit"]');
    await sendButton.click();

    // Textarea should be cleared after send
    await expect(textarea).toHaveValue('', { timeout: 5000 });

    // The sent message should appear in the message feed
    await expect(
      page.locator('.whitespace-pre-wrap.break-words', { hasText: 'Hello from Playwright E2E test' }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('should sort chats by different criteria', async ({ page }) => {
    // Wait for chats to load
    await expect(page.getByText('Dmitry Volkov').first()).toBeVisible({ timeout: 10000 });

    // The sort dropdown is the second <select> in the filter area
    const sortSelect = page.locator('select').filter({ hasText: 'Last Active' });
    await expect(sortSelect).toBeVisible();

    // Sort by Name
    await sortSelect.selectOption('name');

    // Verify the chats are still visible (sorting should not remove them)
    await expect(page.getByText('Dmitry Volkov').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('#general').first()).toBeVisible();

    // Sort by Messages count
    await sortSelect.selectOption('messageCount');
    await expect(page.getByText('#general').first()).toBeVisible({ timeout: 5000 });

    // Reset to default
    await sortSelect.selectOption('lastActivityAt');
    await expect(page.getByText('Dmitry Volkov').first()).toBeVisible({ timeout: 5000 });
  });
});
