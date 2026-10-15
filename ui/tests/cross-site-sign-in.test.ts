// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Signing in on a site that is on another site than Swarm ID, the Devcon
 * viewer's case: the demo under a loopback literal, Swarm ID at
 * `http://localhost:5500`, so the two are cross-site and Chromium partitions
 * Swarm ID's frames. Only a window a Swarm ID frame opened from a click inside
 * it can sign such a site in, which is what the Swarm ID button is for.
 *
 * Runs in `chromium-partitioned`, where every journey proves the partition
 * first, and in `webkit-cross-site`. Playwright's WebKit gives these frames
 * the identity site's `localStorage` but an IndexedDB of their own (measured
 * 2026-10-15), so they cannot open the sealed keys in that storage, Swarm ID
 * treats them as partitioned (`lib/src/utils/storage-probe.ts`), and the same
 * handover path runs there. No chain and no Bee node: the drives are written
 * into the account record, and what the site is told is read off the wire its
 * client listens on.
 */
import { type Page, expect, test } from '@playwright/test'

import {
  CHAT_BATCH,
  MAIN_BATCH,
  accountWithTwoDrivesOnTheDemo,
  confirmOnDefault,
  connectedOnDefault,
  lastStampNamed,
  openChangeStampWindow,
} from './drive-picker-helpers'
import {
  ID_ORIGIN,
  answerSafariBackupPrompt,
  busRoomJoined,
  completeCreateFlow,
  expectDemoLogged,
  expectProxyPartitioned,
  goToApp,
  openSwarmIdButtonPopup,
  partitionedDemoOrigin,
} from './helpers'

const demoOrigin = await partitionedDemoOrigin()
const NO_LOOPBACK_LITERAL =
  'the demo dev server answered on neither loopback literal, nothing to browse cross-site'
if (!demoOrigin && process.env.CI) {
  throw new Error(NO_LOOPBACK_LITERAL)
}
test.skip(!demoOrigin, NO_LOOPBACK_LITERAL)

test.beforeEach(({ context }) => answerSafariBackupPrompt(context))

/**
 * The engine this project runs partitions Swarm ID's frames' `localStorage`
 * here, which `expectProxyPartitioned` can prove
 */
const partitions = (projectName: string) => projectName.startsWith('chromium')

async function onTheDemo(page: Page, projectName: string) {
  await page.goto(`${demoOrigin}/account`)
  if (partitions(projectName)) await expectProxyPartitioned(page)
}

const signedIn = (page: Page) =>
  expect(page.getByRole('heading', { name: 'Identity' })).toBeVisible({ timeout: 15000 })

test('the site page opens no window that cannot sign it in', async ({ page }, testInfo) => {
  await onTheDemo(page, testInfo.project.name)
  const opened: Page[] = []
  page.context().on('page', (created) => opened.push(created))

  await page.getByRole('button', { name: 'Connect Swarm ID' }).click()
  await expect(page.locator('#swarm-id-button iframe')).toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: 'Connect', exact: true }).click()

  await expectDemoLogged(page, /Sign in through the button from client\.mountButton/)
  expect(opened.filter((created) => created.url().includes('/connect'))).toHaveLength(0)
})

test('signing in through the button signs the site in, and a reload keeps it', async ({
  page,
}, testInfo) => {
  await onTheDemo(page, testInfo.project.name)

  const popup = await openSwarmIdButtonPopup(page)
  await expect(popup).toHaveURL(/challenge=/)
  await completeCreateFlow(popup)
  await expect(popup).toHaveURL(/\/connect\/done$/)
  await goToApp(popup)
  await signedIn(page)
  const name = page.getByText('Name', { exact: true }).locator('xpath=following-sibling::div')
  await expect(name).not.toBeEmpty()
  const shownName = await name.innerText()

  // The demo removes its sign-in button once signed in, and the session stays.
  await expect(page.locator('#swarm-id-button iframe')).toHaveCount(0)

  const opened: Page[] = []
  page.context().on('page', (created) => opened.push(created))
  await page.reload()
  await signedIn(page)
  await expect(name).toHaveText(shownName)
  expect(opened.filter((created) => created.url().includes('/connect'))).toHaveLength(0)
})

// The button fills the box the site gives it, has a name a screen reader can
// say, and opens its window from the keyboard as from a click.
test('the button fits its container and works from the keyboard', async ({ page }, testInfo) => {
  await onTheDemo(page, testInfo.project.name)
  await page.getByRole('button', { name: 'Connect Swarm ID' }).click()

  const frame = page.locator('#swarm-id-button iframe')
  const button = page.frameLocator('#swarm-id-button iframe').getByRole('button', {
    name: 'Connect to Swarm',
  })
  await expect(button).toBeVisible({ timeout: 15000 })
  expect(await frame.boundingBox()).toEqual(await page.locator('#swarm-id-button').boundingBox())
  await expect(frame).toHaveAttribute('title', 'Swarm ID')

  const popupPromise = page.waitForEvent('popup', { timeout: 15000 })
  await button.focus()
  await page.keyboard.press('Enter')
  const popup = await popupPromise
  await expect(popup).toHaveURL(/challenge=/)
  // Busy while its window is open, under its busy label
  const busy = page.frameLocator('#swarm-id-button iframe').getByRole('button', {
    name: 'Waiting for Swarm ID',
  })
  await expect(busy).toHaveAttribute('aria-busy', 'true')
  await popup.close()
})

test('changing the stamp through the button reaches the open site', async ({ page }, testInfo) => {
  // Signs in through the button and confirms Main after the demo removed that
  // button, so the confirm reaching the site is part of this too.
  await connectedOnDefault(page, demoOrigin!)
  if (partitions(testInfo.project.name)) await expectProxyPartitioned(page)

  const popup = await openChangeStampWindow(page)
  await expect(popup).toHaveURL(/challenge=/)
  await popup.getByRole('button', { name: /0x[0-9a-fA-F]{4}/ }).click()
  const picker = popup.getByRole('combobox', { name: 'Select drive' })
  await expect(picker).toHaveValue(MAIN_BATCH)
  await picker.selectOption({ label: 'Chat' })
  await goToApp(popup)
  await expect.poll(() => lastStampNamed(page), { timeout: 15000 }).toBe(CHAT_BATCH)
})

test('Disconnect on the Apps screen reaches the open site', async ({ page }, testInfo) => {
  await connectedOnDefault(page, demoOrigin!)
  if (partitions(testInfo.project.name)) await expectProxyPartitioned(page)
  await signedIn(page)

  const idPage = await page.context().newPage()
  // Armed before the navigation that joins: the room has no mailbox.
  const joined = busRoomJoined(idPage)
  joined.catch(() => undefined)
  await idPage.goto(`${ID_ORIGIN}/#apps`)
  await joined
  await idPage.getByRole('tab', { name: 'Apps' }).click()
  await idPage.getByRole('button', { name: 'App actions' }).click()
  await idPage.getByRole('menuitem', { name: 'Disconnect' }).click()

  await expect(page.getByRole('heading', { name: 'Not connected' })).toBeVisible({
    timeout: 15000,
  })
})

// The window hands the session to the frames beside the button that opened
// it, read when it opens, so a site may remove its button while the window is
// still open, as one that closes its panel does, and still be signed in with
// the stamp confirmed there.
test('a button removed while its window is open still signs the site in with its stamp', async ({
  page,
}, testInfo) => {
  await accountWithTwoDrivesOnTheDemo(page, demoOrigin!)
  if (partitions(testInfo.project.name)) await expectProxyPartitioned(page)

  await page.getByRole('button', { name: 'Connect Swarm ID' }).click()
  const button = page.frameLocator('#swarm-id-button iframe').getByRole('button', {
    name: 'Connect to Swarm',
  })
  await expect(button).toBeVisible({ timeout: 15000 })
  const popupPromise = page.waitForEvent('popup', { timeout: 15000 })
  await button.click()
  const popup = await popupPromise
  // Gone as a site's closed panel takes it, once the window is up
  await expect(popup.getByRole('button', { name: /0x[0-9a-fA-F]{4}/ })).toBeVisible({
    timeout: 15000,
  })
  await page.locator('#swarm-id-button iframe').evaluate((frame) => frame.remove())

  await confirmOnDefault(page, popup)
  await signedIn(page)
})
