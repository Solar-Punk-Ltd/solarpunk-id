// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { type Page, expect, test } from '@playwright/test'

import { completeCreateFlow, sealInPage, seedNoChain } from './helpers'

const SITE = 'https://chat.example.com'
const MAIN_BATCH = 'a1'.repeat(32)
const CHAT_BATCH = 'b2'.repeat(32)
const DAY_SECONDS = 24 * 60 * 60
const LIFETIME_DAYS = 12

interface StoredAccounts {
  data: {
    defaultPostageStampBatchID?: string
    postageStamps?: Record<string, unknown>[]
    connectedApps?: {
      appUrl: string
      appName?: string
      lastConnectedAt?: number
      postageStampBatchID?: string
      stampPending?: true
    }[]
  }[]
}

const readAccounts = (page: Page) =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem('swarm-id-accounts') ?? '{}') as StoredAccounts,
  )

const storedChoice = async (page: Page) =>
  (await readAccounts(page)).data[0].connectedApps?.find((app) => app.appUrl === SITE)
    ?.postageStampBatchID

/**
 * Two drives and one connected site, written into the account the create flow
 * made, so no chain is needed: the Apps screen reads only the record.
 */
async function seedDrivesAndSite(page: Page, { stampPending }: { stampPending?: true } = {}) {
  const doc = await readAccounts(page)
  const drive = async (batchID: string, name: string, utilization: number) => ({
    batchID,
    signerKey: await sealInPage(page, 'c3'.repeat(32)),
    name,
    utilization,
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
  doc.data[0].postageStamps = [
    await drive(MAIN_BATCH, 'Main', 0.25),
    await drive(CHAT_BATCH, 'Chat', 0.5),
  ]
  doc.data[0].defaultPostageStampBatchID = MAIN_BATCH
  doc.data[0].connectedApps = [
    { appUrl: SITE, appName: 'Chat site', lastConnectedAt: Date.now(), stampPending },
  ]
  await page.evaluate(
    (value) => localStorage.setItem('swarm-id-accounts', value),
    JSON.stringify(doc),
  )
}

test('the Apps screen changes the drive a site uses, from a link to that site', async ({
  page,
}) => {
  await seedNoChain(page)
  await page.goto('/?signin')
  await completeCreateFlow(page)
  await page.getByRole('button', { name: 'Stay local for now' }).click()
  await expect(page).toHaveURL(/\/$/)
  await seedDrivesAndSite(page)

  await page.goto(`/#apps/${encodeURIComponent(SITE)}`)
  await page.reload()

  const row = page.locator('[aria-current="true"]')
  await expect(row).toContainText(SITE)
  // The site has picked no drive, and the account default does not stand in
  // for one (D4, 2026-10-16).
  const picker = row.getByRole('combobox', { name: 'Drive this app uses', exact: true })
  await expect(picker).toHaveValue('none')
  await expect(row.locator('p', { hasText: /^No drive$/ })).toBeVisible()

  await picker.selectOption({ label: 'Chat' })
  await expect(row.getByText(`Chat · 50% used · ${LIFETIME_DAYS} days left`)).toBeVisible()
  await expect.poll(() => storedChoice(page)).toBe(CHAT_BATCH)

  await picker.selectOption({ label: 'No drive' })
  await expect(row.locator('p', { hasText: /^No drive$/ })).toBeVisible()
  await expect.poll(() => storedChoice(page)).toBe('none')

  // The default is stored by its batch, so the site keeps it when the default moves.
  await picker.selectOption({ label: 'Main (default)' })
  await expect(row.getByText(`Main · 25% used · ${LIFETIME_DAYS} days left`)).toBeVisible()
  await expect.poll(() => storedChoice(page)).toBe(MAIN_BATCH)

  await page.goto(`/#apps/${encodeURIComponent('https://other.example.com')}`)
  await expect(
    page.getByText('https://other.example.com is not connected to this account.'),
  ).toBeVisible()
})

test('the Apps screen says a site waits for the person to confirm its drive', async ({ page }) => {
  await seedNoChain(page)
  await page.goto('/?signin')
  await completeCreateFlow(page)
  await page.getByRole('button', { name: 'Stay local for now' }).click()
  await expect(page).toHaveURL(/\/$/)
  await seedDrivesAndSite(page, { stampPending: true })

  await page.goto(`/#apps/${encodeURIComponent(SITE)}`)
  await page.reload()

  const row = page.locator('[aria-current="true"]')
  await expect(row.getByText('Waiting for you to confirm in the sign-in window.')).toBeVisible()
  await expect(row.getByText(/% used/)).toHaveCount(0)
  await expect(
    row.getByRole('combobox', { name: 'Drive this app uses', exact: true }),
  ).toBeEnabled()
})
