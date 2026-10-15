// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The connect window's drive picker, driven from the demo: an account with two
 * drives written into its record, so no chain is needed, and what the site's
 * frame names to the site read off the wire its client listens on.
 */
import { type Page, expect } from '@playwright/test'

import {
  ID_ORIGIN,
  PASSWORD,
  completeCreateFlow,
  goToApp,
  sealInPage,
  seedNoChain,
} from './helpers'

export const MAIN_BATCH = 'a1'.repeat(32)
export const CHAT_BATCH = 'b2'.repeat(32)
const DAY_SECONDS = 24 * 60 * 60
const LIFETIME_DAYS = 12

interface StoredAccounts {
  data: { defaultPostageStampBatchID?: string; postageStamps?: Record<string, unknown>[] }[]
}

/** Two drives, Main the default, written into the account the create flow made */
export async function seedTwoDrives(page: Page) {
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
export async function recordStampsNamed(page: Page) {
  const record = () => {
    const named: (string | null)[] = []
    Object.assign(window, { stampsNamed: named })
    window.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { type?: string; identity?: unknown; postageBatchId?: string }
      if (data?.type === 'connectionInfoChanged' && data.identity) {
        named.push(data.postageBatchId ?? null)
      }
    })
  }
  // From the start of every later load too, so a reload's first word counts
  await page.addInitScript(record)
  await page.evaluate(record)
}

export const lastStampNamed = (page: Page) =>
  page.evaluate(() => (window as unknown as { stampsNamed: (string | null)[] }).stampsNamed.at(-1))

/** Opens the connect window through the site's own `client.connect()` */
export async function openConnectWindow(page: Page, button: string) {
  const popupPromise = page.waitForEvent('popup', { timeout: 15000 })
  await page.getByRole('button', { name: button, exact: true }).click()
  const popup = await popupPromise
  await popup.waitForLoadState()
  return popup
}

/**
 * An account with two drives, connected to the partitioned demo on the
 * account default, which the picker starts on. Signing in gives the site no
 * stamp, the confirm does.
 */
export async function connectedOnDefault(page: Page, demoOrigin: string) {
  await seedNoChain(page)
  await page.goto(`${ID_ORIGIN}/?signin`)
  await completeCreateFlow(page)
  await page.getByRole('button', { name: 'Stay local for now' }).click()
  await expect(page).toHaveURL(/\/$/)
  await seedTwoDrives(page)

  await page.goto(`${demoOrigin}/account`)
  await recordStampsNamed(page)

  await page.getByRole('button', { name: 'Connect Swarm ID' }).click()
  const popup = await openConnectWindow(page, 'Connect')
  await popup.getByRole('button', { name: /0x[0-9a-fA-F]{4}/ }).click()
  await popup.getByRole('textbox', { name: 'Account password' }).fill(PASSWORD)
  await popup.getByRole('button', { name: 'Confirm' }).click()
  await expect(popup.getByRole('combobox', { name: 'Select drive' })).toHaveValue(MAIN_BATCH)
  await expect.poll(() => lastStampNamed(page), { timeout: 15000 }).toBeNull()
  await goToApp(popup)
  await expect.poll(() => lastStampNamed(page), { timeout: 15000 }).toBe(MAIN_BATCH)
}
