/**
 * Regression guard for the canvas-toolbar overflow bug (2026-09-15): the
 * toolbar's default (layout-settings-popover-closed) footprint must never
 * overlap the DisplayPanel. It caused two other E2E specs to fail with a
 * cryptic "element intercepts pointer events" Playwright error, and a third
 * (drag) spec to silently no-op, before the real cause (flexbox
 * align-items:stretch inflating every layout control to match the widest
 * one) was tracked down. See
 * specs/backlog/canvas-toolbar-overflow-blocks-panels-and-nodes.md.
 */
import { test, expect, type Page } from '@playwright/test';

async function waitForHelper(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as { __lme_e2e__?: unknown }).__lme_e2e__, { timeout: 15_000 });
}

test('canvas toolbar does not overlap the Display panel at default width', async ({ page }) => {
  await page.goto('/');
  await waitForHelper(page);
  await page.getByText('New Empty Project').click();
  await page.locator('#lme-canvas-wrapper').waitFor({ state: 'visible', timeout: 10_000 });

  const toolbarBox = await page.locator('#lme-canvas-toolbar').boundingBox();
  const displayPanelBox = await page.locator('#lme-display-panel').boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(displayPanelBox).not.toBeNull();

  const toolbarLeft = toolbarBox!.x;
  const displayPanelRight = displayPanelBox!.x + displayPanelBox!.width;
  expect(toolbarLeft).toBeGreaterThanOrEqual(displayPanelRight);
});
