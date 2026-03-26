import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should show sidebar with navigation links', async ({ page }) => {
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible();

    // Check for main navigation items
    await expect(page.locator('a[href="/messenger"]')).toBeVisible();
    await expect(page.locator('a[href="/broadcast"]')).toBeVisible();
    await expect(page.locator('a[href="/settings"]')).toBeVisible();
  });

  test('should navigate to Messenger page', async ({ page }) => {
    await page.locator('a[href="/messenger"]').click();
    await expect(page).toHaveURL(/\/messenger/);
  });

  test('should navigate to Broadcast page', async ({ page }) => {
    await page.locator('a[href="/broadcast"]').click();
    await expect(page).toHaveURL(/\/broadcast/);
  });

  test('should navigate to Settings page', async ({ page }) => {
    await page.locator('a[href="/settings"]').click();
    await expect(page).toHaveURL(/\/settings/);
  });

  test('should navigate to Chats management page', async ({ page }) => {
    await page.locator('a[href="/chats"]').click();
    await expect(page).toHaveURL(/\/chats/);
  });
});
