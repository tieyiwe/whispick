import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useSendWhisperBoxMessage, useGetPublicWhisperBox, getGetPublicWhisperBoxQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Mailbox, Send, Loader2, CheckCircle2, Sparkles } from "lucide-react";
import { LogoLockup } from "@/components/ui/logo";
import { AvatarCircle } from "@/components/shared/AvatarCircle";
import { PullToRefresh } from "@/components/shared/PullToRefresh";

const MESSAGE_MAX_LENGTH = 500;
const ALIAS_MAX_LENGTH = 60;

function BlindWhisperLogoMark() {
  return (
    // A stranger's first sight of the brand, same treatment as every other
    // public landing page (PublicInvitePage.tsx / PublicTextWhisp.tsx).
    <LogoLockup tagline />
  );
}

// The platform's one deliberately anonymous-SENDER page — see
// whisper_box_messages.ts's schema comment and docs/features-community.md's
// "Whisper Box" section. Unlike /w/:token, /invite/:token and /tw/:token
// (each single-recipient, private, and noindex'd), this is a PERSISTENT
// public page a Whisperer is meant to hand out as a bio link and have
// strangers find repeatedly — so, deliberately, no noindex meta tag here.
export function PublicWhisperBoxPage() {
  const { handle } = useParams<{ handle: string }>();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { t } = useTranslation("whisperBox");

  const [messageText, setMessageText] = useState("");
  const [senderAlias, setSenderAlias] = useState("");
  const [sent, setSent] = useState(false);

  const { refetch, data: box, isLoading } = useGetPublicWhisperBox(handle!, {
    query: { enabled: !!handle, queryKey: getGetPublicWhisperBoxQueryKey(handle!) },
  });

  const sendMessage = useSendWhisperBoxMessage();

  const remaining = MESSAGE_MAX_LENGTH - messageText.length;
  const canSend = messageText.trim().length > 0 && remaining >= 0 && !sendMessage.isPending;

  function handleSend() {
    if (!canSend || !handle) return;
    sendMessage.mutate(
      { handle, data: { messageText: messageText.trim(), senderAlias: senderAlias.trim() || null } },
      {
        onSuccess: () => setSent(true),
        onError: (err: any) => {
          if (err?.status === 429) {
            toast({
              title: t("publicWhisperBoxPage.toastRateLimitedTitle"),
              description: t("publicWhisperBoxPage.toastRateLimitedDescription"),
              variant: "destructive",
            });
            return;
          }
          if (err?.status === 400) {
            toast({ title: err?.data?.error ?? t("publicWhisperBoxPage.toastValidationError"), variant: "destructive" });
            return;
          }
          toast({ title: t("publicWhisperBoxPage.toastSendFailed"), variant: "destructive" });
        },
      },
    );
  }

  function handleSendAnother() {
    setSent(false);
    setMessageText("");
    setSenderAlias("");
  }

  function handleSignUp() {
    setLocation("/sign-up");
  }

  return (
    <PullToRefresh onRefresh={() => refetch()}>
      <div className="min-h-[100dvh] bg-background flex flex-col relative overflow-hidden">
        {/* Ambient background — same treatment as every other public page */}
        <div className="absolute top-[-15%] left-[-15%] w-[70%] h-[45%] rounded-full blur-[110px] pointer-events-none bg-primary/16" />
        <div className="absolute bottom-[-10%] right-[-15%] w-[55%] h-[35%] rounded-full blur-[100px] pointer-events-none bg-secondary/10" />

        {/* Header */}
        <header
          className="px-5 pb-5 flex items-center justify-between border-b border-border/30 relative z-10"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
        >
          <BlindWhisperLogoMark />
        </header>

        {/* Content */}
        <main className="flex-1 max-w-lg mx-auto w-full px-5 py-10 space-y-7 relative z-10">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-16 w-16 rounded-full mx-auto" />
              <Skeleton className="h-6 w-56 mx-auto" />
              <Skeleton className="h-40 rounded-2xl" />
            </div>
          ) : !box ? (
            <div className="text-center py-20 space-y-3">
              <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto">
                <Mailbox className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground">{t("publicWhisperBoxPage.notFoundTitle")}</p>
              <p className="text-sm text-muted-foreground/80 max-w-xs mx-auto">{t("publicWhisperBoxPage.notFoundDescription")}</p>
            </div>
          ) : sent ? (
            <div className="rounded-2xl overflow-hidden bg-card border border-border/50 glow-card p-6 space-y-4 text-center">
              <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7 text-primary" />
              </div>
              <div className="space-y-1.5">
                <p className="font-medium text-foreground">{t("publicWhisperBoxPage.successTitle")}</p>
                <p className="text-sm text-muted-foreground">{t("publicWhisperBoxPage.successDescription")}</p>
              </div>
              <Button size="lg" className="rounded-full w-full" onClick={handleSendAnother} data-testid="button-send-another-whisper-box-message">
                {t("publicWhisperBoxPage.sendAnotherButton")}
              </Button>
              <p className="text-xs text-muted-foreground pt-1">
                {t("publicWhisperBoxPage.signUpPrompt")}{" "}
                <button type="button" onClick={handleSignUp} className="text-primary hover:underline font-medium" data-testid="button-sign-up-from-whisper-box">
                  {t("publicWhisperBoxPage.signUpLinkText")}
                </button>
              </p>
            </div>
          ) : (
            <>
              <div className="text-center space-y-3">
                <AvatarCircle avatarId={box.avatarId} handle={box.handle} size="lg" className="mx-auto" />
                <p className="text-xl font-serif text-foreground leading-snug">
                  {t("publicWhisperBoxPage.heading", { handle: box.handle })}
                </p>
                <p className="text-sm text-muted-foreground">{t("publicWhisperBoxPage.subheading")}</p>
              </div>

              <div className="rounded-2xl bg-card border border-border/50 p-6 space-y-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground" htmlFor="whisper-box-message">
                    {t("publicWhisperBoxPage.messageLabel")}
                  </label>
                  <div className="relative">
                    <Textarea
                      id="whisper-box-message"
                      className="bg-input/50 border-border/50 rounded-xl min-h-[120px] resize-none"
                      placeholder={t("publicWhisperBoxPage.messagePlaceholder")}
                      maxLength={MESSAGE_MAX_LENGTH}
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      autoFocus
                      data-testid="textarea-whisper-box-message"
                    />
                    <span className={`absolute bottom-2 right-3 text-xs ${remaining < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {messageText.length}/{MESSAGE_MAX_LENGTH}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground" htmlFor="whisper-box-alias">
                    {t("publicWhisperBoxPage.aliasLabel")}
                  </label>
                  <Input
                    id="whisper-box-alias"
                    className="bg-input/50 border-border/50 rounded-xl text-sm"
                    placeholder={t("publicWhisperBoxPage.aliasPlaceholder")}
                    maxLength={ALIAS_MAX_LENGTH}
                    value={senderAlias}
                    onChange={(e) => setSenderAlias(e.target.value)}
                    data-testid="input-whisper-box-alias"
                  />
                </div>

                <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 border border-border/40">
                  {t("publicWhisperBoxPage.privacyNote")}
                </p>

                <Button
                  size="lg"
                  className="rounded-full w-full shadow-[0_0_15px_rgba(124,92,252,0.3)]"
                  onClick={handleSend}
                  disabled={!canSend}
                  data-testid="button-send-whisper-box-message"
                >
                  {sendMessage.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                  {t("publicWhisperBoxPage.sendButton")}
                </Button>
              </div>

              <div className="rounded-2xl border border-border/40 p-4 text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t("publicWhisperBoxPage.signUpPrompt")}{" "}
                  <button type="button" onClick={handleSignUp} className="text-primary hover:underline font-medium" data-testid="button-sign-up-to-get-whisper-box">
                    <Sparkles className="w-3.5 h-3.5 inline -mt-0.5 mr-0.5" />
                    {t("publicWhisperBoxPage.signUpLinkText")}
                  </button>
                </p>
              </div>
            </>
          )}
        </main>

        {/* Footer */}
        <footer
          className="p-5 text-center border-t border-border/30 relative z-10"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
        >
          <p className="text-xs text-muted-foreground">
            {t("publicWhisperBoxPage.poweredByPrefix")}{" "}
            <a href="/" className="text-primary hover:underline">Blind Whisper</a>
            {" "}{t("publicWhisperBoxPage.poweredBySuffix")}
          </p>
        </footer>
      </div>
    </PullToRefresh>
  );
}
