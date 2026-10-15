// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  isSealedValue,
  openedValue,
  primeSealedValues,
  sealValue,
} from "./sealed-values"

/**
 * Whether a Swarm ID frame can read the trusted domain's first-party store,
 * asked BEFORE authentication, because it decides which transport the auth
 * popup has to take (#613). Both frames a site embeds read it: the session
 * frame, to tell the client whether `connect()` can work, and the button
 * frame, to decide whether to leave the popup's challenge in storage.
 *
 * The mirror image of the probe the connect popup already runs: there, the
 * button frame writes a challenge and the popup checks whether it can read it
 * back first-party (`ui/src/lib/stores/connect.svelte.ts`). That answer
 * arrives far too late to choose a transport, so the same question is asked
 * the other way round: the first-party app leaves a marker, and the frames
 * read it back.
 *
 * Deliberately NOT any of these:
 *
 * - **`document.hasStorageAccess()`** — measured 2026-08-31 in the
 *   `chromium-partitioned` rig: it returns `true` inside a genuinely
 *   partitioned frame. It is cookie-scoped, and Chrome partitions storage
 *   separately from cookies, so it answers a different question.
 * - **The accounts key.** The proxy writes `swarm-id-accounts` from inside the
 *   iframe (`clearAuthData`), and the versioned storage manager can materialise
 *   state in a fresh partitioned bucket, so its presence conflates "first-party
 *   storage is visible" with "this partition has its own copy".
 * - **The user agent**, which is what this replaces.
 *
 * The marker only ever answers YES with certainty. Absent means "not proven
 * shared" — a partitioned iframe, or a browser that has never had the SwarmID
 * site open at the top level — and the caller treats that as partitioned,
 * which is the safe direction: the handover through the Swarm ID button works
 * in both modes.
 *
 * The marker is sealed, because the keys in that store are: a frame that sees
 * the store but not the IndexedDB key that opens it sees no session in it.
 * Playwright's WebKit gives a cross-site frame exactly that, one
 * `localStorage` and its own IndexedDB (measured 2026-10-15), and a plain
 * marker had it wait for a storage write it could never read.
 */
export const STORAGE_SHARED_KEY = "swarm-id-first-party"
const MARKER = "1"

/**
 * Leave the marker. Called by the trusted domain's own pages.
 *
 * The framed guard is load-bearing: the proxy route runs the same app shell
 * inside the iframe, and a marker written there would land in the partitioned
 * bucket and make the iframe report itself shared — the one wrong answer this
 * must never give.
 */
export async function markFirstPartyStorage(): Promise<void> {
  try {
    if (typeof window === "undefined" || window.self !== window.top) {
      return
    }
    localStorage.setItem(STORAGE_SHARED_KEY, await sealValue(MARKER))
  } catch {
    // Storage disabled or full, or no key to seal with. Nothing to do: an
    // unwritten marker reads as "not proven shared", which is the safe answer.
  }
}

/** Whether this context can see, and open, the marker a first-party page left. */
export async function isStorageShared(): Promise<boolean> {
  try {
    const marker = localStorage.getItem(STORAGE_SHARED_KEY)
    if (!isSealedValue(marker)) return false
    await primeSealedValues([marker])
    return openedValue(marker) === MARKER
  } catch {
    return false
  }
}
