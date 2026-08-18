// A per-device, per-browser opaque id for the fully-anonymous engagement
// surfaces this app has — Blind Circle likes/comments, Debate Topic
// comments, and anything else built the same way (see
// circle_comments.ts/circle_post_likes.ts/debate_topic_comments.ts's own
// schema comments). It exists purely so a like is idempotent (the same
// visitor tapping twice doesn't double-count), so the anonymous comment
// rate limit (api-server's lib/plans.ts's canPostAnonymousComment) can
// count a device's own recent comments, and so "is this my own comment"
// can be styled client-side — it is NEVER linked to a real identity, NEVER
// sent to the other party in a conversation, and NEVER returned by the
// server to any viewer other than the one who generated it.
//
// Deliberately localStorage, not a cookie or anything server-set: nothing
// about this needs to survive a server round trip or be readable by the
// backend before the visitor's first like/comment, and generating it
// entirely client-side means the server never has to mint or track one.
const VISITOR_ID_KEY = "blindwhisper:visitorId";

export function getVisitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(VISITOR_ID_KEY, id);
    return id;
  } catch {
    // No localStorage (private mode, a locked-down profile) — fall back to
    // a per-page-load id. Likes/comments still work, they just won't
    // recognize this visitor as "the same one" on a later visit; that's a
    // degraded experience, not a broken one.
    return crypto.randomUUID();
  }
}
