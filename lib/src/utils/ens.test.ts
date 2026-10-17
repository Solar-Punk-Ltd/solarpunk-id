// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { keccak_256 } from "@noble/hashes/sha3"
import { describe, expect, it } from "vitest"
import { ensNamehash } from "./ens"
import { uint8ArrayToHex } from "./hex"

const WORD_BYTES = 32

describe("ensNamehash", () => {
  const label = (text: string) => keccak_256(new TextEncoder().encode(text))
  const join = (node: Uint8Array, text: string) => {
    const both = new Uint8Array(WORD_BYTES * 2)
    both.set(node)
    both.set(label(text), WORD_BYTES)
    return keccak_256(both)
  }

  it("hashes the root to zero", () => {
    expect(ensNamehash("")).toBe(`0x${"00".repeat(WORD_BYTES)}`)
  })

  // EIP-137: namehash(label.rest) = keccak256(namehash(rest) || keccak256(label)).
  it("folds labels from the right", () => {
    const eth = join(new Uint8Array(WORD_BYTES), "eth")
    const name = join(eth, "solarpunkid")
    expect(ensNamehash("eth")).toBe(`0x${uint8ArrayToHex(eth)}`)
    expect(ensNamehash("solarpunkid.eth")).toBe(`0x${uint8ArrayToHex(name)}`)
  })
})
