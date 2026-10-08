import { useToggleFollow } from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { Loader2, UserPlus, UserCheck } from "lucide-react";

// Shared by the topic byline and every followable comment on
// DebateTopicDetail.tsx (and anywhere else a follow toggle shows up) — owns
// its own useToggleFollow mutation and reports the result back to the
// caller's cached data via onToggled, optimistically flipping first and
// reconciling with the server response, the same toggle-then-reconcile shape
// as handleReact/handleRewhisp elsewhere on this page.
export function FollowButton({
  handle,
  following,
  followerCount,
  compact = false,
  onToggled,
}: {
  handle: string;
  following: boolean;
  followerCount?: number;
  compact?: boolean;
  onToggled: (patch: { following: boolean; followerCount?: number }) => void;
}) {
  const { toast } = useToast();
  const toggleFollow = useToggleFollow();
  const { t } = useTranslation("sharedB");

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const optimisticFollowing = !following;
    onToggled({
      following: optimisticFollowing,
      followerCount: followerCount === undefined ? undefined : followerCount + (optimisticFollowing ? 1 : -1),
    });
    toggleFollow.mutate(
      { data: { handle } },
      {
        onSuccess: (result) => onToggled({ following: result.following, followerCount: result.followerCount }),
        onError: () => {
          onToggled({ following, followerCount });
          toast({ title: t("followButton.couldntUpdateFollowStatus"), variant: "destructive" });
        },
      },
    );
  }

  const iconClass = "w-3.5 h-3.5";
  const icon = toggleFollow.isPending ? (
    <Loader2 className={`${iconClass} animate-spin`} />
  ) : following ? (
    <UserCheck className={iconClass} />
  ) : (
    <UserPlus className={iconClass} />
  );

  // Deliberately secondary: following someone is never the main action on a
  // page, so neither form is a solid violet pill. `compact` (inline on
  // comment bylines) is a quiet text button whose hit area is padded out to
  // ~44px with an invisible pseudo-element so it stays easy to tap without
  // taking up visual room; the regular form is a soft tinted outline pill.
  const className = compact
    ? `relative inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap transition-colors duration-150 disabled:opacity-60 before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[''] ${
        following ? "text-muted-foreground hover:text-foreground" : "text-primary hover:text-primary/80"
      }`
    : `inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border text-xs font-medium whitespace-nowrap transition-colors duration-150 disabled:opacity-60 ${
        following
          ? "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
          : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
      }`;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={toggleFollow.isPending}
      aria-pressed={following}
      className={className}
      data-testid={`button-follow-${handle}`}
    >
      {icon}
      {following ? t("followButton.following") : t("followButton.follow")}
    </button>
  );
}
