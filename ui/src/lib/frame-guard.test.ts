// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The identity site is served from Swarm through bzz.link, which sends no
 * X-Frame-Options and no frame-ancestors header, and a meta CSP cannot carry
 * frame-ancestors. So the pages refuse a frame themselves (review P2-3): only
 * the hidden proxy page is meant to be framed.
 */
import { describe, expect, it } from 'vitest'

import { LAYOUT_VIEW, layoutView, refusesToRunFramed } from './frame-guard'
import routes from './routes'

const PAGES_A_PERSON_USES = [
  routes.ROOT,
  routes.CONNECT,
  routes.CONNECT_DONE,
  routes.ACCOUNT_ADD,
  routes.ACCOUNT_NEW,
  routes.ACCOUNT_NEW_PHRASE,
  routes.ACCOUNT_NEW_ACCESS,
  routes.ACCOUNT_NEW_DONE,
  routes.ACCOUNT_READY,
  routes.ACCOUNT_IMPORT,
  routes.ACCOUNT_RESTORE,
  routes.PRODUCT,
  '/dev',
  '/no-such-page',
]

describe('refusesToRunFramed', () => {
  for (const base of ['', '/id']) {
    describe(`with base path "${base}"`, () => {
      for (const path of PAGES_A_PERSON_USES) {
        it(`refuses ${path} inside a frame`, () => {
          expect(refusesToRunFramed({ pathname: base + path, base, framed: true })).toBe(true)
        })

        it(`runs ${path} as the top window`, () => {
          expect(refusesToRunFramed({ pathname: base + path, base, framed: false })).toBe(false)
        })
      }

      it('runs the proxy page inside a frame, which is what it is for', () => {
        expect(refusesToRunFramed({ pathname: `${base}/proxy`, base, framed: true })).toBe(false)
        expect(refusesToRunFramed({ pathname: `${base}/proxy/`, base, framed: true })).toBe(false)
      })

      it('does not let a path that merely starts with the proxy one through', () => {
        expect(refusesToRunFramed({ pathname: `${base}/proxyx`, base, framed: true })).toBe(true)
        expect(refusesToRunFramed({ pathname: `${base}/proxy/connect`, base, framed: true })).toBe(
          true,
        )
      })
    })
  }

  it('refuses the proxy path outside the base path', () => {
    expect(refusesToRunFramed({ pathname: '/proxy', base: '/id', framed: true })).toBe(true)
  })
})

describe('layoutView', () => {
  const base = '/id'

  it('shows a page a person uses with its prompts as the top window', () => {
    expect(layoutView({ pathname: `${base}/`, base, framed: false })).toBe(
      LAYOUT_VIEW.PAGE_WITH_PROMPTS,
    )
  })

  it('shows the framed proxy page without the prompts, which would navigate the frame', () => {
    expect(layoutView({ pathname: `${base}/proxy`, base, framed: true })).toBe(LAYOUT_VIEW.PAGE)
  })

  it('refuses a page a person uses inside a frame', () => {
    expect(layoutView({ pathname: `${base}/`, base, framed: true })).toBe(LAYOUT_VIEW.REFUSAL)
  })

  it('refuses once a framed proxy page navigates to a page a person uses', () => {
    const framed = true
    const before = layoutView({ pathname: `${base}/proxy`, base, framed })
    const after = layoutView({ pathname: `${base}/`, base, framed })

    expect(before).toBe(LAYOUT_VIEW.PAGE)
    expect(after).toBe(LAYOUT_VIEW.REFUSAL)
  })
})
