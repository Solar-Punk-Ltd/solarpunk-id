// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The verdicts are the deliverable of #584: the device they run on has no
 * console (Safari on iOS needs a Mac and a cable), so a wrong verdict is not
 * something the tester can go behind and check.
 */
import { describe, expect, it } from 'vitest'

import { formatReport, runChecks } from './safari-check'
import type { CheckInput, CheckResult } from './safari-check'

function verdictOf(results: CheckResult[], id: string): string {
  const found = results.find((result) => result.id === id)
  if (!found) throw new Error(`no check with id ${id}`)
  return found.verdict
}

function connected(overrides: Partial<NonNullable<CheckInput['connection']>> = {}) {
  return {
    storagePartitioned: true,
    uploadMode: 'user-stamp' as const,
    ...overrides,
  }
}

describe('runChecks', () => {
  it('reports nothing as known before a connection', () => {
    const results = runChecks({})
    for (const result of results) expect(result.verdict).toBe('unknown')
  })

  // A run where nothing partitioned says nothing about ITP — reporting the
  // handover as a pass there would be the test lying to us.
  it('does not credit the handover when storage was never partitioned', () => {
    const results = runChecks({
      connection: connected({ storagePartitioned: false }),
    })
    expect(verdictOf(results, 'partitioned')).toBe('fail')
    expect(verdictOf(results, 'handover')).toBe('unknown')
  })

  // The proxy sets `storagePartitioned` in exactly one place — the `setSecret`
  // handler — so a partitioned session that is authenticated at all got there
  // through `window.opener`.
  it('credits the handover on a partitioned session, whatever it can write', () => {
    expect(verdictOf(runChecks({ connection: connected() }), 'handover')).toBe('pass')
    expect(
      verdictOf(
        runChecks({
          connection: connected({ uploadMode: 'unavailable', uploadUnavailableReason: 'no-stamp' }),
        }),
        'handover',
      ),
    ).toBe('pass')
  })

  // The run that made this split necessary: an iPhone connected an account
  // created fresh in the popup, and the harness reported the missing drive as a
  // failed `window.opener` handover — a claim about ITP, from a run that never
  // reached the writer path at all.
  it('replays the first device report: handover passed, the writer was never exercised', () => {
    const results = runChecks({
      connection: {
        storagePartitioned: true,
        uploadMode: 'unavailable',
        uploadUnavailableReason: 'no-stamp',
      },
    })
    expect(verdictOf(results, 'partitioned')).toBe('pass')
    expect(verdictOf(results, 'handover')).toBe('pass')
    expect(verdictOf(results, 'writer')).toBe('unknown')
    expect(results.find((result) => result.id === 'writer')?.detail).toContain('no drive')
    // Nothing here is a failure — the run is incomplete, not negative.
    expect(results.some((result) => result.verdict === 'fail')).toBe(false)
  })

  it('credits the writer when a partitioned session holds its own stamp', () => {
    const results = runChecks({ connection: connected() })
    expect(verdictOf(results, 'writer')).toBe('pass')
  })

  // Ours to fix, unlike a missing drive — so this is the one that goes red.
  it('fails the writer when the stamper would not build', () => {
    const results = runChecks({
      connection: connected({
        uploadMode: 'unavailable',
        uploadUnavailableReason: 'stamper-failed',
      }),
    })
    expect(verdictOf(results, 'writer')).toBe('fail')
    expect(verdictOf(results, 'handover')).toBe('pass')
  })

  // `uploadUnavailableReason` is optional on the wire, so this page running
  // against an older identity deployment reaches the fallback branch. Version
  // skew is not a broken write path — red there would be the same misreading
  // this split exists to stop.
  it('does not fail the writer when the proxy sent no reason at all', () => {
    const results = runChecks({
      connection: connected({ uploadMode: 'unavailable' }),
    })
    expect(verdictOf(results, 'writer')).toBe('unknown')
    expect(verdictOf(results, 'handover')).toBe('pass')
    expect(results.find((result) => result.id === 'writer')?.detail).toContain('older')
  })

  // Uploads work, but through the dApp's gateway rather than the account's own
  // stamp — so it says nothing about the handed-over write path either way.
  it('does not judge the writer when uploads run on a subsidised gateway', () => {
    const results = runChecks({
      connection: connected({ uploadMode: 'subsidised' }),
    })
    expect(verdictOf(results, 'writer')).toBe('unknown')
  })

  it('carries the upload error into the verdict, since the device has no console', () => {
    const results = runChecks({
      connection: connected(),
      uploadRoundTrip: 'failed',
      uploadError: 'invalid batch id',
    })
    expect(verdictOf(results, 'upload')).toBe('fail')
    expect(results.find((result) => result.id === 'upload')?.detail).toContain('invalid batch id')
  })

  // The proxy no longer hands its device id to apps, which gave each site a
  // stable identifier for the browser, so this
  // page has nothing to compare across reloads and makes no claim about it.
  it('makes no claim about storage persistence', () => {
    const results = runChecks({ connection: connected() })
    expect(results.map((result) => result.id)).not.toContain('persistence')
  })

  it('reports the upload round trip only once attempted', () => {
    expect(verdictOf(runChecks({ connection: connected() }), 'upload')).toBe('unknown')
    expect(verdictOf(runChecks({ connection: connected(), uploadRoundTrip: 'ok' }), 'upload')).toBe(
      'pass',
    )
    expect(
      verdictOf(runChecks({ connection: connected(), uploadRoundTrip: 'failed' }), 'upload'),
    ).toBe('fail')
  })
})

describe('formatReport', () => {
  // The tester pastes this back; it has to carry the verdicts AND the device
  // it ran on, or a result cannot be attributed to an iOS version.
  it('renders every verdict and the environment', () => {
    const report = formatReport(runChecks({ connection: connected() }), {
      userAgent: 'iPhone',
      idOrigin: 'https://swarm-id.snaha.net',
    })
    expect(report).toContain('iPhone')
    expect(report).toContain('https://swarm-id.snaha.net')
    expect(report).toContain('[PASS] window.opener handover survived')
    expect(report).not.toContain('Partitioned storage survives reloads')
  })
})
