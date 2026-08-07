import { useState } from "react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminListUsers,
  useAdminUpdateUser,
  useAdminDeleteUser,
  getAdminListUsersQueryKey,
} from "@workspace/api-client-react";
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
import { Search, ChevronLeft, ChevronRight, ShieldCheck, Ban, CheckCircle2, Trash2, MapPin } from "lucide-react";

const PAGE_SIZE = 20;

export function AdminUsers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState("all");
  const [role, setRole] = useState("all");
  const [banned, setBanned] = useState("all");
  const [page, setPage] = useState(1);

  const params = {
    ...(search ? { search } : {}),
    ...(plan !== "all" ? { plan } : {}),
    ...(role !== "all" ? { role } : {}),
    ...(banned !== "all" ? { banned } : {}),
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isLoading } = useAdminListUsers(params, {
    query: { queryKey: getAdminListUsersQueryKey(params) },
  });

  const updateUser = useAdminUpdateUser();
  const deleteUser = useAdminDeleteUser();

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
  }

  function toggleBan(id: string, currentlyBanned: boolean) {
    updateUser.mutate(
      { id, data: { banned: !currentlyBanned } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: currentlyBanned ? "User unbanned" : "User banned" });
        },
        onError: (err: any) => toast({ title: err?.error ?? "Action failed", variant: "destructive" }),
      }
    );
  }

  function handleDelete(id: string) {
    deleteUser.mutate(
      { id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "User deleted" });
        },
        onError: (err: any) => toast({ title: err?.error ?? "Failed to delete user", variant: "destructive" }),
      }
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Users</h1>
          <p className="text-muted-foreground mt-1">{data?.total ?? 0} total users.</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by email or name..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 bg-card border-border/50 rounded-full"
              data-testid="input-admin-user-search"
            />
          </div>
          <Select value={plan} onValueChange={(v) => { setPlan(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-36 bg-card border-border/50 rounded-full"><SelectValue placeholder="Plan" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All plans</SelectItem>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="spark">Spark</SelectItem>
              <SelectItem value="ember">Ember</SelectItem>
            </SelectContent>
          </Select>
          <Select value={role} onValueChange={(v) => { setRole(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-36 bg-card border-border/50 rounded-full"><SelectValue placeholder="Role" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
          <Select value={banned} onValueChange={(v) => { setBanned(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-36 bg-card border-border/50 rounded-full"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="false">Active</SelectItem>
              <SelectItem value="true">Banned</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
          </div>
        ) : data?.items.length ? (
          <div className="space-y-2">
            {data.items.map((user) => (
              <Card key={user.id} className="bg-card border-border/50" data-testid={`admin-user-row-${user.id}`}>
                <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2">
                      <Link href={`/admin/users/${user.id}`} className="font-medium text-foreground hover:text-primary transition-colors truncate">
                        {user.fullName || user.email}
                      </Link>
                      {user.role === "admin" && (
                        <Badge variant="outline" className="text-primary border-primary/30 gap-1"><ShieldCheck className="w-3 h-3" /> Admin</Badge>
                      )}
                      {user.banned && <Badge variant="destructive">Banned</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    {(user.city || user.country) && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3" /> {[user.city, user.country].filter(Boolean).join(", ")}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className="capitalize">{user.plan}</Badge>
                  <span className="text-xs text-muted-foreground w-24 text-center">{user.boostCredits} credits</span>
                  <span className="text-xs text-muted-foreground w-28">{new Date(user.createdAt).toLocaleDateString()}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-full text-muted-foreground"
                      onClick={() => toggleBan(user.id, user.banned)}
                      disabled={updateUser.isPending}
                      data-testid={`button-toggle-ban-${user.id}`}
                    >
                      {user.banned ? <CheckCircle2 className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="rounded-full text-muted-foreground hover:text-destructive" data-testid={`button-delete-user-${user.id}`}>
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
                          <AlertDialogAction
                            onClick={() => handleDelete(user.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <p className="text-muted-foreground">No users match those filters.</p>
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
