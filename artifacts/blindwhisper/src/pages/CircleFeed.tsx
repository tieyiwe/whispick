import { AppLayout } from "@/components/layout/AppLayout";
import { useListCircleFeed } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Link, useLocation } from "wouter";
import { MoodTag } from "@/components/shared/MoodTag";
import { CirclePostComposer } from "@/components/shared/CirclePostComposer";
import { savePendingForward } from "@/lib/forwardVideo";
import { PlayCircle, Users, Send } from "lucide-react";

export function CircleFeed() {
  const { data, isLoading } = useListCircleFeed();
  const [, setLocation] = useLocation();
  const items = data?.items ?? [];

  // Passing a post onward as your own whisp. Same mechanism the public whisp
  // page's "pass it forward" uses — the video's details are carried into the
  // send composer, so what circulates is the video, never the original
  // poster's identity (which the feed never had in the first place).
  function whispThis(item: (typeof items)[number]) {
    savePendingForward({
      videoUrl: item.videoUrl,
      videoTitle: item.videoTitle,
      videoThumbnail: item.videoThumbnail,
      videoPlatform: item.videoPlatform,
    });
    setLocation("/send");
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-3">
              <Users className="w-7 h-7 text-primary" /> Blind Circle
            </h1>
            <p className="text-muted-foreground mt-1">
              Videos dropped anonymously into the community. No recipient, no algorithm — just organic discovery.
            </p>
          </div>
          <CirclePostComposer />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-64 rounded-2xl" />
            ))}
          </div>
        ) : items.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((item) => (
              <Card
                key={item.id}
                className="bg-card hover:bg-card/80 transition-colors border-border/50 overflow-hidden group h-full flex flex-col"
                data-testid={`circle-item-${item.id}`}
              >
                <Link href={`/w/${item.publicToken}`} className="cursor-pointer">
                  {item.videoThumbnail ? (
                    <div className="relative h-36 shrink-0">
                      <img src={item.videoThumbnail} alt={item.videoTitle ?? "Video"} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                        <PlayCircle className="w-9 h-9 text-white opacity-80" />
                      </div>
                    </div>
                  ) : (
                    <div className="h-36 shrink-0 bg-muted flex items-center justify-center">
                      <PlayCircle className="w-9 h-9 text-muted-foreground" />
                    </div>
                  )}
                </Link>
                <div className="p-4 flex-1 flex flex-col gap-2 min-w-0">
                  <Link href={`/w/${item.publicToken}`} className="min-w-0 cursor-pointer">
                    {item.videoTitle && <p className="font-medium text-foreground truncate">{item.videoTitle}</p>}
                    {item.moodTag && <MoodTag mood={item.moodTag} className="scale-90 origin-left self-start" />}
                    {item.anonymousNote && (
                      <p className="text-sm text-muted-foreground italic line-clamp-2">"{item.anonymousNote}"</p>
                    )}
                  </Link>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                    <p className="text-xs text-muted-foreground truncate">
                      {item.senderAlias ?? "Someone"} · {new Date(item.createdAt).toLocaleDateString()}
                    </p>
                    {/* Anything in the circle can be sent onward to someone who
                        needs it — which is the point of a discovery feed in an
                        app whose whole purpose is sending. */}
                    <button
                      type="button"
                      onClick={() => whispThis(item)}
                      data-testid={`button-whisp-this-${item.id}`}
                      className="shrink-0 inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
                    >
                      <Send className="w-3 h-3" /> Whisp this
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <Users className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-xl font-medium text-foreground mb-2">Blind Circle is quiet right now</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Nobody's dropped a video into the community feed yet. Be the first — use Post to Blind Circle above.
            </p>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
