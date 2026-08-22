import { useState } from "react";
import { Link, useSearch } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useAdminListWhisps, useAdminDeleteWhisp, getAdminListWhispsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { StatusBadge } from "@/components/shared/StatusBadge";
import { deliveryLabel } from "@/lib/deliveryMethod";
import { VIDEO_CATEGORY_LABELS, categoryLabel } from "@/lib/videoCategories";
import { Search, ChevronLeft, ChevronRight, PlayCircle, Trash2, Contact } from "lucide-react";

const PAGE_SIZE = 20;

export function AdminWhisps() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Deep-linkable status filter (e.g. AdminDashboard's "Failed Deliveries"
  // stat links here with ?status=failed) — only read once, on mount, so it
  // doesn't fight the Select below on every render.
  const initialStatus = new URLSearchParams(useSearch()).get("status") ?? "all";
  const [search, setSearch] = useState("");
  const [recipient, setRecipient] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [deliveryMethod, setDeliveryMethod] = useState("all");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);

  const params = {
    ...(search ? { search } : {}),
    ...(recipient ? { recipient } : {}),
    ...(status !== "all" ? { status } : {}),
    ...(deliveryMethod !== "all" ? { deliveryMethod } : {}),
    ...(category !== "all" ? { category } : {}),
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isLoading } = useAdminListWhisps(params, {
    query: { queryKey: getAdminListWhispsQueryKey(params) },
  });

  const deleteWhisp = useAdminDeleteWhisp();

  function handleDelete(id: string) {
    deleteWhisp.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/admin/whisps"] });
          toast({ title: "Whisp removed" });
        },
        onError: () => toast({ title: "Failed to remove whisp", variant: "destructive" }),
      }
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Content</h1>
          <p className="text-muted-foreground mt-1">{data?.total ?? 0} whisps sent across all users.</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by video title..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 bg-card border-border/50 rounded-full"
              data-testid="input-admin-whisp-search"
            />
          </div>
          <div className="relative flex-1 min-w-[200px]">
            <Contact className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Find by recipient email or phone..."
              value={recipient}
              onChange={(e) => { setRecipient(e.target.value); setPage(1); }}
              className="pl-9 bg-card border-border/50 rounded-full"
              data-testid="input-admin-whisp-recipient-search"
            />
          </div>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-40 bg-card border-border/50 rounded-full"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="opened">Opened</SelectItem>
              <SelectItem value="watched">Watched</SelectItem>
              <SelectItem value="replied">Replied</SelectItem>
            </SelectContent>
          </Select>
          <Select value={deliveryMethod} onValueChange={(v) => { setDeliveryMethod(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-44 bg-card border-border/50 rounded-full"><SelectValue placeholder="Delivery" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All delivery methods</SelectItem>
              <SelectItem value="whisper_link">Whisper Link</SelectItem>
              <SelectItem value="ghost_boost">Ghost Boost</SelectItem>
              <SelectItem value="circle_drop">Blind Circle</SelectItem>
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-48 bg-card border-border/50 rounded-full"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {Object.entries(VIDEO_CATEGORY_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
          </div>
        ) : data?.items.length ? (
          <div className="space-y-2">
            {data.items.map((w) => {
              const primaryCategory = w.categories.find((c) => c.rank === 1);
              return (
                <Card key={w.id} className="bg-card border-border/50" data-testid={`admin-whisp-row-${w.id}`}>
                  <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                      {w.videoThumbnail ? <img src={w.videoThumbnail} className="w-full h-full object-cover" alt="" /> : <PlayCircle className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-[200px]">
                      <Link href={`/admin_pro/whisps/${w.id}`} className="font-medium text-foreground hover:text-primary transition-colors truncate block">
                        {w.videoTitle || w.videoUrl}
                      </Link>
                      <p className="text-xs text-muted-foreground truncate">
                        {w.senderEmail ?? "Unknown sender"} · via {deliveryLabel(w.deliveryMethod, w.whisperChannel)}
                        {(w.recipientEmail || w.recipientPhone) ? ` · to ${w.recipientEmail || w.recipientPhone}` : ""}
                      </p>
                    </div>
                    {primaryCategory && <Badge variant="outline">{categoryLabel(primaryCategory.category)}</Badge>}
                    <StatusBadge status={w.status} />
                    <span className="text-xs text-muted-foreground w-24 text-right">{new Date(w.createdAt).toLocaleDateString()}</span>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="rounded-full text-muted-foreground hover:text-destructive" data-testid={`button-delete-whisp-${w.id}`}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove this whisp?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Permanently deletes this whisp, its tracking history, and any replies. This can't be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(w.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <p className="text-muted-foreground">No whisps match those filters.</p>
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
