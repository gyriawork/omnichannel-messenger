import { Page, expect } from '@playwright/test';

export const TEST_ADMIN = {
  email: 'admin@omnichannel.dev',
  password: 'admin123',
  name: 'Anton Petrov',
};

export const TEST_USER = {
  email: 'maria@omnichannel.dev',
  password: 'user123',
  name: 'Maria Ivanova',
};

/**
 * Login helper — navigates to /login, fills form, submits, waits for redirect.
 */
export async function login(page: Page, credentials = TEST_ADMIN) {
  await page.goto('/login');
  await page.fill('input[type="email"]', credentials.email);
  await page.fill('input[type="password"]', credentials.password);
  await page.click('button[type="submit"]');
  // Wait for redirect to dashboard
  await page.waitForURL('**/(dashboard)**', { timeout: 10000 }).catch(() => {
    // Fallback: wait for sidebar to appear
  });
  await expect(page.locator('nav, [data-testid="sidebar"], aside')).toBeVisible({ timeout: 10000 });
}
