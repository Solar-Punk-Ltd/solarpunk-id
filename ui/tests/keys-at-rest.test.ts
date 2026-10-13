// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Keys at rest (review P2-2): the account's keys are sealed in storage with a
 * non-extractable wrapping key kept in this origin's IndexedDB. A reload opens
 * them with no prompt, and a lost wrapping key reads as signed out, never as
 * plain text.
 */
import { type Page, expect, test } from '@playwright/test'

import { completeCreateFlow } from './helpers'

async function createLocalAccount(page: Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Get started' }).first().click()
  await completeCreateFlow(page)
  await page.getByRole('button', { name: 'Stay local for now' }).click()
  await expect(page).toHaveURL(/\/$/)
}

function storedDerivationKey(page: Page) {
  return page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem('swarm-id-accounts') ?? '{}') as {
      data?: { derivationKey?: string }[]
    }
    return doc.data?.[0]?.derivationKey
  })
}

test('the derivation key is stored sealed and opens again after a reload', async ({ page }) => {
  await createLocalAccount(page)

  await expect.poll(() => storedDerivationKey(page)).toMatch(/^sealed:v1:[0-9a-f]+$/)

  await page.reload()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText('Signed out')).toHaveCount(0)
})

test('a lost wrapping key signs the account out', async ({ page }) => {
  await createLocalAccount(page)
  await expect.poll(() => storedDerivationKey(page)).toMatch(/^sealed:v1:/)

  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('swarm-id-keys')
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      }),
  )
  await page.reload()

  await expect(page.getByText('Signed out').first()).toBeVisible()
})
