// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Signing the wallet link (docs/Wallet-Link.md) for "Show my ENS name on
 * sites": the wallet an account is secured with signs the link message, and
 * the account's own key countersigns it.
 *
 * The same wallet first unlocks the account, so the wallet the link names is
 * always the one that secures the account on this device: another wallet
 * fails to decrypt the seed and is never asked to sign the link.
 */
import { type WalletLink, buildWalletLinkMessage, hexToUint8Array } from '@solarpunkltd/swarm-id'
import { countersignWalletLink, decryptSeed } from '@solarpunkltd/swarm-id/internal'

import { deriveWalletKey, unlockWalletForLink } from '$lib/crypto/eth-wallet'
import { strip0x } from '$lib/crypto/hex'
import { privateKeyFromEntropy } from '$lib/crypto/mnemonic'
import type { Account } from '$lib/types'

/**
 * Ask the account's wallet to unlock it and sign a fresh link, countersign it
 * with the account key, and return it. The seed is zeroed before this returns.
 *
 * @throws with a message for the person when the account is not secured with
 *   a wallet, the wallet is not the one that secures it, or its signature does
 *   not match its own address (a smart-contract wallet).
 */
export async function createWalletLink(account: Account): Promise<WalletLink> {
  const { access, encryptedSeed } = account.vault
  if (access.type !== 'eth-wallet') {
    throw new Error('Only an account secured with a wallet can show an ENS name.')
  }
  const wallet = await unlockWalletForLink()
  const key = await deriveWalletKey(wallet.source, hexToUint8Array(access.encryptionSalt))
  let seed: Uint8Array
  try {
    seed = await decryptSeed(encryptedSeed, key)
  } catch {
    throw new Error('This is not the wallet this account is secured with.')
  }
  try {
    const message = buildWalletLinkMessage({
      account: account.id.toHex(),
      wallet: wallet.source.walletAddress,
      date: new Date(),
    })
    const walletSignature = await wallet.signLink(message)
    return countersignWalletLink(strip0x(privateKeyFromEntropy(seed)), message, walletSignature)
  } finally {
    seed.fill(0)
  }
}
