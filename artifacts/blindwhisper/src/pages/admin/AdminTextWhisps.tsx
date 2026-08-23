import { useState } from "react";
import { useUser } from "@clerk/react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminBroadcastTextWhisp,
  useAdminSendTextWhispToStaff,
  useAdminListUsers,
  useAdminListProjects,
  useGetMyAdminAccess,
  getAdminListUsersQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { MessageCircle, Send, Loader2, X, Search, Users, User } from "lucide-react";

const MESSAGE_MAX_LENGTH = 260;

function BroadcastComposer() {
  const { toast } = useToast();
  const [messageText, setMessageText] = useState("");
  const [audience, setAudience] = useState<"all" | "selected">("all");
  const [userSearch, setUserSearch] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<Array<{ id: string; email: string }>>([]);

  const broadcast = useAdminBroadcastTextWhisp();
  // Same optimistic-until-answered convention as AdminNotifications: the
  // user search hits the admin users list, which 403s for collaborators
  // without the "users" permission — treat "not loaded yet" as permitted so
  // the picker doesn't just sit silently empty.
  const { data: access } = useGetMyAdminAccess();
  const canTargetSpecificUsers = !access || access.isOwner || access.permissions.includes("users");
  const userSearchParams = { search: userSearch, pageSize: 8 };
  const { data: userResults } = useAdminListUsers(userSearchParams, {
    query: {
      enabled: canTargetSpecificUsers && audience === "selected" && userSearch.trim().length > 0,
      queryKey: getAdminListUsersQueryKey(userSearchParams),
    },
  });

  const remaining = MESSAGE_MAX_LENGTH - messageText.length;
  const canSend =
    messageText.trim().length > 0 &&
    remaining >= 0 &&
    (audience === "all" || selectedUsers.length > 0);

  function toggleUser(user: { id: string; email: string }) {
    setSelectedUsers((prev) => (prev.some((u) => u.id === user.id) ? prev.filter((u) => u.id !== user.id) : [...prev, user]));
  }

  function doSend() {
    broadcast.mutate(
      {
        data: {
          messageText: messageText.trim(),
          audience,
          userIds: audience === "selected" ? selectedUsers.map((u) => u.id) : undefined,
        },
      },
      {
        onSuccess: (result) => {
          toast({
            title: `Sent to ${result.recipientCount} recipient${result.recipientCount === 1 ? "" : "s"}`,
          });
          setMessageText("");
          setSelectedUsers([]);
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Failed to send broadcast", variant: "destructive" }),
      },
    );
  }

  function handleSendClick() {
    if (!canSend) return;
    // "All users" skips the confirm dialog below (it triggers doSend()
    // itself via the AlertDialogAction) — only get here for "selected",
    // which sends straight away since the blast radius is a chosen handful.
    if (audience === "selected") doSend();
  }

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-serif">Broadcast</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 border border-border/40">
          Sent in-app from the platform's "Blind Whisper Team" account, not from you personally.
        </p>

        <div className="space-y-1.5">
          <Label className="text-muted-foreground">Message</Label>
          <div className="relative">
            <Textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              maxLength={MESSAGE_MAX_LENGTH}
              rows={3}
              className="bg-input/50 border-border/50 rounded-xl resize-none"
              data-testid="textarea-broadcast-message"
            />
            <span className={`absolute bottom-2 right-3 text-xs ${remaining < 0 ? "text-destructive" : "text-muted-foreground"}`}>
              {messageText.length}/{MESSAGE_MAX_LENGTH}
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-muted-foreground">Audience</Label>
          <Select value={audience} onValueChange={(v) => setAudience(v as "all" | "selected")}>
            <SelectTrigger className="bg-input/50 border-border/50 rounded-xl w-full sm:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all"><span className="flex items-center gap-2"><Users className="w-3.5 h-3.5" /> All users</span></SelectItem>
              <SelectItem value="selected" disabled={!canTargetSpecificUsers}><span className="flex items-center gap-2"><User className="w-3.5 h-3.5" /> Specific users</span></SelectItem>
            </SelectContent>
          </Select>
          {!canTargetSpecificUsers && (
            <p className="text-xs text-muted-foreground">
              Targeting specific users requires the Users permission — ask the super admin.
            </p>
          )}
        </div>

        {audience === "selected" && (
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
                data-testid="input-broadcast-user-search"
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
              <Button
                disabled={broadcast.isPending || !canSend}
                className="rounded-full"
                data-testid="button-send-broadcast"
              >
                {broadcast.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                Send broadcast
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Send this Text Whisp to every user?</AlertDialogTitle>
                <AlertDialogDescription>
                  This reaches the entire platform, delivered in-app from the "Blind Whisper Team" account. There's
                  no undo once it's sent.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={doSend}>
                  Send to everyone
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button
            onClick={handleSendClick}
            disabled={broadcast.isPending || !canSend}
            className="rounded-full"
            data-testid="button-send-broadcast"
          >
            {broadcast.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
            Send broadcast
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
  // Same {items, staff} shape AdminProjects.tsx's task-assignee picker
  // draws from — the projects list happens to be the endpoint that returns
  // the HQ staff roster.
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

        <Button
          onClick={handleSend}
          disabled={sendToStaff.isPending || !canSend}
          className="rounded-full"
          data-testid="button-send-staff-whisp"
        >
          {sendToStaff.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
          Send
        </Button>
      </CardContent>
    </Card>
  );
}

export function AdminTextWhisps() {
  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-2">
            <MessageCircle className="w-7 h-7 text-primary" /> Text Whisps
          </h1>
          <p className="text-muted-foreground mt-1">
            Broadcast an in-app Text Whisp platform-wide or to a chosen set of users, or message a colleague on staff
            directly by account.
          </p>
        </div>

        <BroadcastComposer />
        <StaffComposer />
      </div>
    </AdminLayout>
  );
}
