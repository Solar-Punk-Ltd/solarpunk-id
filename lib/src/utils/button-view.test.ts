// Copyright 2026 The Swarm Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest"

import { buttonView } from "./button-view"

describe("buttonView", () => {
  it("names each action by default", () => {
    expect(buttonView("sign-in", {}, false).text).toBe("Sign in with Swarm ID")
    expect(buttonView("change-stamp", {}, false).text).toBe(
      "Change stamp in Swarm ID",
    )
  })

  it("takes the site's label and accessible name", () => {
    const view = buttonView(
      "sign-in",
      { text: "Sign in", ariaLabel: "Sign in to the chat with Swarm ID" },
      false,
    )
    expect(view.text).toBe("Sign in")
    expect(view.ariaLabel).toBe("Sign in to the chat with Swarm ID")
  })

  it("leaves the accessible name to the label when the site gives none", () => {
    expect(buttonView("sign-in", {}, false).ariaLabel).toBeUndefined()
  })

  it("is busy while its window is open, with the busy label", () => {
    const view = buttonView("sign-in", { busyText: "Signing in" }, true)
    expect(view).toMatchObject({ text: "Signing in", busy: true })
  })

  it("is busy when the site says so", () => {
    const view = buttonView("sign-in", { busy: true }, false)
    expect(view).toMatchObject({ text: "Waiting for Swarm ID", busy: true })
  })

  it("is disabled only when the site says so", () => {
    expect(buttonView("sign-in", {}, false).disabled).toBe(false)
    expect(buttonView("sign-in", { disabled: true }, false).disabled).toBe(true)
  })

  it("fills its frame and ends a label that does not fit in an ellipsis", () => {
    const { style } = buttonView("sign-in", {}, false)
    expect(style).toMatchObject({
      width: "100%",
      height: "100%",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    })
  })

  it("applies the site's colours, radius and typography", () => {
    const { style } = buttonView(
      "sign-in",
      {
        backgroundColor: "#000",
        color: "#fff",
        borderRadius: "6px",
        fontFamily: "Inter, sans-serif",
        fontSize: "18px",
        fontWeight: 500,
      },
      false,
    )
    expect(style).toMatchObject({
      backgroundColor: "#000",
      color: "#fff",
      borderRadius: "6px",
      fontFamily: "Inter, sans-serif",
      fontSize: "18px",
      fontWeight: "500",
    })
  })

  // Set one by one, after a reset, so a value the browser does not take
  // leaves no border rather than bringing the button's default one back.
  const borderOf = (style: Record<string, string>) => {
    const keys = Object.keys(style).filter(
      (key) => key.startsWith("border") && key !== "borderRadius",
    )
    return Object.fromEntries(keys.map((key) => [key, style[key]]))
  }

  it("draws the site's border, for a secondary style, after a reset", () => {
    const config = { borderColor: "#667eea", borderWidth: "2px" }
    const { style } = buttonView("sign-in", config, false)
    expect(borderOf(style)).toEqual({
      border: "0 none transparent",
      borderWidth: "2px",
      borderStyle: "solid",
      borderColor: "#667eea",
    })
    expect(Object.keys(style).indexOf("border")).toBeLessThan(
      Object.keys(style).indexOf("borderWidth"),
    )
    expect(
      buttonView("sign-in", { ...config, borderStyle: "dashed" }, false).style
        .borderStyle,
    ).toBe("dashed")
  })

  it("keeps the border while busy and while disabled", () => {
    const config = { borderColor: "#667eea", borderWidth: "1px" }
    const drawn = borderOf(buttonView("sign-in", config, false).style)
    expect(borderOf(buttonView("sign-in", config, true).style)).toEqual(drawn)
    expect(
      borderOf(
        buttonView("sign-in", { ...config, disabled: true }, false).style,
      ),
    ).toEqual(drawn)
  })

  it("draws no border unless the site names one", () => {
    expect(borderOf(buttonView("sign-in", {}, false).style)).toEqual({
      border: "0 none transparent",
    })
    expect(
      borderOf(buttonView("sign-in", { borderColor: "#000" }, false).style),
    ).toMatchObject({
      borderWidth: "1px",
      borderStyle: "solid",
      borderColor: "#000",
    })
  })

  it("keeps the built-in look, and no font-family, when unset", () => {
    const { style } = buttonView("sign-in", {}, false)
    expect(style).toMatchObject({
      backgroundColor: "#dd7200",
      color: "white",
      fontSize: "14px",
      fontWeight: "600",
    })
    // Inheriting would take the frame's font, which is no closer to the page.
    expect(style.fontFamily).toBeUndefined()
  })

  it("shows the pointer only where a click does something", () => {
    expect(buttonView("sign-in", {}, false).style.cursor).toBe("pointer")
    expect(buttonView("sign-in", {}, true).style.cursor).toBe("default")
    expect(buttonView("sign-in", { disabled: true }, false).style.cursor).toBe(
      "default",
    )
  })
})
