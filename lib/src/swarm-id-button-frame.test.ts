// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SwarmIdButtonFrame } from "./swarm-id-button-frame"
import { allowingSites } from "./test-fixtures"
import { BUTTON_FRAME_LOADED, STORAGE_CHALLENGE_KEY } from "./types"

/** What `isStorageShared` answers this frame, partitioned unless a test says */
const probe = vi.hoisted(() => ({ shared: false }))
vi.mock("./utils/storage-probe", () => ({
  isStorageShared: () => Promise.resolve(probe.shared),
}))

const ID_ORIGIN = "https://id.example.com"
const PARENT_ORIGIN = "https://site.example.com"
const METADATA = { name: "Site" }

type Listener = (event: MessageEvent) => unknown

interface FakeButton {
  type: string
  textContent: string
  disabled: boolean
  style: Record<string, string>
  attributes: Record<string, string>
  click: () => void
  setAttribute: (name: string, value: string) => void
  removeAttribute: (name: string) => void
  addEventListener: (type: string, handler: () => void) => void
}

function fakeButton(): FakeButton {
  let onClick: (() => void) | undefined
  const button: FakeButton = {
    type: "",
    textContent: "",
    disabled: false,
    style: {},
    attributes: {},
    click: () => onClick?.(),
    setAttribute: (name, value) => {
      button.attributes[name] = value
    },
    removeAttribute: (name) => {
      delete button.attributes[name]
    },
    addEventListener: (type, handler) => {
      if (type === "click") onClick = handler
    },
  }
  return button
}

describe("SwarmIdButtonFrame", () => {
  let listener: Listener
  let parentWindow: {
    postMessage: ReturnType<typeof vi.fn>
    frames: Record<number, unknown> & { length: number }
  }
  let sessionFrame: { postMessage: ReturnType<typeof vi.fn> }
  let siteFrame: { postMessage: ReturnType<typeof vi.fn> }
  let selfWindow: Record<string, unknown>
  let opened: { closed: boolean } | null
  let open: ReturnType<typeof vi.fn>
  let storage: Map<string, string>
  let buttons: FakeButton[]
  let frame: SwarmIdButtonFrame

  beforeEach(() => {
    probe.shared = false
    vi.useFakeTimers()
    sessionFrame = { postMessage: vi.fn() }
    siteFrame = { postMessage: vi.fn() }
    opened = { closed: false }
    open = vi.fn(() => opened)
    storage = new Map()
    buttons = []
    selfWindow = {
      addEventListener: vi.fn((type: string, handler: Listener) => {
        if (type === "message") listener = handler
      }),
      removeEventListener: vi.fn(),
      location: { origin: ID_ORIGIN, pathname: "/button" },
      open,
    }
    parentWindow = {
      postMessage: vi.fn(),
      frames: { length: 3, 0: sessionFrame, 1: selfWindow, 2: siteFrame },
    }
    selfWindow.parent = parentWindow
    vi.stubGlobal("window", selfWindow)
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    })
    vi.stubGlobal("document", {
      createElement: vi.fn(() => {
        const button = fakeButton()
        buttons.push(button)
        return button
      }),
    })
    frame = new SwarmIdButtonFrame(
      { siteAllowList: allowingSites(PARENT_ORIGIN) },
      { appendChild: vi.fn() } as unknown as HTMLElement,
    )
  })

  afterEach(() => {
    frame.destroy()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** Delivers a message and lets what it starts settle */
  const deliver = async (event: Record<string, unknown>) => {
    listener(event as unknown as MessageEvent)
    await vi.advanceTimersByTimeAsync(0)
  }

  const fromParent = (data: unknown, origin = PARENT_ORIGIN) =>
    deliver({ data, origin, source: parentWindow })

  const identify = (extra: Record<string, unknown> = {}) =>
    fromParent({
      type: "buttonIdentify",
      action: "sign-in",
      metadata: METADATA,
      ...extra,
    })

  const toParent = (type: string) =>
    parentWindow.postMessage.mock.calls
      .map(([message]) => message as { type: string })
      .filter((message) => message.type === type)

  it("says it loaded before anyone identified it", () => {
    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      { type: BUTTON_FRAME_LOADED },
      "*",
    )
  })

  it("shows the button for an allowed site and says it is ready", async () => {
    await identify()

    expect(buttons).toHaveLength(1)
    expect(buttons[0].type).toBe("button")
    expect(buttons[0].textContent).toBe("Sign in with Swarm ID")
    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      { type: "buttonReady" },
      PARENT_ORIGIN,
    )
  })

  it("shows nothing for a site the allow list refuses, and says why", async () => {
    await identify()
    frame.destroy()
    frame = new SwarmIdButtonFrame({ siteAllowList: allowingSites() }, {
      appendChild: vi.fn(),
    } as unknown as HTMLElement)
    buttons = []
    await identify()

    expect(buttons).toHaveLength(0)
    expect(toParent("buttonInitError")).toHaveLength(1)
  })

  it("takes its identity only from its parent, and only once", async () => {
    await deliver({
      data: { type: "buttonIdentify", action: "sign-in", metadata: METADATA },
      origin: PARENT_ORIGIN,
      source: siteFrame,
    })
    expect(buttons).toHaveLength(0)

    await identify()
    await identify({ action: "change-stamp" })
    expect(buttons[0].textContent).toBe("Sign in with Swarm ID")
  })

  it("opens the connect window from its click, with a challenge, and tells the session frames", async () => {
    await identify()
    buttons[0].click()

    const [url] = open.mock.calls[0] as [string]
    expect(url.startsWith(`${ID_ORIGIN}/connect#`)).toBe(true)
    const params = new URLSearchParams(url.split("#")[1])
    expect(params.get("origin")).toBe(PARENT_ORIGIN)
    expect(params.get("appName")).toBe(METADATA.name)
    const challenge = params.get("challenge")
    expect(challenge).toBeTruthy()
    // Partitioned: the window must not find it, so it hands the session over
    expect(storage.has(STORAGE_CHALLENGE_KEY)).toBe(false)

    expect(sessionFrame.postMessage).toHaveBeenCalledWith(
      { type: "connectWindowOpened", challenge },
      ID_ORIGIN,
    )
    // Swarm ID's own origin only, so a frame of the site never receives it
    expect(siteFrame.postMessage).toHaveBeenCalledWith(
      { type: "connectWindowOpened", challenge },
      ID_ORIGIN,
    )
    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      { type: "buttonWindowChanged", state: "open" },
      PARENT_ORIGIN,
    )
    expect(buttons[0].textContent).toBe("Waiting for Swarm ID")
    expect(buttons[0].attributes["aria-busy"]).toBe("true")
  })

  // Shared: the window finds the challenge in its own storage and writes the
  // connection there, where the session frame reads it.
  it("leaves the challenge where the window looks when it shares storage", async () => {
    probe.shared = true
    await identify()
    buttons[0].click()

    const [url] = open.mock.calls[0] as [string]
    const challenge = new URLSearchParams(url.split("#")[1]).get("challenge")
    expect(storage.get(STORAGE_CHALLENGE_KEY)).toBe(challenge)
  })

  it("opens a sized popup when the site asked for one", async () => {
    await identify({ popupMode: "popup" })
    buttons[0].click()

    expect(open.mock.calls[0][2]).toBe("width=500,height=600")
  })

  it("says the window was blocked and stays clickable", async () => {
    probe.shared = true
    opened = null
    await identify()
    buttons[0].click()

    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      { type: "buttonWindowChanged", state: "blocked" },
      PARENT_ORIGIN,
    )
    expect(sessionFrame.postMessage).not.toHaveBeenCalled()
    expect(storage.has(STORAGE_CHALLENGE_KEY)).toBe(false)
    expect(buttons[0].attributes["aria-busy"]).toBeUndefined()
  })

  it("comes back once the window closes", async () => {
    await identify()
    buttons[0].click()
    opened!.closed = true
    await vi.advanceTimersByTimeAsync(3000)

    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      { type: "buttonWindowChanged", state: "closed" },
      PARENT_ORIGIN,
    )
    expect(buttons[0].textContent).toBe("Sign in with Swarm ID")
  })

  it("opens nothing while its window is open, disabled or busy", async () => {
    await identify()
    buttons[0].click()
    buttons[0].click()
    expect(open).toHaveBeenCalledTimes(1)

    await fromParent({
      type: "buttonUpdate",
      action: "sign-in",
      config: { disabled: true },
    })
    opened!.closed = true
    await vi.advanceTimersByTimeAsync(3000)
    buttons[0].click()
    expect(open).toHaveBeenCalledTimes(1)
    expect(buttons[0].disabled).toBe(true)

    await fromParent({
      type: "buttonUpdate",
      action: "sign-in",
      config: { busy: true },
    })
    buttons[0].click()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it("changes in place on the site's update, from its parent only", async () => {
    await identify()
    await fromParent({
      type: "buttonUpdate",
      action: "change-stamp",
      config: { text: "Change stamp", ariaLabel: "Change the chat stamp" },
    })

    expect(buttons).toHaveLength(1)
    expect(buttons[0].textContent).toBe("Change stamp")
    expect(buttons[0].attributes["aria-label"]).toBe("Change the chat stamp")

    await fromParent(
      { type: "buttonUpdate", action: "sign-in", config: { text: "Other" } },
      "https://other.example.com",
    )
    expect(buttons[0].textContent).toBe("Change stamp")
  })
})
