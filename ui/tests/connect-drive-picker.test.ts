// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The drive a site uses, picked in the connect window on every connect, and
 * reaching a site that is already open.
 *
 * Runs in the `chromium-partitioned` project: the demo is browsed under a
 * loopback literal, so its proxy iframe cannot read the identity site's
 * storage and the connect window's handover is the only way a pick reaches
 * it. No chain and no Bee node are needed, the drives are written into the
 * account record and the check reads what the frame tells the site.
 */
import { type Page, expect, test } from '@playwright/test'

import {
  CHAT_BATCH,
  MAIN_BATCH,
  connectedOnDefault,
  lastStampNamed,
  openChangeStampWindow,
} from './drive-picker-helpers'
import { expectProxyPartitioned, goToApp, partitionedDemoOrigin } from './helpers'

const demoOrigin = await partitionedDemoOrigin()
test.skip(
  !demoOrigin,
  'the demo dev server answered on neither loopback literal, nothing to browse cross-site',
)

/** Opens the window again while signed in and picks the account */
async function reopenSignedIn(page: Page) {
  const popup = await openChangeStampWindow(page)
  await popup.getByRole('button', { name: /0x[0-9a-fA-F]{4}/ }).click()
  return popup
}

test('the connect window asks for the drive every time, and an open site uses the pick at once', async ({
  page,
}) => {
  await connectedOnDefault(page, demoOrigin!)
  await expectProxyPartitioned(page)
  let popup: Page
  let picker

  // Signed in, the site opens the window again. The account is listed as used
  // with this site, the site holds no stamp until the confirm, the picker
  // starts on the drive it uses, and a pick reaches the open site without a
  // reload.
  popup = await reopenSignedIn(page)
  picker = popup.getByRole('combobox', { name: 'Select drive' })
  await expect(picker).toHaveValue(MAIN_BATCH)
  await expect.poll(() => lastStampNamed(page), { timeout: 15000 }).toBeNull()
  await picker.selectOption({ label: 'Chat' })
  await goToApp(popup)
  await expect.poll(() => lastStampNamed(page), { timeout: 15000 }).toBe(CHAT_BATCH)

  // The next time, it starts on that pick, and no drive takes the site's away.
  popup = await reopenSignedIn(page)
  picker = popup.getByRole('combobox', { name: 'Select drive' })
  await expect(picker).toHaveValue(CHAT_BATCH)
  await picker.selectOption({ label: 'No drive' })
  await goToApp(popup)
  await expect.poll(() => lastStampNamed(page), { timeout: 15000 }).toBeNull()
})

// Closing the window instead of confirming leaves the site signed in with no
// stamp, a reload included.
test('a connect window closed without the confirm leaves the site with no stamp', async ({
  page,
}) => {
  await connectedOnDefault(page, demoOrigin!)
  await expectProxyPartitioned(page)

  const popup = await reopenSignedIn(page)
  await expect(popup.getByRole('combobox', { name: 'Select drive' })).toHaveValue(MAIN_BATCH)
  await expect.poll(() => lastStampNamed(page), { timeout: 15000 }).toBeNull()
  await popup.close()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Identity' })).toBeVisible({ timeout: 15000 })
  await expect.poll(() => lastStampNamed(page), { timeout: 15000 }).toBeNull()
  const named = await page.evaluate(
    () => (window as unknown as { stampsNamed: (string | null)[] }).stampsNamed,
  )
  expect(named.filter((batch) => batch !== null)).toEqual([])
})

// The window can carry the confirmed drive only to the frame that opened it.
// Once the site reloaded, that frame is gone, and the window says the site
// has no drive rather than closing as if it had one.
test('the connect window says so when the site it was opened from is gone', async ({ page }) => {
  await connectedOnDefault(page, demoOrigin!)
  await expectProxyPartitioned(page)

  const popup = await reopenSignedIn(page)
  const picker = popup.getByRole('combobox', { name: 'Select drive' })
  await expect(picker).toHaveValue(MAIN_BATCH)
  await page.reload()
  await picker.selectOption({ label: 'Chat' })
  await popup.getByRole('button', { name: 'Go to app' }).click()

  await expect(
    popup.getByText('Saved. The site has no drive until it connects again.'),
  ).toBeVisible()
  await goToApp(popup)
})

// "Go to app" ends the connect, and the window starts no save to Swarm on its
// way out. A changed pick queues one behind the 2 s debounce, which the closing
// window outruns. A save from here claims a share of the very drive the site's
// frame is claiming at that moment to send with, and on a slow gateway both
// claims read the other's intent as missing and both win (0.10.4, live,
// 2026-10-18). The sign-in reaches the account's saved state with its next save
// instead. Only the window is watched, from the pick until it closes.
test('the connect window closes without saving the account to Swarm', async ({ page }) => {
  await connectedOnDefault(page, demoOrigin!)
  await expectProxyPartitioned(page)

  const popup = await reopenSignedIn(page)
  const savesStarted: string[] = []
  popup.on('console', (message) => {
    if (message.text().includes('Starting sync')) savesStarted.push(message.text())
  })
  await popup.getByRole('combobox', { name: 'Select drive' }).selectOption({ label: 'Chat' })
  await popup.getByRole('button', { name: 'Go to app' }).click()

  await expect.poll(() => popup.isClosed(), { timeout: 10000 }).toBe(true)
  expect(savesStarted).toEqual([])
  await expect.poll(() => lastStampNamed(page), { timeout: 15000 }).toBe(CHAT_BATCH)
})
