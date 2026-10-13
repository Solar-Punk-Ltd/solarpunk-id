// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test'

/**
 * The identity site cannot ask the host to forbid framing (bzz.link sends no
 * X-Frame-Options or frame-ancestors), so every page a person uses refuses to
 * run inside a frame and shows nothing to click (review P2-3). The proxy page
 * is the one that is meant to be framed.
 */
const REFUSED_PATHS = ['/', '/connect', '/connect/done', '/account/new', '/account/import']

const REFUSAL = 'This page cannot be shown inside another site'

async function frame(page: import('@playwright/test').Page, url: string) {
  await page.setContent(`<iframe src="${url}" style="width:800px;height:600px"></iframe>`)
  return page.frameLocator('iframe')
}

for (const path of REFUSED_PATHS) {
  test(`${path} refuses to run inside a frame`, async ({ page, baseURL }) => {
    const framed = await frame(page, `${baseURL}${path}`)

    await expect(framed.getByText(REFUSAL)).toBeVisible()
    await expect(framed.locator('button, a, input, select, textarea')).toHaveCount(0)
  })
}

test('the proxy page still runs inside a frame', async ({ page, baseURL }) => {
  await page.setContent('<html><body></body></html>')
  const initialized = page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        window.addEventListener('message', (event) => {
          if ((event.data as { type?: string })?.type === 'proxyInitialized') resolve(true)
        })
      }),
  )
  await page.evaluate((src) => {
    const iframe = document.createElement('iframe')
    iframe.src = src
    document.body.appendChild(iframe)
  }, `${baseURL}/proxy`)

  expect(await initialized).toBe(true)
  await expect(page.frameLocator('iframe').getByText(REFUSAL)).toHaveCount(0)
})
