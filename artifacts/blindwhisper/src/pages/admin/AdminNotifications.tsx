import { useState } from "react";
import { Link } from "wouter";
import { useUser } from "@clerk/react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminSendNotification,
  useAdminBroadcastTextWhisp,
  useAdminSendTextWhispToStaff,
  useAdminListNotifications,
  useAdminListUsers,
  useAdminListProjects,
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
import { Bell, MessageCircle, Send, Loader2, X, Search, Users, User, Mail } from "lucide-react";

// Shared with the Text Whisp channel (textWhisps.messageText's own cap) —
// kept at the tighter of the two limits so one message body works for
// either channel without a second, confusing counter.
const MESSAGE_MAX_LENGTH = 260;

// A single "reach people" composer. Bell notifications and Text Whisp
// broadcasts used to be two separate admin pages with duplicated audience
// pickers — same underlying goal (reach all/some users), different delivery
// mechanics (an ephemeral bell + optional email vs. a real message sitting
// in the recipient's Text Whisps inbox). They stay two distinct backend
// calls (notifications and text_whisps are genuinely different tables with
// different guarantees — a Text Whisp can be replied to, a notification
// can't), but the admin now composes once and picks one or both channels,
// instead of retyping the same announcement on two different pages.
function BroadcastComposer() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [messageText, setMessageText] = useState("");
  const [url, setUrl] = useState("");
  const [audience, setAudience] = useState<"all" | "users">("all");
  const [sendAsNotification, setSendAsNotification] = useState(true);
  const [sendAsTextWhisp, setSendAsTextWhisp] = useState(false);
  const [alsoEmail, setAlsoEmail] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<Array<{ id: string; email: string }>>([]);

  const sendNotification = useAdminSendNotification();
  const broadcastTextWhisp = useAdminBroadcastTextWhisp();
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

  function toggleUser(user: { id: string; email: string }) {
    setSelectedUsers((prev) => (prev.some((u) => u.id === user.id) ? prev.filter((u) => u.id !== user.id) : [...prev, user]));
  }

  const remaining = MESSAGE_MAX_LENGTH - messageText.length;
  const noChannelPicked = !sendAsNotification && !sendAsTextWhisp;
  const canSend =
    messageText.trim().length > 0 &&
    remaining >= 0 &&
    !noChannelPicked &&
    (!sendAsNotification || title.trim().length > 0) &&
    (audience === "all" || selectedUsers.length > 0);

  async function doSend() {
    const body = messageText.trim();
    const userIds = audience === "users" ? selectedUsers.map((u) => u.id) : undefined;

    // Both channels fire together, independently — a failure on one
    // (e.g. a transient email-provider hiccup inside the notification send)
    // shouldn't silently swallow the other having gone out.
    const [notificationResult, textWhispResult] = await Promise.allSettled([
      sendAsNotification
        ? sendNotification.mutateAsync({ data: { title: title.trim(), body, url: url.trim() || null, audience: audience === "all" ? "all" : "users", userIds, sendEmail: alsoEmail } })
        : Promise.resolve(null),
      sendAsTextWhisp
        ? broadcastTextWhisp.mutateAsync({ data: { messageText: body, audience: audience === "all" ? "all" : "selected", userIds } })
        : Promise.resolve(null),
    ]);

    const parts: string[] = [];
    let failed = false;
    if (sendAsNotification) {
      if (notificationResult.status === "fulfilled" && notificationResult.value) {
        const r = notificationResult.value;
        parts.push(`Bell: ${r.recipientCount} reached (${r.pushDelivered} live push${alsoEmail ? `, ${r.emailsSent} emailed` : ""})`);
      } else {
        failed = true;
        parts.push(`Bell notification failed: ${(notificationResult as PromiseRejectedResult).reason?.data?.error ?? "unknown error"}`);
      }
    }
    if (sendAsTextWhisp) {
      if (textWhispResult.status === "fulfilled" && textWhispResult.value) {
        parts.push(`Text Whisp: ${textWhispResult.value.recipientCount} recipient${textWhispResult.value.recipientCount === 1 ? "" : "s"}`);
      } else {
        failed = true;
        parts.push(`Text Whisp broadcast failed: ${(textWhispResult as PromiseRejectedResult).reason?.data?.error ?? "unknown error"}`);
      }
    }

    toast({ title: failed ? "Sent with errors" : "Sent", description: parts.join(" · "), variant: failed ? "destructive" : undefined });

    if (!failed || notificationResult.status === "fulfilled") {
      setTitle("");
      setMessageText("");
      setUrl("");
      setSelectedUsers([]);
    }
    queryClient.invalidateQueries({ queryKey: ["/api/admin/notifications"] });
  }

  function handleSendClick() {
    if (!canSend) return;
    // "All users" goes through the confirm dialog below (it triggers
    // doSend() itself via AlertDialogAction) — only get here for "users",
    // which sends straight away since the blast radius is a chosen handful.
    if (audience === "users") void doSend();
  }

  const sending = sendNotification.isPending || broadcastTextWhisp.isPending;

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-serif">Compose</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Channels first — everything below adapts to what's picked
            (title only matters for the bell, the char limit is shared). */}
        <div className="space-y-1.5">
          <Label className="text-muted-foreground">Send as</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSendAsNotification(!sendAsNotification)}
              data-testid="button-toggle-channel-notification"
              className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all ${sendAsNotification ? "border-primary bg-primary/10" : "border-border/50 hover:border-border"}`}
            >
              <Bell className="w-4 h-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground text-sm">Bell notification</p>
                <p className="text-xs text-muted-foreground">In-app + live push, optional email</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setSendAsTextWhisp(!sendAsTextWhisp)}
              data-testid="button-toggle-channel-text-whisp"
              className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all ${sendAsTextWhisp ? "border-primary bg-primary/10" : "border-border/50 hover:border-border"}`}
            >
              <MessageCircle className="w-4 h-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground text-sm">Text Whisp</p>
                <p className="text-xs text-muted-foreground">A real message in their inbox, from "Blind Whisper Team"</p>
              </div>
            </button>
          </div>
          {noChannelPicked && <p className="text-xs text-destructive">Pick at least one channel.</p>}
        </div>

        {sendAsNotification && (
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Title <span className="text-xs">(bell notification only)</span></Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="bg-input/50 border-border/50 rounded-xl" data-testid="input-notification-title" />
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-muted-foreground">Message</Label>
          <div className="relative">
            <Textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              maxLength={MESSAGE_MAX_LENGTH}
              rows={3}
              className="bg-input/50 border-border/50 rounded-xl resize-none"
              data-testid="input-notification-body"
            />
            <span className={`absolute bottom-2 right-3 text-xs ${remaining < 0 ? "text-destructive" : "text-muted-foreground"}`}>
              {messageText.length}/{MESSAGE_MAX_LENGTH}
            </span>
          </div>
        </div>

        {sendAsNotification && (
          <>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Link <span className="text-xs">(optional, bell notification only)</span></Label>
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
          </>
        )}

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

        {audience === "all" ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={sending || !canSend} className="rounded-full" data-testid="button-send-notification">
                {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                Send
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Send this to every user?</AlertDialogTitle>
                <AlertDialogDescription>
                  This reaches the entire platform{sendAsNotification && sendAsTextWhisp ? " on both channels" : ""}. There's no undo once it's sent.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void doSend()}>Send to everyone</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button onClick={handleSendClick} disabled={sending || !canSend} className="rounded-full" data-testid="button-send-notification">
            {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
            Send
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function StaffComposer() {
  const { toast } = useToast();
  const { user } = useUser();
  const [recipientAdminId, setRecipientAdminId] = useState<string>("");
  const [messageText, setMessageText] = useState("");

  const sendToStaff = useAdminSendTextWhispToStaff();
  // Same {items, staff} shape AdminProjects.tsx's task-assignee picker draws
  // from — the projects list happens to be the endpoint that returns the HQ
  // staff roster.
  const { data: projectsData } = useAdminListProjects();
  const myEmail = user?.primaryEmailAddress?.emailAddress;
  const staff = (projectsData?.staff ?? []).filter((s) => s.email !== myEmail);

  const remaining = MESSAGE_MAX_LENGTH - messageText.length;
  const canSend = !!recipientAdminId && messageText.trim().length > 0 && remaining >= 0;

  function handleSend() {
    if (!canSend) return;
    sendToStaff.mutate(
      { data: { recipientAdminId, messageText: messageText.trim() } },
      {
        onSuccess: () => {
          toast({ title: "Text Whisp sent" });
          setMessageText("");
          setRecipientAdminId("");
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Failed to send", variant: "destructive" }),
      },
    );
  }

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-serif">Message a colleague</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 border border-border/40">
          Sent from your own account, not anonymously — no phone number needed, just pick them from staff.
        </p>

        <div className="space-y-1.5">
          <Label className="text-muted-foreground">Staff member</Label>
          <Select value={recipientAdminId} onValueChange={setRecipientAdminId}>
            <SelectTrigger className="bg-input/50 border-border/50 rounded-xl w-full sm:w-72" data-testid="select-staff-recipient">
              <SelectValue placeholder="Choose a staff member..." />
            </SelectTrigger>
            <SelectContent>
              {staff.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.email} · {s.roleTitle}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-muted-foreground">Message</Label>
          <div className="relative">
            <Textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              maxLength={MESSAGE_MAX_LENGTH}
              rows={3}
              className="bg-input/50 border-border/50 rounded-xl resize-none"
              data-testid="textarea-staff-message"
            />
            <span className={`absolute bottom-2 right-3 text-xs ${remaining < 0 ? "text-destructive" : "text-muted-foreground"}`}>
              {messageText.length}/{MESSAGE_MAX_LENGTH}
            </span>
          </div>
        </div>

        <Button onClick={handleSend} disabled={sendToStaff.isPending || !canSend} className="rounded-full" data-testid="button-send-staff-whisp">
          {sendToStaff.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
          Send
        </Button>
      </CardContent>
    </Card>
  );
}

export function AdminNotifications() {
  const { data: history, isLoading: historyLoading } = useAdminListNotifications(
    { pageSize: 20 },
    { query: { queryKey: getAdminListNotificationsQueryKey({ pageSize: 20 }) } },
  );

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-2">
            <Bell className="w-7 h-7 text-primary" /> Messages
          </h1>
          <p className="text-muted-foreground mt-1">
            Reach the platform by bell notification, Text Whisp, or both at once — plus a direct line to one colleague.
          </p>
        </div>

        <BroadcastComposer />
        <StaffComposer />

        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-serif">Sent history</CardTitle>
            <p className="text-xs text-muted-foreground">Bell notifications only — Text Whisp sends show up in the Audit Log.</p>
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
