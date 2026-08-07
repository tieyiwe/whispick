import { useEffect, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminGetUser,
  useAdminUpdateUser,
  useAdminDeleteUser,
  getAdminGetUserQueryKey,
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
import { ArrowLeft, Loader2, MapPin, Trash2, PlayCircle } from "lucide-react";

export function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useAdminGetUser(id!, { query: { enabled: !!id, queryKey: getAdminGetUserQueryKey(id!) } });
  const updateUser = useAdminUpdateUser();
  const deleteUser = useAdminDeleteUser();

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

  const { user, recentWhisps, totalWhisps, creditTransactions } = data;

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
                <p className="text-muted-foreground">Whisper Links used</p>
                <p className="font-medium text-foreground">{user.whisperLinksUsed}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Total whisps</p>
                <p className="font-medium text-foreground">{totalWhisps}</p>
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

        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-serif">Recent Whisps</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentWhisps.length ? recentWhisps.map((w) => (
              <Link key={w.id} href={`/admin/whisps/${w.id}`} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted/30 transition-colors">
                <PlayCircle className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="flex-1 min-w-0 truncate text-sm text-foreground">{w.videoTitle || w.videoUrl}</span>
                <StatusBadge status={w.status} />
              </Link>
            )) : <p className="text-sm text-muted-foreground py-4 text-center">No whisps sent yet.</p>}
          </CardContent>
        </Card>

        {creditTransactions.length > 0 && (
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-serif">Credit Transactions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {creditTransactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border/30 last:border-0">
                  <span className="text-muted-foreground capitalize">{tx.type.replace("_", " ")}</span>
                  <span className={tx.amount >= 0 ? "text-primary font-medium" : "text-destructive font-medium"}>
                    {tx.amount >= 0 ? "+" : ""}{tx.amount}
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(tx.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
