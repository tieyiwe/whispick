import { describe, it, expect } from "vitest";
import { isOnline, presenceFor, ONLINE_WINDOW_MS } from "../lib/presence";

// Pure logic, no DB/app needed — same pattern as htmlEntities.test.ts.
describe("isOnline", () => {
  it("is true for a lastSeenAt inside the 5-minute window", () => {
    expect(isOnline(new Date(Date.now() - 1000))).toBe(true);
    expect(isOnline(new Date())).toBe(true);
  });

  it("is true right at the edge of the window", () => {
    expect(isOnline(new Date(Date.now() - ONLINE_WINDOW_MS))).toBe(true);
  });

  it("is false just outside the 5-minute window", () => {
    expect(isOnline(new Date(Date.now() - ONLINE_WINDOW_MS - 1000))).toBe(false);
  });

  it("is false for someone seen an hour ago", () => {
    expect(isOnline(new Date(Date.now() - 60 * 60 * 1000))).toBe(false);
  });

  it("is false for null", () => {
    expect(isOnline(null)).toBe(false);
  });

  it("is false for undefined", () => {
    expect(isOnline(undefined)).toBe(false);
  });
});

// The single reciprocal rule — safety-critical, so covered from every angle:
// a viewer who opted out can't see anyone, and no one can see someone who
// opted out, regardless of what the other side of the pair looks like.
describe("presenceFor", () => {
  const onlineOther = { showOnlineStatus: true, lastSeenAt: new Date() };
  const offlineOther = { showOnlineStatus: true, lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) };

  it("returns null when the viewer has visibility off, even if the other party is online and visible", () => {
    expect(presenceFor({ showOnlineStatus: false }, onlineOther)).toBeNull();
  });

  it("returns null when the viewer has visibility off, regardless of the other party at all", () => {
    expect(presenceFor({ showOnlineStatus: false }, null)).toBeNull();
    expect(presenceFor({ showOnlineStatus: false }, undefined)).toBeNull();
    expect(presenceFor({ showOnlineStatus: false }, { showOnlineStatus: false, lastSeenAt: null })).toBeNull();
  });

  it("returns null when other is null", () => {
    expect(presenceFor({ showOnlineStatus: true }, null)).toBeNull();
  });

  it("returns null when other is undefined", () => {
    expect(presenceFor({ showOnlineStatus: true }, undefined)).toBeNull();
  });

  it("returns null when the other party has their own visibility off, even though the viewer's is on", () => {
    expect(presenceFor({ showOnlineStatus: true }, { showOnlineStatus: false, lastSeenAt: new Date() })).toBeNull();
  });

  it("returns true when both sides are visible and the other party is within the window", () => {
    expect(presenceFor({ showOnlineStatus: true }, onlineOther)).toBe(true);
  });

  it("returns false (not null) when both sides are visible but the other party is stale", () => {
    expect(presenceFor({ showOnlineStatus: true }, offlineOther)).toBe(false);
  });

  it("returns false (not null) when both sides are visible but the other party has never been seen", () => {
    expect(presenceFor({ showOnlineStatus: true }, { showOnlineStatus: true, lastSeenAt: null })).toBe(false);
  });
});
