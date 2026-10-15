// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The page every route is served from (`app.html`, built into the one
 * `index.html`) paints the UI's background and a Swarm loader before any
 * script or stylesheet of the app has loaded, so a page loading from Swarm
 * starts in its theme instead of a blank white page. Its inline script picks
 * the theme by the theme store's rule, and a framed page shows no loader.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { LOADING_SCREEN_ID } from '$lib/loading-screen'

const APP_HTML = fileURLToPath(new URL('../../app.html', import.meta.url))
const BUILT_INDEX = fileURLToPath(new URL('../../../build/index.html', import.meta.url))
const BUILT = existsSync(BUILT_INDEX)
const BUILD_REQUIRED = Boolean(process.env.CI)

const STORAGE_KEY = 'swarm-id-theme'
const SLOW_LINE_ID = 'swarm-id-loading-slow'
const SLOW_AFTER_MS = 30_000

function inlineScript(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/)
  if (!match) throw new Error('no inline script in the page')
  return match[1]
}

/** Runs the page's inline script as a browser would, and says what it set */
function themeFor(
  html: string,
  {
    stored,
    systemDark,
    framed = false,
    storageThrows = false,
  }: { stored?: string; systemDark: boolean; framed?: boolean; storageThrows?: boolean },
): string[] {
  const classes = new Set<string>()
  const self = {}
  const window = {
    setTimeout: () => 0,
    self,
    top: framed ? {} : self,
    matchMedia: (query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' && systemDark,
    }),
  }
  const localStorage = {
    getItem: (key: string) => {
      if (storageThrows) throw new Error('blocked')
      return key === STORAGE_KEY ? (stored ?? null) : null
    },
  }
  const document = { documentElement: { classList: { add: (name: string) => classes.add(name) } } }
  new Function('window', 'localStorage', 'document', 'matchMedia', inlineScript(html))(
    window,
    localStorage,
    document,
    window.matchMedia,
  )
  return [...classes].sort()
}

/** The loader's element and everything inside it */
function loaderMarkup(html: string): string {
  const start = html.indexOf(`<div id="${LOADING_SCREEN_ID}"`)
  if (start === -1) throw new Error('no loader in the page')
  const end = html.indexOf('</svg>', start)
  return html.slice(start, html.indexOf('</div>', end) + '</div>'.length)
}

/** The words a screen reader reads from markup, the parts hidden from it left out */
function textOf(markup: string): string {
  return markup
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function describePage(name: string, read: () => string) {
  describe(name, () => {
    it('paints the dark and the light background before anything loads', () => {
      const html = read()
      expect(html).toMatch(/html\.dark\s*{[^}]*background:\s*oklch\(0\.145 0 0\)/)
      expect(html).toMatch(/html\.dark\s*{[^}]*color-scheme:\s*dark/)
      expect(html).toMatch(/html\s*{[^}]*background:\s*oklch\(1 0 0\)/)
    })

    it('shows a Swarm loader, still when motion is reduced', () => {
      const html = read()
      expect(html).toContain(`id="${LOADING_SCREEN_ID}"`)
      expect(html).toMatch(new RegExp(`id="${LOADING_SCREEN_ID}"[\\s\\S]*?<svg`))
      expect(html).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{[^}]*animation:\s*none/)
    })

    it('says in words, inside its one live region, what it waits for', () => {
      const loader = loaderMarkup(read())
      expect(loader.match(/role="status"|aria-live=/g), 'one live region').toEqual([
        'role="status"',
      ])
      expect(textOf(loader)).toContain('Loading Swarm ID')
    })

    it('says in words under the mark, in that same region, when the wait passes 30 seconds', () => {
      const html = read()
      const slowLine = { textContent: '' }
      const timers: { run: () => void; delay: number }[] = []
      const window = {
        self: {},
        top: {},
        matchMedia: () => ({ matches: false }),
        setTimeout: (run: () => void, delay: number) => timers.push({ run, delay }),
      }
      const document = {
        documentElement: { classList: { add: () => undefined } },
        getElementById: (id: string) => (id === SLOW_LINE_ID ? slowLine : undefined),
      }
      new Function('window', 'localStorage', 'document', inlineScript(html))(
        window,
        { getItem: () => undefined },
        document,
      )

      expect(timers.map((timer) => timer.delay)).toEqual([SLOW_AFTER_MS])
      expect(slowLine.textContent).toBe('')
      timers[0].run()
      expect(slowLine.textContent).toBe('Swarm ID is taking longer than usual.')
      expect(loaderMarkup(html)).toContain(`id="${SLOW_LINE_ID}"`)
    })

    it('says nothing more once the app took the loader away', () => {
      const timers: (() => void)[] = []
      const window = {
        self: {},
        top: {},
        matchMedia: () => ({ matches: false }),
        setTimeout: (run: () => void) => timers.push(run),
      }
      const document = {
        documentElement: { classList: { add: () => undefined } },
        getElementById: () => null,
      }
      new Function('window', 'localStorage', 'document', inlineScript(read()))(
        window,
        { getItem: () => undefined },
        document,
      )
      expect(() => timers[0]()).not.toThrow()
    })

    it('shows no loader and no background inside a frame', () => {
      const html = read()
      expect(html).toMatch(/html\.framed\s*{[^}]*background:\s*transparent/)
      expect(html).toMatch(
        new RegExp(`html\\.framed #${LOADING_SCREEN_ID}\\s*{[^}]*display:\\s*none`),
      )
    })

    it('picks the theme by the theme store’s rule', () => {
      const html = read()
      expect(themeFor(html, { stored: 'dark', systemDark: false })).toEqual(['dark'])
      expect(themeFor(html, { stored: 'light', systemDark: true })).toEqual([])
      expect(themeFor(html, { stored: 'auto', systemDark: true })).toEqual(['dark'])
      expect(themeFor(html, { systemDark: true })).toEqual(['dark'])
      expect(themeFor(html, { systemDark: false })).toEqual([])
      expect(themeFor(html, { systemDark: true, storageThrows: true })).toEqual(['dark'])
      expect(themeFor(html, { systemDark: true, framed: true })).toEqual(['dark', 'framed'])
    })
  })
}

describePage('app.html', () => readFileSync(APP_HTML, 'utf8'))

describe.skipIf(!BUILT && !BUILD_REQUIRED)(
  'the built index.html (needs `pnpm build` first)',
  () => {
    it('carries the same early theme and loader', () => {
      expect(BUILT, `no build at ${BUILT_INDEX}`).toBe(true)
      const html = readFileSync(BUILT_INDEX, 'utf8')
      expect(html).toContain(`id="${LOADING_SCREEN_ID}"`)
      expect(html).toMatch(/html\.dark\s*{[^}]*background:\s*oklch\(0\.145 0 0\)/)
      expect(themeFor(html, { stored: 'dark', systemDark: false })).toEqual(['dark'])
    })
  },
)
