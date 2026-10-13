// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * What the connect window says before the account signs a chat binding, and
 * that the account key signs one nowhere else.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { chatBindingNotice } from '$lib/chat-binding-notice'

const SRC = fileURLToPath(new URL('..', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|svelte)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : []
  })
}

describe('chatBindingNotice', () => {
  const notice = chatBindingNotice('https://viewer.example.com')

  it('names the site and says the link is public', () => {
    expect(notice).toContain('https://viewer.example.com')
    expect(notice).toMatch(/public/i)
    expect(notice).toMatch(/chat/i)
  })

  it('is one sentence with no em-dash and no semicolon', () => {
    expect(notice).not.toMatch(/[—;]/)
    expect(notice.match(/[.!?](\s|$)/g)).toHaveLength(1)
  })
})

describe('where a chat binding is signed', () => {
  it('only in the connect handshake, the window that holds the unlocked key', () => {
    const callers = sourceFiles(SRC)
      .filter((path) => readFileSync(path, 'utf8').includes('createChatBinding'))
      .map((path) => relative(SRC, path))
    expect(callers).toEqual(['lib/connect-handshake.ts'])
  })
})
