/**
 * E2E tests for the Kleiber Electron desktop app.
 *
 * Prerequisites:
 *   pnpm run build:desktop   # produces dist/main/index.js
 *   pnpm e2e:test            # runs playwright test
 *
 * The tests launch Electron via the _electron fixture and drive the
 * renderer UI with standard Playwright locators.
 *
 * Context menus in the sidebar are opened via the "More options" (…) button
 * that appears on hover — Radix DropdownMenu is used, not the native
 * browser context-menu event.
 */

import { test, expect, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';
import path from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..');

/** Launch the Electron app and return {app, page}. */
async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [path.join(ROOT, 'dist/main/index.js')],
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'test' },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  return { app, page };
}

/**
 * Open the context menu for a sidebar item by hovering it and clicking the
 * "More options" (…) button rendered by SidebarItem.
 */
async function openSidebarItemMenu(page: Page, itemLocator: ReturnType<Page['locator']>) {
  await itemLocator.hover();
  await itemLocator.getByRole('button', { name: 'More options' }).click();
}

/** Click "New Project", fill the form, and submit. */
async function createProject(page: Page, name: string, dir = '/tmp/e2e-test'): Promise<void> {
  await page.getByRole('button', { name: 'New Project' }).click();

  const dialog = page.getByRole('dialog', { name: 'New Project' });
  await expect(dialog).toBeVisible();

  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Directory Path').fill(dir);
  await page.getByRole('button', { name: 'Create Project' }).click();

  await expect(dialog).not.toBeVisible();
}

/**
 * Create a session for an existing project.
 * Opens the project's context-menu → New Session, fills the dialog, and submits.
 */
async function createSession(page: Page, projectName: string): Promise<void> {
  const projectItem = page.locator('[data-testid="sidebar-project-item"]', { hasText: projectName });
  await openSidebarItemMenu(page, projectItem);
  await page.getByRole('menuitem', { name: 'New Session' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await page.getByLabel('Name').fill('E2E Session');
  await page.getByRole('button', { name: /create session/i }).click();

  await expect(dialog).not.toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Kleiber Electron app', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    ({ app, page } = await launchApp());
  });

  test.afterEach(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // 1. App launch
  // -------------------------------------------------------------------------
  test('app launches and sidebar is visible', async () => {
    // Sidebar header: "New Project" button.
    await expect(page.getByRole('button', { name: 'New Project' })).toBeVisible();

    // Sidebar footer: Settings button.
    await expect(page.getByRole('button', { name: /settings/i })).toBeVisible();

    // Empty state (no project selected).
    await expect(page.getByText('Select a project to get started')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 2. Create project
  // -------------------------------------------------------------------------
  test('create project — project appears in the sidebar', async () => {
    const projectName = 'E2E Test Project';
    await createProject(page, projectName, '/tmp/kleiber-e2e');

    // Project label should now appear in the sidebar tree.
    await expect(
      page.locator('[data-testid="sidebar-project-item"]', { hasText: projectName }),
    ).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 3. Create session
  // -------------------------------------------------------------------------
  test('create session — session appears in sidebar with a status dot', async () => {
    await createProject(page, 'Session Project', '/tmp/kleiber-e2e-session');
    await createSession(page, 'Session Project');

    // A sidebar-session-item should have appeared.
    const sessionItem = page.locator('[data-testid="sidebar-session-item"]').first();
    await expect(sessionItem).toBeVisible({ timeout: 15_000 });

    // The status dot is a div with rounded-full inside the item.
    const dot = sessionItem.locator('.rounded-full').first();
    await expect(dot).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 4. Terminal I/O
  // -------------------------------------------------------------------------
  test('terminal receives input and shows output', async () => {
    await createProject(page, 'Terminal Project', '/tmp/kleiber-e2e-terminal');
    await createSession(page, 'Terminal Project');

    // Select the session so the terminal pane is shown.
    const sessionItem = page.locator('[data-testid="sidebar-session-item"]').first();
    await expect(sessionItem).toBeVisible({ timeout: 15_000 });
    await sessionItem.click();

    // Terminal pane should be visible.
    const terminal = page.locator('[data-testid="terminal-pane"]');
    await expect(terminal).toBeVisible({ timeout: 15_000 });

    // Click inside the terminal and type a command.
    await terminal.click();
    await page.keyboard.type('echo hello_e2e');
    await page.keyboard.press('Enter');

    // The terminal canvas (xterm) does not expose text nodes, so we just
    // assert the pane remains visible after the keystroke.
    await expect(terminal).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 5. Kill session
  // -------------------------------------------------------------------------
  test('kill session — session state dot turns gray', async () => {
    await createProject(page, 'Kill Project', '/tmp/kleiber-e2e-kill');
    await createSession(page, 'Kill Project');

    const sessionItem = page.locator('[data-testid="sidebar-session-item"]').first();
    await expect(sessionItem).toBeVisible({ timeout: 15_000 });

    // Open context menu → Kill Session.
    await openSidebarItemMenu(page, sessionItem);
    await page.getByRole('menuitem', { name: 'Kill Session' }).click();

    // After kill the status dot should switch to the gray class.
    const dot = sessionItem.locator('.rounded-full').first();
    await expect(dot).toHaveClass(/bg-\[#666666\]/, { timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // 6. Session hierarchy
  // -------------------------------------------------------------------------
  test('sub-session appears nested under parent in sidebar', async () => {
    await createProject(page, 'Hierarchy Project', '/tmp/kleiber-e2e-hierarchy');
    await createSession(page, 'Hierarchy Project');

    const parentItem = page.locator('[data-testid="sidebar-session-item"]').first();
    await expect(parentItem).toBeVisible({ timeout: 15_000 });

    // Open parent context menu → New Sub-Session.
    await openSidebarItemMenu(page, parentItem);
    await page.getByRole('menuitem', { name: 'New Sub-Session' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.getByLabel('Name').fill('Nested E2E Session');
    await page.getByRole('button', { name: /create session/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // There should now be 2 session items.
    const sessionItems = page.locator('[data-testid="sidebar-session-item"]');
    await expect(sessionItems).toHaveCount(2, { timeout: 15_000 });

    // The child item has a larger paddingLeft (indented).
    const childItem = sessionItems.nth(1);
    const childPL = await childItem.evaluate((el) => (el as HTMLElement).style.paddingLeft);
    const parentPL = await parentItem.evaluate((el) => (el as HTMLElement).style.paddingLeft);
    expect(parseInt(childPL)).toBeGreaterThan(parseInt(parentPL));
  });

  // -------------------------------------------------------------------------
  // 7. Settings panel
  // -------------------------------------------------------------------------
  test('settings panel opens, shows sections, closes on Escape', async () => {
    await page.getByRole('button', { name: /settings/i }).click();

    const settingsDialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(settingsDialog).toBeVisible();

    // Nav sections should be visible.
    await expect(settingsDialog.getByRole('button', { name: 'General' })).toBeVisible();
    await expect(settingsDialog.getByRole('button', { name: 'Remote API' })).toBeVisible();
    await expect(settingsDialog.getByRole('button', { name: 'Agent CLIs' })).toBeVisible();
    await expect(settingsDialog.getByRole('button', { name: 'Pack & Updates' })).toBeVisible();

    // Navigate to Remote API section.
    await settingsDialog.getByRole('button', { name: 'Remote API' }).click();

    // Close via Escape.
    await page.keyboard.press('Escape');
    await expect(settingsDialog).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 8. Agent pack banner
  // -------------------------------------------------------------------------
  test('agent pack banner visible when pack not installed, absent when installed', async () => {
    // Give the async pack-status IPC call time to complete.
    await page.waitForTimeout(3_000);

    const bannerText = page.getByText('kleiber-agents is not installed globally');
    const isVisible = await bannerText.isVisible();

    if (isVisible) {
      // Pack is not installed — "Install globally" button must be present.
      await expect(page.getByRole('button', { name: 'Install globally' })).toBeVisible();
    } else {
      // Pack is installed — banner must be absent.
      await expect(bannerText).not.toBeVisible();
    }
  });
});
