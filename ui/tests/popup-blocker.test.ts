// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The Swarm ID button under a real popup blocker.
 *
 * A frame may open a window only from a click inside it. A site on another
 * site than Swarm ID gets a session frame whose storage is partitioned, which
 * only a window a Swarm ID frame opened can hand the session to, so the click
 * has to land in Swarm ID's own button frame (`client.mountButton()`). The
 * first test proves the blocker is on and refuses a frame's window without a
 * click. The second clicks the button and gets the window through it.
 *
 * Every other project runs with `--disable-popup-blocking`, and Playwright's
 * bundled Chromium never blocks even without it, so this runs on Google Chrome
 * (`chrome-popup-blocked` in `playwright.config.ts`). Without the first test
 * the second would pass on any rig and prove nothing.
 *
 * Cross-site the same way as `bus-propagation.test.ts`: the demo under a
 * loopback literal, the identity site at `http://localhost:5500`.
 */
import { expect, test } from '@playwright/test'

import {
  ID_ORIGIN,
  completeCreateFlow,
  expectProxyPartitioned,
  goToApp,
  openSwarmIdButtonPopup,
  partitionedDemoOrigin,
} from './helpers'

const demoOrigin = await partitionedDemoOrigin()
const NO_LOOPBACK_LITERAL =
  'the demo dev server answered on neither loopback literal — nothing to browse cross-site'
if (!demoOrigin && process.env.CI) {
  throw new Error(NO_LOOPBACK_LITERAL)
}
test.skip(!demoOrigin, NO_LOOPBACK_LITERAL)

/** Past the transient-activation window, so nothing `evaluate` grants is left. */
const AFTER_ACTIVATION_MS = 6000

test('the rig blocks a gesture-less popup from the proxy iframe', async ({ page }) => {
  await page.goto(`${demoOrigin}/account`)
  await expectProxyPartitioned(page)
  const proxy = page.frames().find((frame) => frame.url().startsWith(ID_ORIGIN))!
  const opened = await proxy.evaluate(
    (delay) =>
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(window.open('about:blank') !== null), delay),
      ),
    AFTER_ACTIVATION_MS,
  )
  expect(opened, 'the popup blocker is off — this project proves nothing without it').toBe(false)
})

test('the Swarm ID button opens the connect window through the blocker', async ({ page }) => {
  await page.goto(`${demoOrigin}/account`)
  await expectProxyPartitioned(page)

  const popup = await openSwarmIdButtonPopup(page)
  // Only a Swarm ID frame puts a challenge in the URL.
  await expect(popup).toHaveURL(/challenge=/)

  await completeCreateFlow(popup)
  await expect(popup).toHaveURL(/\/connect\/done$/)
  await goToApp(popup)
  await expect(page.getByRole('heading', { name: 'Identity' })).toBeVisible({ timeout: 15000 })
})
