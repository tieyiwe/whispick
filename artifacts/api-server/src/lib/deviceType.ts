// Coarse device classification from a User-Agent string — mobile vs tablet
// vs desktop, nothing richer (no browser/OS fingerprinting). Mirrors the
// client-side regex artifacts/blindwhisper/src/lib/installApp.ts's
// isMobileDevice()/isIos() already use for feature-gating, kept as its own
// server-side copy rather than shared code: that file's checks read
// navigator.userAgentData when available (browser-only API, meaningless on
// a server reading req.headers), so a genuine shared implementation isn't
// possible — this is deliberately the same regex philosophy applied to the
// one signal a server actually has.
export type DeviceType = "mobile" | "tablet" | "desktop" | "unknown";

export function classifyDevice(userAgent: string | undefined | null): DeviceType {
  if (!userAgent) return "unknown";
  const ua = userAgent;

  // Checked before the general mobile regex: an iPad's UA contains "Mobile"
  // in some iPadOS versions, and Android tablets often omit "Mobile" but
  // always carry "Android" — order matters here.
  if (/iPad/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return "mobile";
  if (/Macintosh|Windows NT|X11|Linux/i.test(ua)) return "desktop";
  return "unknown";
}
