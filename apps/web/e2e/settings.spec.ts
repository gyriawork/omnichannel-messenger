import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.locator('a[href="/settings"]').click();
    await expect(page).toHaveURL(/\/settings/);
  });

  test('should show Integrations tab with 4 messengers', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Telegram' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Slack' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'WhatsApp' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Gmail' })).toBeVisible();
  });

  test('should show FAQ section with setup guides', async ({ page }) => {
    await expect(page.locator('text=Frequently Asked Questions')).toBeVisible();

    // Click on Telegram FAQ
    await page.click('text=How to connect Telegram');
    await expect(page.locator('text=my.telegram.org')).toBeVisible();
  });

  test('should switch to Workspace tab and show settings', async ({ page }) => {
    await page.getByRole('button', { name: /Workspace/i }).click();
    await page.waitForTimeout(500);
    await expect(page.getByText('Workspace Settings')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Organization Name')).toBeVisible();

    // Scroll down to Team Members section
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.getByText('Team Members')).toBeVisible({ timeout: 10000 });
  });

  test('should switch to Profile tab', async ({ page }) => {
    await page.click('text=Profile');
    // Profile tab should be visible
    await expect(page.locator('text=Profile').first()).toBeVisible();
  });
});
