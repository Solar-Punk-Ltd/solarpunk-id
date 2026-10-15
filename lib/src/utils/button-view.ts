// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { ButtonAction, ButtonConfig } from "../types"

const DEFAULT_TEXT: Record<ButtonAction, string> = {
  "sign-in": "Sign in with Swarm ID",
  "change-stamp": "Change stamp in Swarm ID",
}
const DEFAULT_BUSY_TEXT = "Waiting for Swarm ID"
const DEFAULT_BACKGROUND = "#dd7200"
const DEFAULT_COLOR = "white"
const DEFAULT_FONT_SIZE = "14px"
const DEFAULT_FONT_WEIGHT = "600"
const DISABLED_OPACITY = "0.6"
/** Keeps the focus ring inside the frame, which clips anything past its edge */
const FOCUS_RING_OFFSET = "-3px"
const SIDE_PADDING = "0 12px"

/** What the button frame paints, worked out from what the site asked for */
export interface ButtonView {
  text: string
  /** Set only when the site gave one, so the label is the name otherwise */
  ariaLabel: string | undefined
  disabled: boolean
  busy: boolean
  style: Record<string, string>
}

/**
 * The button for `action` as `config` asks, busy while its connect window is
 * open or the site says so. A busy button stays focusable and ignores clicks,
 * a disabled one is out of the tab order.
 */
export function buttonView(
  action: ButtonAction,
  config: ButtonConfig,
  windowOpen: boolean,
): ButtonView {
  const busy = windowOpen || config.busy === true
  const disabled = config.disabled === true
  const style: Record<string, string> = {
    width: "100%",
    height: "100%",
    display: "block",
    boxSizing: "border-box",
    margin: "0",
    padding: SIDE_PADDING,
    border: "none",
    borderRadius: config.borderRadius ?? "0",
    backgroundColor: config.backgroundColor ?? DEFAULT_BACKGROUND,
    color: config.color ?? DEFAULT_COLOR,
    fontSize: config.fontSize ?? DEFAULT_FONT_SIZE,
    fontWeight: config.fontWeight?.toString() ?? DEFAULT_FONT_WEIGHT,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    outlineOffset: FOCUS_RING_OFFSET,
    cursor: busy || disabled ? "default" : "pointer",
    opacity: disabled ? DISABLED_OPACITY : "1",
  }
  if (config.fontFamily) style.fontFamily = config.fontFamily
  return {
    text: busy
      ? (config.busyText ?? DEFAULT_BUSY_TEXT)
      : (config.text ?? DEFAULT_TEXT[action]),
    ariaLabel: config.ariaLabel,
    disabled,
    busy,
    style,
  }
}
