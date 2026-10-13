// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * How a Bee node answers a path inside a Swarm website, modelled so a test can
 * ask it about the real build output before anything is uploaded.
 *
 * The rule is Bee's `serveReference` in `pkg/api/bzz.go` (read at v2.7.0), the
 * handler behind `/bzz/{address}/{path}` and so behind every `bzz.link` and ENS
 * gateway in front of it. A website is a manifest whose root carries two
 * settings, the index document and the error document, set at upload time with
 * the `Swarm-Index-Document` and `Swarm-Error-Document` headers.
 *
 * Bee tries, in order:
 *
 * 1. The empty path (the site root): the index document, or 404.
 * 2. An entry whose path is exactly the request path. No extension is added,
 *    so `/proxy` does not find `proxy.html`.
 * 3. When some entry starts with the path plus `/`, a 308 redirect to the path
 *    with a trailing slash, so `/connect` beside a `connect/done.html` becomes
 *    `/connect/`.
 * 4. The path joined with the index document, so `/docs` finds
 *    `docs/index.html`.
 * 5. The error document, served with status 200.
 * 6. 404.
 *
 * Trailing slashes collapse to one before any of this. Bee's `path.Join` in
 * step 4 also cleans `.` and `..` segments, which no route here has.
 */

/** The two website settings a manifest's root carries. */
export interface WebsiteDocuments {
  indexDocument: string
  errorDocument: string
}

/** What Bee answers for one request path. */
export type WebsiteResolution =
  | { kind: 'file'; path: string }
  | { kind: 'redirect'; location: string }
  | { kind: 'not-found' }

/** A route the website would not serve as a page, with what Bee answers instead. */
export interface UnservedRoute {
  route: string
  resolution: WebsiteResolution
}

const ROUTE_PAGE_FILE = '+page.svelte'
const HTML_EXTENSION = '.html'

/**
 * Resolve a request path the way Bee does.
 *
 * @param entries Every file path in the manifest, relative to its root and with
 *   no leading slash, as a folder upload names them (`index.html`,
 *   `_app/env.js`).
 * @param requestPath The URL path after the website's root, such as `/proxy`.
 */
export function resolveWebsitePath(
  entries: ReadonlySet<string>,
  requestPath: string,
  { indexDocument, errorDocument }: WebsiteDocuments,
): WebsiteResolution {
  const path = collapseTrailingSlashes(requestPath.replace(/^\//, ''))
  if (path === '') {
    return entries.has(indexDocument)
      ? { kind: 'file', path: indexDocument }
      : { kind: 'not-found' }
  }
  if (entries.has(path)) {
    return { kind: 'file', path }
  }
  if (!path.startsWith('/') && hasEntryUnder(entries, `${path}/`)) {
    return { kind: 'redirect', location: `${requestPath}/` }
  }
  if (!path.endsWith(indexDocument)) {
    const withIndex = `${path.replace(/\/$/, '')}/${indexDocument}`
    if (entries.has(withIndex)) {
      return { kind: 'file', path: withIndex }
    }
  }
  if (path !== errorDocument && entries.has(errorDocument)) {
    return { kind: 'file', path: errorDocument }
  }
  return { kind: 'not-found' }
}

/**
 * The URL path of every page route, from the `+page.svelte` files under
 * `src/routes`.
 *
 * @param pageFiles Paths relative to `src/routes`, such as
 *   `connect/done/+page.svelte`. Other files are ignored.
 * @throws on a dynamic segment (`[id]`), which no fixed list of paths covers.
 */
export function routePaths(pageFiles: readonly string[]): string[] {
  return pageFiles
    .map((file) => file.split('\\').join('/'))
    .filter((file) => file === ROUTE_PAGE_FILE || file.endsWith(`/${ROUTE_PAGE_FILE}`))
    .map((file) => {
      const segments = file
        .split('/')
        .slice(0, -1)
        .filter((segment) => !isRouteGroup(segment))
      const dynamic = segments.find((segment) => segment.includes('['))
      if (dynamic) {
        throw new Error(`Route segment ${dynamic} in ${file} is dynamic`)
      }
      return `/${segments.join('/')}`
    })
    .sort()
}

/**
 * The routes Bee would not answer with an HTML page straight away: a redirect,
 * a 404, or a file that is not a page.
 */
export function unservedRoutes(
  entries: ReadonlySet<string>,
  routes: readonly string[],
  documents: WebsiteDocuments,
): UnservedRoute[] {
  return routes
    .map((route) => ({ route, resolution: resolveWebsitePath(entries, route, documents) }))
    .filter(
      ({ resolution }) => resolution.kind !== 'file' || !resolution.path.endsWith(HTML_EXTENSION),
    )
}

function collapseTrailingSlashes(path: string): string {
  return path.endsWith('/') ? `${path.replace(/\/+$/, '')}/` : path
}

function hasEntryUnder(entries: ReadonlySet<string>, prefix: string): boolean {
  for (const entry of entries) {
    if (entry.startsWith(prefix)) {
      return true
    }
  }
  return false
}

function isRouteGroup(segment: string): boolean {
  return segment.startsWith('(') && segment.endsWith(')')
}
