// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { type WalletState } from '@web3-onboard/core'
import { type Hex, parseSignature, serializeSignature } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { enrollWalletKeySource, unlockWalletForLink, unlockWalletKeySource } from './eth-wallet'
import { connectAccessWallet } from './onboard'

vi.mock('$lib/crypto/onboard', () => ({ connectAccessWallet: vi.fn() }))

/** anvil's account #0 — a throwaway key. */
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const account = privateKeyToAccount(PRIVATE_KEY)
/** A wallet not on the deterministic list, so enrollment asks it to sign twice. */
const UNLISTED_WALLET = 'WalletConnect'
const LISTED_WALLET = 'MetaMask'
/** An unrelated address, standing in for a smart-contract wallet's. */
const CONTRACT_ADDRESS = '0x000000000000000000000000000000000000dEaD'
/** Order of the secp256k1 group. */
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const SCALAR_HEX_LENGTH = 64
const HEX_RADIX = 16

/**
 * The same signature's high-s twin: `(r, n - s)` with the parity flipped is an
 * equally valid signature that recovers to the same address — what a signer
 * with a random nonce looks like to the ceremony.
 */
function twin(signature: Hex): Hex {
  const { r, s, yParity } = parseSignature(signature)
  const flippedS =
    `0x${(SECP256K1_N - BigInt(s)).toString(HEX_RADIX).padStart(SCALAR_HEX_LENGTH, '0')}` as Hex
  return serializeSignature({ r, s: flippedS, yParity: 1 - yParity })
}

/** A fake EIP-1193 wallet, connected through the mocked onboard picker. */
function connect(
  sign: (message: string, call: number) => Promise<Hex>,
  { address = account.address, label = UNLISTED_WALLET }: { address?: string; label?: string } = {},
) {
  let calls = 0
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method !== 'personal_sign') {
      throw new Error(`unexpected ${method}`)
    }
    return sign(params?.[0] as string, calls++)
  })
  vi.mocked(connectAccessWallet).mockResolvedValue([
    { label, accounts: [{ address }], provider: { request } },
  ] as unknown as WalletState[])
  return request
}

const deterministic = (message: string) => account.signMessage({ message })
const randomNonce = async (message: string, call: number) => {
  const signature = await account.signMessage({ message })
  return call % 2 === 0 ? signature : twin(signature)
}

describe('enrollWalletKeySource', () => {
  beforeEach(() => vi.mocked(connectAccessWallet).mockReset())

  it('accepts a wallet that signs the same bytes twice', async () => {
    const request = connect(deterministic)

    const source = await enrollWalletKeySource()

    expect(request).toHaveBeenCalledTimes(2)
    const message = request.mock.calls[0][0].params?.[0] as string
    expect(source).toEqual({
      walletAddress: account.address,
      signature: await deterministic(message),
    })
  })

  it('refuses a wallet whose second signature differs from the first', async () => {
    const request = connect(randomNonce)

    await expect(enrollWalletKeySource()).rejects.toThrow(/signs the same message differently/)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('trusts a listed wallet after one signature', async () => {
    const request = connect(randomNonce, { label: LISTED_WALLET })

    const source = await enrollWalletKeySource()

    expect(request).toHaveBeenCalledTimes(1)
    expect(source.walletAddress).toBe(account.address)
  })

  it('refuses a listed wallet whose signature does not recover to its address', async () => {
    connect(deterministic, { address: CONTRACT_ADDRESS, label: LISTED_WALLET })

    await expect(enrollWalletKeySource()).rejects.toThrow(/not supported/)
  })

  it('refuses a signature that does not recover to the wallet address', async () => {
    const request = connect(deterministic, { address: CONTRACT_ADDRESS })

    await expect(enrollWalletKeySource()).rejects.toThrow(/not supported/)
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe('unlockWalletKeySource', () => {
  beforeEach(() => vi.mocked(connectAccessWallet).mockReset())

  it('signs once', async () => {
    const request = connect(randomNonce)

    const source = await unlockWalletKeySource()

    expect(request).toHaveBeenCalledTimes(1)
    expect(source.walletAddress).toBe(account.address)
  })

  it('refuses a signature that does not recover to the wallet address', async () => {
    connect(deterministic, { address: CONTRACT_ADDRESS })

    await expect(unlockWalletKeySource()).rejects.toThrow(/not supported/)
  })
})

describe('unlockWalletForLink', () => {
  beforeEach(() => vi.mocked(connectAccessWallet).mockReset())

  const LINK_MESSAGE = 'Swarm ID wallet link v1\nAccount: 0x00\nWallet: 0x00\nDate: x'
  /** Another throwaway key, for a wallet whose link signature is someone else's. */
  const otherAccount = privateKeyToAccount(`0x${'59'.repeat(32)}`)

  it('connects once, signs the unlock message, then the link', async () => {
    const request = connect(deterministic)

    const wallet = await unlockWalletForLink()
    const signature = await wallet.signLink(LINK_MESSAGE)

    expect(connectAccessWallet).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(2)
    expect(wallet.source.walletAddress).toBe(account.address)
    expect(signature).toBe(await deterministic(LINK_MESSAGE))
  })

  it('refuses a link signature that does not recover the wallet', async () => {
    connect((message) =>
      message === LINK_MESSAGE ? otherAccount.signMessage({ message }) : deterministic(message),
    )

    const wallet = await unlockWalletForLink()

    await expect(wallet.signLink(LINK_MESSAGE)).rejects.toThrow(/smart-contract wallet/)
  })
})
