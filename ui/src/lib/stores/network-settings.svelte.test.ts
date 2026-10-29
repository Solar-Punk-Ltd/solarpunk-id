// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_BEE_NODE_URL } from '@solarpunkltd/swarm-id'
import { STORAGE_KEY_NETWORK_SETTINGS } from '@solarpunkltd/swarm-id/internal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const publicEnv = vi.hoisted((): Record<string, string | undefined> => ({}))

vi.mock('$app/environment', () => ({ browser: true, dev: false }))
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }))

const CONFIGURED_DEFAULT_URL = 'https://bee.example.com/'
const SAVED_URL = 'https://saved-node.example.com/'

let store: Map<string, string>

/** A fresh store module, so it reads the build setting and storage again. */
async function loadStore() {
  vi.resetModules()
  const { networkSettingsStore } = await import('$lib/stores/network-settings.svelte')
  return networkSettingsStore
}

beforeEach(() => {
  delete publicEnv.PUBLIC_DEFAULT_BEE_NODE_URL
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  })
})

describe('networkSettingsStore', () => {
  it('starts on the built-in default node when the build names none', async () => {
    const settings = await loadStore()

    expect(settings.beeNodeUrl).toBe(DEFAULT_BEE_NODE_URL)
  })

  it('starts on the node the build names when the person saved none', async () => {
    publicEnv.PUBLIC_DEFAULT_BEE_NODE_URL = CONFIGURED_DEFAULT_URL

    const settings = await loadStore()

    expect(settings.beeNodeUrl).toBe(CONFIGURED_DEFAULT_URL)
  })

  it("keeps the person's saved node over the one the build names", async () => {
    publicEnv.PUBLIC_DEFAULT_BEE_NODE_URL = CONFIGURED_DEFAULT_URL
    store.set(
      STORAGE_KEY_NETWORK_SETTINGS,
      JSON.stringify({ beeNodeUrl: SAVED_URL, gnosisRpcUrl: 'https://rpc.example.com/' }),
    )

    const settings = await loadStore()

    expect(settings.beeNodeUrl).toBe(SAVED_URL)
  })

  it('goes back to the node the build names on reset', async () => {
    publicEnv.PUBLIC_DEFAULT_BEE_NODE_URL = CONFIGURED_DEFAULT_URL
    const settings = await loadStore()
    settings.updateSettings({ beeNodeUrl: SAVED_URL, gnosisRpcUrl: 'https://rpc.example.com/' })

    settings.reset()

    expect(settings.beeNodeUrl).toBe(CONFIGURED_DEFAULT_URL)
    expect(store.has(STORAGE_KEY_NETWORK_SETTINGS)).toBe(false)
  })
})
