// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The WebKit build this Playwright release pins, installed before the WebKit
 * project runs. A setup project rather than the global setup, so a run that
 * selects no WebKit project downloads nothing.
 */
import { test } from '@playwright/test'

import { installPinnedBrowser } from './pinned-browser'

/** A first download of the build, measured at about 72 MB */
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000

test('the pinned WebKit build is installed', () => {
  test.setTimeout(INSTALL_TIMEOUT_MS)
  installPinnedBrowser('webkit')
})
