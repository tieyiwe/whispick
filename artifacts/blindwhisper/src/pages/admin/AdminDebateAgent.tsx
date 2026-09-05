import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminGetDebateAgentConfig,
  useAdminUpdateDebateAgentConfig,
  useAdminRunDebateAgentNow,
  useAdminPostDebateTopic,
  getAdminGetDebateAgentConfigQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { Loader2, Megaphone, Send } from "lucide-react";

const TOPIC_TEXT_MAX = 200;

export function AdminDebateAgent() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useAdminGetDebateAgentConfig({
    query: { queryKey: getAdminGetDebateAgentConfigQueryKey(), refetchInterval: 60_000 },
  });
  const updateConfig = useAdminUpdateDebateAgentConfig();
  const runNow = useAdminRunDebateAgentNow();
  const postTopic = useAdminPostDebateTopic();

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

  const [manualTopicText, setManualTopicText] = useState("");

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getAdminGetDebateAgentConfigQueryKey() });
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
          toast({ title: "Debado settings saved" });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Couldn't save those settings", variant: "destructive" }),
      }
    );
  }

  function handleRunNow() {
    runNow.mutate(undefined, {
      onSuccess: (result) => {
        invalidate();
        toast({ title: `Debado run complete — ${result.posted} posted, ${result.skipped} skipped` });
      },
      onError: (err: any) => toast({ title: err?.data?.error ?? "Run failed to complete", variant: "destructive" }),
    });
  }

  function handlePostNow() {
    const topicText = manualTopicText.trim();
    if (!topicText) return;
    postTopic.mutate(
      { data: { topicText } },
      {
        onSuccess: () => {
          invalidate();
          setManualTopicText("");
          toast({ title: "Topic posted to Debate Now" });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Couldn't post that topic", variant: "destructive" }),
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
            <Megaphone className="w-7 h-7 text-primary" /> Debado
          </h1>
          <p className="text-muted-foreground mt-1">
            The AI agent that generates and posts to Debate Now automatically.
          </p>
        </div>

        <AgentStatusCard agentLabel="Debado" status={config} onRunNow={handleRunNow} runPending={runNow.isPending} />

        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif">Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between p-3 rounded-xl border border-border/50">
              <div>
                <p className="text-sm font-medium text-foreground">Enabled</p>
                <p className="text-xs text-muted-foreground">When off, Debado never posts on its own schedule.</p>
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
              <p className="text-xs text-muted-foreground">How many topics to post per scheduled sweep (1–10).</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Topic themes</Label>
              <p className="text-xs text-muted-foreground">Short themes that steer what the agent generates each run.</p>
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
            <CardTitle className="text-base font-serif">Compose &amp; post a topic manually</CardTitle>
            <p className="text-xs text-muted-foreground">
              Publishes immediately under the system account, through the same moderation pass as every other topic.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder="What's today's debate topic?"
              value={manualTopicText}
              onChange={(e) => setManualTopicText(e.target.value.slice(0, TOPIC_TEXT_MAX))}
              maxLength={TOPIC_TEXT_MAX}
              className="bg-input/50 border-border/50 rounded-xl min-h-24"
              data-testid="textarea-manual-topic"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{manualTopicText.length}/{TOPIC_TEXT_MAX}</span>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={!manualTopicText.trim() || postTopic.isPending} className="rounded-full" data-testid="button-post-topic-now">
                    {postTopic.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                    Post now
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Publish this topic?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This posts immediately to the public Debate Now feed under the system account. It can be
                      retracted afterward like any topic, but this action itself can't be undone from here.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handlePostNow} data-testid="button-confirm-post-topic">
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
