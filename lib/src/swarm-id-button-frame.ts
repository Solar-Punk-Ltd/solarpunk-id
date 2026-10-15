// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  BUTTON_FRAME_LOADED,
  ButtonIdentifyMessageSchema,
  ButtonUpdateMessageSchema,
  STORAGE_CHALLENGE_KEY,
  type AppMetadata,
  type ButtonAction,
  type ButtonConfig,
  type ButtonToParentMessage,
  type ButtonWindowState,
  type ConnectWindowOpenedMessage,
} from "./types"
import { buttonView } from "./utils/button-view"
import type { SiteAllowList } from "./utils/site-allow-list"
import { isStorageShared } from "./utils/storage-probe"
import { buildAuthUrl } from "./utils/url"

const POPUP_FEATURES = "width=500,height=600"
/** Safari can report a new tab closed before it has opened, so watching waits */
const WINDOW_WATCH_START_DELAY_MS = 2000
const WINDOW_CLOSED_CHECK_INTERVAL_MS = 500
const BUTTON_PATH = /\/button\/?$/

export interface ButtonFrameConfig {
  /**
   * The sites this frame serves (docs/Site-Allow-List.md), the same list the
   * session frame asks. A site it refuses gets no button.
   */
  siteAllowList: SiteAllowList
}

/**
 * The visible Swarm ID button a site mounts with `SwarmIdClient.mountButton`.
 *
 * It exists because a frame may open a window only from a click inside it.
 * A site on another site than Swarm ID gets a session frame whose storage is
 * partitioned from the connect window's, so the only way in is a handover the
 * window posts to Swarm ID's frames on the page that opened it, and a window
 * the site's page opens has no such page to post to. The click therefore
 * happens here: this frame opens the window and is its opener, and tells the
 * session frame beside it the window's challenge, so it takes the handover
 * that comes back under it (the window side is `ui/src/lib/handover-targets.ts`).
 * Both frames are Swarm ID's origin under the same top-level site, so they
 * share the partition, and nothing passes the site's page. Every check on the
 * handover stays in the session frame (`SwarmIdProxy.handlePopupMessage`).
 */
export class SwarmIdButtonFrame {
  private parentOrigin: string | undefined
  private identifyReceived = false
  private action: ButtonAction = "sign-in"
  private config: ButtonConfig = {}
  private metadata: AppMetadata | undefined
  private popupMode: "popup" | "window" = "window"
  private storageShared = false
  private connectWindow: Window | undefined
  private watchStart: ReturnType<typeof setTimeout> | undefined
  private watchInterval: ReturnType<typeof setInterval> | undefined
  private button: HTMLButtonElement | undefined
  private readonly onMessage = (event: MessageEvent) => {
    void this.handleMessage(event)
  }

  constructor(
    private readonly options: ButtonFrameConfig,
    private readonly container: HTMLElement,
  ) {
    window.addEventListener("message", this.onMessage)
    window.parent.postMessage({ type: BUTTON_FRAME_LOADED }, "*")
  }

  destroy(): void {
    window.removeEventListener("message", this.onMessage)
    this.stopWatchingWindow()
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    if (event.source !== window.parent) return
    const type = (event.data as { type?: unknown } | undefined)?.type
    if (type === "buttonIdentify") await this.handleIdentify(event)
    else if (type === "buttonUpdate") this.handleUpdate(event)
  }

  private async handleIdentify(event: MessageEvent): Promise<void> {
    if (this.identifyReceived) return
    const parsed = ButtonIdentifyMessageSchema.safeParse(event.data)
    if (!parsed.success) {
      console.warn("[Button] Invalid buttonIdentify message:", parsed.error)
      return
    }
    this.identifyReceived = true
    const siteCheck = await this.options.siteAllowList.check(event.origin)
    if (!siteCheck.allowed) {
      console.warn("[Button] Refused parent:", siteCheck.message)
      window.parent.postMessage(
        { type: "buttonInitError", error: siteCheck.message },
        event.origin,
      )
      return
    }
    this.storageShared = await isStorageShared()
    this.parentOrigin = event.origin
    this.action = parsed.data.action
    this.config = parsed.data.config ?? {}
    this.metadata = parsed.data.metadata
    this.popupMode = parsed.data.popupMode ?? "window"
    this.render()
    this.tellParent({ type: "buttonReady" })
  }

  private handleUpdate(event: MessageEvent): void {
    if (event.origin !== this.parentOrigin) return
    const parsed = ButtonUpdateMessageSchema.safeParse(event.data)
    if (!parsed.success) {
      console.warn("[Button] Invalid buttonUpdate message:", parsed.error)
      return
    }
    this.action = parsed.data.action
    this.config = parsed.data.config ?? {}
    this.render()
  }

  private render(): void {
    const view = buttonView(
      this.action,
      this.config,
      this.connectWindow !== undefined,
    )
    if (!this.button) {
      this.button = document.createElement("button")
      this.button.type = "button"
      this.button.addEventListener("click", () => this.openConnectWindow())
      this.container.appendChild(this.button)
    }
    const button = this.button
    button.textContent = view.text
    button.disabled = view.disabled
    if (view.ariaLabel) button.setAttribute("aria-label", view.ariaLabel)
    else button.removeAttribute("aria-label")
    if (view.busy) {
      button.setAttribute("aria-busy", "true")
      button.setAttribute("aria-disabled", "true")
    } else {
      button.removeAttribute("aria-busy")
      button.removeAttribute("aria-disabled")
    }
    Object.assign(button.style, view.style)
  }

  /**
   * Opens the connect window from the person's click, which is what lets the
   * browser open it at all. The window looks for the challenge in its own
   * storage to learn whether the session frame reads that storage, so it goes
   * there first only when this frame can open what the first-party pages
   * sealed (`isStorageShared`). Otherwise the window hands the session over,
   * and the session frames are told the challenge once the window is open, so
   * they take the handover that comes back under it.
   */
  private openConnectWindow(): void {
    const view = buttonView(
      this.action,
      this.config,
      this.connectWindow !== undefined,
    )
    if (!this.parentOrigin || !this.metadata || view.busy || view.disabled) {
      return
    }
    const challenge = crypto.randomUUID()
    if (this.storageShared)
      localStorage.setItem(STORAGE_CHALLENGE_KEY, challenge)
    const basePath = window.location.pathname.replace(BUTTON_PATH, "")
    const url = buildAuthUrl(
      window.location.origin + basePath,
      this.parentOrigin,
      this.metadata,
      { challenge },
    )
    const opened =
      this.popupMode === "popup"
        ? window.open(url, "_blank", POPUP_FEATURES)
        : window.open(url, "_blank")
    if (!opened) {
      if (this.storageShared) localStorage.removeItem(STORAGE_CHALLENGE_KEY)
      this.tellWindowState("blocked")
      return
    }
    this.tellSessionFrames({ type: "connectWindowOpened", challenge })
    this.connectWindow = opened
    this.render()
    this.tellWindowState("open")
    this.watchWindow(opened)
  }

  private watchWindow(opened: Window): void {
    this.stopWatchingWindow()
    this.watchStart = setTimeout(() => {
      this.watchInterval = setInterval(() => {
        if (!opened.closed) return
        this.stopWatchingWindow()
        if (this.connectWindow !== opened) return
        this.connectWindow = undefined
        this.render()
        this.tellWindowState("closed")
      }, WINDOW_CLOSED_CHECK_INTERVAL_MS)
    }, WINDOW_WATCH_START_DELAY_MS)
  }

  private stopWatchingWindow(): void {
    clearTimeout(this.watchStart)
    clearInterval(this.watchInterval)
    this.watchStart = undefined
    this.watchInterval = undefined
  }

  /**
   * Every other frame of the parent page, on Swarm ID's own origin only, so
   * the browser delivers it to Swarm ID's frames and drops it for the site's.
   */
  private tellSessionFrames(message: ConnectWindowOpenedMessage): void {
    const frames = window.parent.frames
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index]
      if (frame && frame !== window) {
        frame.postMessage(message, window.location.origin)
      }
    }
  }

  private tellWindowState(state: ButtonWindowState): void {
    this.tellParent({ type: "buttonWindowChanged", state })
  }

  private tellParent(message: ButtonToParentMessage): void {
    if (this.parentOrigin) window.parent.postMessage(message, this.parentOrigin)
  }
}

/** Starts the button frame, as `initProxy` starts the session frame */
export function initButtonFrame(
  config: ButtonFrameConfig,
  container: HTMLElement,
): SwarmIdButtonFrame {
  return new SwarmIdButtonFrame(config, container)
}
