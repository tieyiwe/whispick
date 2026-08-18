// FAQ content shown on the landing page and mirrored into FAQPage JSON-LD
// structured data (see scripts/prerender.mjs). Kept as a single source of
// truth so the visible accordion text and the structured-data text can never
// drift apart — search engines and AI answer engines penalize/ignore
// structured data that doesn't match what's actually on the page.
//
// Content is verbatim per the approved copy — do not rewrite or paraphrase.
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
      "No. A Whisper Link and an anonymous invite can be opened by anyone with the link — no signup required. Text Whisps also reach any phone number: if the recipient already has a verified account, it delivers instantly in the app; if not, they get a text with a link to read it and the option to sign up and reply the same way.",
  },
  {
    question: "What is a Whisper Link?",
    answer:
      "A Whisper Link is an anonymous, one-to-one delivery of a video with an optional note, sent by email, SMS, or WhatsApp to one specific person you choose.",
  },
  {
    question: "What is a Text Whisp?",
    answer:
      "A Text Whisp is a short (up to 260 characters) anonymous written message, sent the same private way as a Whisper Link, but as text instead of video.",
  },
  {
    question: "What is Ghost Boost?",
    answer:
      "Ghost Boost matches your video to people who have separately opted in to receive anonymous recommendations on topics or moods they picked themselves. It's not advertising, and it's not sent through any third-party ad platform.",
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
      "Blind Whisper has a free tier, plus paid plans with more features for people who send often. Pricing is on the Subscribe page.",
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
      "The recipient gets a link by email, SMS, or WhatsApp. It expires 48 hours after delivery, and Blind Whisper can send up to two reminders before then.",
  },
];
