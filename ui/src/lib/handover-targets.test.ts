// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Where a connect window hands the session: the frames beside the button
 * frame that opened it, which is where the site's session frame is.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { handoverTargets, rememberHandoverTargets } from '$lib/handover-targets'

interface FakeFrame {
  closed: boolean
  parent?: unknown
}

function sitePage(...children: FakeFrame[]) {
  const page = { frames: Object.assign({}, children, { length: children.length }) }
  for (const child of children) child.parent = page
  return page
}

describe('handover targets', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function openedBy(opener: FakeFrame | null) {
    vi.stubGlobal('window', { opener })
    rememberHandoverTargets()
  }

  it('are the frames beside the button that opened the window', () => {
    const button: FakeFrame = { closed: false }
    const session: FakeFrame = { closed: false }
    sitePage(session, button)
    openedBy(button)

    expect(handoverTargets()).toEqual([session])
  })

  // The site may remove its button once it is signed in, while the window
  // still has the stamp the person picks to hand over.
  it('still reach the session frame once the button is gone', () => {
    const button: FakeFrame = { closed: false }
    const session: FakeFrame = { closed: false }
    sitePage(session, button)
    openedBy(button)

    button.closed = true
    vi.stubGlobal('window', { opener: null })

    expect(handoverTargets()).toEqual([session])
  })

  it('are none once the site page reloaded, which closes its frames', () => {
    const button: FakeFrame = { closed: false }
    const session: FakeFrame = { closed: false }
    sitePage(session, button)
    openedBy(button)

    session.closed = true

    expect(handoverTargets()).toEqual([])
  })

  it('are none for a window no frame opened', () => {
    openedBy(null)
    expect(handoverTargets()).toEqual([])

    const page: FakeFrame = { closed: false }
    page.parent = page
    openedBy(page)
    expect(handoverTargets()).toEqual([])
  })
})
