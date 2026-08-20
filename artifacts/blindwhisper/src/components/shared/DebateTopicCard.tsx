import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { MessageCircle, Repeat2, Share2, ArrowRight } from "lucide-react";
import type { DebateTopicFeedItem } from "@workspace/api-client-react";
import { AvatarCircle } from "@/components/shared/AvatarCircle";

// Deterministic-ish "randomness" (by id) so the same topic doesn't jump
// between accent colors on every re-render/refetch — purely decorative, a
// little visual variety across the feed instead of one flat repeating card.
const ACCENTS = [
  { glow: "rgba(124,92,252,0.18)", text: "text-primary" },
  { glow: "rgba(236,72,153,0.16)", text: "text-[#EC4899]" },
  { glow: "rgba(45,212,191,0.16)", text: "text-[#2DD4BF]" },
  { glow: "rgba(251,191,36,0.16)", text: "text-[#FBBF24]" },
];
function accentFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[hash % ACCENTS.length]!;
}

// Shared by DebateTopics.tsx (the public feed) and DebateFollowing.tsx (the
// following feed) — same card, same accent-by-id styling, so a topic reads
// identically wherever it shows up.
export function DebateTopicCard({ topic }: { topic: DebateTopicFeedItem }) {
  const { toast } = useToast();
  const { t } = useTranslation("sharedA");
  const accent = accentFor(topic.id);

  // Distinct from "rewhisp" (the retweet-style boost on the detail page) —
  // this just gets the topic's link in front of someone so they can join the
  // debate, same clipboard-copy pattern as MyCircles.tsx's invite code copy.
  function handleShareTopic(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const url = `${window.location.origin}/debate-topics/${topic.id}`;
    if (navigator.share) {
      // Left in English in every language — this is a proper-noun share-sheet
      // title (brand name + feature name), not a translatable sentence.
      navigator.share({ title: t("debateTopicCard.shareTitle"), url }).catch(() => {});
      return;
    }
    navigator.clipboard.writeText(url).then(() => toast({ title: t("debateTopicCard.linkCopied") }));
  }

  return (
    <Link href={`/debate-topics/${topic.id}`}>
      {/* Gilded frame (see index.css's --gilded token, same one
          WhispsList.tsx uses for its pin ring) around every topic
          card, on top of the per-topic accent glow. */}
      <article
        className="group relative rounded-2xl border border-gilded/40 bg-card hover:bg-card/80 transition-all cursor-pointer p-6 overflow-hidden"
        style={{ boxShadow: `0 0 28px ${accent.glow}` }}
        data-testid={`debate-topic-${topic.id}`}
      >
        <div
          className="absolute -top-6 -right-4 text-7xl font-serif select-none pointer-events-none opacity-[0.06] leading-none"
          aria-hidden
        >
          &rdquo;
        </div>
        {/* X/Twitter-style byline — avatar left of the handle, post text
            below spanning the full card width. */}
        <div className="relative flex items-center gap-2.5 mb-2" data-testid={`text-author-${topic.id}`}>
          <AvatarCircle avatarId={topic.authorAvatarId} handle={topic.authorHandle} size="sm" />
          <span className="text-sm font-medium text-foreground">{topic.authorHandle}</span>
        </div>
        <p className="relative font-serif text-xl md:text-2xl font-bold text-foreground leading-snug tracking-tight pr-6">
          {topic.topicText}
        </p>
        <div className="relative flex items-center justify-between gap-3 mt-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${accent.text}`}>
              <MessageCircle className="w-3.5 h-3.5" />
              {t("debateTopicCard.commentCount", { count: topic.commentCount })}
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Repeat2 className="w-3.5 h-3.5" />
              {topic.rewhispCount}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleShareTopic}
              aria-label={t("debateTopicCard.shareTopicAria")}
              className="p-1.5 -m-1.5 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              data-testid={`button-share-${topic.id}`}
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
            <span className="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground transition-colors">
              {t("debateTopicCard.joinDebate")} <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
