import { useEffect, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminGetUser,
  useAdminUpdateUser,
  useAdminDeleteUser,
  useAdminListUserWhisps,
  getAdminGetUserQueryKey,
  getAdminListUserWhispsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ArrowLeft, Loader2, MapPin, Trash2, PlayCircle, MessageSquareHeart, ShieldAlert } from "lucide-react";

const WHISP_PAGE_SIZE = 15;

export function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useAdminGetUser(id!, { query: { enabled: !!id, queryKey: getAdminGetUserQueryKey(id!) } });
  const updateUser = useAdminUpdateUser();
  const deleteUser = useAdminDeleteUser();

  const [whispStatusFilter, setWhispStatusFilter] = useState("all");
  const [whispPage, setWhispPage] = useState(1);
  const whispParams = {
    ...(whispStatusFilter !== "all" ? { status: whispStatusFilter } : {}),
    page: whispPage,
    pageSize: WHISP_PAGE_SIZE,
  };
  const { data: whispsPage, isLoading: whispsLoading } = useAdminListUserWhisps(id!, whispParams, {
    query: { enabled: !!id, queryKey: getAdminListUserWhispsQueryKey(id!, whispParams) },
  });

  const [role, setRole] = useState("user");
  const [plan, setPlan] = useState("free");
  const [boostCredits, setBoostCredits] = useState("0");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data && !initialized) {
      setRole(data.user.role);
      setPlan(data.user.plan);
      setBoostCredits(String(data.user.boostCredits));
      setInitialized(true);
    }
  }, [data, initialized]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getAdminGetUserQueryKey(id!) });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
  }

  function handleSave() {
    updateUser.mutate(
      { id: id!, data: { role: role as "user" | "admin", plan: plan as "free" | "spark" | "ember", boostCredits: parseInt(boostCredits, 10) || 0 } },
      {
        onSuccess: () => { invalidate(); toast({ title: "User updated" }); },
        onError: (err: any) => toast({ title: err?.error ?? "Failed to update user", variant: "destructive" }),
      }
    );
  }

  function toggleBan() {
    if (!data) return;
    updateUser.mutate(
      { id: id!, data: { banned: !data.user.banned } },
      {
        onSuccess: () => { invalidate(); toast({ title: data.user.banned ? "User unbanned" : "User banned" }); },
        onError: (err: any) => toast({ title: err?.error ?? "Action failed", variant: "destructive" }),
      }
    );
  }

  function handleDelete() {
    deleteUser.mutate(
      { id: id! },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
          setLocation("/admin/users");
          toast({ title: "User deleted" });
        },
        onError: (err: any) => toast({ title: err?.error ?? "Failed to delete user", variant: "destructive" }),
      }
    );
  }

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="max-w-3xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      </AdminLayout>
    );
  }

  if (!data) {
    return (
      <AdminLayout>
        <div className="max-w-3xl mx-auto text-center py-16">
          <p className="text-muted-foreground">User not found.</p>
        </div>
      </AdminLayout>
    );
  }

  const { user, totalWhisps, creditTransactions, statusCounts, totalReplies, moderationFlagCount, moderationFlags } = data;

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setLocation("/admin/users")} className="text-muted-foreground -ml-2">
            <ArrowLeft className="w-4 h-4 mr-1" /> Users
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" data-testid="button-delete-user-detail">
                <Trash2 className="w-4 h-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this user?</AlertDialogTitle>
                <AlertDialogDescription>
                  Permanently deletes {user.email} and all their whisps, replies, tracking history, and credit transactions. This can't be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <Card className="bg-card border-border/50">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <CardTitle className="text-xl font-serif truncate">{user.fullName || user.email}</CardTitle>
                <p className="text-sm text-muted-foreground truncate">{user.email}</p>
              </div>
              {user.banned && <Badge variant="destructive" className="shrink-0">Banned</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {(user.city || user.country) && (
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <MapPin className="w-4 h-4" /> {[user.city, user.region, user.country].filter(Boolean).join(", ")}
              </p>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Phone</p>
                <p className="font-medium text-foreground">{user.phone || "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Gender</p>
                <p className="font-medium text-foreground capitalize">{user.gender?.replace(/_/g, " ") || "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Age range</p>
                <p className="font-medium text-foreground">{user.ageRange?.replace(/_/g, " ") || "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Whisper Links used</p>
                <p className="font-medium text-foreground">{user.whisperLinksUsed}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Total whisps</p>
                <p className="font-medium text-foreground">{totalWhisps}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Replies received</p>
                <p className="font-medium text-foreground">{totalReplies}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Joined</p>
                <p className="font-medium text-foreground">{new Date(user.createdAt).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Last seen</p>
                <p className="font-medium text-foreground">{user.lastSeenAt ? new Date(user.lastSeenAt).toLocaleDateString() : "—"}</p>
              </div>
            </div>

            {Object.keys(statusCounts).length > 0 && (
              <div className="flex flex-wrap gap-2 pt-3 border-t border-border/30">
                {Object.entries(statusCounts).map(([status, statusCount]) => (
                  <span key={status} className="flex items-center gap-1.5">
                    <StatusBadge status={status} />
                    <span className="text-xs text-muted-foreground">×{statusCount}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="bg-input/50 border-border/50 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Plan</Label>
                <Select value={plan} onValueChange={setPlan}>
                  <SelectTrigger className="bg-input/50 border-border/50 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="spark">Spark</SelectItem>
                    <SelectItem value="ember">Ember</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Ghost Boost credits</Label>
                <Input
                  type="number"
                  min={0}
                  className="bg-input/50 border-border/50 rounded-xl"
                  value={boostCredits}
                  onChange={(e) => setBoostCredits(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={handleSave} disabled={updateUser.isPending} className="rounded-full" data-testid="button-save-user">
                {updateUser.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Save Changes
              </Button>
              <Button variant="outline" onClick={toggleBan} disabled={updateUser.isPending} className="rounded-full">
                {user.banned ? "Unban User" : "Ban User"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {moderationFlagCount > 0 && (
          <Card className="bg-destructive/5 border-destructive/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-serif text-destructive flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4" /> Content Flags ({moderationFlagCount} active)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {moderationFlags.map((f) => {
                // Text Whisp flags (see moderation_flags.ts's contentType)
                // have no admin whisp-detail page to deep-link into — shown
                // as a static row with a short message excerpt instead of a
                // clickable video title.
                const isTextWhisp = f.contentType === "text_whisp";
                const content = (
                  <>
                    <div className="flex items-center justify-between mb-1">
                      <span className="flex items-center gap-2 min-w-0">
                        <Badge variant={f.dismissed ? "outline" : "destructive"} className="capitalize shrink-0">{f.severity}</Badge>
                        <span className="text-foreground truncate">
                          {isTextWhisp ? `Text Whisp: "${(f.textWhispMessage ?? "").slice(0, 40)}${(f.textWhispMessage?.length ?? 0) > 40 ? "…" : ""}"` : f.videoTitle || "Video"}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">{new Date(f.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p className="text-muted-foreground text-xs">{f.reasoning}</p>
                  </>
                );
                const rowClassName = `block p-3 rounded-xl text-sm border transition-colors ${isTextWhisp ? "" : "hover:bg-muted/30"} ${f.dismissed ? "bg-muted/10 border-border/30 opacity-60" : "bg-card border-destructive/20"}`;
                return isTextWhisp ? (
                  <div key={f.id} className={rowClassName}>{content}</div>
                ) : (
                  <Link key={f.id} href={`/admin/whisps/${f.whispId}`} className={rowClassName}>
                    {content}
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        )}

        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base font-serif">Activity Timeline</CardTitle>
            <Select value={whispStatusFilter} onValueChange={(v) => { setWhispStatusFilter(v); setWhispPage(1); }}>
              <SelectTrigger className="w-36 h-8 text-xs bg-input/50 border-border/50 rounded-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="failed">Couldn't send</SelectItem>
                <SelectItem value="opened">Opened</SelectItem>
                <SelectItem value="watched">Watched</SelectItem>
                <SelectItem value="replied">Replied</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="space-y-1">
            {whispsLoading ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
            ) : whispsPage?.items.length ? (
              <>
                {whispsPage.items.map((w) => (
                  <Link key={w.id} href={`/admin/whisps/${w.id}`} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted/30 transition-colors">
                    <PlayCircle className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm text-foreground">{w.videoTitle || w.videoUrl}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {deliveryLabel(w.deliveryMethod, w.whisperChannel)}
                        {(w.recipientEmail || w.recipientPhone) ? ` · to ${w.recipientEmail || w.recipientPhone}` : ""}
                        {w.replyCount > 0 ? (
                          <span className="inline-flex items-center gap-0.5 ml-1.5"><MessageSquareHeart className="w-3 h-3" /> {w.replyCount}</span>
                        ) : ""}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{new Date(w.createdAt).toLocaleDateString()}</span>
                    <StatusBadge status={w.status} />
                  </Link>
                ))}
                {whispsPage.total > WHISP_PAGE_SIZE && (
                  <div className="flex items-center justify-between pt-2">
                    <Button variant="outline" size="sm" className="rounded-full" disabled={whispPage <= 1} onClick={() => setWhispPage((p) => p - 1)}>
                      Prev
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Page {whispPage} of {Math.max(1, Math.ceil(whispsPage.total / WHISP_PAGE_SIZE))}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      disabled={whispPage >= Math.ceil(whispsPage.total / WHISP_PAGE_SIZE)}
                      onClick={() => setWhispPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </>
            ) : <p className="text-sm text-muted-foreground py-4 text-center">No whisps match this filter.</p>}
          </CardContent>
        </Card>

        {creditTransactions.length > 0 && (
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-serif">Credit Transactions</CardTitle>
              <p className="text-xs text-muted-foreground">Running balance walked backward from the current Ghost Boost credit count ({user.boostCredits}).</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {(() => {
                let runningBalance = user.boostCredits;
                return creditTransactions.map((tx) => {
                  const balanceAfter = runningBalance;
                  runningBalance -= tx.amount;
                  return (
                    <div key={tx.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border/30 last:border-0">
                      <span className="text-muted-foreground capitalize">{tx.type.replace("_", " ")}</span>
                      <span className={tx.amount >= 0 ? "text-primary font-medium" : "text-destructive font-medium"}>
                        {tx.amount >= 0 ? "+" : ""}{tx.amount}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">bal. {balanceAfter}</span>
                      <span className="text-xs text-muted-foreground">{new Date(tx.createdAt).toLocaleDateString()}</span>
                    </div>
                  );
                });
              })()}
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
