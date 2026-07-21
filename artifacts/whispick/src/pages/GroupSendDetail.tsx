import { useParams, useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetGroupWhispSend, getGetGroupWhispSendQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ArrowLeft, PlayCircle, UsersRound, Eye, MessageSquare, HeartHandshake } from "lucide-react";

export function GroupSendDetail() {
  const { groupSendId } = useParams<{ groupSendId: string }>();
  const [, setLocation] = useLocation();

  const { data, isLoading } = useGetGroupWhispSend(groupSendId!, {
    query: { enabled: !!groupSendId, queryKey: getGetGroupWhispSendQueryKey(groupSendId!) },
  });

  if (isLoading) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      </AppLayout>
    );
  }

  if (!data) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto text-center py-16">
          <p className="text-muted-foreground">Group send not found.</p>
        </div>
      </AppLayout>
    );
  }

  const { groupName, video, members } = data;
  const opened = members.filter((m) => m.openedAt).length;
  const watched = members.filter((m) => m.watchedAt).length;
  const replied = members.filter((m) => m.replies.length > 0).length;
  const appreciated = members.filter((m) => m.appreciationResponse === "yes").length;

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-5">
        <Button variant="ghost" onClick={() => setLocation("/whisper-groups")} className="text-muted-foreground -ml-2">
          <ArrowLeft className="w-4 h-4 mr-1" /> Whisper Groups
        </Button>

        <Card className="bg-card border-border/50 overflow-hidden">
          {video.videoThumbnail && (
            <div className="relative h-40 overflow-hidden">
              <img src={video.videoThumbnail} alt="Video" className="w-full h-full object-cover" />
              <a href={video.videoUrl} target="_blank" rel="noopener noreferrer" className="absolute inset-0 bg-black/50 flex items-center justify-center hover:bg-black/40 transition-colors">
                <PlayCircle className="w-10 h-10 text-white" />
              </a>
            </div>
          )}
          <CardContent className="p-5 space-y-2">
            <h2 className="font-serif font-semibold text-lg text-foreground">{video.videoTitle || "Video"}</h2>
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <UsersRound className="w-4 h-4" /> {groupName ?? "Group"} · {members.length} member{members.length === 1 ? "" : "s"}
            </p>
            <div className="flex items-center gap-4 text-sm text-muted-foreground pt-1 flex-wrap">
              <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {opened} opened</span>
              <span className="flex items-center gap-1"><PlayCircle className="w-3.5 h-3.5" /> {watched} watched</span>
              <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> {replied} replied</span>
              {appreciated > 0 && <span className="flex items-center gap-1 text-primary"><HeartHandshake className="w-3.5 h-3.5" /> {appreciated} appreciated</span>}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-serif">Per-member status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {members.map((m) => (
              <div key={m.whispId} className="p-3 rounded-xl bg-muted/20 space-y-2" data-testid={`group-member-status-${m.whispId}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{m.recipientEmail || m.recipientPhone || "Unknown"}</span>
                  <StatusBadge status={m.status} />
                </div>
                {m.replies.length > 0 && (
                  <div className="space-y-1.5 pt-1 border-t border-border/30">
                    {m.replies.map((r) => (
                      <div key={r.id} className="text-xs">
                        <span className="text-muted-foreground">{new Date(r.createdAt).toLocaleString()}: </span>
                        {r.replyText && <span className="text-foreground">{r.replyText}</span>}
                        {r.videoUrl && <span className="text-foreground italic"> whisped a video back</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
