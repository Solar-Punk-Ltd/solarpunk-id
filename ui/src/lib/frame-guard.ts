// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Clickjacking defence for a site that cannot send headers.
 *
 * Served from Swarm through bzz.link, the identity site gets no
 * X-Frame-Options and no frame-ancestors header, and a meta CSP cannot carry
 * frame-ancestors. So the pages refuse a frame themselves: the root layout
 * renders nothing a person can click and runs no page logic unless it is the
 * top window. The hidden proxy page and the button page are the exceptions,
 * being the pages that exist to be framed. The button page's one action opens
 * a top-level Swarm ID window, where the person acts for themselves.
 *
 * This defends against other pages framing the site. It does not defend
 * against the host serving different code: nothing in the browser checks the
 * files bzz.link serves, so whoever serves this origin's code can use
 * everything on it, this check included.
 */
import routes from './routes'

export interface FrameContext {
  /** `location.pathname`, base path included. */
  pathname: string
  /** The SvelteKit base path the site is built with, `''` at a domain root. */
  base: string
  /** Whether this window is not the top one. */
  framed: boolean
}

/** The pages that exist to be framed by a site: the hidden session frame and its button */
const FRAMED_ROUTES = [routes.PROXY, routes.BUTTON]

function isFramedPath(pathname: string, base: string): boolean {
  return FRAMED_ROUTES.some((route) => {
    const path = `${base}${route}`
    return pathname === path || pathname === `${path}/`
  })
}

export function refusesToRunFramed({ pathname, base, framed }: FrameContext): boolean {
  return framed && !isFramedPath(pathname, base)
}

/** What the root layout renders around a page. */
export const LAYOUT_VIEW = {
  /** One line of text and nothing to click. */
  REFUSAL: 'refusal',
  /** The page alone. A framed page gets no prompts, which could navigate the frame. */
  PAGE: 'page',
  PAGE_WITH_PROMPTS: 'page-with-prompts',
} as const

export type LayoutView = (typeof LAYOUT_VIEW)[keyof typeof LAYOUT_VIEW]

/**
 * Asked again on every navigation: a page that is allowed in a frame must not
 * become a way into one that is not.
 */
export function layoutView(context: FrameContext): LayoutView {
  if (refusesToRunFramed(context)) return LAYOUT_VIEW.REFUSAL
  return context.framed ? LAYOUT_VIEW.PAGE : LAYOUT_VIEW.PAGE_WITH_PROMPTS
}

/**
 * Comparing the two window references is allowed across origins, unlike
 * reading anything off `top`.
 */
export function isFramed(): boolean {
  return window.self !== window.top
}
