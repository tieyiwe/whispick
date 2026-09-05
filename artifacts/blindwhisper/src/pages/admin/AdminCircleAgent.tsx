import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminGetCircleAgentConfig,
  useAdminUpdateCircleAgentConfig,
  useAdminRunCircleAgentNow,
  useAdminPostCircleVideo,
  getAdminGetCircleAgentConfigQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { AgentStatusCard } from "@/components/admin/AgentStatusCard";
import { TopicThemesEditor } from "@/components/admin/TopicThemesEditor";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Video, Send } from "lucide-react";

export function AdminCircleAgent() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useAdminGetCircleAgentConfig({
    query: { queryKey: getAdminGetCircleAgentConfigQueryKey(), refetchInterval: 60_000 },
  });
  const updateConfig = useAdminUpdateCircleAgentConfig();
  const runNow = useAdminRunCircleAgentNow();
  const postVideo = useAdminPostCircleVideo();

  const [enabled, setEnabled] = useState(false);
  const [dailyPostCount, setDailyPostCount] = useState("3");
  const [topics, setTopics] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (config && !initialized) {
      setEnabled(config.enabled);
      setDailyPostCount(String(config.dailyPostCount));
      setTopics(config.topics);
      setInitialized(true);
    }
  }, [config, initialized]);

  const [manualVideoUrl, setManualVideoUrl] = useState("");
  const [manualPostError, setManualPostError] = useState<string | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getAdminGetCircleAgentConfigQueryKey() });
  }

  function handleSaveConfig() {
    // A cleared input parses to NaN, which the backend's z.number() rejects —
    // losing every other edit in the save. Omit the count instead (keeping
    // the server's current value) so the rest of the config still lands.
    const parsedCount = parseInt(dailyPostCount, 10);
    const countValid = Number.isInteger(parsedCount) && parsedCount >= 1 && parsedCount <= 10;
    updateConfig.mutate(
      { data: { enabled, ...(countValid ? { dailyPostCount: parsedCount } : {}), topics } },
      {
        onSuccess: () => {
          // The server kept its existing count — reflect that in the input
          // rather than leaving the cleared/invalid value on screen.
          if (!countValid && config) setDailyPostCount(String(config.dailyPostCount));
          invalidate();
          toast({ title: "Circle Scout settings saved" });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Couldn't save those settings", variant: "destructive" }),
      }
    );
  }

  function handleRunNow() {
    runNow.mutate(undefined, {
      onSuccess: (result) => {
        invalidate();
        toast({ title: `Circle Scout run complete — ${result.posted} posted, ${result.skipped} skipped` });
      },
      onError: (err: any) => toast({ title: err?.data?.error ?? "Run failed to complete", variant: "destructive" }),
    });
  }

  function handlePostNow() {
    const videoUrl = manualVideoUrl.trim();
    if (!videoUrl) return;
    setManualPostError(null);
    postVideo.mutate(
      { data: { videoUrl } },
      {
        onSuccess: () => {
          invalidate();
          setManualVideoUrl("");
          toast({ title: "Video posted to Blind Circle" });
        },
        onError: (err: any) => {
          const message = err?.data?.error ?? "Couldn't resolve or post that video URL";
          setManualPostError(message);
          toast({ title: message, variant: "destructive" });
        },
      }
    );
  }

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="max-w-3xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-2">
            <Video className="w-7 h-7 text-primary" /> Circle Scout
          </h1>
          <p className="text-muted-foreground mt-1">
            The AI agent that discovers and posts videos to the public Blind Circle feed.
          </p>
        </div>

        <AgentStatusCard agentLabel="Circle Scout" status={config} onRunNow={handleRunNow} runPending={runNow.isPending} />

        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif">Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between p-3 rounded-xl border border-border/50">
              <div>
                <p className="text-sm font-medium text-foreground">Enabled</p>
                <p className="text-xs text-muted-foreground">When off, Circle Scout never posts on its own schedule.</p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="switch-agent-enabled" />
            </div>

            <div className="space-y-1.5 max-w-xs">
              <Label className="text-muted-foreground">Daily post count</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={dailyPostCount}
                onChange={(e) => setDailyPostCount(e.target.value)}
                className="bg-input/50 border-border/50 rounded-xl"
                data-testid="input-daily-post-count"
              />
              <p className="text-xs text-muted-foreground">How many videos to post per scheduled sweep (1–10).</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Topics</Label>
              <p className="text-xs text-muted-foreground">Short topics that steer what the agent searches for each run.</p>
              <TopicThemesEditor value={topics} onChange={setTopics} />
            </div>

            <Button onClick={handleSaveConfig} disabled={updateConfig.isPending} className="rounded-full" data-testid="button-save-agent-config">
              {updateConfig.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Save settings
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif">Post a specific video manually</CardTitle>
            <p className="text-xs text-muted-foreground">
              Publishes immediately to the public Blind Circle feed under the system account, through the same URL
              allowlist every discovered candidate goes through.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="https://youtube.com/watch?v=..."
              value={manualVideoUrl}
              onChange={(e) => { setManualVideoUrl(e.target.value); setManualPostError(null); }}
              className="bg-input/50 border-border/50 rounded-xl"
              data-testid="input-manual-video-url"
            />
            {manualPostError && <p className="text-sm text-destructive">{manualPostError}</p>}
            <div className="flex justify-end">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={!manualVideoUrl.trim() || postVideo.isPending} className="rounded-full" data-testid="button-post-video-now">
                    {postVideo.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                    Post now
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Publish this video?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This posts immediately to the public Blind Circle feed under the system account. It can be
                      retracted afterward like any post, but this action itself can't be undone from here.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handlePostNow} data-testid="button-confirm-post-video">
                      Publish
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
