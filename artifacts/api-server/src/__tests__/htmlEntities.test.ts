import { describe, it, expect } from "vitest";
import { decodeHtmlEntities } from "../lib/videoMeta";

// og:image and og:title arrive as HTML attribute values, so they carry
// entities. Leaving them encoded broke Facebook previews outright — see the
// signed-URL case below, which is the bug these exist to keep fixed.
describe("decodeHtmlEntities", () => {
  it("keeps a signed image URL's query parameters separate", () => {
    // The real failure: Facebook signs its CDN URLs across several query
    // params. With `&amp;` left in place the whole signature is one malformed
    // parameter, Facebook 403s it, and the thumbnail renders as a broken
    // image. This is the assertion that matters.
    const raw =
      "https://scontent.xx.fbcdn.net/v/t15.5256-10/123_456.jpg?stp=dst-jpg&amp;_nc_cat=101&amp;oh=00_AfDx&amp;oe=68A1B2C3";
    const decoded = decodeHtmlEntities(raw);

    expect(decoded).not.toContain("&amp;");
    expect(new URL(decoded).searchParams.get("oh")).toBe("00_AfDx");
    expect(new URL(decoded).searchParams.get("oe")).toBe("68A1B2C3");
  });

  it("decodes the hex entity that showed up verbatim in whisp titles", () => {
    expect(decodeHtmlEntities("15M views &#xb7; 299K reactions")).toBe("15M views · 299K reactions");
  });

  it("decodes decimal entities", () => {
    expect(decodeHtmlEntities("a &#183; b")).toBe("a · b");
  });

  it("decodes the named entities a title actually contains", () => {
    expect(decodeHtmlEntities("Rock &amp; Roll &quot;Live&quot; &lt;2024&gt; &#39;s best")).toBe(
      "Rock & Roll \"Live\" <2024> 's best",
    );
  });

  it("decodes astral-plane entities, since titles carry emoji", () => {
    expect(decodeHtmlEntities("watch this &#x1F440;")).toBe("watch this 👀");
  });

  it("leaves text alone when there is nothing to decode", () => {
    expect(decodeHtmlEntities("How does fasting affect cancer?")).toBe("How does fasting affect cancer?");
  });

  it("leaves an unrecognised entity as written rather than mangling it", () => {
    // Better a literal "&unknownthing;" in a title than a silently dropped
    // character or an exception on a scrape.
    expect(decodeHtmlEntities("a &unknownthing; b")).toBe("a &unknownthing; b");
  });

  it("does not treat a bare ampersand as the start of an entity", () => {
    expect(decodeHtmlEntities("fish & chips")).toBe("fish & chips");
  });
});
