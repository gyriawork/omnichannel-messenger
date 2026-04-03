import { test, expect } from '@playwright/test';
import { login, TEST_ADMIN } from './helpers';

test.describe('Authentication', () => {
  test('should show login page with form fields', async ({ page }) => {
    await page.goto('/login');

    // Verify heading
    await expect(page.locator('h1')).toHaveText('Welcome back');

    // Verify form fields are present
    await expect(page.locator('input#email')).toBeVisible();
    await expect(page.locator('input#email')).toHaveAttribute('placeholder', 'you@company.com');
    await expect(page.locator('input#password')).toBeVisible();
    await expect(page.locator('input#password')).toHaveAttribute('placeholder', 'Enter your password');

    // Verify submit button
    await expect(page.locator('button[type="submit"]')).toHaveText('Sign in');
  });

  test('should reject invalid credentials', async ({ page }) => {
    await page.goto('/login');

    await page.locator('input#email').fill('wrong@example.com');
    await page.locator('input#password').fill('wrongpassword');
    await page.locator('button[type="submit"]').click();

    // API error shows as a Sonner toast
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({ timeout: 5000 });

    // Should remain on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('should login successfully with valid credentials', async ({ page }) => {
    await login(page, TEST_ADMIN);

    // Should redirect to /messenger
    await expect(page).toHaveURL(/\/messenger/);

    // Sidebar should be visible with navigation links
    await expect(page.locator('a[href="/messenger"]')).toBeVisible();
  });

  test('should redirect unauthenticated users to login', async ({ page }) => {
    // Clear any stored tokens
    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('user');
    });

    // Attempt to visit a protected route
    await page.goto('/messenger');
    await page.waitForURL('**/login', { timeout: 10000 });
    await expect(page).toHaveURL(/\/login/);
  });
});
