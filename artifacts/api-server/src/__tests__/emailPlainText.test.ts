import { describe, it, expect } from "vitest";
import {
  htmlToPlainText,
  whisperLinkEmailHtml,
  replyNotificationEmailHtml,
  subscriptionMatchedEmailFooter,
} from "../lib/email";

const URL = "https://blindwhisper.com/api/l/abc123";

// Every message goes out as multipart/alternative; a missing or mangled
// text/plain part is both a spam heuristic and a blank message for anything
// reading without HTML. These pin the parts of that conversion that have
// already broken once or would break silently.
describe("htmlToPlainText", () => {
  it("keeps a button's destination, which is the whole point of the email", () => {
    const text = htmlToPlainText(whisperLinkEmailHtml(URL));
    // Regression: the destination was being dropped because the URL was
    // wrapped in angle brackets and then eaten by the tag-stripping pass.
    expect(text).toContain(`View your whisp: ${URL}`);
  });

  it("carries the hook line and the anonymity note", () => {
    const text = htmlToPlainText(whisperLinkEmailHtml(URL));
    expect(text).toContain("Someone who cares about you");
    expect(text).toContain("isn't included unless they choose to reveal it");
  });

  it("leaves no markup behind", () => {
    const text = htmlToPlainText(whisperLinkEmailHtml(URL));
    expect(text).not.toMatch(/<[a-z/!]/i);
    expect(text).not.toContain("style=");
    expect(text).not.toContain("&amp;");
  });

  it("decodes escaped characters back to what the reader should see", () => {
    // videoTitle is escaped for the HTML body; the text part has to undo it
    // or a scraped title arrives full of &quot; and &amp;.
    const text = htmlToPlainText(replyNotificationEmailHtml(`Bob's "Rock & Roll" <Live>`));
    expect(text).toContain(`Bob's "Rock & Roll" <Live>`);
  });

  it("prints a self-labelled link once rather than twice", () => {
    const text = htmlToPlainText(whisperLinkEmailHtml(URL));
    expect(text).not.toContain(`${URL}: ${URL}`);
  });

  it("keeps the unsubscribe link reachable without HTML", () => {
    const unsub = "https://blindwhisper.com/unsubscribe?token=t";
    const text = htmlToPlainText(whisperLinkEmailHtml(URL, undefined, subscriptionMatchedEmailFooter(unsub)));
    expect(text).toContain(`Unsubscribe: ${unsub}`);
  });

  it("collapses the table scaffolding instead of leaving a wall of blank lines", () => {
    const text = htmlToPlainText(whisperLinkEmailHtml(URL));
    expect(text).not.toMatch(/\n{3,}/);
    expect(text.startsWith("Blind Whisper")).toBe(true);
  });
});
