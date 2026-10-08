// Display names for the video platforms the scraper reports (lower-case ids
// like "youtube"). CSS `capitalize` turns those into "Youtube"/"Tiktok", so
// brand names are spelled out here instead. Brand names are not translated.
const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  vimeo: "Vimeo",
  twitter: "X",
  x: "X",
  reddit: "Reddit",
  twitch: "Twitch",
  dailymotion: "Dailymotion",
  loom: "Loom",
};

/** "youtube" → "YouTube"; unknown ids are capitalized ("other" → "Other"). */
export function platformLabel(platform: string | null | undefined): string {
  if (!platform) return "";
  const key = platform.toLowerCase();
  return PLATFORM_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}
