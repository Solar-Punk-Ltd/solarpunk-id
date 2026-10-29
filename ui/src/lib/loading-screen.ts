// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The loader `app.html` shows while the app loads from Swarm. It is plain
 * markup in the page, painted before any script, so it is taken away by id
 * once the app has something to show.
 */
export const LOADING_SCREEN_ID = 'swarm-id-loading'

function removeLoadingScreen(): void {
  document.getElementById(LOADING_SCREEN_ID)?.remove()
}

/**
 * Takes the loader away once `loaded` settles either way. A rejection is
 * left to whoever else awaits `loaded`, and is never rethrown from here.
 */
export function removeLoadingScreenOnceSettled(loaded: Promise<unknown>): void {
  loaded.then(removeLoadingScreen, removeLoadingScreen)
}
