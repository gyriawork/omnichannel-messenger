import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should show sidebar with navigation links', async ({ page }) => {
    const sidebar = page.locator('nav, aside').first();
    await expect(sidebar).toBeVisible();

    // Check for main navigation items
    await expect(sidebar.locator('text=Messenger').or(sidebar.locator('a[href="/messenger"]'))).toBeVisible();
    await expect(sidebar.locator('text=Broadcast').or(sidebar.locator('a[href="/broadcast"]'))).toBeVisible();
    await expect(sidebar.locator('text=Settings').or(sidebar.locator('a[href="/settings"]'))).toBeVisible();
  });

  test('should navigate to Messenger page', async ({ page }) => {
    await page.click('a[href="/messenger"], text=Messenger');
    await expect(page).toHaveURL(/\/messenger/);
  });

  test('should navigate to Broadcast page', async ({ page }) => {
    await page.click('a[href="/broadcast"], text=Broadcast');
    await expect(page).toHaveURL(/\/broadcast/);
  });

  test('should navigate to Settings page', async ({ page }) => {
    await page.click('a[href="/settings"], text=Settings');
    await expect(page).toHaveURL(/\/settings/);
  });

  test('should navigate to Chats management page', async ({ page }) => {
    await page.click('a[href="/chats"], text=Chats');
    await expect(page).toHaveURL(/\/chats/);
  });
});
