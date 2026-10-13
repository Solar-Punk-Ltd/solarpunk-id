// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { gnosis, mainnet } from 'viem/chains'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { connectAccessWallet } from './onboard'

const { onboardFactory, setWalletModules, walletConnectModule } = vi.hoisted(() => {
  const setWalletModules = vi.fn()
  return {
    setWalletModules,
    onboardFactory: vi.fn(() => ({
      state: { actions: { setWalletModules } },
      connectWallet: vi.fn(async () => []),
    })),
    walletConnectModule: vi.fn(() => ({ label: 'walletconnect' })),
  }
})

// A build with no `PUBLIC_WALLETCONNECT_PROJECT_ID`, which is every build that
// does not name its own Reown project.
vi.mock('$env/dynamic/public', () => ({ env: {} }))
vi.mock('$app/environment', () => ({ browser: false }))
vi.mock('$app/paths', () => ({ asset: (path: string) => path }))
vi.mock('$lib/components/swarm-mark', () => ({ SWARM_MARK_SVG: '<svg />' }))
vi.mock('$lib/payment/dev-funding', () => ({ devWalletChains: [] }))
vi.mock('$lib/payment/payment-rail', () => ({ WALLET_CHAINS: [mainnet, gnosis] }))
vi.mock('@web3-onboard/core', () => ({ default: onboardFactory }))
vi.mock('@web3-onboard/injected-wallets', () => ({ default: () => ({ label: 'injected' }) }))
vi.mock('@web3-onboard/coinbase', () => ({
  default: (options: { supportedWalletType?: string }) => ({
    label: 'coinbase',
    walletType: options.supportedWalletType ?? 'all',
  }),
}))
vi.mock('@web3-onboard/walletconnect', () => ({ default: walletConnectModule }))

const INJECTED = { label: 'injected' }
const COINBASE = { label: 'coinbase', walletType: 'all' }
const COINBASE_EOA = { label: 'coinbase', walletType: 'eoaOnly' }

describe('the wallet picker without a WalletConnect project id', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, removeItem: vi.fn() })
    setWalletModules.mockClear()
  })

  it('offers the injected wallets and Coinbase Wallet, and no WalletConnect', () => {
    expect(walletConnectModule).not.toHaveBeenCalled()
    expect(onboardFactory).toHaveBeenCalledWith(
      expect.objectContaining({ wallets: [INJECTED, COINBASE] }),
    )
  })

  it('offers the same wallets to unlock an account with, Coinbase as an EOA', async () => {
    await connectAccessWallet()

    expect(setWalletModules).toHaveBeenNthCalledWith(1, [INJECTED, COINBASE_EOA])
    expect(setWalletModules).toHaveBeenLastCalledWith([INJECTED, COINBASE])
  })
})
