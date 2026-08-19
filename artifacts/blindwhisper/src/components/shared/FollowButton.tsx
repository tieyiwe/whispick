import { useToggleFollow } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
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
          toast({ title: "Couldn't update follow status", variant: "destructive" });
        },
      },
    );
  }

  return (
    <Button
      type="button"
      variant={following ? "outline" : "default"}
      size="sm"
      onClick={handleClick}
      disabled={toggleFollow.isPending}
      aria-pressed={following}
      className={`rounded-full ${compact ? "h-6 px-2 text-[11px]" : "h-7 px-3 text-xs"}`}
      data-testid={`button-follow-${handle}`}
    >
      {toggleFollow.isPending ? (
        <Loader2 className={compact ? "w-2.5 h-2.5 animate-spin" : "w-3 h-3 animate-spin"} />
      ) : following ? (
        <UserCheck className={compact ? "w-2.5 h-2.5" : "w-3 h-3"} />
      ) : (
        <UserPlus className={compact ? "w-2.5 h-2.5" : "w-3 h-3"} />
      )}
      {following ? "Following" : "Follow"}
    </Button>
  );
}
