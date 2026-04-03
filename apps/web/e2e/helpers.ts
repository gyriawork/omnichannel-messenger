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
  await page.locator('input#email').fill(credentials.email);
  await page.locator('input#password').fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  // Wait for sidebar nav to appear — definitive signal that login succeeded
  // Note: in dev mode, bcrypt(12) + Next.js SSR can make login slow
  await expect(page.locator('aside nav').first()).toBeVisible({ timeout: 30000 });
}

/**
 * Logout helper — finds logout button and clicks it, waits for redirect to login.
 */
export async function logout(page: Page) {
  // Look for logout button (typically in user menu/settings)
  const logoutButton = page.locator(
    'button:has-text("Logout"), button:has-text("Sign Out"), [data-testid="logout"]'
  );

  if (await logoutButton.isVisible().catch(() => false)) {
    await logoutButton.click();
  } else {
    // Alternative: try user menu/settings
    const userMenu = page.locator(
      'button[aria-label*="user"], button:has-text("Profile"), [data-testid="user-menu"]'
    ).first();

    if (await userMenu.isVisible().catch(() => false)) {
      await userMenu.click();
      await logoutButton.click();
    }
  }

  // Should redirect to login
  await page.waitForURL('**/login', { timeout: 5000 });
  await expect(page).toHaveURL(/\/login/);
}

/**
 * Wait for toast/notification to appear and disappear
 */
export async function waitForNotification(page: Page, timeout = 5000) {
  const notification = page.locator('[role="alert"], [data-sonner-toast], .toast, .notification').first();
  await expect(notification).toBeVisible({ timeout });
  await notification.waitFor({ state: 'hidden', timeout });
}

/**
 * Navigate to a page and wait for load
 */
export async function navigateTo(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('main, [role="main"], aside').first()).toBeVisible({ timeout: 10000 });
}

/**
 * Click button by text content with fallback selectors
 */
export async function clickButton(page: Page, text: string) {
  const button = page.locator(
    `button:has-text("${text}"), button:has-text("${text.toLowerCase()}"), a:has-text("${text}")`
  ).first();

  if (await button.isVisible().catch(() => false)) {
    await button.click();
  } else {
    throw new Error(`Button with text "${text}" not found`);
  }
}

/**
 * Fill form input by placeholder or aria-label
 */
export async function fillInput(page: Page, placeholder: string, value: string) {
  const input = page.locator(
    `input[placeholder*="${placeholder}"], textarea[placeholder*="${placeholder}"], [aria-label*="${placeholder}"]`
  ).first();

  if (await input.isVisible().catch(() => false)) {
    await input.fill(value);
  } else {
    throw new Error(`Input with placeholder "${placeholder}" not found`);
  }
}

/**
 * Wait for element by text content
 */
export async function waitForText(page: Page, text: string, timeout = 5000) {
  await expect(page.locator(`text=${text}`).first()).toBeVisible({ timeout });
}

/**
 * Check if user is authenticated by looking for sidebar
 */
export async function isAuthenticated(page: Page): Promise<boolean> {
  try {
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}
