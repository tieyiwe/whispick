import { describe, it, expect } from "vitest";
import { scrubPii, scrubUrl } from "../lib/piiScrub";

describe("scrubPii", () => {
  it("redacts email addresses", () => {
    expect(scrubPii("Failed for user jane.doe+test@example.com during checkout")).toBe(
      "Failed for user [redacted-email] during checkout",
    );
  });

  it("redacts phone-number-shaped digit runs but leaves short numbers alone", () => {
    expect(scrubPii("Call +1 (555) 123-4567 now")).toBe("Call [redacted-phone] now");
    // Stack frame line:column shouldn't be mistaken for a phone number.
    expect(scrubPii("at Object.foo (bundle.js:42:17)")).toBe("at Object.foo (bundle.js:42:17)");
  });

  it("redacts JWT-shaped tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQ-abcdefghij";
    expect(scrubPii(`Authorization header was ${jwt}`)).toBe("Authorization header was [redacted-token]");
  });

  it("redacts known secret-key prefixes", () => {
    expect(scrubPii("using key sk_live_51H8x9nQwertyuiopASDFGH")).toContain("[redacted-secret]");
    expect(scrubPii("Bearer abcdefghijklmnopqrstuvwxyz123456")).toBe("[redacted-secret]");
  });

  it("leaves ordinary error text untouched", () => {
    const msg = "Cannot read properties of undefined (reading 'map')";
    expect(scrubPii(msg)).toBe(msg);
  });
});

describe("scrubUrl", () => {
  it("strips the query string and any fragment", () => {
    expect(scrubUrl("https://blindwhisper.com/reset?token=abc123&email=a@b.com", 300)).toBe(
      "https://blindwhisper.com/reset",
    );
    expect(scrubUrl("/settings#danger-zone", 300)).toBe("/settings");
  });

  it("caps length", () => {
    expect(scrubUrl("/" + "a".repeat(500), 10).length).toBeLessThanOrEqual(10);
  });
});
