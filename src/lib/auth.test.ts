import { describe, expect, it } from "vitest";
import { translate } from "../i18n";
import { appleAuthBlockedReason, hasUsableAppleSession } from "./auth";
import type { AuthSessionState } from "./types";

const t = translate.bind(null, "en");

describe("Apple auth UI state", () => {
  it("only treats signedIn state as usable for downloads", () => {
    const signedIn: AuthSessionState = { state: "signedIn", account: "person@example.com" };
    const savedMarker: AuthSessionState = { state: "savedSessionAvailable" };
    const expired: AuthSessionState = { state: "sessionExpired" };

    expect(hasUsableAppleSession(signedIn)).toBe(true);
    expect(hasUsableAppleSession(savedMarker)).toBe(false);
    expect(hasUsableAppleSession(expired)).toBe(false);
  });

  it("matches blocked reasons to visible auth state", () => {
    expect(appleAuthBlockedReason({ state: "savedSessionLocked" }, t)).toBe(
      "Use saved Apple ID session first"
    );
    expect(appleAuthBlockedReason({ state: "sessionExpired" }, t)).toBe(
      "Sign in with Apple ID again"
    );
    expect(appleAuthBlockedReason({ state: "notSignedIn" }, t)).toBe(
      "Sign in with Apple ID first"
    );
    expect(appleAuthBlockedReason({ state: "signedIn" }, t)).toBeNull();
  });
});
