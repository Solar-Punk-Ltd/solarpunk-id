// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { EthAddress, PrivateKey } from '@ethersphere/bee-js'
import { uint8ArrayToHex, verifyWalletLink } from '@solarpunkltd/swarm-id'
import { encryptSeed } from '@solarpunkltd/swarm-id/internal'
import { type WalletState } from '@web3-onboard/core'
import { type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Account } from '$lib/types'

import { deriveWalletKey } from './eth-wallet'
import { strip0x } from './hex'
import { privateKeyFromEntropy } from './mnemonic'
import { connectAccessWallet } from './onboard'
import { createWalletLink } from './wallet-link'

vi.mock('$lib/crypto/onboard', () => ({ connectAccessWallet: vi.fn() }))

/** Two throwaway wallets with obviously fake keys. */
const wallet = privateKeyToAccount(`0x${'ab'.repeat(32)}`)
const otherWallet = privateKeyToAccount(`0x${'cd'.repeat(32)}`)
const SEED_BYTES = 16
const SEED_FILL = 42
const SALT_BYTES = 32
const SALT_FILL = 7
const SALT = new Uint8Array(SALT_BYTES).fill(SALT_FILL)
const UNLOCK_MESSAGE =
  'Swarm ID\n\nSign this message to encrypt your recovery phrase on this device.\n\nv1'

/** A fake EIP-1193 wallet, connected through the mocked onboard picker. */
function connect(
  signer: { address: string; signMessage(args: { message: string }): Promise<Hex> },
  signLink?: (message: string) => Promise<Hex>,
) {
  const request = vi.fn(async ({ params }: { method: string; params?: unknown[] }) => {
    const message = params?.[0] as string
    if (signLink && message.startsWith('Swarm ID wallet link v1')) return signLink(message)
    return signer.signMessage({ message })
  })
  vi.mocked(connectAccessWallet).mockResolvedValue([
    { label: 'MetaMask', accounts: [{ address: signer.address }], provider: { request } },
  ] as unknown as WalletState[])
  return request
}

/** An account secured with `wallet`, as enrollment would leave it on this device. */
async function walletSecuredAccount(): Promise<{ account: Account; address: string }> {
  const seed = new Uint8Array(SEED_BYTES).fill(SEED_FILL)
  const address = new PrivateKey(strip0x(privateKeyFromEntropy(seed))).publicKey().address()
  const unlock = await wallet.signMessage({ message: UNLOCK_MESSAGE })
  const key = await deriveWalletKey({ walletAddress: wallet.address, signature: unlock }, SALT)
  const account = {
    id: new EthAddress(address.toHex()),
    vault: {
      access: { type: 'eth-wallet', encryptionSalt: uint8ArrayToHex(SALT) },
      encryptedSeed: await encryptSeed(seed, key),
    },
  } as unknown as Account
  return { account, address: address.toHex() }
}

describe('createWalletLink', () => {
  beforeEach(() => vi.mocked(connectAccessWallet).mockReset())

  it('makes a link the wallet and the account both signed', async () => {
    const { account, address } = await walletSecuredAccount()
    const request = connect(wallet)

    const link = await createWalletLink(account)

    expect(request).toHaveBeenCalledTimes(2)
    expect(verifyWalletLink(link, { account: address })).toEqual({
      account: `0x${address}`,
      wallet: wallet.address.toLowerCase(),
      date: expect.any(String),
    })
  })

  it('refuses an account that is not secured with a wallet', async () => {
    const { account } = await walletSecuredAccount()
    const passkeyAccount = {
      id: account.id,
      vault: { ...account.vault, access: { type: 'passkey', credentialId: 'x' } },
    } as unknown as Account

    await expect(createWalletLink(passkeyAccount)).rejects.toThrow(/secured with a wallet/)
    expect(connectAccessWallet).not.toHaveBeenCalled()
  })

  it('refuses another wallet before asking it to sign the link', async () => {
    const { account } = await walletSecuredAccount()
    const request = connect(otherWallet)

    await expect(createWalletLink(account)).rejects.toThrow(/not the wallet/)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('refuses a wallet whose link signature does not match its address', async () => {
    const { account } = await walletSecuredAccount()
    connect(wallet, (message) => otherWallet.signMessage({ message }))

    await expect(createWalletLink(account)).rejects.toThrow(/smart-contract wallet/)
  })
})
