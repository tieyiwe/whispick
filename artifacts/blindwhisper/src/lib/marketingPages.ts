// Content for Blind Whisper's public, indexable marketing pages.
//
// One source of truth, used by:
//   - pages/MarketingPage.tsx (what visitors see),
//   - scripts/prerender.mjs (static HTML for crawlers that don't run JS, the
//     per-page <title>/description/canonical, FAQPage/HowTo/BreadcrumbList
//     JSON-LD, the build-time sitemap.xml, and llms.txt / llms-full.txt for
//     AI assistants).
// Because every surface reads from here, the structured data and the AI
// summaries can't drift from the visible text — search engines penalize
// mismatches, and AI assistants repeat whatever these say.
//
// Writing rules (keep them when editing):
//   - Open every page with a direct, self-contained answer to the question
//     the page targets — that's the sentence search snippets and AI answers
//     quote.
//   - Only state what the product actually does today. SMS/WhatsApp delivery
//     is switched off at launch (see lib/usePublicConfig.ts), so delivery is
//     described as email + in-app. Update the copy if that changes.
//   - English only for now; these pages are prerendered in English.

import { FAQ_ITEMS } from "./faqContent";

export type MarketingFaq = { question: string; answer: string };
export type MarketingStep = { name: string; text: string };
export type MarketingSection = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  steps?: MarketingStep[];
};
export type MarketingPageDef = {
  path: string;
  navLabel: string;
  /** <title> — keep under ~60 characters where possible. */
  title: string;
  /** Meta description — ~150 characters, says what the page answers. */
  description: string;
  eyebrow: string;
  h1: string;
  /** The answer-first opening paragraph. */
  intro: string;
  sections: MarketingSection[];
  faqs?: MarketingFaq[];
  cta: { heading: string; body: string; label: string; href: string };
  related: string[];
  updated: string;
};

export const MARKETING_UPDATED = "2026-10-08";

export const MARKETING_PAGES: MarketingPageDef[] = [
  {
    path: "/how-it-works",
    navLabel: "How it works",
    title: "How Blind Whisper Works — Send a Video Anonymously",
    description:
      "Send someone a video and a private note without revealing who you are. What you send, what they see, how replies and reveals work, and how you stay anonymous.",
    eyebrow: "How it works",
    h1: "How Blind Whisper works",
    intro:
      "Blind Whisper lets you send someone a video — a link from YouTube, TikTok, Instagram, Vimeo or Facebook, or a clip you upload or record — together with an optional private note, without telling them who you are. They open it in their browser with no account needed, can reply anonymously, and only ever learn your identity if you choose to reveal it and they agree to see it.",
    sections: [
      {
        heading: "Sending a whisp, step by step",
        steps: [
          {
            name: "Pick the video",
            text: "Paste a link from YouTube, TikTok, Instagram, Vimeo or Facebook, upload a video from your device, or record one with your camera. You can trim it to the part that matters.",
          },
          {
            name: "Add an anonymous note",
            text: "Say why you're sending it, in your own words — or leave it to the video. Pick a mood so they know the spirit it's sent in. Your name is never attached.",
          },
          {
            name: "Choose who gets it",
            text: "Enter their email address. If they already use Blind Whisper, it lands in their in-app inbox too. You can also schedule it for a better moment.",
          },
          {
            name: "They watch and can reply",
            text: "They open a private link — no account, no download. They can react, reply anonymously, or ask to be reminded later. You can see when it was opened and watched.",
          },
        ],
      },
      {
        heading: "What the person receiving it sees",
        paragraphs: [
          "A private page with the video, your note and mood — and nothing that identifies you: no name, no email address, no phone number, no profile. If you upload a photo or video, Blind Whisper strips the hidden details phones embed in files, like location and device information, before anyone can download it.",
          "A whisp sent by link stays open for 48 hours after it's delivered, so it feels like a moment rather than something that sits in an inbox forever. The recipient can ask Blind Whisper to remind them before it expires.",
        ],
      },
      {
        heading: "Replies stay anonymous both ways",
        paragraphs: [
          "The recipient can write back right on the page. You see their reply without learning who they are either, unless they choose to tell you. After a few anonymous replies they can create a free account to keep the conversation going — still anonymous to you.",
          "Reply notifications are deliberately delayed by a few minutes, so a phone buzzing in the same room can't give away who sent something.",
        ],
      },
      {
        heading: "Revealing yourself is optional — and it takes two",
        paragraphs: [
          "If you ever want them to know it was you, you can ask to reveal yourself. They decide whether to see it. Nothing is revealed unless you ask and they accept.",
        ],
      },
    ],
    faqs: [
      {
        question: "Does the recipient need an account or an app?",
        answer: "No. A whisp opens in any web browser from a private link. An account is only needed to keep a longer conversation going or to send whisps of your own.",
      },
      {
        question: "Can the recipient find out who sent it?",
        answer: "Not from Blind Whisper. Your name, email and phone number are never shown, uploaded files are stripped of hidden location and device details, and notifications are delayed so timing doesn't give you away. They only learn who you are if you ask to reveal yourself and they accept.",
      },
      {
        question: "How long does a whisp last?",
        answer: "A whisp sent by link stays available for 48 hours after it's delivered. Uploaded video files are deleted from our storage about 7 days after upload.",
      },
    ],
    cta: {
      heading: "Say what matters — without the awkward part.",
      body: "Create a free account in one tap and send your first whisp in under a minute.",
      label: "Send your first whisp",
      href: "/sign-up",
    },
    related: ["/anonymous-message-link", "/safety", "/ideas", "/faq"],
    updated: MARKETING_UPDATED,
  },
  {
    path: "/anonymous-message-link",
    navLabel: "Whisper Box",
    title: "Get an Anonymous Message Link — Whisper Box",
    description:
      "Whisper Box gives you your own link so anyone can send you an anonymous message — no account needed to send. Share it on Instagram, read messages privately.",
    eyebrow: "Whisper Box",
    h1: "Your own anonymous message link",
    intro:
      "Whisper Box is a personal link you can share anywhere — your Instagram story, your bio, a group chat — so anyone can send you an anonymous message. Senders don't need an account and you never see who wrote what; you read every message privately inside Blind Whisper and can delete any of them or switch your box off at any time.",
    sections: [
      {
        heading: "How Whisper Box works",
        steps: [
          { name: "Turn it on", text: "Create a free Blind Whisper account and switch on your Whisper Box in one tap. You get your own short link." },
          { name: "Share your link", text: "Post it to your story or bio, or send it to friends. Blind Whisper can make a ready-to-post story card for you." },
          { name: "Get anonymous messages", text: "Anyone with the link can write to you anonymously — no sign-up, no download. They can add a nickname if they want to." },
          { name: "Read them privately", text: "Messages arrive in your Whisper Box inbox, with an alert if you've turned alerts on. Delete anything you don't want to keep." },
        ],
      },
      {
        heading: "What makes it different",
        bullets: [
          "Truly anonymous: you never see a sender's name, account, email, phone number or location.",
          "Screened for safety: messages are automatically checked for harassment, threats and explicit content, and flagged messages are reviewed by people.",
          "You stay in control: delete any message, and turn your box off whenever you like.",
          "Part of something bigger: reply privately with videos and notes, join anonymous debates, and post to Blind Circle — all from the same free account.",
        ],
      },
    ],
    faqs: [
      {
        question: "Can I see who sent me a message?",
        answer: "No. Whisper Box messages are anonymous by design — Blind Whisper doesn't show you the sender's name, account, email, phone number or location.",
      },
      {
        question: "Do people need an account to send me a message?",
        answer: "No. Anyone with your link can send a message from their browser. You need a free account to have a Whisper Box and read your messages.",
      },
      {
        question: "Is Whisper Box free?",
        answer: "Yes. Turning on your Whisper Box and receiving messages is free.",
      },
      {
        question: "What if someone sends something hurtful?",
        answer: "Messages are automatically screened for harassment, threats, hate speech and explicit content, and flagged messages are reviewed by people. You can delete any message, and you can turn your box off at any time.",
      },
    ],
    cta: {
      heading: "Find out what people really think.",
      body: "Get your free Whisper Box link in one tap — it takes less than a minute.",
      label: "Get my Whisper Box",
      href: "/sign-up",
    },
    related: ["/how-it-works", "/safety", "/anonymous-debates", "/faq"],
    updated: MARKETING_UPDATED,
  },
  {
    path: "/anonymous-debates",
    navLabel: "Debate Now",
    title: "Debate Now — Anonymous Debates & Honest Opinions",
    description:
      "Ask a question and get honest, anonymous answers. Debate Now on Blind Whisper lets anyone join a debate and answer 100% anonymously — no account needed to answer.",
    eyebrow: "Debate Now",
    h1: "Anonymous debates, honest answers",
    intro:
      "Debate Now is Blind Whisper's space for questions people actually want honest answers to. Anyone can join a debate and answer 100% anonymously, with no account; posting a new debate topic takes a free account, and the topic is published without your name.",
    sections: [
      {
        heading: "Why anonymous works for debate",
        paragraphs: [
          "People say what they really think when their name isn't attached — and listen more openly when they don't know who's talking. Debate Now is built for that: the argument, not the person.",
          "Answers show a per-debate anonymous nickname. If you're signed in, you can answer under your own pseudonymous Whisperer handle — never your real name — and build a following of people who like how you think.",
        ],
      },
      {
        heading: "How to join a debate",
        steps: [
          { name: "Open a debate", text: "Browse the live debates, or open one someone shared with you." },
          { name: "Answer anonymously", text: "Write your answer and post it — no account needed. You can attach a photo, and reply to other answers." },
          { name: "React and follow", text: "Like or dislike answers, share debates you care about, and follow topic authors to see what they post next." },
        ],
      },
      {
        heading: "Kept civil",
        paragraphs: [
          "Debates are screened automatically for harassment, threats, hate speech and explicit content, flagged posts are reviewed by people, and anyone can report a post. The Community Guidelines explain what's encouraged and what isn't allowed.",
        ],
      },
    ],
    faqs: [
      {
        question: "Do I need an account to answer a debate?",
        answer: "No. Anyone can answer a debate anonymously from their browser. You need a free account to post a new debate topic.",
      },
      {
        question: "Is my name shown on a debate I post?",
        answer: "No. Debate topics are published without your name. If you're signed in, your answers show your pseudonymous Whisperer handle, which is never your real name.",
      },
    ],
    cta: {
      heading: "What do you really think?",
      body: "Jump into a live debate and answer anonymously — or start your own.",
      label: "Browse live debates",
      href: "/dt",
    },
    related: ["/anonymous-message-link", "/safety", "/how-it-works", "/faq"],
    updated: MARKETING_UPDATED,
  },
  {
    path: "/ideas",
    navLabel: "What to send",
    title: "What to Send Anonymously — Ideas for Hard-to-Say Messages",
    description:
      "Ideas for anonymous messages that help: encouragement before a big day, an apology, a compliment, a gentle nudge, or a song that says it better than you can.",
    eyebrow: "Ideas",
    h1: "What to send when it's hard to say out loud",
    intro:
      "Anonymous messages work best for the things that are true but hard to say in person: encouragement, appreciation, an apology, or a gentle nudge. A short video plus one honest sentence is often enough — here are ideas that tend to land well, and a few things to avoid.",
    sections: [
      {
        heading: "Ideas that tend to land well",
        bullets: [
          "Encouragement before a big day — an interview, an exam, a first day somewhere new.",
          "\"You're not alone\" for someone going through a hard time, with a video that helped you through something similar.",
          "Appreciation they'd never expect: a coworker who quietly holds the team together, a teacher, a neighbour.",
          "An apology you can't quite say face to face — and, later, the option to reveal it was you.",
          "A song that says what you mean better than you can.",
          "A compliment with no strings attached.",
          "A gentle nudge: \"I've noticed you seem stretched thin lately — this helped me.\"",
          "A hard truth, said kindly, from someone who clearly cares.",
          "Pride in someone who doesn't hear it enough.",
          "A video that made you think of them, just because.",
        ],
      },
      {
        heading: "Make it land",
        bullets: [
          "Keep the note short and specific — one honest sentence beats a paragraph.",
          "Pick a mood so they know the spirit it's sent in.",
          "Think about timing: schedule it for the morning of the big day, not the night before.",
          "Write the way you'd want to be written to.",
        ],
      },
      {
        heading: "What not to send",
        paragraphs: [
          "Anonymity is for kindness and honesty, not for hurting people. Harassment, threats, hate speech, sexual content and anything that endangers someone break the Community Guidelines and Terms, and content is screened automatically and reviewed by people.",
          "If someone may be in immediate danger, an anonymous message isn't enough — contact local emergency services. In the US you can call or text 988, the Suicide & Crisis Lifeline.",
        ],
      },
    ],
    cta: {
      heading: "Someone needs to hear it.",
      body: "Send it anonymously — it takes a minute, and they never have to know it was you.",
      label: "Send a whisp",
      href: "/sign-up",
    },
    related: ["/how-it-works", "/safety", "/anonymous-message-link", "/faq"],
    updated: MARKETING_UPDATED,
  },
  {
    path: "/safety",
    navLabel: "Safety",
    title: "Safety & Anonymity at Blind Whisper",
    description:
      "How Blind Whisper protects your anonymity and keeps people safe: what recipients never see, metadata stripping, delayed alerts, moderation, reporting and limits.",
    eyebrow: "Trust & safety",
    h1: "Safety and anonymity, by design",
    intro:
      "Blind Whisper protects senders' anonymity from the people they message — names, emails, phone numbers and hidden file details are never shown — while screening content for abuse and enforcing clear rules. Anonymity here protects kind and honest messages; it is not a shield for harassment.",
    sections: [
      {
        heading: "What the people you message never see",
        bullets: [
          "Your name, email address, phone number or account details.",
          "Hidden details inside photos and videos you upload — like location and device information. These are stripped before anyone else can download the file.",
          "The exact moment they acted — notifications about opens, replies, likes and comments are delayed by a few minutes so a phone buzzing nearby can't give anyone away.",
          "Whether a particular email address or phone number belongs to a Blind Whisper user.",
        ],
      },
      {
        heading: "Revealing who you are is always a choice",
        paragraphs: [
          "Identity is only shared through the Reveal Flow: the sender asks, and the recipient decides whether to see it. Nobody is revealed by default, by accident, or by a third party.",
        ],
      },
      {
        heading: "Moderation and reporting",
        bullets: [
          "Messages, comments and debate posts are automatically screened for sexual content, harassment, threats, hate speech and incitement.",
          "Anything flagged is reviewed by people, and serious or repeated violations lead to removal and account action.",
          "Anyone can report a post in public spaces like Debate Now and Blind Circle.",
          "Whisper Box owners can delete any message and turn their box off at any time.",
        ],
      },
      {
        heading: "The limits of anonymity",
        paragraphs: [
          "Blind Whisper is for adults 18 and over. Like any online service, we may be required to disclose account information in response to valid legal process such as a court order or subpoena, and we act on serious violations of our Terms. The Privacy Policy explains exactly what we collect and why.",
        ],
      },
    ],
    faqs: [
      {
        question: "Is Blind Whisper really anonymous?",
        answer: "Yes, toward the people you message: they never see your name, email, phone number or account, uploaded files are stripped of hidden location and device data, and notifications are delayed so timing can't identify you. Blind Whisper itself keeps account records and may have to disclose them in response to valid legal process.",
      },
      {
        question: "How old do you have to be to use Blind Whisper?",
        answer: "You must be at least 18 years old to use Blind Whisper.",
      },
      {
        question: "What happens if someone sends something abusive?",
        answer: "Content is screened automatically and flagged content is reviewed by people. Abusive content is removed, and accounts that break the rules can be suspended or terminated.",
      },
    ],
    cta: {
      heading: "Kind words, safely delivered.",
      body: "Create a free account and send your first anonymous whisp.",
      label: "Get started free",
      href: "/sign-up",
    },
    related: ["/how-it-works", "/anonymous-message-link", "/anonymous-debates", "/faq"],
    updated: MARKETING_UPDATED,
  },
  {
    path: "/about",
    navLabel: "About",
    title: "About Blind Whisper",
    description:
      "Blind Whisper is an anonymous messaging app for the things that are easier to send than to say: videos, notes, honest answers and anonymous debates.",
    eyebrow: "About",
    h1: "About Blind Whisper",
    intro:
      "Blind Whisper is an anonymous messaging app for the things that are easier to send than to say out loud. You can send someone a video with a private note, get anonymous messages through your own Whisper Box link, post to the Blind Circle community, and join anonymous debates — without your name attached unless you choose to reveal it.",
    sections: [
      {
        heading: "Why it exists",
        paragraphs: [
          "Most of us have something we'd like to tell someone — encouragement, appreciation, an apology, a hard truth — and don't, because saying it face to face is awkward. Blind Whisper removes the awkward part: the message gets through, and the person who needed it gets it, whether or not they ever learn who sent it.",
        ],
      },
      {
        heading: "What you can do on Blind Whisper",
        bullets: [
          "Whisper Link — send a video and an anonymous note to one person by email; they open it in their browser, no account needed.",
          "Whisper Groups — send the same anonymous whisp to several people at once.",
          "Whisper Box — your own link for receiving anonymous messages.",
          "Debate Now — ask questions and answer debates anonymously.",
          "Blind Circle — an anonymous community feed for videos worth sharing.",
          "Reveal Flow — reveal yourself only if you want to, and only if they agree.",
        ],
      },
      {
        heading: "Principles",
        bullets: [
          "Anonymous by design, not by promise: identity is never shown to the people you message.",
          "Consent before reveal: nobody is identified unless both sides agree.",
          "Kindness over virality: content is screened, and the rules are clear.",
        ],
      },
      {
        heading: "Who runs Blind Whisper",
        paragraphs: [
          "Blind Whisper is a service of TIBLOGICS, part of TILO GROUP, LLC. For help, write to support@blindwhisper.com; for privacy questions, privacy@blindwhisper.com.",
        ],
      },
    ],
    cta: {
      heading: "Try it — it's free.",
      body: "One tap to sign up with Google, and your first whisp is a minute away.",
      label: "Get started free",
      href: "/sign-up",
    },
    related: ["/how-it-works", "/safety", "/anonymous-message-link", "/faq"],
    updated: MARKETING_UPDATED,
  },
  {
    path: "/faq",
    navLabel: "FAQ",
    title: "Blind Whisper FAQ — Anonymous Messages, Answered",
    description:
      "Answers to common questions about Blind Whisper: how anonymity works, whether recipients need an account, replies, revealing yourself, Whisper Box, Debate Now and whether it's free.",
    eyebrow: "FAQ",
    h1: "Frequently asked questions",
    intro:
      "Blind Whisper is an anonymous messaging app: you can send someone a video and a private note without revealing who you are, get anonymous messages through your own Whisper Box link, and join anonymous debates. These are the questions people ask most.",
    sections: [],
    // The same entries as the homepage accordion (lib/faqContent.ts), so the
    // two FAQPage blocks can never disagree.
    faqs: FAQ_ITEMS,
    cta: {
      heading: "Still curious?",
      body: "The quickest way to understand Blind Whisper is to send one. It's free.",
      label: "Get started free",
      href: "/sign-up",
    },
    related: ["/how-it-works", "/safety", "/anonymous-message-link", "/anonymous-debates"],
    updated: MARKETING_UPDATED,
  },
];

export function getMarketingPage(path: string): MarketingPageDef | undefined {
  return MARKETING_PAGES.find((p) => p.path === path);
}
