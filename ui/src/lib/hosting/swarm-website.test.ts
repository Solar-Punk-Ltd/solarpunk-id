// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import routes from '$lib/routes'

import {
  type WebsiteDocuments,
  resolveWebsitePath,
  routePaths,
  unservedRoutes,
} from './swarm-website'

/** The settings the upload recipe in `docs-site/.../swarm-hosting.mdx` gives Bee. */
const DOCUMENTS: WebsiteDocuments = { indexDocument: 'index.html', errorDocument: 'index.html' }

const ROUTES_DIR = fileURLToPath(new URL('../../routes', import.meta.url))
const BUILD_DIR = fileURLToPath(new URL('../../../build', import.meta.url))
const BUILT = existsSync(`${BUILD_DIR}/index.html`)
// CI builds the UI before it runs this suite, so a missing build there is a
// broken pipeline rather than a laptop that has not built yet.
const BUILD_REQUIRED = Boolean(process.env.CI)

/** The paths the frame and the client open by name, which must stay routes. */
const FRAME_PATHS = ['/proxy', routes.CONNECT, routes.CONNECT_DONE]

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      `${entry.parentPath}/${entry.name}`
        .slice(dir.length + 1)
        .split('\\')
        .join('/'),
    )
}

describe('resolveWebsitePath', () => {
  const entries = new Set([
    'index.html',
    'proxy.html',
    'connect.html',
    'connect/done.html',
    'docs/index.html',
    '_app/env.js',
  ])

  it('serves the index document at the root', () => {
    expect(resolveWebsitePath(entries, '/', DOCUMENTS)).toEqual({
      kind: 'file',
      path: 'index.html',
    })
  })

  it('matches a path exactly, with no extension added', () => {
    expect(resolveWebsitePath(entries, '/_app/env.js', DOCUMENTS)).toEqual({
      kind: 'file',
      path: '_app/env.js',
    })
    expect(resolveWebsitePath(entries, '/proxy', DOCUMENTS)).toEqual({
      kind: 'file',
      path: 'index.html',
    })
  })

  it('redirects a path that is also a folder to its trailing-slash form', () => {
    expect(resolveWebsitePath(entries, '/connect', DOCUMENTS)).toEqual({
      kind: 'redirect',
      location: '/connect/',
    })
  })

  it('serves a folder index, with or without the trailing slash once redirected', () => {
    expect(resolveWebsitePath(entries, '/docs/', DOCUMENTS)).toEqual({
      kind: 'file',
      path: 'docs/index.html',
    })
    expect(resolveWebsitePath(entries, '/docs', DOCUMENTS).kind).toBe('redirect')
  })

  it('falls back to the error document for anything unmatched', () => {
    expect(resolveWebsitePath(entries, '/account/new/access', DOCUMENTS)).toEqual({
      kind: 'file',
      path: 'index.html',
    })
    expect(resolveWebsitePath(entries, '/proxy///', DOCUMENTS)).toEqual({
      kind: 'file',
      path: 'index.html',
    })
  })

  it('answers 404 when there is neither a match nor an error document', () => {
    expect(
      resolveWebsitePath(new Set(['a.html']), '/proxy', {
        indexDocument: 'index.html',
        errorDocument: 'missing.html',
      }),
    ).toEqual({ kind: 'not-found' })
  })
})

describe('routePaths', () => {
  it('names each page route by its URL path', () => {
    expect(
      routePaths(['+page.svelte', '+layout.ts', 'connect/done/+page.svelte', 'dev/+page.ts']),
    ).toEqual(['/', '/connect/done'])
  })

  it('drops route groups from the path', () => {
    expect(routePaths(['(app)/proxy/+page.svelte'])).toEqual(['/proxy'])
  })

  it('refuses a dynamic route, which no file list can cover', () => {
    expect(() => routePaths(['drive/[id]/+page.svelte'])).toThrow(/\[id\]/)
  })
})

describe('the routes the frame and the client open', () => {
  it('are pages of this site', () => {
    const paths = routePaths(filesUnder(ROUTES_DIR))

    expect(paths).toEqual(expect.arrayContaining(['/', ...FRAME_PATHS]))
  })
})

describe('the build output, served from Swarm', () => {
  it.skipIf(!BUILT && !BUILD_REQUIRED)(
    'answers every route with a page and no redirect (needs `pnpm build` first)',
    () => {
      expect(BUILT, `no build at ${BUILD_DIR}`).toBe(true)
      const entries = new Set(filesUnder(BUILD_DIR))
      const paths = routePaths(filesUnder(ROUTES_DIR))

      expect(unservedRoutes(entries, paths, DOCUMENTS)).toEqual([])
    },
  )
})
