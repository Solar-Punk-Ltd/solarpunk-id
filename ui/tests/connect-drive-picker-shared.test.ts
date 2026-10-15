// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The drive picker where the site's frame shares the identity site's
 * storage (`localhost:3500` beside `localhost:5500`). There the frame reads
 * the connection out of that store, so the stamp held back until the
 * person's confirm is held back by the stored entry itself.
 */
import { expect, test } from '@playwright/test'

import {
  CHAT_BATCH,
  MAIN_BATCH,
  connectedOnDefault,
  lastStampNamed,
  openConnectWindow,
} from './drive-picker-helpers'
import { goToApp } from './helpers'

const DEMO_URL = 'http://localhost:3500'

test('a site reading shared storage stamps only after the confirm', async ({ page }) => {
  await connectedOnDefault(page, DEMO_URL)

  const popup = await openConnectWindow(page, 'Change in Swarm ID')
  await popup.getByRole('button', { name: /0x[0-9a-fA-F]{4}/ }).click()
  const picker = popup.getByRole('combobox', { name: 'Select drive' })
  await expect(picker).toHaveValue(MAIN_BATCH)
  await expect.poll(() => lastStampNamed(page), { timeout: 15000 }).toBeNull()
  await picker.selectOption({ label: 'Chat' })
  await goToApp(popup)
  await expect.poll(() => lastStampNamed(page), { timeout: 15000 }).toBe(CHAT_BATCH)
})
