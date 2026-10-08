import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { MessageCircle, Repeat2, Share2, ArrowRight } from "lucide-react";
import type { DebateTopicFeedItem } from "@workspace/api-client-react";
import { AvatarCircle } from "@/components/shared/AvatarCircle";
import { formatTimeAgo } from "@/lib/relativeTime";

// Shared by DebateTopics.tsx (the public feed) and DebateFollowing.tsx (the
// following feed) — same card, same styling, so a topic reads identically
// wherever it shows up. Every card uses the same violet comment accent (no
// per-topic colour) so the feed reads as one calm, consistent list.
export function DebateTopicCard({
  topic,
  authorOnline = false,
}: {
  topic: DebateTopicFeedItem;
  /** Only ever passed from DebateFollowing.tsx, where authorHandle is
   * necessarily a followed account — see GET /follows/online-status. The
   * public feed (DebateTopics.tsx) never passes this, so it never shows a
   * dot: presence is scoped to follower/followed pairs, not "any author". */
  authorOnline?: boolean;
}) {
  const { toast } = useToast();
  const { t } = useTranslation("sharedA");

  // Distinct from "rewhisp" (the retweet-style boost on the detail page) —
  // this just gets the topic's link in front of someone so they can join the
  // debate, same clipboard-copy pattern as MyCircles.tsx's invite code copy.
  function handleShareTopic(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Routed through /dt/:id (routes/debateTopicLink.ts, served by the API
    // server at a bare top-level prefix), NOT the SPA's own
    // /debate-topics/:id — in production the frontend is static files
    // serving the same index.html for every route, so that URL can't unfurl
    // this topic's text in iMessage/WhatsApp/etc. /dt/:id does: a browser
    // bounces straight to /debate-topics/:id, a link-preview crawler gets
    // real Open Graph tags for THIS topic, and it's the topic's canonical,
    // search-indexable URL too.
    const url = `${window.location.origin}/dt/${topic.id}`;
    if (navigator.share) {
      // `text` rides along in share targets that show a message body
      // (WhatsApp, Messages), so the invite reads right even before the
      // link preview loads.
      navigator.share({ title: t("debateTopicCard.shareTitle"), text: t("debateTopicCard.shareText"), url }).catch(() => {});
      return;
    }
    navigator.clipboard
      .writeText(url)
      .then(() => toast({ title: t("debateTopicCard.linkCopied") }))
      // A rejected clipboard write (permissions, unfocused document) should
      // say so rather than vanish silently.
      .catch(() => toast({ title: t("debateTopicCard.copyFailed"), variant: "destructive" }));
  }

  return (
    <Link
      href={`/debate-topics/${topic.id}`}
      className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      {/* Gilded hairline frame (see index.css's --gilded token, same one
          WhispsList.tsx uses for its pin ring) around every topic card —
          kept subtle at rest, brightening on hover. */}
      <article
        className="group relative rounded-2xl border border-gilded/25 bg-card hover:border-gilded/45 hover:bg-card/80 transition-colors duration-200 ease-out cursor-pointer p-5 sm:p-6 overflow-hidden"
        data-testid={`debate-topic-${topic.id}`}
      >
        <div
          className="absolute top-2 right-4 text-7xl font-serif select-none pointer-events-none opacity-[0.06] leading-none"
          aria-hidden
        >
          &rdquo;
        </div>
        {/* X/Twitter-style byline — avatar left of the handle, post text
            below spanning the full card width. */}
        <div className="relative flex items-center gap-2.5 mb-2.5 min-w-0" data-testid={`text-author-${topic.id}`}>
          <AvatarCircle
            avatarId={topic.authorAvatarId}
            handle={topic.authorHandle}
            size="sm"
            online={authorOnline}
            onlineLabel={t("debateTopicCard.onlineAriaLabel")}
          />
          <span className="text-sm font-medium text-foreground truncate">{topic.authorHandle}</span>
          <span className="text-sm text-muted-foreground whitespace-nowrap shrink-0" aria-hidden>
            ·
          </span>
          <time dateTime={topic.createdAt} className="text-sm text-muted-foreground whitespace-nowrap shrink-0">
            {formatTimeAgo(new Date(topic.createdAt))}
          </time>
        </div>
        <p className="relative font-serif text-xl md:text-2xl font-bold text-foreground leading-snug tracking-tight pr-6">
          {topic.topicText}
        </p>
        <div className="relative flex items-center justify-between gap-3 mt-3">
          <div className="flex items-center gap-4 min-w-0 text-[13px] tabular-nums">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground/85">
              <MessageCircle className="w-4 h-4 text-primary" />
              {t("debateTopicCard.commentCount", { count: topic.commentCount })}
            </span>
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Repeat2 className="w-4 h-4" />
              {topic.rewhispCount}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0 -mr-2.5">
            <span className="hidden sm:inline-flex items-center gap-1 text-[13px] text-muted-foreground group-hover:text-foreground transition-colors mr-1">
              {t("debateTopicCard.joinDebate")} <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform rtl:-scale-x-100" />
            </span>
            <button
              type="button"
              onClick={handleShareTopic}
              aria-label={t("debateTopicCard.shareTopicAria")}
              className="inline-flex items-center justify-center w-11 h-11 -my-2.5 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              data-testid={`button-share-${topic.id}`}
            >
              <Share2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </article>
    </Link>
  );
}
