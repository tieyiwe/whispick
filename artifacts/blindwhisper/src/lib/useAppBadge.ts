// "Home-screen presence" — the Web Badge API is the closest thing to a
// native OS home-screen widget that's actually buildable from a pure web
// PWA. It puts a small numeric badge on the app's home-screen/taskbar icon,
// entirely outside the browser window, reflecting the user's total
// actionable unread count (bell notifications + Whisper Box). A true
// glanceable widget with custom UI would need a native iOS/Android app
// shell, which this project doesn't have — this is deliberately just the
// numeric badge, nothing more.
//
// Support: Chrome/Edge desktop + Android, and Safari 16.4+ but ONLY for an
// installed (Add to Home Screen) iOS/iPadOS/macOS PWA — Safari in an
// ordinary browser tab has no Badge API at all. Everywhere else
// `navigator.setAppBadge` simply doesn't exist, which is why every call
// below is guarded by isAppBadgeSupported() and never assumed.

import { useEffect, useState } from "react";

const ENABLED_KEY = "blindwhisper:appBadgeEnabled";

function readEnabled(): boolean {
  try {
    // Absent key (first run, or storage unavailable) defaults to on — most
    // people installing the app want the glanceable signal, and it's a
    // purely client-side display preference either way, easy to flip off.
    return localStorage.getItem(ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

type Listener = (enabled: boolean) => void;
const listeners = new Set<Listener>();
let cachedEnabled = readEnabled();

function writeEnabled(enabled: boolean): void {
  cachedEnabled = enabled;
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // Private browsing / locked-down profile — the in-memory value above
    // still takes effect for the rest of this session, it just won't
    // persist across a reload. Not worth surfacing as an error.
  }
  for (const listener of listeners) listener(enabled);
}

/** Whether this browser exposes the Badge API at all. */
export function isAppBadgeSupported(): boolean {
  return typeof navigator !== "undefined" && "setAppBadge" in navigator;
}

type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/**
 * The user's badge-on-icon preference, shared reactively across every
 * component that calls this hook — so flipping the switch on SettingsPage
 * takes effect in AppLayout's always-mounted badge effect immediately,
 * without a reload or waiting on the next poll tick.
 */
export function useAppBadgeEnabled(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabledState] = useState(cachedEnabled);

  useEffect(() => {
    const listener: Listener = (next) => setEnabledState(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return [enabled, writeEnabled];
}

/**
 * Sets/clears the installed PWA's home-screen icon badge to reflect `total`.
 * Call with the combined unread total (bell notifications' unreadCount +
 * Whisper Box's unreadCount — NOT unreadReplyCount, which is already a
 * subset of the bell count, not additional to it).
 *
 * Intentionally takes a plain number rather than fetching its own data: the
 * caller (AppLayout) already polls both source queries on a 60s interval,
 * and this piggybacks on that instead of opening a third independent poll.
 *
 * Every call is guarded by isAppBadgeSupported() and wrapped in try/catch —
 * unsupported browsers no-op silently (no console errors), and the Badge API
 * can throw in some contexts (private browsing, restricted permissions)
 * even where it exists, which must never break the app around it.
 */
export function useAppBadge(total: number): void {
  const [enabled] = useAppBadgeEnabled();

  useEffect(() => {
    if (!isAppBadgeSupported()) return;
    const nav = navigator as BadgeNavigator;
    try {
      if (enabled && total > 0) {
        nav.setAppBadge?.(total)?.catch(() => {});
      } else {
        nav.clearAppBadge?.()?.catch(() => {});
      }
    } catch {
      // Synchronous throw path — never let a badge update break the app.
    }
  }, [total, enabled]);
}
