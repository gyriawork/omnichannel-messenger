import { test, expect } from '@playwright/test';
import { login, TEST_ADMIN } from './helpers';

/**
 * Phase 4.2: E2E Tests for Critical User Workflows
 *
 * Covers:
 * 1. Registration page (login/auth details are in auth.spec.ts)
 * 2. Broadcast creation wizard (full flow)
 * 3. Chat search & filtering on messenger page
 * 4. Settings & integrations page structure
 *
 * NOTE: auth.spec.ts covers login/logout/redirect flows.
 *       settings.spec.ts covers settings tabs and FAQ.
 *       messenger.spec.ts covers chat list and opening chats.
 *       This file tests workflows that span multiple steps.
 */

test.describe('Registration Page', () => {
  test('should show registration form at /register', async ({ page }) => {
    await page.goto('/register');

    // Verify all form fields with exact IDs
    await expect(page.locator('input#name')).toBeVisible();
    await expect(page.locator('input#email')).toBeVisible();
    await expect(page.locator('input#password')).toBeVisible();
    await expect(page.locator('input#confirmPassword')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toHaveText('Create account');
  });

  test('should reject registration with existing email', async ({ page }) => {
    await page.goto('/register');

    // Fill with existing admin email — use exact field IDs from register page
    await page.locator('input#name').fill('Test User');
    await page.locator('input#email').fill(TEST_ADMIN.email);
    await page.locator('input#password').fill('password123');
    await page.locator('input#confirmPassword').fill('password123');
    await page.locator('button[type="submit"]').click();

    // Should show error toast (Sonner) for duplicate email
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Broadcast Creation Wizard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TEST_ADMIN);
  });

  test('should navigate to broadcast list page', async ({ page }) => {
    await page.locator('a[href="/broadcast"]').click();
    await expect(page).toHaveURL(/\/broadcast/);

    // Should show the "New Broadcast" button
    await expect(page.getByRole('button', { name: /New Broadcast/i })).toBeVisible();
  });

  test('should show broadcast list with status tabs', async ({ page }) => {
    await page.goto('/broadcast');

    // Status filter tabs
    await expect(page.getByRole('button', { name: 'All' }).or(page.getByText('All').first())).toBeVisible();
    await expect(page.getByText('Draft')).toBeVisible();
    await expect(page.getByText('Sent')).toBeVisible();
  });

  test('should show search input on broadcast list', async ({ page }) => {
    await page.goto('/broadcast');

    await expect(
      page.locator('input[placeholder="Search broadcasts..."]')
    ).toBeVisible();
  });

  test('should navigate to broadcast wizard via New Broadcast button', async ({ page }) => {
    await page.goto('/broadcast');

    await page.getByRole('button', { name: /New Broadcast/i }).click();
    await expect(page).toHaveURL(/\/broadcast\/new/);
  });

  test('should show Step 0 (Compose) with name and message fields', async ({ page }) => {
    await page.goto('/broadcast/new');

    // Broadcast name input
    await expect(
      page.locator('input[placeholder="e.g., Weekly Update, Product Launch..."]')
    ).toBeVisible();

    // Message textarea
    await expect(
      page.locator('textarea[placeholder="Type your broadcast message here..."]')
    ).toBeVisible();
  });

  test('should fill compose step and navigate to recipients', async ({ page }) => {
    await page.goto('/broadcast/new');

    // Fill broadcast name
    await page.locator('input[placeholder="e.g., Weekly Update, Product Launch..."]').fill('E2E Test Broadcast');

    // Fill message
    await page.locator('textarea[placeholder="Type your broadcast message here..."]').fill('Hello from E2E tests!');

    // Click Next button (has ArrowRight icon)
    await page.getByRole('button', { name: /Next/i }).click();

    // Step 1 (Recipients) should show search for chats
    await expect(
      page.locator('input[placeholder="Search chats..."]')
    ).toBeVisible({ timeout: 5000 });
  });

  test('should show messenger filter buttons on recipients step', async ({ page }) => {
    await page.goto('/broadcast/new');

    // Fill required fields and go to step 1
    await page.locator('input[placeholder="e.g., Weekly Update, Product Launch..."]').fill('Test');
    await page.locator('textarea[placeholder="Type your broadcast message here..."]').fill('Test message');
    await page.getByRole('button', { name: /Next/i }).click();

    // Wait for recipients step
    await expect(page.locator('input[placeholder="Search chats..."]')).toBeVisible({ timeout: 5000 });

    // Messenger filter buttons should be visible (use exact: true to avoid matching chat buttons)
    await expect(page.getByRole('button', { name: 'Telegram', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Slack', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'WhatsApp', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gmail', exact: true })).toBeVisible();
  });

  test('should navigate back from recipients to compose', async ({ page }) => {
    await page.goto('/broadcast/new');

    // Go to step 1
    await page.locator('input[placeholder="e.g., Weekly Update, Product Launch..."]').fill('Test');
    await page.locator('textarea[placeholder="Type your broadcast message here..."]').fill('Test message');
    await page.getByRole('button', { name: /Next/i }).click();

    // Wait for step 1
    await expect(page.locator('input[placeholder="Search chats..."]')).toBeVisible({ timeout: 5000 });

    // Click Back button (exact match to avoid matching "Back to Broadcasts")
    await page.getByRole('button', { name: 'Back', exact: true }).click();

    // Should be back on compose step
    await expect(
      page.locator('input[placeholder="e.g., Weekly Update, Product Launch..."]')
    ).toBeVisible({ timeout: 5000 });
  });

  test('should cancel wizard and return to broadcast list', async ({ page }) => {
    await page.goto('/broadcast/new');

    // Click Cancel button
    await page.getByRole('button', { name: /Cancel/i }).click();

    // Should navigate back to broadcast list
    await expect(page).toHaveURL(/\/broadcast$/, { timeout: 5000 });
  });

  test('should show Analytics and Anti-ban buttons on broadcast list', async ({ page }) => {
    await page.goto('/broadcast');

    await expect(page.getByRole('button', { name: /Analytics/i }).or(page.getByRole('link', { name: /Analytics/i }))).toBeVisible();
    await expect(page.getByRole('button', { name: /Anti-ban/i }).or(page.getByText('Anti-ban'))).toBeVisible();
  });
});

test.describe('Chat Search & Filtering', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TEST_ADMIN);
    await page.locator('a[href="/messenger"]').click();
    await expect(page).toHaveURL(/\/messenger/);
  });

  test('should search chats by name', async ({ page }) => {
    // Wait for chat list to load
    await expect(page.getByText('Dmitry Volkov').first()).toBeVisible({ timeout: 10000 });

    // Find search input in the messenger chat list
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible();

    // Search for a known seeded chat
    await searchInput.fill('Dmitry');
    await page.waitForTimeout(500);

    // Dmitry Volkov should still be visible
    await expect(page.getByText('Dmitry Volkov').first()).toBeVisible();
  });

  test('should show no results for non-matching search', async ({ page }) => {
    await expect(page.getByText('Dmitry Volkov').first()).toBeVisible({ timeout: 10000 });

    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible();

    // Search for something that won't match
    await searchInput.fill('zzz-nonexistent-chat-xyz');
    await page.waitForTimeout(500);

    // Known seeded chats should not be visible
    await expect(page.getByText('Dmitry Volkov')).not.toBeVisible({ timeout: 3000 });
  });

  test('should clear search and restore all chats', async ({ page }) => {
    await expect(page.getByText('Dmitry Volkov').first()).toBeVisible({ timeout: 10000 });

    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await searchInput.fill('zzz-nonexistent');
    await page.waitForTimeout(500);

    // Clear the search
    await searchInput.clear();
    await page.waitForTimeout(500);

    // Seeded chats should reappear
    await expect(page.getByText('Dmitry Volkov').first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Cross-Page Session Consistency', () => {
  test('should maintain session across messenger, broadcast, and settings', async ({ page }) => {
    await login(page, TEST_ADMIN);

    // Navigate to messenger
    await page.goto('/messenger');
    await expect(page).toHaveURL(/\/messenger/);
    await expect(page.locator('aside').first()).toBeVisible();

    // Navigate to broadcast
    await page.goto('/broadcast');
    await expect(page).toHaveURL(/\/broadcast/);
    await expect(page.locator('aside').first()).toBeVisible();

    // Navigate to settings
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator('aside').first()).toBeVisible();
  });

  test('should maintain session after page reload', async ({ page }) => {
    await login(page, TEST_ADMIN);

    // Verify we are authenticated
    expect(page.url()).toContain('/messenger');

    // Reload
    await page.reload();

    // Should still be authenticated (sidebar visible, not redirected to login)
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 10000 });
    expect(page.url()).not.toContain('/login');
  });

  test('should redirect to login after clearing tokens', async ({ page }) => {
    await login(page, TEST_ADMIN);

    // Clear all auth state — localStorage keys and force a fresh page load
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    // Full navigation (not client-side) to force hydrate() to re-read empty localStorage
    await page.goto('/messenger', { waitUntil: 'networkidle' });

    // Should redirect to login since hydrate() finds no accessToken
    await page.waitForURL('**/login', { timeout: 15000 });
    await expect(page).toHaveURL(/\/login/);
  });
});
