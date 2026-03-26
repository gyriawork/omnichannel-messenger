import { test, expect } from '@playwright/test';
import { login, TEST_ADMIN } from './helpers';

test.describe('Authentication', () => {
  test('should show login page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h1, h2').first()).toContainText(/sign in|log in|welcome/i);
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('should reject invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'wrong@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');

    // Should show an error message
    await expect(
      page.locator('[role="alert"], .text-red-500, [data-sonner-toast]').first()
    ).toBeVisible({ timeout: 5000 });
  });

  test('should login successfully with valid credentials', async ({ page }) => {
    await login(page, TEST_ADMIN);

    // Should see dashboard or messenger page
    await expect(page).toHaveURL(/\/(dashboard|messenger)?/);
  });

  test('should redirect unauthenticated users to login', async ({ page }) => {
    // Clear any stored tokens
    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.clear();
    });

    await page.goto('/messenger');
    await page.waitForURL('**/login', { timeout: 10000 });
    await expect(page).toHaveURL(/\/login/);
  });
});
