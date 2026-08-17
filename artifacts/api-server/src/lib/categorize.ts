// A fixed taxonomy (more than 3 categories) that every whisped video is
// scored against. Deliberately keyword/heuristic-based rather than a
// call to an external ML classifier — cheap, deterministic, and testable
// without network access, at the cost of being a blunter signal than a real
// model would give. Title matches count for more than transcript matches
// (3x) since the title is a stronger, human-authored signal; transcript
// matches (when a transcript was fetchable) add supporting evidence on top,
// which is what "confirms" the category pick in the product ask.
export const VIDEO_CATEGORIES = [
  {
    key: "motivational",
    label: "Motivational & Inspirational",
    keywords: ["motivation", "motivational", "inspire", "inspiration", "inspiring", "mindset", "discipline", "hustle", "self improvement", "self-improvement", "growth mindset", "never give up", "overcome", "success habits"],
  },
  {
    key: "music",
    label: "Music",
    keywords: ["music", "song", "lyrics", "album", "remix", "official video", "official audio", "cover", "acoustic", "concert", "live performance", "beat", "playlist"],
  },
  {
    key: "comedy",
    label: "Comedy",
    keywords: ["funny", "comedy", "prank", "meme", "hilarious", "joke", "sketch", "stand up", "stand-up", "parody", "fail compilation"],
  },
  {
    key: "education",
    label: "Education & How-To",
    keywords: ["how to", "tutorial", "explained", "lesson", "course", "learn", "guide", "tips", "lecture", "study", "explainer"],
  },
  {
    key: "relationships-love",
    label: "Relationships & Love",
    keywords: ["love", "relationship", "boyfriend", "girlfriend", "dating", "breakup", "crush", "marriage", "wedding", "romance", "couple goals", "soulmate"],
  },
  {
    key: "spiritual-faith",
    label: "Spiritual & Faith",
    keywords: ["god", "faith", "prayer", "bible", "jesus", "spiritual", "meditation", "blessing", "church", "worship", "quran", "sermon", "gospel"],
  },
  {
    key: "fitness-health",
    label: "Fitness & Health",
    keywords: ["workout", "fitness", "gym", "exercise", "health", "diet", "nutrition", "weight loss", "yoga", "cardio", "training plan"],
  },
  {
    key: "food-cooking",
    label: "Food & Cooking",
    keywords: ["recipe", "cooking", "food", "kitchen", "chef", "baking", "meal prep", "restaurant review", "delicious", "foodie"],
  },
  {
    key: "travel",
    label: "Travel",
    keywords: ["travel", "trip", "vacation", "destination", "explore", "adventure", "flight", "hotel", "backpacking", "tour guide"],
  },
  {
    key: "gaming",
    label: "Gaming",
    keywords: ["gameplay", "gaming", "playthrough", "streamer", "esports", "level up", "boss fight", "walkthrough", "speedrun"],
  },
  {
    key: "news-politics",
    label: "News & Politics",
    keywords: ["breaking news", "politics", "election", "government", "president", "policy", "debate", "senate", "protest"],
  },
  {
    key: "sports",
    label: "Sports",
    keywords: ["football", "basketball", "soccer", "match highlights", "goal", "championship", "highlights", "athlete", "nba", "nfl", "world cup"],
  },
  {
    key: "family-kids",
    label: "Family & Kids",
    keywords: ["family", "kids", "children", "parenting", "toddler", "family time", "family vlog", "newborn"],
  },
  {
    key: "diy-howto",
    label: "DIY & Projects",
    keywords: ["diy", "build a", "fix your", "repair", "life hack", "home project", "homemade", "craft tutorial", "woodworking"],
  },
  {
    key: "entertainment-pop-culture",
    label: "Entertainment & Pop Culture",
    keywords: ["movie trailer", "celebrity", "tv show", "series", "review", "reaction", "pop culture", "red carpet", "premiere"],
  },
] as const;

export type CategoryKey = (typeof VIDEO_CATEGORIES)[number]["key"] | "uncategorized";

export type CategoryScore = { category: CategoryKey; score: number };

function countMatches(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

// Returns the top 3 ranked category matches (rank 1 = best fit), or a single
// "uncategorized" entry when nothing in the taxonomy matched at all.
export function categorizeVideo(title: string | null | undefined, transcript: string | null | undefined): CategoryScore[] {
  const titleText = (title ?? "").toLowerCase();
  const transcriptText = (transcript ?? "").toLowerCase();

  const scored: CategoryScore[] = VIDEO_CATEGORIES.map((c) => {
    const titleHits = c.keywords.reduce((sum, kw) => sum + countMatches(titleText, kw), 0);
    const transcriptHits = c.keywords.reduce((sum, kw) => sum + countMatches(transcriptText, kw), 0);
    return { category: c.key, score: titleHits * 3 + transcriptHits };
  });

  const withHits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (withHits.length === 0) return [{ category: "uncategorized", score: 0 }];
  return withHits.slice(0, 3);
}
