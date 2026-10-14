// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Safari deletes a site's script-written storage after days without the
 * person using the site, 7 or 30 depending on the source (docs/Hardening.md),
 * and the account on this device goes with it. So after an account is created or imported here, a Safari visitor
 * is asked once to save a backup.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  BACKUP_PROMPT_TEXT,
  hasSafariStorageLimit,
  markBackupPromptDue,
  markBackupPromptShown,
  shouldPromptBackup,
} from './backup-prompt'

const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15'
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1'
const CHROME_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1'
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'

const ACCOUNT = 'aa'.repeat(20)

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  }
}

describe('hasSafariStorageLimit', () => {
  it('is true for Safari, and for every browser on iPhone, which runs Safari underneath', () => {
    expect(hasSafariStorageLimit(SAFARI_MAC)).toBe(true)
    expect(hasSafariStorageLimit(SAFARI_IPHONE)).toBe(true)
    expect(hasSafariStorageLimit(CHROME_IPHONE)).toBe(true)
  })

  it('is false elsewhere', () => {
    for (const agent of [CHROME_MAC, EDGE_WINDOWS, FIREFOX_LINUX, CHROME_ANDROID]) {
      expect(hasSafariStorageLimit(agent)).toBe(false)
    }
  })
})

describe('the backup prompt', () => {
  let storage: Storage

  beforeEach(() => {
    storage = memoryStorage()
  })

  it('shows on Safari after an account was created or imported here', () => {
    markBackupPromptDue(storage, ACCOUNT)
    expect(shouldPromptBackup(storage, ACCOUNT, SAFARI_IPHONE)).toBe(true)
  })

  it('does not show outside Safari', () => {
    markBackupPromptDue(storage, ACCOUNT)
    expect(shouldPromptBackup(storage, ACCOUNT, CHROME_MAC)).toBe(false)
  })

  it('does not show for an account that was not set up on this device', () => {
    expect(shouldPromptBackup(storage, ACCOUNT, SAFARI_IPHONE)).toBe(false)
  })

  it('shows only once, even when the account is imported again', () => {
    markBackupPromptDue(storage, ACCOUNT)
    markBackupPromptShown(storage, ACCOUNT)
    markBackupPromptDue(storage, ACCOUNT)
    expect(shouldPromptBackup(storage, ACCOUNT, SAFARI_IPHONE)).toBe(false)
  })

  it('keeps one account’s answer to itself', () => {
    markBackupPromptDue(storage, ACCOUNT)
    markBackupPromptShown(storage, ACCOUNT)
    markBackupPromptDue(storage, 'bb'.repeat(20))
    expect(shouldPromptBackup(storage, 'bb'.repeat(20), SAFARI_IPHONE)).toBe(true)
  })

  it('speaks plainly, without em-dashes or semicolons', () => {
    for (const text of Object.values(BACKUP_PROMPT_TEXT)) {
      expect(text).not.toMatch(/[—;]/)
    }
  })
})
