import { useState } from "react";
import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminSendNotification,
  useAdminListNotifications,
  useAdminListUsers,
  useGetMyAdminAccess,
  getAdminListNotificationsQueryKey,
  getAdminListUsersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Bell, Send, Loader2, X, Search, Users, User, Mail } from "lucide-react";

export function AdminNotifications() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [audience, setAudience] = useState<"all" | "users">("all");
  const [alsoEmail, setAlsoEmail] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<Array<{ id: string; email: string }>>([]);

  const sendNotification = useAdminSendNotification();
  // Recipient search hits the admin users list, which 403s for collaborators
  // without the "users" permission (e.g. the Assistant preset) — the picker
  // would just sit silently empty. Same optimistic-until-answered convention
  // as AdminLayout's rail: treat "not loaded yet" as permitted.
  const { data: access } = useGetMyAdminAccess();
  const canTargetSpecificUsers = !access || access.isOwner || access.permissions.includes("users");
  const userSearchParams = { search: userSearch, pageSize: 8 };
  const { data: userResults } = useAdminListUsers(userSearchParams, {
    query: {
      enabled: canTargetSpecificUsers && audience === "users" && userSearch.trim().length > 0,
      queryKey: getAdminListUsersQueryKey(userSearchParams),
    },
  });
  const { data: history, isLoading: historyLoading } = useAdminListNotifications(
    { pageSize: 20 },
    { query: { queryKey: getAdminListNotificationsQueryKey({ pageSize: 20 }) } },
  );

  function toggleUser(user: { id: string; email: string }) {
    setSelectedUsers((prev) => (prev.some((u) => u.id === user.id) ? prev.filter((u) => u.id !== user.id) : [...prev, user]));
  }

  function handleSend() {
    if (!title.trim() || !body.trim()) return;
    if (audience === "users" && selectedUsers.length === 0) {
      toast({ title: "Pick at least one user", variant: "destructive" });
      return;
    }

    sendNotification.mutate(
      {
        data: {
          title: title.trim(),
          body: body.trim(),
          url: url.trim() || null,
          audience,
          userIds: audience === "users" ? selectedUsers.map((u) => u.id) : undefined,
          sendEmail: alsoEmail,
        },
      },
      {
        onSuccess: (result) => {
          toast({
            title: `Sent to ${result.recipientCount} user${result.recipientCount === 1 ? "" : "s"}`,
            description: `${result.pushDelivered} reached live via push.${alsoEmail ? ` ${result.emailsSent} email${result.emailsSent === 1 ? "" : "s"} delivered${result.emailsSkipped ? `, ${result.emailsSkipped} skipped (opted out or no real email)` : ""}.` : ""}`,
          });
          setTitle("");
          setBody("");
          setUrl("");
          setSelectedUsers([]);
          queryClient.invalidateQueries({ queryKey: ["/api/admin/notifications"] });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Failed to send notification", variant: "destructive" }),
      },
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-2">
            <Bell className="w-7 h-7 text-primary" /> Notifications
          </h1>
          <p className="text-muted-foreground mt-1">Compose an in-app notification, plus a best-effort live push to anyone subscribed.</p>
        </div>

        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-serif">Compose</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="bg-input/50 border-border/50 rounded-xl" data-testid="input-notification-title" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Message</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={3} className="bg-input/50 border-border/50 rounded-xl" data-testid="input-notification-body" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Link (optional)</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/whisps" className="bg-input/50 border-border/50 rounded-xl" />
            </div>

            {/* The email channel reaches people who aren't in the app —
                respects each user's Settings opt-out and skips accounts
                without a real (non-placeholder) address. */}
            <button
              type="button"
              onClick={() => setAlsoEmail(!alsoEmail)}
              data-testid="button-toggle-send-email"
              className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                alsoEmail ? "border-primary bg-primary/10" : "border-border/50 hover:border-border"
              }`}
            >
              <Mail className="w-4 h-4 text-primary" />
              <div className="flex-1">
                <p className="font-medium text-foreground text-sm">Also send as email</p>
                <p className="text-xs text-muted-foreground">Branded email to each recipient's inbox — skips opted-out users and accounts without a real address.</p>
              </div>
              <div className={`w-9 h-5 rounded-full transition-colors relative ${alsoEmail ? "bg-primary" : "bg-muted"}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${alsoEmail ? "translate-x-4" : "translate-x-0.5"}`} />
              </div>
            </button>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Audience</Label>
              <Select value={audience} onValueChange={(v) => setAudience(v as "all" | "users")}>
                <SelectTrigger className="bg-input/50 border-border/50 rounded-xl w-full sm:w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all"><span className="flex items-center gap-2"><Users className="w-3.5 h-3.5" /> All users</span></SelectItem>
                  <SelectItem value="users" disabled={!canTargetSpecificUsers}><span className="flex items-center gap-2"><User className="w-3.5 h-3.5" /> Specific users</span></SelectItem>
                </SelectContent>
              </Select>
              {!canTargetSpecificUsers && (
                <p className="text-xs text-muted-foreground">
                  Targeting specific users requires the Users permission — ask the super admin.
                </p>
              )}
            </div>

            {audience === "users" && (
              <div className="space-y-2">
                {selectedUsers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedUsers.map((u) => (
                      <Badge key={u.id} variant="outline" className="gap-1">
                        {u.email}
                        <button onClick={() => toggleUser(u)} aria-label={`Remove ${u.email}`}>
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search users by email or name..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="pl-9 bg-input/50 border-border/50 rounded-xl"
                    data-testid="input-notification-user-search"
                  />
                </div>
                {userResults?.items.length ? (
                  <div className="border border-border/50 rounded-xl divide-y divide-border/30 max-h-48 overflow-y-auto">
                    {userResults.items.map((u) => {
                      const picked = selectedUsers.some((s) => s.id === u.id);
                      return (
                        <button
                          key={u.id}
                          onClick={() => toggleUser({ id: u.id, email: u.email })}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/30 transition-colors flex items-center justify-between ${picked ? "bg-primary/10" : ""}`}
                        >
                          <span className="truncate">{u.fullName || u.email} <span className="text-muted-foreground">{u.fullName ? `(${u.email})` : ""}</span></span>
                          {picked && <span className="text-primary text-xs shrink-0">Selected</span>}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            )}

            <Button
              onClick={handleSend}
              disabled={sendNotification.isPending || !title.trim() || !body.trim()}
              className="rounded-full"
              data-testid="button-send-notification"
            >
              {sendNotification.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
              Send
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-serif">Sent history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {historyLoading ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
            ) : history?.items.length ? (
              history.items.map((n) => (
                <div key={n.id} className="p-3 rounded-xl bg-muted/20 border border-border/30 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-foreground truncate">{n.title}</p>
                    <span className="text-xs text-muted-foreground shrink-0">{new Date(n.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-muted-foreground text-xs mt-0.5">{n.body}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {n.targetUserId ? (
                      <>To <Link href={`/admin_pro/users/${n.targetUserId}`} className="hover:text-primary transition-colors">{n.targetUserEmail ?? n.targetUserId}</Link></>
                    ) : "Broadcast to all users"}
                    {" · "}
                    {n.createdByAdminEmail ? `by ${n.createdByAdminEmail}` : "system-generated"}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">Nothing sent yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
