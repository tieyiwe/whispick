// FAQ content shown on the landing page and mirrored into FAQPage JSON-LD
// structured data (see scripts/prerender.mjs). Kept as a single source of
// truth so the visible accordion text and the structured-data text can never
// drift apart — search engines and AI answer engines penalize/ignore
// structured data that doesn't match what's actually on the page.
//
// Content is verbatim per the approved copy — do not rewrite or paraphrase.
// Exception (2026-10-08, pre-launch): answers were edited ONLY where they had
// become inaccurate — SMS/WhatsApp delivery is switched off at launch (see
// lib/usePublicConfig.ts) and Text Whisps are paused with it, and the app
// launches free (payments stay off until BILLING_ENABLED — see the API's
// lib/plans.ts). Whisper Box and Debate
// Now entries were added. Restore the SMS wording if those channels return.
export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "What is Blind Whisper?",
    answer:
      "Blind Whisper is an anonymous messaging platform that lets you send a video or a short written note to someone you know — without revealing who you are, unless you choose to.",
  },
  {
    question: "How does Blind Whisper keep me anonymous?",
    answer:
      "When you send a Whisper Link, Whisper Group, or Text Whisp, the recipient never sees your name, email, or phone number. Your identity is only shared if you use the Reveal Flow, and even then, only after the recipient agrees to see it.",
  },
  {
    question: "Does the recipient need a Blind Whisper account?",
    answer:
      "No. A Whisper Link and an anonymous invite can be opened by anyone with the link — no signup required.",
  },
  {
    question: "What is a Whisper Link?",
    answer:
      "A Whisper Link is an anonymous, one-to-one delivery of a video with an optional note, sent by email to one specific person you choose — or straight to their Blind Whisper inbox if they already have an account.",
  },
  {
    question: "What is Blind Circle?",
    answer:
      "Blind Circle is a public or invite-only feed where you can post a video anonymously for a community to discover, instead of sending it privately to one person.",
  },
  {
    question: "Can I find out if someone read what I sent?",
    answer:
      "Yes. Blind Whisper shows you when your Whisper Link was opened and watched, without ever identifying the sender to the recipient.",
  },
  {
    question: "Is Blind Whisper free?",
    answer:
      "Yes. Blind Whisper is free to use — sending whisps, getting a Whisper Box, replying and joining debates. Optional paid plans with extra features for people who send often may be added later.",
  },
  {
    question: "Can the recipient reply without knowing who I am?",
    answer:
      "Yes. Recipients can reply anonymously through the same private link — a reply doesn't reveal their identity to you either, unless they choose to.",
  },
  {
    question: "Is my phone number ever shared with the person I message?",
    answer:
      "No. If you verify your phone number, it's used only to check whether a recipient's number matches an existing verified account (so delivery can happen instantly in-app) and, if you choose, to sign in — never to identify you to anyone you message.",
  },
  {
    question: "What happens after I send a Whisper Link?",
    answer:
      "The recipient gets a link by email (or in their Blind Whisper inbox if they have an account). It expires 48 hours after delivery, and Blind Whisper can send up to two reminders before then.",
  },
  {
    question: "What is a Whisper Box?",
    answer:
      "A Whisper Box is your own shareable link — for your Instagram story, bio or group chats — that lets anyone send you an anonymous message without an account. You read messages privately in the app, can delete any of them, and can turn your box off at any time.",
  },
  {
    question: "What is Debate Now?",
    answer:
      "Debate Now is Blind Whisper's space for anonymous debates. Anyone can answer a debate anonymously without an account; posting a new debate topic takes a free account, and topics are published without your name.",
  },
];
