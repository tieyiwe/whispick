// Canonical hook line shown to recipients — keep the frontend's copy
// (PublicWhispPage.tsx lead text) in sync with this by hand; the two
// packages don't share a constants module.
export const HOOK_LINE = "Someone who cares about you thought you needed to see this 👀";

// Group Whisper variant — deliberately vague about who else is in the group
// (a headcount, never names) so no single member feels personally targeted,
// even if one of them was the "real" reason it was sent. Keep in sync with
// PublicWhispPage.tsx the same way as HOOK_LINE.
export function groupHookLine(memberCount: number): string {
  return `Someone in your circle sent this anonymously — you're one of ${memberCount} people who got it 👀`;
}

// Re-notification copy for a "remind me later" follow-up. `isFinal` marks
// the last reminder a whisp is allowed (see lib/expiration.ts's
// MAX_REMINDERS) — that one has to say so explicitly and give the real
// deadline, since there's no reminder after it.
export function reminderHookLine(isFinal: boolean, expiresAt: Date): string {
  if (isFinal) {
    const when = expiresAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    return `Last reminder — the anonymous whisp you were sent won't be available after ${when}.`;
  }
  return "Don't forget — you have an anonymous whisp waiting for you 👀";
}

// Sent when a Sender clicks "Reveal Yourself" on an already-delivered whisp
// (see routes/whisps.ts POST /:id/reveal). Deliberately gives away nothing —
// no name, no hint — the suspense is the point; the actual accept/decline
// choice (and, if accepted, the sender following up to say who they are) all
// happens on the public whisp page this links to. Keep in sync with
// PublicWhispPage.tsx's reveal-section copy the same way as HOOK_LINE.
export function revealRequestHookLine(): string {
  return "Someone who sent you an anonymous whisp wants to reveal who they are... 👀";
}

// Sent when a Sender posts a follow-up on an already-delivered whisp (see
// routes/whisps.ts POST /:id/replies) — keeps the recipient from needing to
// coincidentally reopen the link to notice a new message. Keep in sync with
// PublicWhispPage.tsx's reply-thread copy the same way as HOOK_LINE.
export function newReplyHookLine(): string {
  return "The person who sent you an anonymous whisp replied 💬";
}

// Ghost Boost match delivery — deliberately doesn't say "a stranger sent
// this" (true, but a colder framing than the rest of the app's copy) or
// imply the sender picked THEM specifically (they didn't — a subscriber
// opted in to a topic, and this matched it). Keep in sync with
// PublicWhispPage.tsx the same way as HOOK_LINE.
export function matchHookLine(): string {
  return "This matched something you said you wanted to hear about — sent anonymously 👀";
}

// Anonymous invite-a-friend (routes/invites.ts) — required, verbatim framing
// from product: no name, no hint who sent it, ever, unless/until the
// inviter reveals themselves post-signup (same consent-based Reveal Flow as
// a whisp, see requestInviteReveal/respondInviteReveal). Keep in sync with
// PublicInvitePage.tsx's lead text the same way as HOOK_LINE.
export const INVITE_HOOK_LINE =
  "Someone who cares about you is inviting you to install Blind Whisper — for honest conversations without the awkwardness, kept confidential and anonymous.";

// Sent when an inviter clicks "Reveal Yourself" on an invite that's already
// been joined (see routes/invites.ts POST /invites/:id/reveal) — same
// "give away nothing" posture as revealRequestHookLine above, just worded
// for the invite context. Delivered as an in-app notification (the invitee
// is a real account holder by this point), not email/SMS/WhatsApp.
export function inviteRevealRequestHookLine(): string {
  return "Someone who invited you to Blind Whisper wants to reveal who they are... 👀";
}

// Text Whisp (routes/textWhisps.ts) notification copy — deliberately never
// includes the actual messageText/replyText in the notification body (it
// can appear on a lock screen, and the whole point of the tied-scroll
// unfurl moment is that the recipient opens the app to read it, not that it
// arrives pre-spoiled). Delivered exclusively in-app, so this is the only
// copy path this feature has — no email/SMS equivalent exists.
export function textWhispHookLine(): string {
  return "Someone sent you an anonymous Text Whisp 📜";
}

export function textWhispReplyHookLine(): string {
  return "You got a reply on your Text Whisp 💬";
}

// Same "give away nothing" posture as revealRequestHookLine, worded for the
// Text Whisp context.
export function textWhispRevealRequestHookLine(): string {
  return "The person who sent you a Text Whisp wants to reveal who they are... 👀";
}

export function textWhispRevealRespondedHookLine(accepted: boolean): string {
  return accepted
    ? "They accepted your reveal request — you can now tell them who you are."
    : "They declined your reveal request to stay anonymous.";
}

// Guest SMS teaser for a Text Whisp sent to a phone number that wasn't a
// verified Blind Whisper account at send time (routes/textWhisps.ts's
// POST /, lib/sms.ts's textWhispGuestSmsBody). Deliberately its own line
// rather than reusing textWhispHookLine above: that one is in-app
// notification copy for an existing account holder, this is the very first
// thing a stranger to the product sees, in an SMS inbox rather than a
// notification bell. Keep in sync with PublicTextWhisp.tsx's lead copy by
// hand, same as HOOK_LINE.
export const TEXT_WHISP_GUEST_HOOK_LINE =
  "You've received an anonymous Text Whisp on Blind Whisper — a short note just for you.";

// SMS-only compliant leads for A2P 10DLC — deliberately separate from the
// HOOK_LINE family above, which also drives in-app notification bodies and
// public-page copy and varies per trigger (reminder/group/reply/reveal —
// see reminderHookLine/groupHookLine/newReplyHookLine/revealRequestHookLine).
// A carrier-reviewed SMS body needs ONE fixed, brand-led, third-person
// template per delivery type used for every send of that type — variant
// wording that was never registered as its own sample message is exactly
// what got this app's last A2P submission rejected. Email and in-app still
// get the fuller, varying hookLine copy; only the SMS channel — the one a
// carrier actually reviews — is pinned to these.
export const SMS_WHISPER_LINK_LEAD = "Blind Whisper: Someone you know shared a video with you.";
export const SMS_INVITE_LEAD = "Blind Whisper: Someone you know invited you to join Blind Whisper.";
export const SMS_TEXT_WHISP_LEAD = "Blind Whisper: You have a new message on Blind Whisper.";
export const SMS_DEBATE_TOPIC_WHISP_LEAD = "Blind Whisper: Someone you know shared a discussion topic with you.";

// The Open Graph description for a shared Whisper Box link (routes/
// whisperBoxLink.ts's GET /wb/:handle) — what shows up in the link-preview
// card when someone pastes their link into iMessage/Instagram/WhatsApp/etc.
// Keep in sync with PublicWhisperBoxPage.tsx's own subheading by hand, same
// as HOOK_LINE.
export const WHISPER_BOX_HOOK_LINE = "You can tell me anything or share a video I need to see anonymously.";

// Debate Now topic whisp (routes/debateTopicWhisps.ts) — sent when someone
// Whispers a topic to a specific contact instead of (or alongside) plain
// link-sharing. Deliberately doesn't name the sender or hint at a
// relationship the way HOOK_LINE does ("someone who cares about you") —
// this is "someone thought you'd want to weigh in", not necessarily
// personal, since any signed-in viewer of a topic can send it, not just
// people who know the recipient well.
export function debateTopicWhispHookLine(): string {
  return "Someone thinks you'd have something to say about this 🗣️";
}
