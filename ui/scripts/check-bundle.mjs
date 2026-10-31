// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Checks the client build's chunking (`frameAndRest` in vite.config.ts) from
 * Vite's manifest, after `vite build`:
 *
 * - no page's first load asks for more than MAX_SCRIPTS_PER_PAGE scripts,
 *   because bzz.link answers 500 to a burst of parallel requests;
 * - the frames other sites embed (`/proxy`, `/button`) download at most
 *   MAX_FRAME_BYTES of script, about a third of the app. bzz.link sends it
 *   uncompressed, and an import that reaches the wallet libraries from a frame
 *   moves them into the `frame` chunk, which only its size shows.
 *
 * A page's first load is the two client entries, the root layout and error
 * nodes, its own node, and every script those import statically.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MANIFEST = '.svelte-kit/output/client/.vite/manifest.json'
const NODES_DIR = '.svelte-kit/generated/client-optimized/nodes'
const BUILD_DIR = 'build'
const MAX_SCRIPTS_PER_PAGE = 8
/** 1.58 MB at the 0.10.10 sources, against 4.79 MB for the whole app. */
const MAX_FRAME_BYTES = 1_900_000

/** Matched against what a generated node file imports. */
const ROOT_NODES = [/src\/routes\/\+layout\.svelte"/, /src\/routes\/\+error\.svelte"/]
const FRAME_PAGES = [/src\/routes\/proxy\/\+page\.svelte"/, /src\/routes\/button\/\+page\.svelte"/]

/** @typedef {{ file: string, name?: string, isEntry?: boolean, imports?: string[] }} Chunk */
/** @type {Record<string, Chunk>} */
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))

const nodeKey = (file) => `${NODES_DIR}/${file}`
const nodeSource = Object.fromEntries(
  readdirSync(NODES_DIR).map((file) => [
    nodeKey(file),
    readFileSync(join(NODES_DIR, file), 'utf8'),
  ]),
)
const nodesImporting = (patterns) =>
  Object.keys(nodeSource).filter((key) => patterns.some((pattern) => pattern.test(nodeSource[key])))

const entries = Object.keys(manifest).filter((key) => manifest[key].isEntry && !(key in nodeSource))
const rootNodes = nodesImporting(ROOT_NODES)

/** The manifest keys of every script a first load of these starting keys fetches. */
function firstLoad(keys) {
  const loaded = new Set(keys)
  for (const key of loaded) {
    for (const imported of manifest[key]?.imports ?? []) loaded.add(imported)
  }
  return loaded
}

const failures = []
if (rootNodes.length !== ROOT_NODES.length)
  failures.push(`found ${rootNodes.length} root nodes, expected ${ROOT_NODES.length}`)

const frameNodes = nodesImporting(FRAME_PAGES)
if (frameNodes.length !== FRAME_PAGES.length)
  failures.push(`found ${frameNodes.length} frame pages, expected ${FRAME_PAGES.length}`)

for (const node of Object.keys(nodeSource)) {
  if (!(node in manifest)) continue
  const loaded = firstLoad([...entries, ...rootNodes, node])
  const page = nodeSource[node].match(/src\/routes\/([^"]*)"/)?.[1] ?? node
  if (loaded.size > MAX_SCRIPTS_PER_PAGE) {
    failures.push(
      `${page} loads ${loaded.size} scripts at first, more than ${MAX_SCRIPTS_PER_PAGE}`,
    )
  }
  if (frameNodes.includes(node)) {
    const bytes = [...loaded].reduce(
      (sum, key) => sum + statSync(join(BUILD_DIR, manifest[key].file)).size,
      0,
    )
    if (bytes > MAX_FRAME_BYTES) {
      failures.push(
        `${page} is embedded by other sites and loads ${bytes} bytes of script, more than ${MAX_FRAME_BYTES}`,
      )
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`::error::${failure}`)
  process.exit(1)
}
console.log(
  `every page loads at most ${MAX_SCRIPTS_PER_PAGE} scripts at first, and each frame at most ${MAX_FRAME_BYTES} bytes`,
)
