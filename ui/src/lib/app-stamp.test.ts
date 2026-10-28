// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { BatchId, PrivateKey } from '@ethersphere/bee-js'
import { NO_POSTAGE_STAMP, type PostageStamp } from '@solarpunkltd/swarm-id/internal'
import { describe, expect, it } from 'vitest'

import {
  appSiteFromTarget,
  appStampChoice,
  appStampOptions,
  appStampSummary,
  appStampValue,
  connectPickToStore,
  connectPickerStart,
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

// A site uses only the drive the person picked for it, and the account
// default never stands in for a missing pick.
describe('appStampValue', () => {
  it('names no drive for a site with no pick, though the account has a default', () => {
    expect(appStampValue({ postageStampBatchID: undefined }, account)).toBe(NO_POSTAGE_STAMP)
  })

  it("names the site's own drive", () => {
    expect(appStampValue({ postageStampBatchID: new BatchId(OTHER_HEX) }, account)).toBe(OTHER_HEX)
  })

  it('names none for a site set to no drive', () => {
    expect(appStampValue({ postageStampBatchID: NO_POSTAGE_STAMP }, account)).toBe(NO_POSTAGE_STAMP)
  })

  // What the site's frame does: a removed drive leaves the site with none,
  // so the screen shows no drive rather than the default.
  it("names no drive when the site's own was removed", () => {
    const removed = new BatchId('e'.repeat(64))
    expect(appStampValue({ postageStampBatchID: removed }, account)).toBe(NO_POSTAGE_STAMP)
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

describe('connectPickToStore', () => {
  const ownExpired = { postageStampBatchID: new BatchId(EXPIRED_HEX) }
  const allExpired = { ...account, defaultPostageStampBatchID: new BatchId(EXPIRED_HEX) }

  it('leaves the pick as it is when the window starts on no drive the person did not choose', () => {
    const start = connectPickerStart(ownExpired, allExpired, NOW)
    expect(connectPickToStore(ownExpired, allExpired, start, false)).toBeUndefined()
  })

  it('stores no drive when the person picked it', () => {
    expect(connectPickToStore(ownExpired, allExpired, NO_POSTAGE_STAMP, true)).toBe(
      NO_POSTAGE_STAMP,
    )
  })

  it("stores the live default the window offered in place of the site's expired drive", () => {
    const start = connectPickerStart(ownExpired, account, NOW)
    expect(connectPickToStore(ownExpired, account, start, false)).toEqual(new BatchId(DEFAULT_HEX))
  })

  it("leaves the pick as it is when the site's drive is the one selected", () => {
    const own = { postageStampBatchID: new BatchId(OTHER_HEX) }
    expect(connectPickToStore(own, account, OTHER_HEX, true)).toBeUndefined()
  })
})

describe('appStampChoice', () => {
  // A pick of the default is a pick of that drive: the site does not move
  // when the default later does.
  it('stores the account default by its batch', () => {
    const choice = appStampChoice(DEFAULT_HEX)
    expect(choice).toBeInstanceOf(BatchId)
    expect((choice as BatchId).toHex()).toBe(DEFAULT_HEX)
  })

  it('stores another drive by its batch', () => {
    const choice = appStampChoice(OTHER_HEX)
    expect(choice).toBeInstanceOf(BatchId)
    expect((choice as BatchId).toHex()).toBe(OTHER_HEX)
  })

  it('stores none', () => {
    expect(appStampChoice(NO_POSTAGE_STAMP)).toBe(NO_POSTAGE_STAMP)
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

// The connect window offers the default to a site with no pick, and the
// person's "Go to app" is what picks it.
describe('connectPickerStart', () => {
  it("starts on the site's own drive", () => {
    expect(connectPickerStart({ postageStampBatchID: new BatchId(OTHER_HEX) }, account, NOW)).toBe(
      OTHER_HEX,
    )
  })

  it('offers the account default to a site with no pick', () => {
    expect(connectPickerStart({ postageStampBatchID: undefined }, account, NOW)).toBe(DEFAULT_HEX)
  })

  it("offers the account default when the site's own drive was removed", () => {
    const removed = new BatchId('e'.repeat(64))
    expect(connectPickerStart({ postageStampBatchID: removed }, account, NOW)).toBe(DEFAULT_HEX)
  })

  it('keeps a site set to no drive on no drive', () => {
    expect(connectPickerStart({ postageStampBatchID: NO_POSTAGE_STAMP }, account)).toBe(
      NO_POSTAGE_STAMP,
    )
  })

  it('offers no drive when the default has expired', () => {
    expect(
      connectPickerStart(
        { postageStampBatchID: undefined },
        { ...account, defaultPostageStampBatchID: new BatchId(EXPIRED_HEX) },
      ),
    ).toBe(NO_POSTAGE_STAMP)
  })

  it("offers the account default, not the site's own drive, once the site's own drive has expired", () => {
    expect(
      connectPickerStart({ postageStampBatchID: new BatchId(EXPIRED_HEX) }, account, NOW),
    ).toBe(DEFAULT_HEX)
  })

  it("offers no drive when the site's own drive and the default have both expired", () => {
    expect(
      connectPickerStart(
        { postageStampBatchID: new BatchId(EXPIRED_HEX) },
        { ...account, defaultPostageStampBatchID: new BatchId(EXPIRED_HEX) },
        NOW,
      ),
    ).toBe(NO_POSTAGE_STAMP)
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

  it('says a site with no pick has no drive, though the account has a default', () => {
    expect(appStampSummary({ postageStampBatchID: undefined }, account, NOW)).toBe('No drive')
  })

  it('says the site has no drive', () => {
    expect(appStampSummary({ postageStampBatchID: NO_POSTAGE_STAMP }, account, NOW)).toBe(
      'No drive',
    )
  })

  it('says the site waits for the person to confirm its drive', () => {
    expect(
      appStampSummary(
        { postageStampBatchID: new BatchId(OTHER_HEX), stampPending: true },
        account,
        NOW,
      ),
    ).toBe('Waiting for you to confirm in the sign-in window.')
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
