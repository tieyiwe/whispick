import { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminListPolicyVersions,
  useAdminCreatePolicyVersion,
  useAdminUpdatePolicyVersion,
  useAdminDeletePolicyVersion,
  useAdminPublishPolicyVersion,
  type PolicyVersion,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { FileCheck2, Megaphone, Loader2, Trash2, Pencil, Check, X, Users } from "lucide-react";

const DOC_LABELS: Record<string, string> = {
  privacy: "Privacy Policy",
  terms: "Terms of Service",
};

// Admin side of the policy re-consent system: draft a "what changed"
// summary for the Privacy Policy or Terms, then Publish — from that moment
// every signed-in user gets the animated consent prompt (PolicyUpdateGate)
// live in-app, on refresh, or at next login, and their agreement is
// recorded per version. The policy TEXT itself still lives on the /privacy
// and /terms pages; what's versioned here is the announcement + consent.
export function AdminPolicies() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useAdminListPolicyVersions();
  const create = useAdminCreatePolicyVersion();
  const update = useAdminUpdatePolicyVersion();
  const remove = useAdminDeletePolicyVersion();
  const publish = useAdminPublishPolicyVersion();

  const [docType, setDocType] = useState<"privacy" | "terms">("privacy");
  const [summary, setSummary] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSummary, setEditingSummary] = useState("");

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["/api/admin/policy-versions"] });
  }

  function handleCreate() {
    if (!summary.trim()) return;
    create.mutate(
      { data: { docType, summary: summary.trim() } },
      {
        onSuccess: () => {
          setSummary("");
          refresh();
          toast({ title: "Draft saved", description: "Publish it when the page text is live — users are only prompted after publishing." });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Failed to save draft", variant: "destructive" }),
      },
    );
  }

  function handlePublish(v: PolicyVersion) {
    publish.mutate(
      { id: v.id },
      {
        onSuccess: () => {
          refresh();
          toast({
            title: `${DOC_LABELS[v.docType]} update published`,
            description: "Every signed-in user will now be prompted to review and agree — live in the app, on refresh, or at next login.",
          });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Failed to publish", variant: "destructive" }),
      },
    );
  }

  function handleSaveEdit(id: string) {
    update.mutate(
      { id, data: { summary: editingSummary.trim() } },
      {
        onSuccess: () => {
          setEditingId(null);
          refresh();
          toast({ title: "Draft updated" });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Failed to update draft", variant: "destructive" }),
      },
    );
  }

  const items = data?.items ?? [];
  const totalUsers = data?.totalUsers ?? 0;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-2">
            <FileCheck2 className="w-7 h-7 text-primary" /> Policy Updates
          </h1>
          <p className="text-muted-foreground mt-1">
            Announce Privacy Policy or Terms changes and collect every user's agreement. Update the actual
            page text first, then draft the "what changed" summary here and publish — users are prompted with
            it immediately.
          </p>
        </div>

        <Card className="bg-card border-border/50">
          <CardContent className="p-6 space-y-4">
            <p className="font-medium text-foreground">Draft a policy update</p>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Document</Label>
              <Select value={docType} onValueChange={(v) => setDocType(v as "privacy" | "terms")}>
                <SelectTrigger className="bg-input/50 border-border/50 rounded-xl w-full sm:w-56" data-testid="select-policy-doctype"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="privacy">Privacy Policy</SelectItem>
                  <SelectItem value="terms">Terms of Service</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">What changed (shown to users in the consent prompt)</Label>
              <Textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value.slice(0, 1000))}
                rows={3}
                placeholder="e.g. We clarified how phone numbers are used for delivery routing, and added a section on the new reporting system."
                className="bg-input/50 border-border/50 rounded-xl"
                data-testid="input-policy-summary"
              />
            </div>
            <Button
              className="rounded-full"
              onClick={handleCreate}
              disabled={!summary.trim() || create.isPending}
              data-testid="button-create-policy-draft"
            >
              {create.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Pencil className="w-4 h-4 mr-2" />}
              Save draft
            </Button>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        ) : items.length ? (
          <div className="space-y-2">
            {items.map((v) => {
              const isDraft = !v.publishedAt;
              const isEditing = editingId === v.id;
              return (
                <Card key={v.id} className={`border ${isDraft ? "bg-card border-amber-400/40" : "bg-card/60 border-border/40"}`} data-testid={`policy-row-${v.id}`}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline">{DOC_LABELS[v.docType] ?? v.docType}</Badge>
                        {isDraft ? (
                          <Badge className="bg-amber-500/90 text-black">Draft — not visible to users</Badge>
                        ) : (
                          <Badge variant="outline" className="border-emerald-500 text-emerald-500">
                            Published {new Date(v.publishedAt!).toLocaleString()}
                          </Badge>
                        )}
                      </div>
                      {!isDraft && (
                        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" /> {v.acceptedCount}/{totalUsers} agreed
                        </span>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="space-y-2">
                        <Textarea
                          value={editingSummary}
                          onChange={(e) => setEditingSummary(e.target.value.slice(0, 1000))}
                          rows={3}
                          className="rounded-xl"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" className="rounded-full" onClick={() => handleSaveEdit(v.id)} disabled={update.isPending || !editingSummary.trim()}>
                            <Check className="w-3.5 h-3.5 mr-1.5" /> Save
                          </Button>
                          <Button size="sm" variant="outline" className="rounded-full" onClick={() => setEditingId(null)}>
                            <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{v.summary}</p>
                    )}

                    {isDraft && !isEditing && (
                      <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" className="rounded-full" disabled={publish.isPending} data-testid={`button-publish-policy-${v.id}`}>
                              <Megaphone className="w-3.5 h-3.5 mr-1.5" /> Publish
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Publish this {DOC_LABELS[v.docType]?.toLowerCase()} update?</AlertDialogTitle>
                              <AlertDialogDescription className="space-y-2">
                                <span className="block">"{v.summary.slice(0, 200)}{v.summary.length > 200 ? "…" : ""}"</span>
                                <span className="block">
                                  Every signed-in user will be prompted to review and agree — immediately if they're in the
                                  app, otherwise on their next refresh or sign-in. Make sure the {DOC_LABELS[v.docType]} page
                                  itself already shows the new text. A published update can't be edited or deleted.
                                </span>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handlePublish(v)}>Publish to all users</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full"
                          onClick={() => { setEditingId(v.id); setEditingSummary(v.summary); }}
                        >
                          <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-full text-muted-foreground hover:text-destructive"
                          disabled={remove.isPending}
                          onClick={() =>
                            remove.mutate(
                              { id: v.id },
                              {
                                onSuccess: () => { refresh(); toast({ title: "Draft discarded" }); },
                                onError: (err: any) => toast({ title: err?.data?.error ?? "Failed to discard", variant: "destructive" }),
                              },
                            )
                          }
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Discard
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <p className="text-muted-foreground">No policy updates yet — draft one above when the Privacy Policy or Terms change.</p>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
