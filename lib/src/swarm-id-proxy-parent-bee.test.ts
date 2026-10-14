// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The site's own Bee address: a site that embeds the frame names the node its
 * reads and writes go through, for its own session only. The person's own
 * network setting keeps applying everywhere else, the identity site included.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// Rollup-only virtual module (see rollup.config.js), not resolvable in vitest
vi.mock("virtual:stamp-worker-code", () => ({ default: "" }))

import { DEFAULT_BEE_NODE_URL } from "./schemas"
import { SwarmIdProxy } from "./swarm-id-proxy"
import { allowingSites } from "./test-fixtures"
import {
  IframeToParentMessageSchema,
  STORAGE_KEY_NETWORK_SETTINGS,
} from "./types"

type ProxyInternals = {
  authenticated: boolean
  appSecret: string
  bee: { url: string }
  nodeBee: { url: string }
  accountBee: { url: string }
  buildConnectionInfo: () => { uploadMode: string; beeApiUrl?: string }
  ensureCanUpload: () => void
  withModeAwareWriteLock: <T>(
    targetOptions: undefined,
    operation: (target: unknown) => Promise<T>,
  ) => Promise<T>
}

const internals = (p: SwarmIdProxy): ProxyInternals =>
  p as unknown as ProxyInternals

/** bee-js keeps a client's URL without its trailing slash. */
const clientUrl = (url: string): string => url.replace(/\/$/, "")

const PARENT_ORIGIN = "https://dapp.example.com"
const OTHER_ORIGIN = "https://other-dapp.example.com"
const SITE_BEE_URL = "https://site-bee.example.com/"
const NEXT_SITE_BEE_URL = "https://gateway.example.org/bee/"
const OWN_BEE_URL = "https://own-node.example.com/"
const GATEWAY_URL = "https://subsidised.example.com/"
const APP_SECRET_HEX = "11".repeat(32)
const NETWORK_SETTINGS = (beeNodeUrl: string) =>
  JSON.stringify({ beeNodeUrl, gnosisRpcUrl: "https://rpc.example.com/" })

type MessageListener = (event: MessageEvent) => Promise<void>
type FakeWindow = { postMessage: ReturnType<typeof vi.fn> }

describe("SwarmIdProxy with the site's own Bee address", () => {
  let store: Map<string, string>
  let storageListeners: Array<(event: StorageEvent) => void>
  /** Every message any proxy posted that the client would refuse to parse. */
  let unsendable: unknown[]

  beforeEach(() => {
    vi.restoreAllMocks()
    store = new Map()
    storageListeners = []
    unsendable = []
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    })
  })

  /** A frame embedded by `origin`, as the browser would mount it. */
  function mount(origin: string = PARENT_ORIGIN) {
    const parent: FakeWindow = {
      postMessage: vi.fn((message: unknown) => {
        if ((message as { type?: string })?.type === "proxyInitialized") return
        if (!IframeToParentMessageSchema.safeParse(message).success) {
          unsendable.push(message)
        }
      }),
    }
    const listeners: Record<string, unknown> = {}
    vi.stubGlobal("window", {
      addEventListener: vi.fn((type: string, listener: unknown) => {
        if (type === "storage") {
          storageListeners.push(listener as (event: StorageEvent) => void)
        }
        listeners[type] = listener
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      parent,
      location: { origin: "https://id.example.com", pathname: "/proxy" },
    })
    const proxy = new SwarmIdProxy({
      siteAllowList: allowingSites(PARENT_ORIGIN, OTHER_ORIGIN),
    })
    const listener = listeners["message"] as MessageListener
    const send = (data: unknown, from: string = origin) =>
      listener({
        data,
        origin: from,
        source: parent,
      } as unknown as MessageEvent)
    const sent = (type: string) =>
      parent.postMessage.mock.calls
        .map(([message]) => message)
        .filter((message) => message?.type === type)
    return {
      proxy,
      send,
      sent,
      identify: (fields: Record<string, unknown> = {}) =>
        send({
          type: "parentIdentify",
          requestId: "r1",
          metadata: { name: "Test App" },
          ...fields,
        }),
      setBeeApiUrl: (beeApiUrl: unknown, from?: string) =>
        send({ type: "setBeeApiUrl", requestId: "r9", beeApiUrl }, from),
      lastConnectionInfo: () => sent("connectionInfoChanged").at(-1),
    }
  }

  const setOwnBeeUrl = (beeNodeUrl: string) => {
    store.set(STORAGE_KEY_NETWORK_SETTINGS, NETWORK_SETTINGS(beeNodeUrl))
    storageListeners.forEach((listener) =>
      listener({ key: STORAGE_KEY_NETWORK_SETTINGS } as StorageEvent),
    )
  }

  const uploadTarget = (proxy: SwarmIdProxy) => {
    internals(proxy).ensureCanUpload()
    return internals(proxy).withModeAwareWriteLock(
      undefined,
      async (target) => target,
    )
  }

  describe("given at identify", () => {
    it("reads and writes through the site's address", async () => {
      store.set(STORAGE_KEY_NETWORK_SETTINGS, NETWORK_SETTINGS(OWN_BEE_URL))
      const frame = mount()

      await frame.identify({ beeApiUrl: SITE_BEE_URL })

      expect(internals(frame.proxy).bee.url).toBe(clientUrl(SITE_BEE_URL))
      expect(internals(frame.proxy).nodeBee.url).toBe(clientUrl(SITE_BEE_URL))
      expect(frame.sent("proxyReady")).toHaveLength(1)
      expect(unsendable).toEqual([])
    })

    // The person's devices coordinate, and the session's revocation is
    // checked, through the person's own node, never one a site can answer.
    it("keeps the person's own node for coordinating their account", async () => {
      store.set(STORAGE_KEY_NETWORK_SETTINGS, NETWORK_SETTINGS(OWN_BEE_URL))
      const frame = mount()

      await frame.identify({ beeApiUrl: SITE_BEE_URL })
      await frame.setBeeApiUrl(NEXT_SITE_BEE_URL)

      expect(internals(frame.proxy).accountBee.url).toBe(clientUrl(OWN_BEE_URL))
    })

    it("reports it in checkAuth and in the connection info", async () => {
      const frame = mount()
      await frame.identify({ beeApiUrl: SITE_BEE_URL })

      await frame.send({ type: "checkAuth", requestId: "r2" })

      expect(frame.sent("authStatusResponse")[0]).toMatchObject({
        beeApiUrl: SITE_BEE_URL,
      })
      expect(frame.lastConnectionInfo()).toMatchObject({
        beeApiUrl: SITE_BEE_URL,
      })
      expect(unsendable).toEqual([])
    })

    // The person's own node is theirs to keep private: a site is told only
    // the address it gave itself.
    it("never tells a site the person's own node", async () => {
      store.set(STORAGE_KEY_NETWORK_SETTINGS, NETWORK_SETTINGS(OWN_BEE_URL))
      const frame = mount()
      await frame.identify()

      await frame.send({ type: "checkAuth", requestId: "r2" })

      expect(frame.sent("authStatusResponse")[0].beeApiUrl).toBeUndefined()
      expect(frame.lastConnectionInfo().beeApiUrl).toBeUndefined()
      expect(JSON.stringify(frame.sent("authStatusResponse"))).not.toContain(
        "own-node.example.com",
      )
      expect(JSON.stringify(frame.sent("connectionInfoChanged"))).not.toContain(
        "own-node.example.com",
      )
      expect(internals(frame.proxy).bee.url).toBe(clientUrl(OWN_BEE_URL))
    })

    it.each([
      "javascript:alert(1)",
      "ftp://bee.example.com",
      "https://user:pass@bee.example.com",
      "https://bee.example.com/?token=1",
      "localhost:1633",
    ])("refuses the whole identify for %s", async (beeApiUrl) => {
      const frame = mount()

      await frame.identify({ beeApiUrl })

      expect(frame.sent("proxyReady")).toHaveLength(0)
    })
  })

  describe("set later with setBeeApiUrl", () => {
    it("moves reads and writes to the new address and says so", async () => {
      const frame = mount()
      await frame.identify({ beeApiUrl: SITE_BEE_URL })

      await frame.setBeeApiUrl(NEXT_SITE_BEE_URL)

      expect(frame.sent("setBeeApiUrlResponse")).toEqual([
        {
          type: "setBeeApiUrlResponse",
          requestId: "r9",
          beeApiUrl: NEXT_SITE_BEE_URL,
        },
      ])
      expect(internals(frame.proxy).bee.url).toBe(clientUrl(NEXT_SITE_BEE_URL))
      expect(internals(frame.proxy).nodeBee.url).toBe(
        clientUrl(NEXT_SITE_BEE_URL),
      )
      expect(frame.lastConnectionInfo()).toMatchObject({
        beeApiUrl: NEXT_SITE_BEE_URL,
      })
      expect(unsendable).toEqual([])
    })

    it("takes over from the person's own node on a site that gave none at identify", async () => {
      store.set(STORAGE_KEY_NETWORK_SETTINGS, NETWORK_SETTINGS(OWN_BEE_URL))
      const frame = mount()
      await frame.identify()

      await frame.setBeeApiUrl(SITE_BEE_URL)

      expect(internals(frame.proxy).bee.url).toBe(clientUrl(SITE_BEE_URL))
    })

    it.each([
      "javascript:alert(1)",
      "data:text/html,hi",
      "https://bee.example.com/#x",
      "",
      42,
    ])("refuses %s and keeps the address in effect", async (beeApiUrl) => {
      const frame = mount()
      await frame.identify({ beeApiUrl: SITE_BEE_URL })

      await frame.setBeeApiUrl(beeApiUrl)

      expect(frame.sent("setBeeApiUrlResponse")).toHaveLength(0)
      expect(internals(frame.proxy).bee.url).toBe(clientUrl(SITE_BEE_URL))
    })

    it("ignores a request from any origin but the frame's own parent", async () => {
      const frame = mount()
      await frame.identify({ beeApiUrl: SITE_BEE_URL })

      await frame.setBeeApiUrl(NEXT_SITE_BEE_URL, OTHER_ORIGIN)

      expect(frame.sent("setBeeApiUrlResponse")).toHaveLength(0)
      expect(internals(frame.proxy).bee.url).toBe(clientUrl(SITE_BEE_URL))
    })
  })

  describe("leaves everything else alone", () => {
    it("does not touch another site's frame", async () => {
      store.set(STORAGE_KEY_NETWORK_SETTINGS, NETWORK_SETTINGS(OWN_BEE_URL))
      const site = mount(PARENT_ORIGIN)
      await site.identify({ beeApiUrl: SITE_BEE_URL })
      await site.setBeeApiUrl(NEXT_SITE_BEE_URL)

      const other = mount(OTHER_ORIGIN)
      await other.identify()

      expect(internals(other.proxy).bee.url).toBe(clientUrl(OWN_BEE_URL))
      expect(other.lastConnectionInfo().beeApiUrl).toBeUndefined()
    })

    it("keeps the person's own setting, and a change to it does not move the site", async () => {
      store.set(STORAGE_KEY_NETWORK_SETTINGS, NETWORK_SETTINGS(OWN_BEE_URL))
      const frame = mount()
      await frame.identify({ beeApiUrl: SITE_BEE_URL })
      await frame.setBeeApiUrl(NEXT_SITE_BEE_URL)

      expect(store.get(STORAGE_KEY_NETWORK_SETTINGS)).toBe(
        NETWORK_SETTINGS(OWN_BEE_URL),
      )

      setOwnBeeUrl(DEFAULT_BEE_NODE_URL)

      expect(internals(frame.proxy).bee.url).toBe(clientUrl(NEXT_SITE_BEE_URL))
    })

    it("writes the site's address nowhere in storage", async () => {
      const frame = mount()
      await frame.identify({ beeApiUrl: SITE_BEE_URL })
      await frame.setBeeApiUrl(NEXT_SITE_BEE_URL)

      const stored = [...store.values()].join("\n")
      expect(stored).not.toContain("site-bee.example.com")
      expect(stored).not.toContain("gateway.example.org")
    })
  })

  // The person's custom node drops the site's subsidised gateway, so their
  // uploads go to the node they chose. On a site that names its own node the
  // person's choice is not in effect there, and the site asked for both.
  describe("with a subsidised gateway", () => {
    const signIn = (proxy: SwarmIdProxy) => {
      internals(proxy).authenticated = true
      internals(proxy).appSecret = APP_SECRET_HEX
    }

    it("keeps the site's gateway beside the site's address, over the person's custom node", async () => {
      store.set(STORAGE_KEY_NETWORK_SETTINGS, NETWORK_SETTINGS(OWN_BEE_URL))
      const frame = mount()
      await frame.identify({
        beeApiUrl: SITE_BEE_URL,
        subsidisedGatewayUrl: GATEWAY_URL,
      })
      signIn(frame.proxy)

      expect(internals(frame.proxy).buildConnectionInfo().uploadMode).toBe(
        "subsidised",
      )
      await expect(uploadTarget(frame.proxy)).resolves.toEqual({
        mode: "subsidised",
        gatewayUrl: GATEWAY_URL,
      })
      expect(internals(frame.proxy).bee.url).toBe(clientUrl(GATEWAY_URL))
      expect(internals(frame.proxy).nodeBee.url).toBe(clientUrl(SITE_BEE_URL))
    })

    it("still drops it for the person's custom node when the site names no address", async () => {
      store.set(STORAGE_KEY_NETWORK_SETTINGS, NETWORK_SETTINGS(OWN_BEE_URL))
      const frame = mount()
      await frame.identify({ subsidisedGatewayUrl: GATEWAY_URL })
      signIn(frame.proxy)

      expect(internals(frame.proxy).buildConnectionInfo().uploadMode).toBe(
        "unavailable",
      )
    })

    it("brings it back when the site names its address later", async () => {
      store.set(STORAGE_KEY_NETWORK_SETTINGS, NETWORK_SETTINGS(OWN_BEE_URL))
      const frame = mount()
      await frame.identify({ subsidisedGatewayUrl: GATEWAY_URL })
      signIn(frame.proxy)

      await frame.setBeeApiUrl(SITE_BEE_URL)

      expect(internals(frame.proxy).buildConnectionInfo().uploadMode).toBe(
        "subsidised",
      )
      await expect(uploadTarget(frame.proxy)).resolves.toEqual({
        mode: "subsidised",
        gatewayUrl: GATEWAY_URL,
      })
    })

    it("is not dropped by the person changing to a custom node mid-session", async () => {
      const frame = mount()
      await frame.identify({
        beeApiUrl: SITE_BEE_URL,
        subsidisedGatewayUrl: GATEWAY_URL,
      })
      signIn(frame.proxy)

      setOwnBeeUrl(OWN_BEE_URL)

      expect(internals(frame.proxy).buildConnectionInfo().uploadMode).toBe(
        "subsidised",
      )
    })

    // The person's settings arrive as a storage event, and what the site was
    // told has to follow without waiting for some other change to send it.
    it("tells the site when the person's custom node switches its gateway off", async () => {
      const frame = mount()
      await frame.identify({ subsidisedGatewayUrl: GATEWAY_URL })
      signIn(frame.proxy)
      const before = frame.sent("connectionInfoChanged").length

      setOwnBeeUrl(OWN_BEE_URL)

      expect(frame.sent("connectionInfoChanged")).toHaveLength(before + 1)
      expect(frame.lastConnectionInfo()).toMatchObject({
        uploadMode: "unavailable",
        uploadUnavailableReason: "no-stamp",
      })
    })
  })
})
