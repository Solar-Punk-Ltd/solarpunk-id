// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * A site uses only the drive the person picked for it (Levi's ruling D4,
 * 2026-10-16). The account default never stands in for a missing pick, so a
 * drive bought after the site signed in, or the default left after the picked
 * drive is removed, pays for nothing until the person picks it.
 *
 * The demo shares the identity site's storage here (`localhost:3500` beside
 * `localhost:5500`), so a drive written into the account record on a Swarm ID
 * page reaches the site's frame as a storage event, the same way a drive
 * bought in another tab does. No chain is needed.
 */
import { type Page, expect, test } from '@playwright/test'

import {
  CHAT_BATCH,
  MAIN_BATCH,
  connectedOnDefault,
  lastStampNamed,
  openChangeStampWindow,
  recordStampsNamed,
  seedTwoDrives,
} from './drive-picker-helpers'
import {
  ID_ORIGIN,
  PASSWORD,
  completeCreateFlow,
  goToApp,
  openSwarmIdButtonPopup,
  seedNoChain,
} from './helpers'

const DEMO_URL = 'http://localhost:3500'

interface StoredAccounts {
  data: { postageStamps?: { batchID: string }[] }[]
}

/** A Swarm ID page beside the demo, where the account record is written */
async function swarmIdTab(page: Page) {
  const tab = await page.context().newPage()
  await tab.goto(ID_ORIGIN)
  return tab
}

/** Takes the drive off the account record, as removing it in Swarm ID does */
async function removeDrive(tab: Page, batchID: string) {
  const doc = await tab.evaluate(
    () => JSON.parse(localStorage.getItem('swarm-id-accounts') ?? '{}') as StoredAccounts,
  )
  doc.data[0].postageStamps = doc.data[0].postageStamps?.filter(
    (drive) => drive.batchID !== batchID,
  )
  await tab.evaluate(
    (value) => localStorage.setItem('swarm-id-accounts', value),
    JSON.stringify(doc),
  )
}

/** Every stamp the frame named to the site since the last load */
const stampsNamed = (page: Page) =>
  page.evaluate(() => (window as unknown as { stampsNamed: (string | null)[] }).stampsNamed)

test('a drive bought after signing in is not used until the person picks it', async ({ page }) => {
  await seedNoChain(page)
  await page.goto(`${ID_ORIGIN}/?signin`)
  await completeCreateFlow(page)
  await page.getByRole('button', { name: 'Stay local for now' }).click()
  await expect(page).toHaveURL(/\/$/)

  await page.goto(`${DEMO_URL}/account`)
  await recordStampsNamed(page)
  const popup = await openSwarmIdButtonPopup(page)
  await popup.getByRole('button', { name: /0x[0-9a-fA-F]{4}/ }).click()
  await popup.getByRole('textbox', { name: 'Account password' }).fill(PASSWORD)
  await popup.getByRole('button', { name: 'Confirm' }).click()
  await expect(popup.getByRole('button', { name: 'Set up a drive' })).toBeVisible()
  await goToApp(popup)
  await expect.poll(() => lastStampNamed(page), { timeout: 15000 }).toBeNull()

  // The drive arrives as the account's first, so it becomes the default.
  const tab = await swarmIdTab(page)
  await seedTwoDrives(tab)

  // A reload makes the frame read the record afresh, so its first word is the
  // whole answer rather than a race with the storage event.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Identity' })).toBeVisible({ timeout: 15000 })
  await expect
    .poll(async () => (await stampsNamed(page)).length, { timeout: 15000 })
    .toBeGreaterThan(0)
  expect(await stampsNamed(page)).not.toContain(MAIN_BATCH)
  expect(await stampsNamed(page)).not.toContain(CHAT_BATCH)

  // The connect window offers the default, and the confirm is the pick.
  const change = await openChangeStampWindow(page)
  await change.getByRole('button', { name: /0x[0-9a-fA-F]{4}/ }).click()
  await expect(change.getByRole('combobox', { name: 'Select drive' })).toHaveValue(MAIN_BATCH)
  await goToApp(change)
  await expect.poll(() => lastStampNamed(page), { timeout: 15000 }).toBe(MAIN_BATCH)
})

test('removing the drive picked for a site leaves it with none, not the default', async ({
  page,
}) => {
  await connectedOnDefault(page, DEMO_URL)

  const change = await openChangeStampWindow(page)
  await change.getByRole('button', { name: /0x[0-9a-fA-F]{4}/ }).click()
  await change.getByRole('combobox', { name: 'Select drive' }).selectOption({ label: 'Chat' })
  await goToApp(change)
  await expect.poll(() => lastStampNamed(page), { timeout: 15000 }).toBe(CHAT_BATCH)

  const tab = await swarmIdTab(page)
  await removeDrive(tab, CHAT_BATCH)

  await expect.poll(() => lastStampNamed(page), { timeout: 15000 }).toBeNull()
  const named = await stampsNamed(page)
  expect(named.slice(named.lastIndexOf(CHAT_BATCH))).not.toContain(MAIN_BATCH)
})
