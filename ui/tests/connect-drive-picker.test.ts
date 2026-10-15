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
  ID_ORIGIN,
  PASSWORD,
  completeCreateFlow,
  expectProxyPartitioned,
  goToApp,
  partitionedDemoOrigin,
  sealInPage,
  seedNoChain,
} from './helpers'

const demoOrigin = await partitionedDemoOrigin()
test.skip(
  !demoOrigin,
  'the demo dev server answered on neither loopback literal, nothing to browse cross-site',
)

const MAIN_BATCH = 'a1'.repeat(32)
const CHAT_BATCH = 'b2'.repeat(32)
const DAY_SECONDS = 24 * 60 * 60
const LIFETIME_DAYS = 12

interface StoredAccounts {
  data: { defaultPostageStampBatchID?: string; postageStamps?: Record<string, unknown>[] }[]
}

/** Two drives, Main the default, written into the account the create flow made */
async function seedTwoDrives(page: Page) {
  const doc = await page.evaluate(
    () => JSON.parse(localStorage.getItem('swarm-id-accounts') ?? '{}') as StoredAccounts,
  )
  const drive = async (batchID: string, name: string) => ({
    batchID,
    signerKey: await sealInPage(page, 'c3'.repeat(32)),
    name,
    utilization: 0,
    usable: true,
    depth: 22,
    amount: '100000000',
    bucketDepth: 16,
    blockNumber: 1,
    immutableFlag: false,
    exists: true,
    batchTTL: LIFETIME_DAYS * DAY_SECONDS,
    createdAt: Date.now(),
  })
  doc.data[0].postageStamps = [await drive(MAIN_BATCH, 'Main'), await drive(CHAT_BATCH, 'Chat')]
  doc.data[0].defaultPostageStampBatchID = MAIN_BATCH
  await page.evaluate(
    (value) => localStorage.setItem('swarm-id-accounts', value),
    JSON.stringify(doc),
  )
}

/**
 * Every stamp the frame has named to the site, oldest first, read off the
 * wire the site's client listens on.
 */
async function recordStampsNamed(page: Page) {
  await page.evaluate(() => {
    const named: (string | null)[] = []
    Object.assign(window, { stampsNamed: named })
    window.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { type?: string; identity?: unknown; postageBatchId?: string }
      if (data?.type === 'connectionInfoChanged' && data.identity) {
        named.push(data.postageBatchId ?? null)
      }
    })
  })
}

const lastStampNamed = (page: Page) =>
  page.evaluate(() => (window as unknown as { stampsNamed: (string | null)[] }).stampsNamed.at(-1))

/** Opens the connect window through the site's own `client.connect()` */
async function openConnectWindow(page: Page, button: string) {
  const popupPromise = page.waitForEvent('popup', { timeout: 15000 })
  await page.getByRole('button', { name: button, exact: true }).click()
  const popup = await popupPromise
  await popup.waitForLoadState()
  return popup
}

/**
 * An account with two drives, connected to the partitioned demo on the
 * account default, which the picker starts on
 */
async function connectedOnDefault(page: Page) {
  await seedNoChain(page)
  await page.goto(`${ID_ORIGIN}/?signin`)
  await completeCreateFlow(page)
  await page.getByRole('button', { name: 'Stay local for now' }).click()
  await expect(page).toHaveURL(/\/$/)
  await seedTwoDrives(page)

  await page.goto(`${demoOrigin}/account`)
  await expectProxyPartitioned(page)
  await recordStampsNamed(page)

  await page.getByRole('button', { name: 'Connect Swarm ID' }).click()
  const popup = await openConnectWindow(page, 'Connect')
  await popup.getByRole('button', { name: /0x[0-9a-fA-F]{4}/ }).click()
  await popup.getByRole('textbox', { name: 'Account password' }).fill(PASSWORD)
  await popup.getByRole('button', { name: 'Confirm' }).click()
  await expect(popup.getByRole('combobox', { name: 'Select drive' })).toHaveValue(MAIN_BATCH)
  await goToApp(popup)
  await expect.poll(() => lastStampNamed(page), { timeout: 15000 }).toBe(MAIN_BATCH)
}

test('the connect window asks for the drive every time, and an open site uses the pick at once', async ({
  page,
}) => {
  await connectedOnDefault(page)
  let popup: Page
  let picker

  // Signed in, the site opens the window again. The account is listed as used
  // with this site, the picker starts on the drive it uses, and a pick reaches
  // the open site without a reload.
  popup = await openConnectWindow(page, 'Change in Swarm ID')
  await popup.getByRole('button', { name: /0x[0-9a-fA-F]{4}/ }).click()
  picker = popup.getByRole('combobox', { name: 'Select drive' })
  await expect(picker).toHaveValue(MAIN_BATCH)
  await picker.selectOption({ label: 'Chat' })
  await goToApp(popup)
  await expect.poll(() => lastStampNamed(page), { timeout: 15000 }).toBe(CHAT_BATCH)

  // The next time, it starts on that pick, and no drive takes the site's away.
  popup = await openConnectWindow(page, 'Change in Swarm ID')
  await popup.getByRole('button', { name: /0x[0-9a-fA-F]{4}/ }).click()
  picker = popup.getByRole('combobox', { name: 'Select drive' })
  await expect(picker).toHaveValue(CHAT_BATCH)
  await picker.selectOption({ label: 'No drive' })
  await goToApp(popup)
  await expect.poll(() => lastStampNamed(page), { timeout: 15000 }).toBeNull()
})

// The window can carry a pick only to the frame that opened it. Once the site
// reloaded, that frame is gone, and the window says the open site stays on
// its earlier drive rather than closing as if it had moved.
test('the connect window says so when the site it was opened from is gone', async ({ page }) => {
  await connectedOnDefault(page)

  const popup = await openConnectWindow(page, 'Change in Swarm ID')
  await popup.getByRole('button', { name: /0x[0-9a-fA-F]{4}/ }).click()
  const picker = popup.getByRole('combobox', { name: 'Select drive' })
  await expect(picker).toHaveValue(MAIN_BATCH)
  await page.reload()
  await picker.selectOption({ label: 'Chat' })
  await popup.getByRole('button', { name: 'Go to app' }).click()

  await expect(
    popup.getByText('Saved. The open site keeps its earlier drive until it connects again.'),
  ).toBeVisible()
  await goToApp(popup)
})
