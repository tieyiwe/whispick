import { useState } from "react";
import { Link } from "wouter";
import {
  useGetFollowStats,
  useGetMyDebateTopicStats,
  useListFollowingDebateTopics,
} from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DebateTopicCard } from "@/components/shared/DebateTopicCard";
import {
  ArrowLeft,
  Loader2,
  Swords,
  Users,
  UserPlus,
  MessageCircle,
  MessageSquare,
  Repeat2,
  ThumbsUp,
} from "lucide-react";

export function DebateFollowing() {
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];

  const { data: followStats, isLoading: followStatsLoading } = useGetFollowStats();
  const { data: engagementStats, isLoading: engagementStatsLoading } = useGetMyDebateTopicStats();
  const { data, isLoading: feedLoading, isFetching } = useListFollowingDebateTopics(cursor ? { cursor } : undefined);
  const items = data?.items ?? [];
  const statsLoading = followStatsLoading || engagementStatsLoading;

  const statCards = [
    { title: "Followers", value: followStats?.followerCount ?? 0, icon: Users, color: "text-primary", bg: "bg-primary/10" },
    { title: "Following", value: followStats?.followingCount ?? 0, icon: UserPlus, color: "text-secondary", bg: "bg-secondary/10" },
    { title: "Topics Posted", value: engagementStats?.topicsPosted ?? 0, icon: Swords, color: "text-blue-400", bg: "bg-blue-500/10" },
    { title: "Comments Received", value: engagementStats?.commentsReceived ?? 0, icon: MessageCircle, color: "text-amber-400", bg: "bg-amber-500/10" },
    { title: "Rewhisps Received", value: engagementStats?.rewhispsReceived ?? 0, icon: Repeat2, color: "text-emerald-400", bg: "bg-emerald-500/10" },
    { title: "Comments Posted", value: engagementStats?.commentsPosted ?? 0, icon: MessageSquare, color: "text-[#EC4899]", bg: "bg-[#EC4899]/10" },
    {
      title: "Comment Likes Received",
      value: engagementStats?.commentLikesReceived ?? 0,
      icon: ThumbsUp,
      color: "text-gilded",
      bg: "bg-gilded/10",
      highlight: true,
    },
  ];

  return (
    <AppLayout>
      <div className="space-y-8">
        <div>
          <Link href="/debate-topics">
            <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground" data-testid="button-back-debate-topics">
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Debate Topics
            </Button>
          </Link>
          <h1 className="text-3xl font-serif font-bold text-foreground mt-2">Following</h1>
          <p className="text-muted-foreground mt-1">
            Your follow stats, your topic engagement, and topics from the authors and commentators you follow.
          </p>
        </div>

        {statsLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {statCards.map((stat, i) => (
              <Card
                key={i}
                className={`bg-card shadow-sm overflow-hidden relative ${
                  stat.highlight ? "border-gilded/25 shadow-[0_0_20px_rgba(232,200,110,0.08)]" : "border-border/50"
                }`}
                data-testid={`card-stat-${stat.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className={`absolute top-0 right-0 w-20 h-20 rounded-full ${stat.bg} blur-2xl -mr-8 -mt-8 pointer-events-none`} />
                <CardContent className="p-5">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground leading-tight">{stat.title}</p>
                      <h3 className={`text-2xl font-bold mt-1.5 ${stat.highlight ? "text-gilded" : "text-foreground"}`}>
                        {stat.value}
                      </h3>
                    </div>
                    <div className={`p-2.5 rounded-xl shrink-0 ${stat.bg}`}>
                      <stat.icon className={`w-4 h-4 ${stat.color}`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="space-y-4">
          <h2 className="text-xl font-serif font-bold text-foreground">Your following feed</h2>

          {feedLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28 rounded-2xl" />
              ))}
            </div>
          ) : items.length ? (
            <div className="space-y-4">
              {items.map((topic) => (
                <DebateTopicCard key={topic.id} topic={topic} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border py-16 text-center bg-card/50">
              <Users className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-xl font-medium text-foreground mb-2">No one to show yet</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Follow some authors or commentators to see their topics here.
              </p>
              <Link href="/debate-topics">
                <Button variant="outline" size="sm" className="rounded-full mt-4">
                  Browse Debate Topics
                </Button>
              </Link>
            </div>
          )}

          {items.length > 0 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              {cursors.length > 0 && (
                <Button variant="outline" size="sm" className="rounded-full" onClick={() => setCursors((c) => c.slice(0, -1))}>
                  Newer
                </Button>
              )}
              {data?.nextCursor && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  disabled={isFetching}
                  onClick={() => setCursors((c) => [...c, data.nextCursor!])}
                >
                  {isFetching ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                  More topics
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
