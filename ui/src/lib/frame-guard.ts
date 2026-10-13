// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Clickjacking defence for a site that cannot send headers.
 *
 * Served from Swarm through bzz.link, the identity site gets no
 * X-Frame-Options and no frame-ancestors header, and a meta CSP cannot carry
 * frame-ancestors. So the pages refuse a frame themselves: the root layout
 * renders nothing a person can click and runs no page logic unless it is the
 * top window. The hidden proxy page is the exception, being the one page that
 * exists to be framed.
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

function isProxyPath(pathname: string, base: string): boolean {
  const proxy = `${base}${routes.PROXY}`
  return pathname === proxy || pathname === `${proxy}/`
}

export function refusesToRunFramed({ pathname, base, framed }: FrameContext): boolean {
  return framed && !isProxyPath(pathname, base)
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
