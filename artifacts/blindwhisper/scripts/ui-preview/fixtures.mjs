// DEV-ONLY API fixtures for the UI preview harness (see README.md).
//
// Every request the app makes to /api/** is answered from the `routes` table
// below by capture.mjs (Playwright page.route). Shapes follow
// lib/api-client-react/src/generated/api.schemas.ts — when a page renders an
// empty/error state, check that file for the type the hook expects and add or
// extend an entry here.
//
// Each route: [METHOD | "*", RegExp matched against the URL pathname, handler]
// handler(ctx) → JSON-serializable body | { __status, __body } for non-200.
// ctx = { url: URL, method, params: RegExp match groups, search: URLSearchParams,
//         body: parsed JSON request body or null, state: per-page mutable object }
//
// Timestamps are relative to "now" so "2h ago" style labels look natural.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const ago = (ms) => new Date(Date.now() - ms).toISOString();
export const fromNow = (ms) => new Date(Date.now() + ms).toISOString();

// Thumbnails point at i.ytimg.com — capture.mjs intercepts that host and
// serves a generated SVG gradient, so nothing goes to the network.
export const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const yt = (id) => ({
  videoUrl: `https://www.youtube.com/watch?v=${id}`,
  videoEmbedUrl: `https://www.youtube.com/embed/${id}`,
  videoThumbnail: thumb(id),
  videoPlatform: "youtube",
});

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

export const PUBLIC_WHISP_TOKEN = "pv_tok_sunrise";
export const WHISPER_BOX_HANDLE = "maya-rivera";

export const profile = {
  id: "usr_preview",
  clerkId: "user_preview",
  email: "maya@example.com",
  fullName: "Maya Rivera",
  avatarUrl: null,
  phone: "+14155550134",
  phoneVerifiedAt: ago(40 * DAY),
  countryCode: "US",
  gender: "woman",
  ageRange: "25-34",
  preferredLanguage: "en",
  whispererHandle: "QuietLantern214",
  whispererAvatarId: "moon-violet",
  whisperBoxHandlePersonalized: true,
  mfaNudgeDismissedAt: ago(2 * DAY),
  plan: "free",
  boostCredits: 12,
  whisperLinksUsed: 7,
  role: "user",
  emailNotificationsEnabled: true,
  showOnlineStatus: true,
  notifyOnNewSignup: false,
  notifyOnNewDebateTopic: false,
  twoFactorEnabled: false,
  createdAt: ago(120 * DAY),
};

const whispBase = {
  senderId: "usr_preview",
  videoStartSeconds: null,
  videoEndSeconds: null,
  videoTranscript: null,
  uploadedVideoId: null,
  circleId: null,
  recipientPhone: null,
  senderAlias: null,
  scheduledAt: null,
  revealRequested: false,
  revealAccepted: null,
  appreciationResponse: null,
  appreciationRespondedAt: null,
  aiTakeaway: null,
  aiTakeawayStatus: null,
  conciergeRequestId: null,
  viewerIsRecipient: false,
  viewerRole: "sender",
  pinned: false,
  archived: false,
  senderHandle: null,
  whisperChannel: "email",
};

export const sentWhisps = [
  {
    ...whispBase,
    ...yt("sunrise01"),
    id: "w_sent_1",
    videoTitle: "The Science of Starting Over — A Short Film",
    deliveryMethod: "whisper_link",
    recipientEmail: "jordan@example.com",
    anonymousNote: "Saw this and immediately thought of you. You're braver than you know.",
    moodTag: "i-see-you",
    status: "replied",
    publicToken: PUBLIC_WHISP_TOKEN,
    deliveredAt: ago(3 * HOUR),
    openedAt: ago(2 * HOUR),
    watchedAt: ago(2 * HOUR - 5 * MIN),
    appreciationResponse: "grateful",
    appreciationRespondedAt: ago(90 * MIN),
    aiTakeaway: "A gentle reminder that beginnings are allowed to be messy.",
    aiTakeawayStatus: "ready",
    createdAt: ago(3 * HOUR),
    pinned: true,
  },
  {
    ...whispBase,
    ...yt("ocean02"),
    id: "w_sent_2",
    videoTitle: "What the Ocean Teaches Us About Patience",
    deliveryMethod: "whisper_link",
    recipientEmail: "sam.lee@example.com",
    anonymousNote: "For the days that feel slow. They count too.",
    moodTag: "heal-together",
    status: "watched",
    publicToken: "pv_tok_ocean",
    deliveredAt: ago(1 * DAY),
    openedAt: ago(20 * HOUR),
    watchedAt: ago(19 * HOUR),
    createdAt: ago(1 * DAY),
  },
  {
    ...whispBase,
    ...yt("laugh03"),
    id: "w_sent_3",
    videoTitle: "Grandma Reviews Every Pizza Topping",
    deliveryMethod: "whisper_link",
    whisperChannel: "sms",
    recipientEmail: null,
    recipientPhone: "+14155550199",
    anonymousNote: "You needed a laugh today. Trust me.",
    moodTag: "just-because",
    status: "opened",
    publicToken: "pv_tok_laugh",
    deliveredAt: ago(2 * DAY),
    openedAt: ago(2 * DAY - 2 * HOUR),
    watchedAt: null,
    createdAt: ago(2 * DAY),
  },
  {
    ...whispBase,
    ...yt("growth04"),
    id: "w_sent_4",
    videoTitle: "Why Discomfort Means You're Growing",
    deliveryMethod: "whisper_link",
    recipientEmail: "alex@example.com",
    anonymousNote: "No pressure. Just something I think you'd get.",
    moodTag: "for-your-growth",
    status: "delivered",
    publicToken: "pv_tok_growth",
    deliveredAt: ago(4 * DAY),
    openedAt: null,
    watchedAt: null,
    createdAt: ago(4 * DAY),
  },
  {
    ...whispBase,
    ...yt("love05"),
    id: "w_sent_5",
    videoTitle: "A Letter to My Best Friend",
    deliveryMethod: "whisper_link",
    recipientEmail: "riley@example.com",
    anonymousNote: "Happy birthday from someone who's glad you exist.",
    moodTag: "i-love-you",
    status: "scheduled",
    publicToken: "pv_tok_love",
    scheduledAt: fromNow(2 * DAY),
    deliveredAt: null,
    openedAt: null,
    watchedAt: null,
    createdAt: ago(5 * HOUR),
  },
  {
    ...whispBase,
    ...yt("think06"),
    id: "w_sent_6",
    videoTitle: "The Overview Effect: Seeing Earth From Space",
    deliveryMethod: "circle_drop",
    recipientEmail: null,
    whisperChannel: null,
    circleId: "c_1",
    anonymousNote: "Perspective, for anyone who needs it this week.",
    moodTag: "think-about-this",
    status: "delivered",
    publicToken: "pv_tok_overview",
    deliveredAt: ago(6 * DAY),
    createdAt: ago(6 * DAY),
  },
];

export const receivedWhisps = [
  {
    ...whispBase,
    ...yt("recv01"),
    id: "w_recv_1",
    senderId: null,
    viewerIsRecipient: true,
    viewerRole: "recipient",
    senderHandle: "Falcon482",
    videoTitle: "How to Be Kind to Yourself on Hard Days",
    deliveryMethod: "whisper_link",
    recipientEmail: null,
    anonymousNote: "I noticed how much you've been carrying lately. This one's for you.",
    moodTag: "heal-together",
    status: "delivered",
    publicToken: "pv_tok_recv1",
    deliveredAt: ago(40 * MIN),
    openedAt: null,
    createdAt: ago(40 * MIN),
  },
  {
    ...whispBase,
    ...yt("recv02"),
    id: "w_recv_2",
    senderId: null,
    viewerIsRecipient: true,
    viewerRole: "recipient",
    senderHandle: "Harbor77",
    videoTitle: "You Are Not Behind",
    deliveryMethod: "whisper_link",
    recipientEmail: null,
    anonymousNote: "Someone who believes in you sent this.",
    moodTag: "i-see-you",
    status: "watched",
    publicToken: "pv_tok_recv2",
    deliveredAt: ago(3 * DAY),
    openedAt: ago(3 * DAY),
    watchedAt: ago(3 * DAY),
    createdAt: ago(3 * DAY),
  },
  {
    ...whispBase,
    ...yt("recv03"),
    id: "w_recv_3",
    senderId: null,
    viewerIsRecipient: true,
    viewerRole: "recipient",
    senderHandle: "Willow903",
    videoTitle: "The Joy of Small Things",
    deliveryMethod: "whisper_link",
    recipientEmail: null,
    anonymousNote: null,
    moodTag: "just-because",
    status: "replied",
    publicToken: "pv_tok_recv3",
    deliveredAt: ago(8 * DAY),
    openedAt: ago(8 * DAY),
    watchedAt: ago(8 * DAY),
    createdAt: ago(8 * DAY),
  },
];

const allWhisps = [...sentWhisps, ...receivedWhisps];

const reply = (o) => ({
  videoUrl: null,
  videoTitle: null,
  videoThumbnail: null,
  videoEmbedUrl: null,
  videoPlatform: null,
  moodTag: null,
  parentReplyId: null,
  readAt: null,
  isGuess: false,
  guessReaction: null,
  ...o,
});

export const repliesByWhisp = {
  w_sent_1: [
    reply({ id: "r1", whispId: "w_sent_1", replyText: "Okay this genuinely made me cry a little. Thank you, whoever you are 💜", fromRecipient: true, createdAt: ago(100 * MIN), readAt: ago(95 * MIN) }),
    reply({ id: "r2", whispId: "w_sent_1", replyText: "I'm really glad it found you at the right time.", fromRecipient: false, createdAt: ago(80 * MIN), readAt: ago(70 * MIN) }),
    reply({ id: "r3", whispId: "w_sent_1", replyText: "Is this Priya?? You always know what to say", fromRecipient: true, isGuess: true, guessReaction: null, createdAt: ago(60 * MIN) }),
    reply({ id: "r4", whispId: "w_sent_1", replyText: "Also — the part at 3:40 about the lighthouse. Wow.", fromRecipient: true, parentReplyId: "r2", createdAt: ago(25 * MIN) }),
  ],
  w_sent_2: [
    reply({ id: "r5", whispId: "w_sent_2", replyText: "Needed this today. Saving it.", fromRecipient: true, createdAt: ago(18 * HOUR) }),
  ],
  w_recv_3: [
    reply({ id: "r6", whispId: "w_recv_3", replyText: "This made my whole week, thank you!", fromRecipient: true, createdAt: ago(7 * DAY), readAt: ago(7 * DAY) }),
    reply({ id: "r7", whispId: "w_recv_3", replyText: "Anytime. Keep noticing the small stuff ✨", fromRecipient: false, createdAt: ago(6 * DAY) }),
  ],
};

const circleComment = (o) => ({
  parentCommentId: null,
  isPoster: false,
  isOwnComment: false,
  imageUrl: null,
  likeCount: 0,
  dislikeCount: 0,
  viewerReaction: null,
  ...o,
});

export function whispDetail(id) {
  const whisp = allWhisps.find((w) => w.id === id) ?? { ...sentWhisps[0], id };
  const isCircle = whisp.deliveryMethod === "circle_drop";
  return {
    whisp,
    trackingEvents: [
      { id: "te1", whispId: whisp.id, eventType: "delivered", createdAt: whisp.deliveredAt ?? whisp.createdAt },
      ...(whisp.openedAt ? [{ id: "te2", whispId: whisp.id, eventType: "opened", createdAt: whisp.openedAt }] : []),
      ...(whisp.watchedAt ? [{ id: "te3", whispId: whisp.id, eventType: "watched", createdAt: whisp.watchedAt }] : []),
      ...(whisp.appreciationRespondedAt ? [{ id: "te4", whispId: whisp.id, eventType: "appreciated", createdAt: whisp.appreciationRespondedAt }] : []),
    ],
    replies: repliesByWhisp[whisp.id] ?? [],
    recipientRepliesRemaining: null,
    viewCount: isCircle ? 214 : 0,
    likeCount: isCircle ? 37 : 0,
    comments: isCircle
      ? [
          circleComment({ id: "cc1", commentText: "Watched this on my lunch break and felt tiny in the best way.", handle: "SwiftFalcon482", createdAt: ago(5 * DAY), likeCount: 12 }),
          circleComment({ id: "cc2", commentText: "Thank you for posting this.", handle: "MistyHarbor12", createdAt: ago(4 * DAY), likeCount: 3 }),
        ]
      : [],
    circleConversations: [],
  };
}

export const publicWhisp = {
  id: "w_sent_1",
  viewerArchived: false,
  viewerPinned: false,
  senderHandle: null,
  ...yt("sunrise01"),
  videoStartSeconds: null,
  videoEndSeconds: null,
  videoTitle: "The Science of Starting Over — A Short Film",
  anonymousNote:
    "Saw this and immediately thought of you. I know the last few months have been a lot — you've handled them with more grace than you give yourself credit for. You're braver than you know.",
  senderAlias: "Someone who's rooting for you",
  moodTag: "i-see-you",
  revealRequested: false,
  groupSize: null,
  appreciationResponse: null,
  expiresAt: fromNow(6 * DAY),
  reminderCount: 0,
  expired: false,
  hasUpload: false,
  aiTakeaway: "A gentle reminder that beginnings are allowed to be messy — and that starting over is a skill, not a failure.",
  aiTakeawayStatus: "ready",
  replies: [
    reply({ id: "pr1", whispId: "w_sent_1", replyText: "Okay this genuinely made me cry a little. Thank you, whoever you are 💜", fromRecipient: true, createdAt: ago(100 * MIN), readAt: ago(95 * MIN) }),
    reply({ id: "pr2", whispId: "w_sent_1", replyText: "I'm really glad it found you at the right time.", fromRecipient: false, createdAt: ago(80 * MIN) }),
  ],
  recipientRepliesRemaining: 3,
  videoRepliesAllowed: false,
  hasWatched: false,
  hasOpenedBefore: false,
  deliveryMethod: "whisper_link",
  likeCount: 0,
  viewerHasLiked: false,
  comments: [],
};

// ---------------------------------------------------------------------------
// Debate topics
// ---------------------------------------------------------------------------

export const debateTopics = [
  { id: "dt_1", topicText: "Is it ever okay to read your partner's texts?", authorHandle: "SwiftFalcon482", authorAvatarId: "flame-violet", commentCount: 48, rewhispCount: 12, createdAt: ago(2 * HOUR) },
  { id: "dt_2", topicText: "Remote work is making us lonelier, not happier.", authorHandle: "QuietLantern214", authorAvatarId: "moon-violet", commentCount: 31, rewhispCount: 7, createdAt: ago(9 * HOUR) },
  { id: "dt_3", topicText: "Should you tell a friend their partner is cheating?", authorHandle: "AmberComet55", authorAvatarId: "star-amber", commentCount: 112, rewhispCount: 40, createdAt: ago(1 * DAY) },
  { id: "dt_4", topicText: "Pineapple on pizza is a personality test.", authorHandle: "VelvetOtter9", authorAvatarId: "zap-rose", commentCount: 7, rewhispCount: 1, createdAt: ago(2 * DAY) },
  { id: "dt_5", topicText: "Ghosting is sometimes the kindest option.", authorHandle: "MistyHarbor12", authorAvatarId: "ghost-violet", commentCount: 64, rewhispCount: 18, createdAt: ago(3 * DAY) },
  { id: "dt_6", topicText: "Social media did more good than harm for our generation.", authorHandle: "CedarWren31", authorAvatarId: "feather-amber", commentCount: 0, rewhispCount: 0, createdAt: ago(4 * DAY) },
];

const dtComment = (o) => ({
  parentCommentId: null,
  isPoster: false,
  isOwnComment: false,
  commentAuthorFollowed: false,
  imageUrl: null,
  likeCount: 0,
  dislikeCount: 0,
  viewerReaction: null,
  avatarId: null,
  ...o,
});

export function debateTopicDetail(id, signedIn) {
  const t = debateTopics.find((d) => d.id === id) ?? debateTopics[0];
  return {
    id: t.id,
    topicText: t.topicText,
    createdAt: t.createdAt,
    isOwnTopic: false,
    authorHandle: t.authorHandle,
    authorAvatarId: t.authorAvatarId,
    authorFollowed: signedIn ? false : null,
    authorFollowerCount: 128,
    commentCount: t.commentCount,
    rewhispCount: t.rewhispCount,
    viewerRewhisped: false,
    comments: [
      dtComment({ id: "dc1", commentText: "Never. Trust is the whole foundation — if you feel the need to check, the problem already exists.", handle: "AmberComet55", avatarId: "star-amber", likeCount: 24, dislikeCount: 3, createdAt: ago(100 * MIN), commentAuthorFollowed: signedIn ? true : null }),
      dtComment({ id: "dc2", commentText: "Hot take: if they're hiding something big, you deserve to know. Context matters.", handle: "VelvetOtter9", avatarId: "zap-rose", likeCount: 9, dislikeCount: 11, createdAt: ago(90 * MIN), viewerReaction: signedIn ? "like" : null, commentAuthorFollowed: signedIn ? false : null }),
      dtComment({ id: "dc3", commentText: "Agree with this. Talk first, snoop never.", parentCommentId: "dc1", handle: "MistyHarbor12", avatarId: "ghost-violet", likeCount: 6, createdAt: ago(70 * MIN), commentAuthorFollowed: signedIn ? false : null }),
      dtComment({ id: "dc4", commentText: "I posted this because I genuinely can't decide. Keep them coming.", isPoster: true, handle: t.authorHandle, avatarId: t.authorAvatarId, likeCount: 4, createdAt: ago(60 * MIN), commentAuthorFollowed: signedIn ? false : null }),
      dtComment({ id: "dc5", commentText: "Depends entirely on whether you've already asked them directly.", handle: "BrightMoth70", avatarId: null, likeCount: 2, createdAt: ago(20 * MIN), commentAuthorFollowed: null }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Circle feed, Whisper Box, notifications, suggestions…
// ---------------------------------------------------------------------------

export const circleFeed = [
  { id: "cf1", ...yt("circle01"), videoTitle: "Morning Pages Changed My Life", anonymousNote: "Started this two weeks ago. My head has never been quieter.", senderAlias: null, moodTag: "for-your-growth", publicToken: "pv_tok_cf1", createdAt: ago(25 * MIN) },
  { id: "cf2", ...yt("circle02"), videoTitle: "Tiny Kitten Discovers Snow", anonymousNote: "No deep message. Just joy.", senderAlias: "a cat person", moodTag: "just-because", publicToken: "pv_tok_cf2", createdAt: ago(3 * HOUR) },
  { id: "cf3", ...yt("think06"), videoTitle: "The Overview Effect: Seeing Earth From Space", anonymousNote: "Perspective, for anyone who needs it this week.", senderAlias: null, moodTag: "think-about-this", publicToken: "pv_tok_overview", createdAt: ago(6 * DAY) },
  { id: "cf4", ...yt("circle04"), videoTitle: "It's Okay to Rest", anonymousNote: null, senderAlias: null, moodTag: "heal-together", publicToken: "pv_tok_cf4", createdAt: ago(7 * DAY) },
];

export const whisperBoxMessages = [
  { id: "wb1", recipientUserId: "usr_preview", messageText: "You probably don't know this, but the way you spoke up in Thursday's meeting gave me the courage to do the same. Thank you.", senderAlias: "a quiet coworker", status: "unread", readAt: null, removedByAdminAt: null, createdAt: ago(35 * MIN) },
  { id: "wb2", recipientUserId: "usr_preview", messageText: "Your playlist recommendations are elite. Please never stop.", senderAlias: null, status: "unread", readAt: null, removedByAdminAt: null, createdAt: ago(5 * HOUR) },
  { id: "wb3", recipientUserId: "usr_preview", messageText: "Honest question: what's one thing you wish people asked you more?", senderAlias: "curious", status: "read", readAt: ago(1 * DAY), removedByAdminAt: null, createdAt: ago(2 * DAY) },
  { id: "wb4", recipientUserId: "usr_preview", messageText: "You were right about the book. I finished it in one night.", senderAlias: null, status: "read", readAt: ago(4 * DAY), removedByAdminAt: null, createdAt: ago(5 * DAY) },
];

export const notifications = [
  { id: "n1", title: "New reply on your whisp", body: "Someone replied to “The Science of Starting Over”.", url: "/whisps/w_sent_1", kind: "reply", createdAt: ago(25 * MIN), read: false },
  { id: "n2", title: "You received a whisp", body: "Someone sent you a video with a note.", url: "/whisps/w_recv_1", kind: "received", createdAt: ago(40 * MIN), read: false },
  { id: "n3", title: "Your whisp was watched", body: "“What the Ocean Teaches Us About Patience” was watched.", url: "/whisps/w_sent_2", kind: "watched", createdAt: ago(19 * HOUR), read: false },
  { id: "n4", title: "Someone appreciated your whisp", body: "They said: grateful.", url: "/whisps/w_sent_1", kind: "appreciation", createdAt: ago(90 * MIN), read: true },
  { id: "n5", title: "New Whisper Box message", body: "You have a new anonymous message.", url: "/whisper-box", kind: "whisper_box", createdAt: ago(5 * HOUR), read: true },
].map((n) => ({ targetUserId: "usr_preview", targetUserEmail: null, createdByAdminId: null, createdByAdminEmail: null, ...n }));

const suggestion = (id, title, cats, featured = true) => ({
  id: `sg_${id}`,
  ...yt(id),
  videoTitle: title,
  authorName: "Creator",
  categories: cats,
  aiSummary: null,
  aiSummaryStatus: null,
  featured,
  status: "published",
  source: "admin",
  addedByUserId: null,
  createdAt: ago(10 * DAY),
  publishedAt: ago(10 * DAY),
});

export const suggestions = [
  suggestion("sugg01", "How to Be Kind to Yourself on Hard Days", ["encouragement"]),
  suggestion("sugg02", "The Power of Vulnerability", ["growth"]),
  suggestion("sugg03", "A Pep Talk From a Kid President", ["funny", "encouragement"]),
  suggestion("sugg04", "Why We Need Friends More Than Ever", ["friendship"]),
  suggestion("sugg05", "Breathe: A 3-Minute Reset", ["calm"]),
  suggestion("sugg06", "Letters to Your Future Self", ["growth"]),
];

const suggestionCategories = [
  { key: "encouragement", label: "Encouragement" },
  { key: "growth", label: "Personal growth" },
  { key: "funny", label: "Funny" },
  { key: "friendship", label: "Friendship" },
  { key: "calm", label: "Calm" },
];

export const recap = {
  period: "all_time",
  totalSent: 23,
  totalReceived: 9,
  repliesReceived: 14,
  circlePosts: 3,
  debateTopicsPosted: 2,
  followerCount: 41,
  whisperBoxMessagesReceived: 18,
  topCategory: "encouragement",
  memberSince: profile.createdAt,
  whispererHandle: profile.whispererHandle,
  whisperBoxHandle: WHISPER_BOX_HANDLE,
};

export const stats = {
  totalSent: 23,
  totalOpened: 19,
  totalWatched: 16,
  totalReplied: 9,
  totalAppreciated: 7,
  deliveryRate: 0.96,
  openRate: 0.83,
  boostCredits: profile.boostCredits,
  plan: profile.plan,
  recentWhisps: sentWhisps.slice(0, 4),
};

export const creditTransactions = [
  { id: "ct1", userId: "usr_preview", type: "purchase", amount: 10, whispId: null, createdAt: ago(9 * DAY) },
  { id: "ct2", userId: "usr_preview", type: "boost", amount: -1, whispId: "w_sent_6", createdAt: ago(6 * DAY) },
  { id: "ct3", userId: "usr_preview", type: "bonus", amount: 3, whispId: null, createdAt: ago(30 * DAY) },
];

export const circles = [
  { id: "c_1", name: "Sunday Book Club", isOwner: true, inviteCode: "BOOKS42", createdAt: ago(40 * DAY) },
  { id: "c_2", name: "Design Team", isOwner: false, inviteCode: "DSGN7", createdAt: ago(20 * DAY) },
];

export const textWhisps = [
  { id: "tw1", senderId: "usr_preview", viewerIsRecipient: false, recipientPhone: "+14155550123", publicToken: "pv_tw1", senderAlias: null, messageText: "Hey — just wanted to say you crushed that presentation today.", status: "replied", revealRequested: false, revealAccepted: null, scheduledAt: null, readAt: ago(2 * HOUR), createdAt: ago(3 * HOUR), otherPartyTyping: false, revealedSenderName: null, senderHandle: null },
];

// ---------------------------------------------------------------------------
// Route table. First match wins — put specific paths before generic ones.
// ---------------------------------------------------------------------------

const ok = { ok: true };

export const routes = [
  // --- global / chrome ---
  ["GET", /^\/api\/config$/, () => ({ smsDeliveryEnabled: false, whatsappDeliveryEnabled: false })],
  ["GET", /^\/api\/healthz$/, () => ({ status: "ok" })],
  ["GET", /^\/api\/user\/profile$/, () => profile],
  ["PATCH", /^\/api\/user\/profile$/, ({ body }) => ({ ...profile, ...(body ?? {}) })],
  ["GET", /^\/api\/user\/policy-status$/, () => ({ pending: [] })],
  ["GET", /^\/api\/user\/recap$/, () => recap],
  ["GET", /^\/api\/user\/notifications\/unread-count$/, () => ({ unreadCount: 3, unreadReplyCount: 1 })],
  ["GET", /^\/api\/user\/notifications$/, () => ({ items: notifications, unreadCount: 3 })],
  ["GET", /^\/api\/user\/recent-recipients$/, () => ({
    items: [
      { value: "jordan@example.com", kind: "email", lastUsedAt: ago(3 * HOUR), useCount: 4 },
      { value: "sam.lee@example.com", kind: "email", lastUsedAt: ago(1 * DAY), useCount: 2 },
    ],
  })],
  ["GET", /^\/api\/user\/push-public-key$/, () => ({ publicKey: "BPreviewKey" })],
  ["POST", /^\/api\/user\/sms-consent\/check$/, () => ({ consented: [] })],
  ["GET", /^\/api\/whisps\/received-unread-count$/, () => ({ unreadCount: 1 })],
  ["GET", /^\/api\/whisper-box\/unread-count$/, () => ({ unreadCount: 2 })],

  // --- whisps ---
  ["GET", /^\/api\/whisps\/stats$/, () => stats],
  ["GET", /^\/api\/whisps$/, ({ search }) => {
    const box = search.get("box") ?? "sent";
    if (box === "received") return receivedWhisps;
    if (box === "archived") return [];
    return sentWhisps;
  }],
  ["GET", /^\/api\/whisps\/([^/]+)\/replies$/, ({ params }) => repliesByWhisp[params[1]] ?? []],
  ["GET", /^\/api\/whisps\/([^/]+)\/matches$/, () => ({ matchedCount: 12, openedCount: 9, watchedCount: 7, repliedCount: 2, appreciatedCount: 3 })],
  ["GET", /^\/api\/whisps\/([^/]+)$/, ({ params }) => whispDetail(params[1])],
  ["POST", /^\/api\/whisps\/note-suggestions$/, () => ({ suggestions: ["Thought of you the second I saw this.", "No reason. Just because you matter.", "For the version of you that's still figuring it out."] })],

  // --- public recipient page ---
  ["GET", /^\/api\/public\/w\/([^/]+)$/, ({ params }) => ({ ...publicWhisp, id: params[1] === PUBLIC_WHISP_TOKEN ? publicWhisp.id : `pw_${params[1]}` })],
  ["*", /^\/api\/public\/w\/[^/]+\/.*$/, () => ok],

  // --- debate topics ---
  ["GET", /^\/api\/debate-topics\/my-stats$/, () => ({ topicsPosted: 2, commentsReceived: 79, rewhispsReceived: 19, commentsPosted: 34, commentLikesReceived: 112 })],
  ["GET", /^\/api\/debate-topics\/following-feed$/, () => ({ items: debateTopics.slice(0, 3), nextCursor: null })],
  ["GET", /^\/api\/(?:public\/)?debate-topics$/, () => ({ items: debateTopics, nextCursor: null })],
  ["GET", /^\/api\/(?:public\/)?debate-topics\/([^/]+)$/, ({ params, state }) => debateTopicDetail(params[1], !state.signedOut)],
  ["GET", /^\/api\/follows\/stats$/, () => ({ followerCount: 41, followingCount: 17 })],
  ["GET", /^\/api\/follows\/online-status$/, () => ({ online: { AmberComet55: true } })],

  // --- circle ---
  ["GET", /^\/api\/circles$/, () => circles],
  ["GET", /^\/api\/circles\/([^/]+)\/feed$/, () => ({ items: circleFeed, nextCursor: null })],
  ["GET", /^\/api\/public\/circle$/, () => ({ items: circleFeed, nextCursor: null })],

  // --- whisper box ---
  ["GET", /^\/api\/public\/whisper-box\/([^/]+)$/, ({ params }) => ({ handle: params[1], avatarId: "moon-violet" })],
  ["GET", /^\/api\/whisper-box$/, () => ({ items: whisperBoxMessages })],

  // --- money / misc ---
  ["GET", /^\/api\/credits\/transactions$/, () => creditTransactions],
  ["GET", /^\/api\/suggestions$/, ({ search }) => ({
    items: search.get("featured") === "true" ? suggestions.filter((s) => s.featured) : suggestions,
    categories: suggestionCategories,
  })],
  ["GET", /^\/api\/invites$/, () => []],
  ["GET", /^\/api\/text-whisps$/, () => textWhisps],
  ["GET", /^\/api\/whisper-groups$/, () => []],
  ["GET", /^\/api\/whisper-groups\/sends$/, () => []],
  ["GET", /^\/api\/media$/, () => []],

  // --- fire-and-forget telemetry ---
  ["POST", /^\/api\/public\/(visitor-ping|usage-events|bug-reports)$/, () => ({ __status: 204 })],
];

/**
 * Scenario overrides, selected per screen in capture.mjs (`scenario: "empty"`).
 * Each is a route table consulted BEFORE the default one.
 */
export const scenarios = {
  empty: [
    ["GET", /^\/api\/whisps$/, () => []],
    ["GET", /^\/api\/whisps\/stats$/, () => ({ ...stats, totalSent: 0, totalOpened: 0, totalWatched: 0, totalReplied: 0, totalAppreciated: 0, deliveryRate: 0, openRate: 0, recentWhisps: [] })],
    ["GET", /^\/api\/whisper-box$/, () => ({ items: [] })],
    ["GET", /^\/api\/whisps\/received-unread-count$/, () => ({ unreadCount: 0 })],
    ["GET", /^\/api\/whisper-box\/unread-count$/, () => ({ unreadCount: 0 })],
    ["GET", /^\/api\/user\/notifications\/unread-count$/, () => ({ unreadCount: 0, unreadReplyCount: 0 })],
    ["GET", /^\/api\/user\/notifications$/, () => ({ items: [], unreadCount: 0 })],
    ["GET", /^\/api\/(?:public\/circle|circles\/[^/]+\/feed)$/, () => ({ items: [], nextCursor: null })],
  ],
  // Never answers — shows loading skeletons/spinners.
  loading: [["GET", /^\/api\/(?!config$).*/, () => ({ __hang: true })]],
};
