// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Web3-Onboard looks up the ENS name of every wallet that connects, over a
 * public Ethereum endpoint baked into its own chain table, whatever rpcUrl the
 * app configures. That told the endpoint which wallet opened Swarm ID, and
 * nothing in Swarm ID reads the answer. `patches/@web3-onboard__core@*.patch`
 * makes the lookup answer nothing, and this reads the installed copy to see
 * that the patch is in it.
 */
const ONBOARD_DIST = join(
  dirname(createRequire(import.meta.url).resolve('@web3-onboard/core/package.json')),
  'dist',
)
const ENS_LOOKUP = 'async function getEns(address, chain) {'
const ANSWERS_NOTHING_FIRST = /^\s*(?:\/\/[^\n]*\n\s*)*return null;/

function ensLookupBodies(): string[] {
  return readdirSync(ONBOARD_DIST)
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(join(ONBOARD_DIST, name), 'utf8'))
    .flatMap((source) => source.split(ENS_LOOKUP).slice(1))
}

describe('the wallet picker', () => {
  it('reads no ENS name when a wallet connects', () => {
    const bodies = ensLookupBodies()

    expect(bodies).not.toHaveLength(0)
    for (const body of bodies) {
      expect(body).toMatch(ANSWERS_NOTHING_FIRST)
    }
  })
})
