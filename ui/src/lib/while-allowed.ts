// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/** What `whileAllowed` returns. */
export interface AllowedRun {
  /** Starts on a page that may run, and stops once the page is refused. */
  follow(refused: boolean): void
  stop(): void
}

/**
 * Runs `start` while the page may run, and the stop it returns once the page
 * becomes refused or the owner goes away. The root layout outlives a
 * navigation, so a framed proxy page that navigates to a refused one must stop
 * what it started then, which a mount hook never notices.
 */
export function whileAllowed(start: () => () => void): AllowedRun {
  let stopStarted: (() => void) | undefined
  const stop = () => {
    stopStarted?.()
    stopStarted = undefined
  }
  return {
    follow(refused) {
      if (refused) stop()
      else stopStarted ??= start()
    },
    stop,
  }
}
