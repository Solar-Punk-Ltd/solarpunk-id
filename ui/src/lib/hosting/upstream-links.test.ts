// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The fork must neither send a person to the upstream project's hosts nor
 * call them. Links to an upstream issue stay, since that is where the issue
 * lives, and so does the footer's credit to Snaha's own home page, since the
 * work is theirs. Test files are left out: their fixtures are never served.
 */
const SITE_SOURCES = [
  fileURLToPath(new URL('../../../src', import.meta.url)),
  fileURLToPath(new URL('../../../../demo/src', import.meta.url)),
]
const UPSTREAM_HOST = /[\w.-]*snaha\.net/
const UPSTREAM_CREDIT = "url: 'https://snaha.net' }"
const UPSTREAM_REPOSITORY = /github\.com\/snaha\/(?![\w-]+\/issues\/\d)/
const SOURCE_FILE = /\.(ts|js|svelte|html)$/
const TEST_FILE = /\.test\.ts$/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && SOURCE_FILE.test(entry.name))
    .filter((entry) => !TEST_FILE.test(entry.name))
    .map((entry) => `${entry.parentPath}/${entry.name}`)
}

describe('the identity site and the demo', () => {
  it('name no upstream host and link no upstream repository', () => {
    const offending = SITE_SOURCES.flatMap(sourceFiles).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ file, line: index + 1, text: line.trim() }))
        .filter(({ text }) => !text.includes(UPSTREAM_CREDIT))
        .filter(({ text }) => UPSTREAM_HOST.test(text) || UPSTREAM_REPOSITORY.test(text)),
    )

    expect(offending).toEqual([])
  })
})
