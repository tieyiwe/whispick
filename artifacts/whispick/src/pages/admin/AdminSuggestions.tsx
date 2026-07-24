import { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminListSuggestions,
  useAdminCreateSuggestion,
  useAdminUpdateSuggestion,
  useAdminDeleteSuggestion,
  useAdminGetSuggestionAgentStatus,
  useAdminRunSuggestionAgent,
  getAdminListSuggestionsQueryKey,
  getAdminGetSuggestionAgentStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { VIDEO_CATEGORY_LABELS, categoryLabel } from "@/lib/videoCategories";
import { Search, ChevronLeft, ChevronRight, PlayCircle, Trash2, Plus, Star, CheckCircle2, Archive, Loader2, Bot, UserCog, AlertTriangle, Zap } from "lucide-react";

const PAGE_SIZE = 20;
const ADD_CATEGORIES = Object.entries(VIDEO_CATEGORY_LABELS).filter(([key]) => key !== "uncategorized");
const MAX_ADD_CATEGORIES = 5;

function SuggestionStatusBadge({ status }: { status: string }) {
  if (status === "pending") return <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20 rounded-full">Pending review</Badge>;
  if (status === "archived") return <Badge variant="outline" className="bg-muted text-muted-foreground border-border rounded-full">Archived</Badge>;
  return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 rounded-full">Published</Badge>;
}

function AddSuggestionDialog() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [featured, setFeatured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createSuggestion = useAdminCreateSuggestion();

  function toggleCategory(key: string) {
    setCategories((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : prev.length >= MAX_ADD_CATEGORIES ? prev : [...prev, key]
    );
  }

  function reset() {
    setVideoUrl("");
    setCategories([]);
    setFeatured(false);
    setError(null);
  }

  function handleSubmit() {
    setError(null);
    if (!videoUrl.trim()) {
      setError("Enter a video link");
      return;
    }
    if (categories.length === 0) {
      setError("Pick at least one category");
      return;
    }
    createSuggestion.mutate(
      { data: { videoUrl: videoUrl.trim(), categories, featured } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/admin/suggestions"] });
          toast({ title: "Added to the Suggestions Library" });
          setOpen(false);
          reset();
        },
        onError: (err: any) => setError(err?.response?.data?.error ?? "Couldn't add that video"),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        <Button className="rounded-full" data-testid="button-add-suggestion">
          <Plus className="w-4 h-4 mr-1.5" /> Add video
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a video to the Suggestions Library</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Video link</label>
            <Input
              placeholder="https://youtube.com/watch?v=..."
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              className="bg-input/50 border-border/50 rounded-xl"
              data-testid="input-suggestion-url"
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Categories ({categories.length}/{MAX_ADD_CATEGORIES})</p>
            <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
              {ADD_CATEGORIES.map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 p-2 rounded-lg border border-border/50 bg-card hover:border-primary/40 transition-colors cursor-pointer">
                  <Checkbox checked={categories.includes(key)} onCheckedChange={() => toggleCategory(key)} data-testid={`checkbox-suggestion-category-${key}`} />
                  <span className="text-sm text-foreground">{label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl border border-border/50">
            <div>
              <p className="text-sm font-medium text-foreground">Feature this video</p>
              <p className="text-xs text-muted-foreground">Featured videos are highlighted at the top of the gallery</p>
            </div>
            <Switch checked={featured} onCheckedChange={setFeatured} data-testid="switch-suggestion-featured" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleSubmit} disabled={createSuggestion.isPending} className="w-full rounded-full" data-testid="button-submit-suggestion">
            {createSuggestion.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Add to library
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AgentStatusBanner() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: status } = useAdminGetSuggestionAgentStatus({
    query: { queryKey: getAdminGetSuggestionAgentStatusQueryKey(), refetchInterval: 60_000 },
  });
  const runAgent = useAdminRunSuggestionAgent();

  function handleRunNow() {
    runAgent.mutate(undefined, {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getAdminGetSuggestionAgentStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/suggestions"] });
        toast({ title: `Discovery run complete — ${result.inserted} added, ${result.skipped} skipped` });
      },
      onError: () => toast({ title: "Discovery run failed to complete", variant: "destructive" }),
    });
  }

  const runNowButton = (
    <Button size="sm" variant="outline" className="rounded-full shrink-0" onClick={handleRunNow} disabled={runAgent.isPending} data-testid="button-run-suggestion-agent">
      {runAgent.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 mr-1.5" />}
      Run discovery now
    </Button>
  );

  if (!status?.lastRunAt) {
    return (
      <Card className="bg-card border-border/50" data-testid="agent-status-banner-never-run">
        <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-muted-foreground">
            The AI discovery agent hasn't run yet — it checks automatically once a day, or you can trigger it now.
          </p>
          {runNowButton}
        </CardContent>
      </Card>
    );
  }

  if (!status.lastRunOk) {
    return (
      <Card
        className={status.lowCreditSuspected ? "border-destructive/40 bg-destructive/5" : "border-amber-500/40 bg-amber-500/5"}
        data-testid="agent-status-banner-error"
      >
        <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${status.lowCreditSuspected ? "text-destructive" : "text-amber-400"}`} />
            <div>
              <p className={`text-sm font-medium ${status.lowCreditSuspected ? "text-destructive" : "text-amber-400"}`}>
                {status.lowCreditSuspected
                  ? "AI discovery agent stopped — your Anthropic credit balance looks too low"
                  : "The last AI discovery run failed"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {status.lowCreditSuspected
                  ? "Add credits in your Anthropic Console, then run it again."
                  : status.lastErrorMessage ?? "Check the server logs for details."}
                {status.consecutiveFailures > 1 && ` · Failed ${status.consecutiveFailures} times in a row.`}
              </p>
            </div>
          </div>
          {runNowButton}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border/50" data-testid="agent-status-banner-ok">
      <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          AI discovery last ran {new Date(status.lastRunAt).toLocaleString()} — looking healthy.
        </p>
        {runNowButton}
      </CardContent>
    </Card>
  );
}

export function AdminSuggestions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);

  const params = {
    ...(search ? { search } : {}),
    ...(status !== "all" ? { status } : {}),
    ...(source !== "all" ? { source } : {}),
    ...(category !== "all" ? { category } : {}),
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isLoading } = useAdminListSuggestions(params, {
    query: { queryKey: getAdminListSuggestionsQueryKey(params) },
  });

  const updateSuggestion = useAdminUpdateSuggestion();
  const deleteSuggestion = useAdminDeleteSuggestion();

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/suggestions"] });
  }

  function handlePublish(id: string) {
    updateSuggestion.mutate(
      { id, data: { status: "published" } },
      { onSuccess: () => { invalidate(); toast({ title: "Published" }); }, onError: () => toast({ title: "Failed to publish", variant: "destructive" }) }
    );
  }

  function handleArchive(id: string) {
    updateSuggestion.mutate(
      { id, data: { status: "archived" } },
      { onSuccess: () => { invalidate(); toast({ title: "Archived" }); }, onError: () => toast({ title: "Failed to archive", variant: "destructive" }) }
    );
  }

  function handleToggleFeatured(id: string, next: boolean) {
    updateSuggestion.mutate(
      { id, data: { featured: next } },
      { onSuccess: () => invalidate(), onError: () => toast({ title: "Failed to update", variant: "destructive" }) }
    );
  }

  function handleDelete(id: string) {
    deleteSuggestion.mutate(
      { id },
      { onSuccess: () => { invalidate(); toast({ title: "Removed" }); }, onError: () => toast({ title: "Failed to remove", variant: "destructive" }) }
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground">Suggestions Library</h1>
            <p className="text-muted-foreground mt-1">{data?.total ?? 0} videos curated for users to discover and whisper along.</p>
          </div>
          <AddSuggestionDialog />
        </div>

        <AgentStatusBanner />

        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by video title..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 bg-card border-border/50 rounded-full"
              data-testid="input-admin-suggestion-search"
            />
          </div>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-44 bg-card border-border/50 rounded-full"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending review</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={(v) => { setSource(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-40 bg-card border-border/50 rounded-full"><SelectValue placeholder="Source" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="admin">Added by admin</SelectItem>
              <SelectItem value="ai_agent">AI discovered</SelectItem>
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-48 bg-card border-border/50 rounded-full"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {Object.entries(VIDEO_CATEGORY_LABELS).filter(([key]) => key !== "uncategorized").map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
        ) : data?.items.length ? (
          <div className="space-y-2">
            {data.items.map((s) => (
              <Card key={s.id} className="bg-card border-border/50" data-testid={`admin-suggestion-row-${s.id}`}>
                <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                  <div className="w-16 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                    {s.videoThumbnail ? <img src={s.videoThumbnail} className="w-full h-full object-cover" alt="" /> : <PlayCircle className="w-4 h-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-[220px]">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <PlatformIcon platform={s.videoPlatform} className="w-3.5 h-3.5" />
                      <span className="font-medium text-foreground truncate">{s.videoTitle || s.videoUrl}</span>
                    </div>
                    {s.aiSummary && <p className="text-xs text-muted-foreground truncate">{s.aiSummary}</p>}
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      {s.categories.map((c) => <Badge key={c} variant="outline" className="text-[10px] px-1.5 py-0">{categoryLabel(c)}</Badge>)}
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground" title={s.source === "ai_agent" ? "AI discovered" : "Added by admin"}>
                    {s.source === "ai_agent" ? <Bot className="w-3.5 h-3.5" /> : <UserCog className="w-3.5 h-3.5" />}
                  </span>
                  <SuggestionStatusBadge status={s.status} />
                  <button
                    type="button"
                    onClick={() => handleToggleFeatured(s.id, !s.featured)}
                    className={`p-1.5 rounded-full transition-colors ${s.featured ? "text-amber-400" : "text-muted-foreground hover:text-amber-400"}`}
                    title={s.featured ? "Featured — click to unfeature" : "Click to feature"}
                    data-testid={`button-toggle-featured-${s.id}`}
                  >
                    <Star className={`w-4 h-4 ${s.featured ? "fill-amber-400" : ""}`} />
                  </button>
                  {s.status !== "published" && (
                    <Button size="sm" variant="outline" className="rounded-full" onClick={() => handlePublish(s.id)} data-testid={`button-publish-${s.id}`}>
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Publish
                    </Button>
                  )}
                  {s.status !== "archived" && (
                    <Button size="sm" variant="ghost" className="rounded-full text-muted-foreground" onClick={() => handleArchive(s.id)} data-testid={`button-archive-${s.id}`}>
                      <Archive className="w-3.5 h-3.5 mr-1" /> Archive
                    </Button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="rounded-full text-muted-foreground hover:text-destructive" data-testid={`button-delete-suggestion-${s.id}`}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove this video?</AlertDialogTitle>
                        <AlertDialogDescription>Permanently removes it from the Suggestions Library. This can't be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(s.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <p className="text-muted-foreground">No videos match those filters.</p>
          </Card>
        )}

        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" size="sm" className="rounded-full" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Prev
            </Button>
            <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" className="rounded-full" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
