// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The one-time backup prompt for Safari's storage limit (review P2-7).
 *
 * Safari deletes everything a site's scripts stored after 7 days in which the
 * person did not use the site, and the account on this device is stored that
 * way. So after an account is created or imported here, a Safari visitor is
 * asked once to save the recovery phrase or a backup file. Every browser on
 * iPhone and iPad runs Safari's engine, so they are asked too.
 *
 * Kept per account in this site's own storage: `due` once the account is set
 * up here, `shown` once the prompt was answered.
 */

/** `localStorage` key prefix, followed by the account id in hex. */
export const BACKUP_PROMPT_KEY_PREFIX = 'swarm-id-backup-prompt:'

const DUE = 'due'
const SHOWN = 'shown'

/** The prompt's words, in one place so they are checked for tone. */
export const BACKUP_PROMPT_TEXT = {
  title: 'Save a backup of your account',
  body: 'Safari deletes the data of a site you have not used for 7 days, and your account on this device would go with it. Save your Secret Recovery Phrase, or export a backup file, so you can always get back in.',
  save: 'Save a backup now',
  later: 'Not now',
} as const

/** Safari, or any browser on iPhone or iPad. */
export function hasSafariStorageLimit(userAgent: string): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true
  return (
    /Safari\//.test(userAgent) && !/Chrome|Chromium|Edg\/|OPR\/|Firefox|Android/.test(userAgent)
  )
}

function key(accountId: string): string {
  return `${BACKUP_PROMPT_KEY_PREFIX}${accountId}`
}

/** An account was created or imported on this device. Never re-arms. */
export function markBackupPromptDue(storage: Storage, accountId: string): void {
  if (storage.getItem(key(accountId)) === null) storage.setItem(key(accountId), DUE)
}

export function markBackupPromptShown(storage: Storage, accountId: string): void {
  storage.setItem(key(accountId), SHOWN)
}

export function shouldPromptBackup(
  storage: Storage,
  accountId: string,
  userAgent: string,
): boolean {
  return hasSafariStorageLimit(userAgent) && storage.getItem(key(accountId)) === DUE
}
