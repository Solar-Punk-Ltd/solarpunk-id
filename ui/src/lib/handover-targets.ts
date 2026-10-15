// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Where a connect window hands the session over to a site whose session frame
 * cannot read this window's storage.
 *
 * The window is opened by the Swarm ID button frame the site mounted
 * (`SwarmIdClient.mountButton`), so `window.opener` is that frame. The session
 * frame is a frame of the same site page beside it, so the handover goes to
 * the frames of the opener's page, and the browser delivers it to the ones on
 * Swarm ID's origin only. They are read once, when the window opens, so a site
 * that removes its button once it is signed in still gets the stamp the person
 * picks after that. A frame of a page that reloaded since is closed and
 * dropped, which is how the window learns the site it came from is gone.
 */

let remembered: Window[] = []

/** Read the frames beside this window's opener. Called once the link is read. */
export function rememberHandoverTargets(): void {
  remembered = []
  const opener = window.opener as Window | null
  if (!opener || opener.closed) return
  const page = opener.parent
  if (page === opener) return
  const frames = page.frames
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]
    if (frame && frame !== opener) remembered.push(frame)
  }
}

/** The remembered frames that are still there */
export function handoverTargets(): Window[] {
  return remembered.filter((frame) => !frame.closed)
}
