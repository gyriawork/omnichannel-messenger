import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.click('a[href="/settings"], text=Settings');
    await expect(page).toHaveURL(/\/settings/);
  });

  test('should show Integrations tab with 4 messengers', async ({ page }) => {
    await expect(page.locator('text=Telegram')).toBeVisible();
    await expect(page.locator('text=Slack')).toBeVisible();
    await expect(page.locator('text=WhatsApp')).toBeVisible();
    await expect(page.locator('text=Gmail')).toBeVisible();
  });

  test('should show FAQ section with setup guides', async ({ page }) => {
    await expect(page.locator('text=Frequently Asked Questions')).toBeVisible();

    // Click on Telegram FAQ
    await page.click('text=How to connect Telegram');
    await expect(page.locator('text=my.telegram.org')).toBeVisible();
  });

  test('should switch to Workspace tab and show team members', async ({ page }) => {
    await page.click('text=Workspace');
    await expect(page.locator('text=Team Members')).toBeVisible();
    await expect(page.locator('text=Invite User')).toBeVisible();

    // Should show seeded users
    await expect(page.locator('text=Anton Petrov')).toBeVisible();
  });

  test('should switch to Profile tab', async ({ page }) => {
    await page.click('text=Profile');
    // Profile tab should be visible
    await expect(page.locator('text=Profile').first()).toBeVisible();
  });
});
