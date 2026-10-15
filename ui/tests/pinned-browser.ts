// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

/**
 * Installs the build of `browser` this Playwright release pins, through the
 * repository's own Playwright. A machine or image that carries another
 * release's builds would otherwise fail every test of that browser with a
 * missing executable. Where the build is already there it does nothing.
 */
export function installPinnedBrowser(...args: string[]): void {
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')
  execFileSync(process.execPath, [cli, 'install', ...args], { stdio: 'inherit' })
}
