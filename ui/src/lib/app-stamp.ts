// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The drive (postage stamp) a connected site uses, as the Apps screen shows
 * and changes it. What the site's frame spends is decided by the library's
 * `resolveStampForApp`, so the screen reads the same rule rather than its own.
 */
import { BatchId } from '@ethersphere/bee-js'
import {
  type ConnectedApp,
  NO_POSTAGE_STAMP,
  type PostageStamp,
  resolveStampForApp,
} from '@solarpunkltd/swarm-id/internal'

import type { SelectOption } from '$lib/components/ui/select'
import { describeDrive } from '$lib/drives'

/** What the Apps screen stores for a site: its own drive, none, or `undefined` to follow the account default */
type AppStampChoice = ConnectedApp['postageStampBatchID']

type AppStampPointer = Pick<ConnectedApp, 'postageStampBatchID'>

interface AccountDrives {
  /** The account's live drives, tombstones left out */
  stamps: PostageStamp[]
  defaultPostageStampBatchID: BatchId | undefined
}

function resolvedDrive(app: AppStampPointer, account: AccountDrives): PostageStamp | undefined {
  return resolveStampForApp(app, account, account.stamps)
}

/** The select value for the drive the site uses, or `NO_POSTAGE_STAMP` when it has none */
export function appStampValue(app: AppStampPointer, account: AccountDrives): string {
  return resolvedDrive(app, account)?.batchID.toHex() ?? NO_POSTAGE_STAMP
}

/**
 * The choice to store for a select value. Picking the account default stores
 * "follow the default", as the connect window's drive picker does, so the site
 * moves with the default when the person changes it.
 */
export function appStampChoice(value: string, account: AccountDrives): AppStampChoice {
  if (value === NO_POSTAGE_STAMP) return NO_POSTAGE_STAMP
  if (account.defaultPostageStampBatchID?.toHex() === value) return undefined
  return new BatchId(value)
}

/** Every drive, the default marked, an expired one listed but not choosable, and no drive last */
export function appStampOptions(account: AccountDrives, now = Date.now()): SelectOption[] {
  const defaultHex = account.defaultPostageStampBatchID?.toHex()
  const drives = account.stamps.map((drive) => {
    const display = describeDrive(drive, now)
    const hex = drive.batchID.toHex()
    const expired = display.status === 'expired'
    const mark = hex === defaultHex ? ' (default)' : expired ? ' (expired)' : ''
    return { value: hex, label: display.name + mark, disabled: expired }
  })
  return [...drives, { value: NO_POSTAGE_STAMP, label: 'No drive' }]
}

/** "Chat · 50% used · 12 days left", or "No drive" */
export function appStampSummary(
  app: AppStampPointer,
  account: AccountDrives,
  now = Date.now(),
): string {
  const drive = resolvedDrive(app, account)
  if (!drive) return 'No drive'
  const display = describeDrive(drive, now)
  const timeLeft = display.status === 'expired' ? 'Expired' : display.timeLeftLabel
  return [display.name, `${display.usedPercent}% used`, timeLeft].filter(Boolean).join(' · ')
}

/**
 * The connect window's line about a site given its own drive or none, which
 * a reconnect would otherwise not mention. `undefined` for a site that follows
 * the account default.
 */
export function appChosenDriveLine(
  app: AppStampPointer,
  account: AccountDrives,
): string | undefined {
  if (app.postageStampBatchID === undefined) return undefined
  const drive = resolvedDrive(app, account)
  return drive
    ? `This app uses the drive ${describeDrive(drive).name}.`
    : 'No drive, this site cannot stamp.'
}

/** The home page hash that opens the Apps tab on one site */
export function appsTabHash(site: string): string {
  return `#apps/${encodeURIComponent(site)}`
}

/**
 * The site a `#apps/<encoded origin>` link names. The origin is encoded as
 * one segment because the hash splits on `/`.
 */
export function appSiteFromTarget(target: string[]): string | undefined {
  const [encoded] = target
  if (!encoded) return undefined
  try {
    return decodeURIComponent(encoded)
  } catch {
    return undefined
  }
}
