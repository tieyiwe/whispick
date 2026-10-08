import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

const BROWSER_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS) AppleWebKit/605.1.15";
const WHATSAPP_UA = "WhatsApp/2.23.20 A";
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const GPTBOT_UA = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";

async function createTopic(userId: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/debate-topics")
    .set(asUser(userId))
    .send({ topicText: "Is honesty always the best policy?", ...overrides });
  return res.body as { id: string };
}

async function answer(topicId: string, commentText: string, visitorId: string) {
  const res = await request(app)
    .post(`/api/public/debate-topics/${topicId}/comments`)
    .field("commentText", commentText)
    .field("visitorId", visitorId);
  expect(res.status).toBe(201);
}

// Both the bare /dt prefix (what's shared now) and the older /api/dt mount
// (links already out in the wild) must behave the same.
describe.each(["/dt", "/api/dt"])("GET %s/:id", (prefix) => {
  it("redirects real browsers straight to the app", async () => {
    const topic = await createTopic("clerk_dt_link_user_1");
    const res = await request(app).get(`${prefix}/${topic.id}`).set("User-Agent", BROWSER_UA);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`/debate-topics/${topic.id}`);
  });

  it("serves a link-preview card that invites people to answer 100% anonymously", async () => {
    const topic = await createTopic("clerk_dt_link_user_2", { topicText: "Is honesty always the best policy?" });
    const res = await request(app).get(`${prefix}/${topic.id}`).set("User-Agent", WHATSAPP_UA);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain('property="og:title" content="Is honesty always the best policy?"');
    expect(res.text).toContain("Join this debate and answer 100% anonymously");
    expect(res.text).toContain(`/debate-topics/${topic.id}`);
    expect(res.text).toContain(`<link rel="canonical" href="http://`);
    expect(res.text).toContain(`/dt/${topic.id}"`);
    expect(res.text).toContain('property="og:site_name" content="Blind Whisper"');
    expect(res.text).toContain('name="twitter:card" content="summary_large_image"');
    // No meta refresh: a 0-second refresh reads to search engines as a
    // redirect to the SPA URL, which is kept out of the index.
    expect(res.text).not.toContain('http-equiv="refresh"');
  });

  it("404s unknown ids for crawlers so they drop out of the index", async () => {
    const res = await request(app).get(`${prefix}/does-not-exist`).set("User-Agent", WHATSAPP_UA);
    expect(res.status).toBe(404);
    expect(res.text).toContain('content="noindex"');
  });

  it("stops unfurling a retracted topic's text", async () => {
    const topic = await createTopic("clerk_dt_link_user_3", { topicText: "A topic about to be retracted" });
    await request(app).delete(`/api/debate-topics/${topic.id}`).set(asUser("clerk_dt_link_user_3"));

    const res = await request(app).get(`${prefix}/${topic.id}`).set("User-Agent", WHATSAPP_UA);

    expect(res.status).toBe(404);
    expect(res.text).not.toContain("A topic about to be retracted");
  });
});

describe("debate topics for search engines and AI crawlers", () => {
  it("keeps an unanswered topic out of the index", async () => {
    const topic = await createTopic("clerk_dt_seo_user_1", { topicText: "Nobody has answered this yet" });
    const res = await request(app).get(`/dt/${topic.id}`).set("User-Agent", GOOGLEBOT_UA);

    expect(res.status).toBe(200);
    expect(res.text).toContain('name="robots" content="noindex, follow"');
  });

  it("renders the topic and its anonymous answers as indexable HTML with structured data, without identifiers", async () => {
    const topic = await createTopic("clerk_dt_seo_user_2", { topicText: "Should <script> tags be allowed?" });
    await answer(topic.id, "Only if they're escaped & reviewed", "visitor-seo-secret-1");
    await answer(topic.id, "Never", "visitor-seo-secret-2");

    const res = await request(app).get(`/dt/${topic.id}`).set("User-Agent", GPTBOT_UA);

    expect(res.status).toBe(200);
    expect(res.text).toContain('name="robots" content="index, follow, max-image-preview:large"');
    expect(res.text).toContain("2 people have answered so far");
    expect(res.text).toContain("Only if they&#39;re escaped &amp; reviewed");
    expect(res.text).toContain('"@type":"DiscussionForumPosting"');
    expect(res.text).toContain('"userInteractionCount":2');
    // User text is escaped in HTML and can't break out of the JSON-LD script.
    expect(res.text).not.toContain("<script> tags");
    expect(res.text).toContain("\\u003cscript> tags");
    // Anonymity: the visitor ids behind each answer are never rendered.
    expect(res.text).not.toContain("visitor-seo-secret-1");
    expect(res.text).not.toContain("visitor-seo-secret-2");
    expect(res.text).not.toContain("clerk_dt_seo_user_2");
  });

  it("lists only answered, live topics in the sitemap", async () => {
    const answered = await createTopic("clerk_dt_seo_user_3", { topicText: "Answered topic" });
    const unanswered = await createTopic("clerk_dt_seo_user_3", { topicText: "Unanswered topic" });
    const retracted = await createTopic("clerk_dt_seo_user_3", { topicText: "Retracted topic" });
    await answer(answered.id, "Yes", "visitor-sitemap-1");
    await answer(retracted.id, "Yes", "visitor-sitemap-2");
    await request(app).delete(`/api/debate-topics/${retracted.id}`).set(asUser("clerk_dt_seo_user_3"));

    const res = await request(app).get("/dt/sitemap.xml");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/xml");
    expect(res.text).toContain(`/dt/${answered.id}</loc>`);
    expect(res.text).not.toContain(unanswered.id);
    expect(res.text).not.toContain(retracted.id);
  });

  it("serves a crawlable hub of recent debates, and sends people to the in-app feed", async () => {
    const topic = await createTopic("clerk_dt_seo_user_4", { topicText: "Hub-listed topic" });

    const crawler = await request(app).get("/dt").set("User-Agent", GOOGLEBOT_UA);
    expect(crawler.status).toBe(200);
    expect(crawler.text).toContain("Hub-listed topic");
    expect(crawler.text).toContain(`/dt/${topic.id}"`);

    const browser = await request(app).get("/dt").set("User-Agent", BROWSER_UA);
    expect(browser.status).toBe(302);
    expect(browser.headers.location).toContain("/debate-topics");
  });
});
