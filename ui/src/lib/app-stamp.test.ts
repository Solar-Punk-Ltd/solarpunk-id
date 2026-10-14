// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { BatchId, PrivateKey } from '@ethersphere/bee-js'
import { NO_POSTAGE_STAMP, type PostageStamp } from '@solarpunkltd/swarm-id/internal'
import { describe, expect, it } from 'vitest'

import {
  appChosenDriveLine,
  appSiteFromTarget,
  appStampChoice,
  appStampOptions,
  appStampSummary,
  appStampValue,
  appsTabHash,
} from './app-stamp'

const DAY_SECONDS = 24 * 60 * 60
const NOW = Date.UTC(2026, 9, 15)
const DEFAULT_HEX = 'a'.repeat(64)
const OTHER_HEX = 'b'.repeat(64)
const EXPIRED_HEX = 'c'.repeat(64)
const SITE = 'https://site.example.com'

function makeDrive(batchHex: string, overrides: Partial<PostageStamp> = {}): PostageStamp {
  return {
    batchID: new BatchId(batchHex),
    signerKey: new PrivateKey('d'.repeat(64)),
    depth: 24,
    amount: 100000000n,
    bucketDepth: 16,
    blockNumber: 1,
    immutableFlag: false,
    utilization: 0.25,
    usable: true,
    exists: true,
    batchTTL: 12 * DAY_SECONDS,
    createdAt: NOW,
    ...overrides,
  }
}

const defaultDrive = makeDrive(DEFAULT_HEX, { name: 'Main' })
const otherDrive = makeDrive(OTHER_HEX, { name: 'Chat', utilization: 0.5 })
const expiredDrive = makeDrive(EXPIRED_HEX, { name: 'Old', batchTTL: 0 })

const account = {
  stamps: [defaultDrive, otherDrive, expiredDrive],
  defaultPostageStampBatchID: new BatchId(DEFAULT_HEX),
}

describe('appStampValue', () => {
  it('names the account default for a site that follows it', () => {
    expect(appStampValue({ postageStampBatchID: undefined }, account)).toBe(DEFAULT_HEX)
  })

  it("names the site's own drive", () => {
    expect(appStampValue({ postageStampBatchID: new BatchId(OTHER_HEX) }, account)).toBe(OTHER_HEX)
  })

  it('names none for a site set to no drive', () => {
    expect(appStampValue({ postageStampBatchID: NO_POSTAGE_STAMP }, account)).toBe(NO_POSTAGE_STAMP)
  })

  // What the site's frame does: a removed drive's pointer falls through to
  // the default, so the screen shows the default rather than a drive the site
  // no longer uses.
  it('names the drive the site falls through to when its own was removed', () => {
    const removed = new BatchId('e'.repeat(64))
    expect(appStampValue({ postageStampBatchID: removed }, account)).toBe(DEFAULT_HEX)
  })

  it('names none when the account has no drive', () => {
    expect(
      appStampValue(
        { postageStampBatchID: undefined },
        { stamps: [], defaultPostageStampBatchID: undefined },
      ),
    ).toBe(NO_POSTAGE_STAMP)
  })
})

describe('appStampChoice', () => {
  it('stores the account default as following it, as the connect window does', () => {
    expect(appStampChoice(DEFAULT_HEX, account)).toBeUndefined()
  })

  it('stores another drive by its batch', () => {
    const choice = appStampChoice(OTHER_HEX, account)
    expect(choice).toBeInstanceOf(BatchId)
    expect((choice as BatchId).toHex()).toBe(OTHER_HEX)
  })

  it('stores none', () => {
    expect(appStampChoice(NO_POSTAGE_STAMP, account)).toBe(NO_POSTAGE_STAMP)
  })
})

describe('appStampOptions', () => {
  it('lists every drive, marks the default, and ends with no drive', () => {
    expect(appStampOptions(account, NOW)).toEqual([
      { value: DEFAULT_HEX, label: 'Main (default)', disabled: false },
      { value: OTHER_HEX, label: 'Chat', disabled: false },
      { value: EXPIRED_HEX, label: 'Old (expired)', disabled: true },
      { value: NO_POSTAGE_STAMP, label: 'No drive' },
    ])
  })
})

describe('appStampSummary', () => {
  it('says how full the drive is and how long it has left', () => {
    expect(appStampSummary({ postageStampBatchID: new BatchId(OTHER_HEX) }, account, NOW)).toBe(
      'Chat · 50% used · 12 days left',
    )
  })

  it('says when the drive has expired', () => {
    expect(appStampSummary({ postageStampBatchID: new BatchId(EXPIRED_HEX) }, account, NOW)).toBe(
      'Old · 25% used · Expired',
    )
  })

  it('says the site has no drive', () => {
    expect(appStampSummary({ postageStampBatchID: NO_POSTAGE_STAMP }, account, NOW)).toBe(
      'No drive',
    )
  })
})

describe('appSiteFromTarget', () => {
  it('reads the site a link names', () => {
    expect(appSiteFromTarget([encodeURIComponent(SITE)])).toBe(SITE)
  })

  it('reads nothing from a link that names no site', () => {
    expect(appSiteFromTarget([])).toBeUndefined()
  })

  it('reads nothing from a link that does not decode', () => {
    expect(appSiteFromTarget(['%E0%A4%A'])).toBeUndefined()
  })
})

// The connect window's done screen on a reconnect: a site that was given its
// own drive, or none, says so, since nothing else on that screen would.
describe('appChosenDriveLine', () => {
  it('names the drive a site was given', () => {
    expect(appChosenDriveLine({ postageStampBatchID: new BatchId(OTHER_HEX) }, account)).toBe(
      'This app uses the drive Chat.',
    )
  })

  it('says a site set to no drive cannot stamp', () => {
    expect(appChosenDriveLine({ postageStampBatchID: NO_POSTAGE_STAMP }, account)).toBe(
      'No drive, this site cannot stamp.',
    )
  })

  it('says nothing for a site that follows the default', () => {
    expect(appChosenDriveLine({ postageStampBatchID: undefined }, account)).toBeUndefined()
  })
})

describe('appsTabHash', () => {
  it('links the Apps tab to one site, the reverse of appSiteFromTarget', () => {
    const hash = appsTabHash(SITE)
    expect(hash).toBe(`#apps/${encodeURIComponent(SITE)}`)
    expect(appSiteFromTarget(hash.slice(1).split('/').slice(1))).toBe(SITE)
  })
})
