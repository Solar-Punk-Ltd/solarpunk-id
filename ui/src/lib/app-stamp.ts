// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The drive (postage stamp) a connected site uses, as the Apps screen shows
 * and changes it. What the site's frame spends is decided by the library's
 * `resolveStampForApp`, so the screen reads the same rule rather than its own:
 * the drive the person picked for the site, and never the account default in
 * its place. A site with no pick has no stamp.
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

/** What a pick stores for a site: its own drive, or none */
type AppStampChoice = ConnectedApp['postageStampBatchID']

type AppStampPointer = Pick<ConnectedApp, 'postageStampBatchID'>

type AppStampState = Pick<ConnectedApp, 'postageStampBatchID' | 'stampPending'>

const AWAITING_CONFIRM_SUMMARY = 'Waiting for you to confirm in the sign-in window.'

interface AccountDrives {
  /** The account's live drives, tombstones left out */
  stamps: PostageStamp[]
  defaultPostageStampBatchID: BatchId | undefined
}

function resolvedDrive(app: AppStampPointer, account: AccountDrives): PostageStamp | undefined {
  return resolveStampForApp(app, account.stamps)
}

/** The select value for the drive the site uses, or `NO_POSTAGE_STAMP` when it has none */
export function appStampValue(app: AppStampPointer, account: AccountDrives): string {
  return resolvedDrive(app, account)?.batchID.toHex() ?? NO_POSTAGE_STAMP
}

/**
 * The drive the connect window's picker starts on. A site with a live drive of
 * its own starts there, and a site set to no drive stays on none. A site with
 * no pick, or whose drive is gone or has expired, is offered the account
 * default when it has not expired, and only the person's "Go to app" makes it
 * the site's drive. An expired drive is listed but not choosable, so starting
 * on one would let "Go to app" keep it.
 */
export function connectPickerStart(
  app: AppStampPointer,
  account: AccountDrives,
  now = Date.now(),
): string {
  const isLive = (drive: PostageStamp) => describeDrive(drive, now).status !== 'expired'
  const own = resolvedDrive(app, account)
  if (own && isLive(own)) return own.batchID.toHex()
  if (app.postageStampBatchID === NO_POSTAGE_STAMP) return NO_POSTAGE_STAMP
  const fallback = account.defaultPostageStampBatchID
  const offered = fallback && account.stamps.find((drive) => drive.batchID.equals(fallback))
  if (!offered || !isLive(offered)) return NO_POSTAGE_STAMP
  return offered.batchID.toHex()
}

/**
 * The choice to store for a select value. A drive is stored by its batch,
 * the account default included, so the site keeps the drive it was given
 * when the default later moves.
 */
export function appStampChoice(value: string): AppStampChoice {
  if (value === NO_POSTAGE_STAMP) return NO_POSTAGE_STAMP
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

/**
 * "Chat · 50% used · 12 days left", or "No drive". A site still waiting for
 * the person to confirm its drive in the connect window says so instead,
 * because its frame holds no stamp until then, whatever drive it points at.
 */
export function appStampSummary(
  app: AppStampState,
  account: AccountDrives,
  now = Date.now(),
): string {
  if (app.stampPending) return AWAITING_CONFIRM_SUMMARY
  const drive = resolvedDrive(app, account)
  if (!drive) return 'No drive'
  const display = describeDrive(drive, now)
  const timeLeft = display.status === 'expired' ? 'Expired' : display.timeLeftLabel
  return [display.name, `${display.usedPercent}% used`, timeLeft].filter(Boolean).join(' · ')
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
