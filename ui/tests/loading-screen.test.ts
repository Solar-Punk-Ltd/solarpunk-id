// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * What a Swarm ID page shows before its app has loaded, which from Swarm
 * takes seconds: the theme's background and a Swarm loader on a page of its
 * own, nothing inside a frame, and the app once it has loaded. The app's
 * scripts are held back to see the first state, as a slow load would.
 */
import { type Page, expect, test } from '@playwright/test'

import { ID_ORIGIN } from './helpers'

const LOADER = '#swarm-id-loading'
const DARK_BACKGROUND = 'oklch(0.145 0 0)'
const LIGHT_BACKGROUND = 'oklch(1 0 0)'

/** Only the page itself arrives: no script of the app runs */
async function holdBackTheApp(page: Page) {
  await page
    .context()
    .route(`${ID_ORIGIN}/**`, (route) =>
      route.request().resourceType() === 'script' ? route.abort() : route.continue(),
    )
}

function storeTheme(page: Page, theme: string) {
  return page.addInitScript((value) => localStorage.setItem('swarm-id-theme', value), theme)
}

const backgroundOf = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)

test('a page starts dark with the loader when the stored theme is dark', async ({ page }) => {
  await holdBackTheApp(page)
  await storeTheme(page, 'dark')
  await page.goto(`${ID_ORIGIN}/connect`)

  await expect(page.locator(LOADER)).toBeVisible()
  await expect(page.getByRole('status', { name: 'Loading Swarm ID' })).toBeVisible()
  expect(await backgroundOf(page)).toBe(DARK_BACKGROUND)
})

test('a page starts light when the stored theme is light', async ({ page }) => {
  await holdBackTheApp(page)
  await storeTheme(page, 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto(`${ID_ORIGIN}/connect`)

  await expect(page.locator(LOADER)).toBeVisible()
  expect(await backgroundOf(page)).toBe(LIGHT_BACKGROUND)
})

test('a page follows the system theme when none is stored', async ({ page }) => {
  await holdBackTheApp(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto(`${ID_ORIGIN}/`)

  expect(await backgroundOf(page)).toBe(DARK_BACKGROUND)
})

for (const path of ['/button', '/proxy']) {
  test(`${path} shows no loader and no background in a frame`, async ({ page }) => {
    await holdBackTheApp(page)
    await storeTheme(page, 'dark')
    await page.setContent(`<iframe src="${ID_ORIGIN}${path}"></iframe>`)
    const frame = page.frameLocator('iframe')

    await expect(frame.locator(LOADER)).toBeAttached()
    await expect(frame.locator(LOADER)).toBeHidden()
    const background = await page
      .frames()
      .find((candidate) => candidate.url().startsWith(ID_ORIGIN))!
      .evaluate(() => getComputedStyle(document.documentElement).backgroundColor)
    expect(background).toBe('rgba(0, 0, 0, 0)')
  })
}

test('the loader goes once the app has loaded', async ({ page }) => {
  await storeTheme(page, 'dark')
  await page.goto(`${ID_ORIGIN}/`)

  await expect(page.getByRole('link', { name: 'Get started' }).first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.locator(LOADER)).toHaveCount(0)
})
