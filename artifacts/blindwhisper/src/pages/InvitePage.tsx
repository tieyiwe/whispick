import { useState } from "react";
import { useCreateInvite, useListInvites, useRequestInviteReveal, getListInvitesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Mail, MessageSquare, UserPlus, Eye, Loader2 } from "lucide-react";

type Channel = "email" | "sms" | "whatsapp";

const CHANNELS: { key: Channel; label: string; icon: typeof Mail }[] = [
  { key: "email", label: "Email", icon: Mail },
  { key: "sms", label: "Text", icon: MessageSquare },
  { key: "whatsapp", label: "WhatsApp", icon: MessageSquare },
];

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  sent: { label: "Sent", className: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  failed: { label: "Couldn't send", className: "bg-destructive/10 text-destructive border-destructive/20" },
  joined: { label: "Joined", className: "bg-primary/20 text-primary border-primary/30" },
};

function InviteStatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.sent;
  return (
    <span className={`text-xs font-medium rounded-full px-2.5 py-0.5 border ${config.className}`}>{config.label}</span>
  );
}

export function InvitePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState<Channel>("email");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");

  const { data: invites, isLoading } = useListInvites();
  const createInvite = useCreateInvite();
  const requestReveal = useRequestInviteReveal();

  const canSend = channel === "email" ? !!recipientEmail.trim() : !!recipientPhone.trim();

  function handleSend() {
    createInvite.mutate(
      {
        data: {
          channel,
          recipientEmail: channel === "email" ? recipientEmail.trim() || null : null,
          recipientPhone: channel !== "email" ? recipientPhone.trim() || null : null,
        },
      },
      {
        onSuccess: () => {
          setRecipientEmail("");
          setRecipientPhone("");
          queryClient.invalidateQueries({ queryKey: getListInvitesQueryKey() });
          toast({ title: "Invite sent anonymously" });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Failed to send invite", variant: "destructive" }),
      }
    );
  }

  function handleReveal(id: string) {
    requestReveal.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInvitesQueryKey() });
          toast({ title: "Reveal request sent" });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Failed to request reveal", variant: "destructive" }),
      }
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-serif font-bold text-foreground">Invite a Friend</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Invite someone to join Blind Whisper — anonymously, exactly like a whisp. They won't know it's from you
            unless you choose to reveal yourself later.
          </p>
        </div>

        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif">Send an invite</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {CHANNELS.map((ch) => {
                const Icon = ch.icon;
                return (
                  <button
                    key={ch.key}
                    type="button"
                    onClick={() => setChannel(ch.key)}
                    data-testid={`invite-channel-${ch.key}`}
                    className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                      channel === ch.key
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border/50 text-muted-foreground hover:border-border"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {ch.label}
                  </button>
                );
              })}
            </div>

            {channel === "email" ? (
              <Input
                placeholder="friend@example.com"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                data-testid="input-invite-email"
              />
            ) : (
              <Input
                placeholder="+1 555 123 4567"
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                data-testid="input-invite-phone"
              />
            )}

            <Button
              onClick={handleSend}
              disabled={!canSend || createInvite.isPending}
              className="w-full rounded-full"
              data-testid="button-send-invite"
            >
              {createInvite.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <UserPlus className="w-4 h-4 mr-2" />
              )}
              Send Invite
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Invites you've sent</h2>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
            </div>
          ) : !invites?.length ? (
            <p className="text-sm text-muted-foreground py-4">You haven't sent any invites yet.</p>
          ) : (
            <div className="space-y-2">
              {invites.map((invite) => (
                <Card key={invite.id} className="bg-card border-border/50">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-foreground truncate">
                        {invite.recipientEmail || invite.recipientPhone}
                      </span>
                      <InviteStatusBadge status={invite.status} />
                    </div>

                    {invite.status === "joined" && !invite.revealRequested && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full border-primary/30 hover:bg-primary/10 hover:text-primary"
                        onClick={() => handleReveal(invite.id)}
                        disabled={requestReveal.isPending}
                        data-testid={`button-reveal-invite-${invite.id}`}
                      >
                        <Eye className="w-3.5 h-3.5 mr-1.5" /> Reveal Yourself
                      </Button>
                    )}

                    {invite.revealRequested && (
                      <p className="text-xs text-muted-foreground">
                        {invite.revealAccepted === true
                          ? "They accepted! You can now reveal your identity."
                          : invite.revealAccepted === false
                          ? "They declined the reveal."
                          : "Waiting for them to respond..."}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
