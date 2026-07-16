// Keep in sync with artifacts/api-server/src/lib/categorize.ts's VIDEO_CATEGORIES —
// frontend and backend don't share a constants module (same pattern as the
// HOOK_LINE copy noted in replit.md).
export const VIDEO_CATEGORY_LABELS: Record<string, string> = {
  motivational: "Motivational & Inspirational",
  music: "Music",
  comedy: "Comedy",
  education: "Education & How-To",
  "relationships-love": "Relationships & Love",
  "spiritual-faith": "Spiritual & Faith",
  "fitness-health": "Fitness & Health",
  "food-cooking": "Food & Cooking",
  travel: "Travel",
  gaming: "Gaming",
  "news-politics": "News & Politics",
  sports: "Sports",
  "family-kids": "Family & Kids",
  "diy-howto": "DIY & Projects",
  "entertainment-pop-culture": "Entertainment & Pop Culture",
  uncategorized: "Uncategorized",
};

export function categoryLabel(key: string): string {
  return VIDEO_CATEGORY_LABELS[key] ?? key;
}
