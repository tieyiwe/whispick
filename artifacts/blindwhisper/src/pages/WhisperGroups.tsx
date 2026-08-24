import { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListWhisperGroups,
  useCreateWhisperGroup,
  useListGroupWhispSends,
  getListWhisperGroupsQueryKey,
  getListGroupWhispSendsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { deliveryLabel } from "@/lib/deliveryMethod";
import { UsersRound, Plus, Loader2, PlayCircle, ChevronRight } from "lucide-react";

export function WhisperGroups() {
  const { t } = useTranslation("whisp");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newGroupName, setNewGroupName] = useState("");

  const { data: groups, isLoading: groupsLoading } = useListWhisperGroups({
    query: { queryKey: getListWhisperGroupsQueryKey() },
  });
  const { data: sends, isLoading: sendsLoading } = useListGroupWhispSends({
    query: { queryKey: getListGroupWhispSendsQueryKey() },
  });
  const createGroup = useCreateWhisperGroup();

  function handleCreate() {
    const name = newGroupName.trim();
    if (!name) return;
    createGroup.mutate(
      { data: { name } },
      {
        onSuccess: () => {
          setNewGroupName("");
          queryClient.invalidateQueries({ queryKey: getListWhisperGroupsQueryKey() });
          toast({ title: t("whisperGroups.toast.groupCreated") });
        },
        onError: () => toast({ title: t("whisperGroups.toast.failedToCreateGroup"), variant: "destructive" }),
      }
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-3">
            <UsersRound className="w-7 h-7 text-primary" /> {t("whisperGroups.title")}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t("whisperGroups.subtitle")}
          </p>
        </div>

        <Tabs defaultValue="groups">
          <TabsList>
            <TabsTrigger value="groups" data-testid="tab-groups">{t("whisperGroups.tabs.groups")}</TabsTrigger>
            <TabsTrigger value="sends" data-testid="tab-sent-batches">{t("whisperGroups.tabs.sentBatches")}</TabsTrigger>
          </TabsList>

          <TabsContent value="groups" className="space-y-4">
            <Card className="bg-card border-border/50">
              <CardContent className="p-5 space-y-3">
                <p className="font-medium text-foreground flex items-center gap-2">
                  <Plus className="w-4 h-4 text-primary" /> {t("whisperGroups.createAGroup")}
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder={t("whisperGroups.namePlaceholder")}
                    className="bg-input/50 border-border/50 rounded-xl"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                    data-testid="input-new-group-name"
                  />
                  <Button
                    onClick={handleCreate}
                    disabled={!newGroupName.trim() || createGroup.isPending}
                    className="rounded-xl shrink-0"
                    data-testid="button-create-group"
                  >
                    {createGroup.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t("whisperGroups.create")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {groupsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
              </div>
            ) : groups?.length ? (
              <div className="space-y-2">
                {groups.map((group) => (
                  <Link key={group.id} href={`/whisper-groups/${group.id}`}>
                    <Card className="bg-card hover:bg-card/80 transition-colors border-border/50 cursor-pointer" data-testid={`group-row-${group.id}`}>
                      <CardContent className="p-4 flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-primary/10 shrink-0">
                          <UsersRound className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate">{group.name}</p>
                          <p className="text-xs text-muted-foreground">{t("shared.memberCount", { count: group.memberCount })}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            ) : (
              <Card className="bg-card/50 border-dashed border-border py-12 text-center">
                <p className="text-muted-foreground">{t("whisperGroups.emptyGroups")}</p>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="sends" className="space-y-3">
            {sendsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
              </div>
            ) : sends?.length ? (
              sends.map((s) => (
                <Link key={s.groupSendId} href={`/whisper-groups/sends/${s.groupSendId}`}>
                  <Card className="bg-card hover:bg-card/80 transition-colors border-border/50 cursor-pointer" data-testid={`group-send-row-${s.groupSendId}`}>
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                        {s.videoThumbnail ? <img src={s.videoThumbnail} className="w-full h-full object-cover" alt="" /> : <PlayCircle className="w-5 h-5 text-muted-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">{s.videoTitle || s.videoUrl}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {t("whisperGroups.sendRow.summary", {
                            group: s.groupName ?? t("whisperGroups.groupFallback"),
                            members: t("shared.memberCount", { count: s.memberCount }),
                            via: deliveryLabel("whisper_link", s.whisperChannel),
                          })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {s.scheduledCount === s.memberCount && s.memberCount > 0
                            ? t("whisperGroups.sendRow.scheduled")
                            : t("whisperGroups.sendRow.stats", {
                                opened: s.openedCount,
                                watched: s.watchedCount,
                                replied: s.repliedCount,
                              })}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </CardContent>
                  </Card>
                </Link>
              ))
            ) : (
              <Card className="bg-card/50 border-dashed border-border py-12 text-center">
                <p className="text-muted-foreground">{t("whisperGroups.emptySends")}</p>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
