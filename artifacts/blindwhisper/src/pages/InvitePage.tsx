import { useState } from "react";
import { useCreateInvite, useListInvites, useRequestInviteReveal, getListInvitesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Mail, MessageSquare, UserPlus, Eye, Loader2 } from "lucide-react";
import { RevealCountdownDialog } from "@/components/shared/RevealCountdownDialog";

type Channel = "email" | "sms" | "whatsapp";

// labelKey resolves against the "account" namespace's invitePage.* keys at
// render time via t(), the same labelKey pattern AppLayout's NAV_ITEMS uses.
const CHANNELS: { key: Channel; labelKey: string; icon: typeof Mail }[] = [
  { key: "email", labelKey: "invitePage.channelEmail", icon: Mail },
  { key: "sms", labelKey: "invitePage.channelText", icon: MessageSquare },
  { key: "whatsapp", labelKey: "invitePage.channelWhatsapp", icon: MessageSquare },
];

const STATUS_CONFIG: Record<string, { labelKey: string; className: string }> = {
  sent: { labelKey: "invitePage.statusSent", className: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  failed: { labelKey: "invitePage.statusFailed", className: "bg-destructive/10 text-destructive border-destructive/20" },
  joined: { labelKey: "invitePage.statusJoined", className: "bg-primary/20 text-primary border-primary/30" },
};

function InviteStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("account");
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.sent;
  return (
    <span className={`text-xs font-medium rounded-full px-2.5 py-0.5 border ${config.className}`}>{t(config.labelKey)}</span>
  );
}

export function InvitePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation("account");
  const [channel, setChannel] = useState<Channel>("email");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  // Single shared countdown dialog for the whole list — which invite it's
  // for is just which id is currently non-null here, same "one shared
  // component, id picks the target" shape as a per-row menu/dialog
  // elsewhere in this app (e.g. WhispsList.tsx's openMenuId).
  const [revealCountdownInviteId, setRevealCountdownInviteId] = useState<string | null>(null);

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
          toast({ title: t("invitePage.toastInviteSent") });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? t("invitePage.toastInviteSendFailed"), variant: "destructive" }),
      }
    );
  }

  function handleReveal(id: string) {
    requestReveal.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInvitesQueryKey() });
          toast({ title: t("invitePage.toastRevealRequestSent") });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? t("invitePage.toastRevealRequestFailed"), variant: "destructive" }),
      }
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-serif font-bold text-foreground">{t("invitePage.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("invitePage.subtitle")}
          </p>
        </div>

        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif">{t("invitePage.sendInviteCardTitle")}</CardTitle>
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
                    {t(ch.labelKey)}
                  </button>
                );
              })}
            </div>

            {channel === "email" ? (
              <Input
                placeholder={t("invitePage.emailPlaceholder")}
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                data-testid="input-invite-email"
              />
            ) : (
              <Input
                placeholder={t("invitePage.phonePlaceholder")}
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
              {t("invitePage.sendInvite")}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("invitePage.invitesSentHeading")}</h2>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
            </div>
          ) : !invites?.length ? (
            <p className="text-sm text-muted-foreground py-4">{t("invitePage.noInvitesYet")}</p>
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
                        onClick={() => setRevealCountdownInviteId(invite.id)}
                        disabled={requestReveal.isPending}
                        data-testid={`button-reveal-invite-${invite.id}`}
                      >
                        <Eye className="w-3.5 h-3.5 mr-1.5" /> {t("invitePage.revealYourself")}
                      </Button>
                    )}

                    {invite.revealRequested && (
                      <p className="text-xs text-muted-foreground">
                        {invite.revealAccepted === true
                          ? t("invitePage.revealAccepted")
                          : invite.revealAccepted === false
                          ? t("invitePage.revealDeclined")
                          : t("invitePage.revealWaiting")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <RevealCountdownDialog
        open={!!revealCountdownInviteId}
        onOpenChange={(open) => !open && setRevealCountdownInviteId(null)}
        onConfirm={() => {
          if (revealCountdownInviteId) handleReveal(revealCountdownInviteId);
        }}
      />
    </AppLayout>
  );
}
