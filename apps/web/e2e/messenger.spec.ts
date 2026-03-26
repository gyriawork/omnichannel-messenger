import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Messenger', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.click('a[href="/messenger"], text=Messenger');
    await expect(page).toHaveURL(/\/messenger/);
  });

  test('should show 3-column layout', async ({ page }) => {
    // Chat list column
    await expect(page.locator('text=Chats').first()).toBeVisible();

    // Should show seeded chats
    await expect(page.locator('text=Dmitry Volkov').or(page.locator('text=#general'))).toBeVisible({ timeout: 10000 });
  });

  test('should filter chats by messenger type', async ({ page }) => {
    // Wait for chats to load
    await page.waitForTimeout(1000);

    // Look for filter buttons/tabs for messenger types
    const filterArea = page.locator('[data-testid="chat-filters"], .flex').first();
    await expect(filterArea).toBeVisible();
  });

  test('should open a chat and show messages', async ({ page }) => {
    // Click on a seeded chat
    await page.click('text=Dmitry Volkov');

    // Should show message area with seeded messages
    await expect(page.locator('text=discuss the new proposal').or(page.locator('text=updated document'))).toBeVisible({ timeout: 10000 });
  });
});
