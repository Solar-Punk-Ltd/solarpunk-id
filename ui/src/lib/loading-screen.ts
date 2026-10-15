// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The loader `app.html` shows while the app loads from Swarm. It is plain
 * markup in the page, painted before any script, so it is taken away by id
 * once the app has something to show.
 */
export const LOADING_SCREEN_ID = 'swarm-id-loading'

export function removeLoadingScreen(): void {
  document.getElementById(LOADING_SCREEN_ID)?.remove()
}
