import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useSendWhisperBoxMessage, useGetPublicWhisperBox, getGetPublicWhisperBoxQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Mailbox, Send, Loader2, CheckCircle2, Sparkles, UserPlus, Video, ShieldCheck, Info } from "lucide-react";
import { LogoLockup } from "@/components/ui/logo";
import { AvatarCircle } from "@/components/shared/AvatarCircle";
import { PullToRefresh } from "@/components/shared/PullToRefresh";
import { WhisperBoxSearchBar } from "@/components/shared/WhisperBoxSearchBar";

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
          className="px-5 pb-3 sm:pb-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:pt-[calc(env(safe-area-inset-top)+1rem)] flex items-center justify-between gap-3 border-b border-border/40 relative z-10"
        >
          <a href="/" className="inline-block hover:opacity-80 transition-opacity">
            <BlindWhisperLogoMark />
          </a>
          {/* A stranger landing here from a bio link may never have heard of
              the product — one quiet way to find out, never a sign-up push
              competing with the message they came to write. */}
          <a
            href="/how-it-works"
            aria-label={t("publicWhisperBoxPage.whatIsLink")}
            className="inline-flex items-center justify-center gap-1.5 min-h-11 min-w-11 -mr-2 sm:px-2 rounded-full text-sm text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
            data-testid="link-what-is-blind-whisper"
          >
            {/* Icon-only on a phone, where the full lockup leaves no room
                for the words; the label is still its accessible name. */}
            <Info className="w-5 h-5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">{t("publicWhisperBoxPage.whatIsLink")}</span>
          </a>
        </header>

        {/* Content */}
        <main className="flex-1 max-w-lg mx-auto w-full px-5 pt-8 pb-10 sm:pt-10 sm:pb-12 space-y-6 relative z-10">
          {isLoading ? (
            // Shaped like the page: avatar, two-line heading, the form card.
            <div className="space-y-6" aria-hidden>
              <div className="flex flex-col items-center gap-3">
                <Skeleton className="h-16 w-16 rounded-full" />
                <Skeleton className="h-6 w-64" />
                <Skeleton className="h-4 w-48" />
              </div>
              <Skeleton className="h-80 rounded-2xl" />
            </div>
          ) : !box ? (
            <div className="text-center py-20 space-y-3">
              <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto">
                <Mailbox className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground">{t("publicWhisperBoxPage.notFoundTitle")}</p>
              <p className="text-sm text-muted-foreground/80 max-w-xs mx-auto">{t("publicWhisperBoxPage.notFoundDescription")}</p>
              <div className="pt-2 max-w-xs mx-auto text-left">
                <WhisperBoxSearchBar />
              </div>
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
              {/* The API only ever returns the handle (no display name), so
                  it's shown as what it is — an @handle — rather than passed
                  off as a person's name. */}
              <div className="flex flex-col items-center text-center">
                <AvatarCircle avatarId={box.avatarId} handle={box.handle} size="lg" />
                <h1 className="mt-4 text-[22px] sm:text-2xl font-serif text-foreground leading-snug text-balance">
                  {t("publicWhisperBoxPage.heading", { handle: `@${box.handle}` })}
                </h1>
                <p className="mt-2 text-base font-serif italic text-foreground/85 text-balance">{t("publicWhisperBoxPage.promptLine")}</p>
                <p className="mt-3 text-sm text-muted-foreground text-balance">{t("publicWhisperBoxPage.subheading")}</p>
              </div>

              <div className="rounded-2xl bg-card border border-border/50 p-5 sm:p-6 space-y-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground" htmlFor="whisper-box-message">
                    {t("publicWhisperBoxPage.messageLabel")}
                  </label>
                  <div className="relative">
                    <Textarea
                      id="whisper-box-message"
                      className="bg-input/50 border-border/60 rounded-xl min-h-[132px] resize-none text-[15px] pb-7 placeholder:text-muted-foreground"
                      placeholder={t("publicWhisperBoxPage.messagePlaceholder")}
                      maxLength={MESSAGE_MAX_LENGTH}
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      autoFocus
                      data-testid="textarea-whisper-box-message"
                    />
                    <span className={`absolute bottom-2 right-3 text-xs tabular-nums ${remaining < 0 ? "text-destructive" : "text-muted-foreground"}`}>
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
                    className="bg-input/50 border-border/60 rounded-xl h-11 text-[15px] placeholder:text-muted-foreground"
                    placeholder={t("publicWhisperBoxPage.aliasPlaceholder")}
                    maxLength={ALIAS_MAX_LENGTH}
                    value={senderAlias}
                    onChange={(e) => setSenderAlias(e.target.value)}
                    data-testid="input-whisper-box-alias"
                  />
                </div>

                <p className="flex items-start gap-2 text-[13px] text-muted-foreground leading-relaxed">
                  <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                  <span>{t("publicWhisperBoxPage.privacyNote")}</span>
                </p>

                <Button
                  size="lg"
                  className="rounded-full w-full h-12 text-base shadow-[0_0_20px_rgba(124,92,252,0.3)] disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none transition-[background-color,box-shadow] duration-200"
                  onClick={handleSend}
                  disabled={!canSend}
                  data-testid="button-send-whisper-box-message"
                >
                  {sendMessage.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                  {t("publicWhisperBoxPage.sendButton")}
                </Button>
              </div>

              {/* Marketing block — this is the moment a stranger who just
                  used the product (or is about to) learns it isn't only
                  for replying to this one person: they can create a free
                  account and Whisp a message or video to someone in their
                  own life, anonymously, same as what they're doing here.
                  Deliberately a SECONDARY card — quieter surface, outline
                  button, no glow — so "Send anonymously" above stays the
                  page's one primary action. The two steps are a real (if
                  tiny) "how it works": numbered rows that read top to
                  bottom on any width instead of two narrow columns whose
                  labels wrapped to four lines. */}
              <section className="rounded-2xl border border-border/50 bg-card/60 p-5 sm:p-6 space-y-5">
                <div className="text-center space-y-2">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium">
                    <Video className="w-3.5 h-3.5" />
                    <span>{t("publicWhisperBoxPage.marketingBadge")}</span>
                  </div>
                  <h2 className="font-serif text-xl font-semibold text-foreground text-balance pt-1">
                    {t("publicWhisperBoxPage.marketingHeading")}
                  </h2>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
                    {t("publicWhisperBoxPage.marketingDescription")}
                  </p>
                </div>

                <ol className="relative space-y-3">
                  {/* The connector between the two step icons. */}
                  <span aria-hidden className="absolute left-5 top-10 bottom-10 w-px -translate-x-1/2 bg-gradient-to-b from-primary/50 to-primary/10" />
                  {[
                    { icon: UserPlus, label: t("publicWhisperBoxPage.howItWorksStep1") },
                    { icon: Send, label: t("publicWhisperBoxPage.howItWorksStep2") },
                  ].map(({ icon: Icon, label }, i) => (
                    <li key={i} className="relative flex items-center gap-3.5">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-background text-primary">
                        <Icon className="w-[18px] h-[18px]" />
                      </span>
                      <span className="flex min-w-0 gap-1.5 text-sm text-foreground leading-snug">
                        <span className="font-medium text-muted-foreground tabular-nums">{i + 1}.</span>
                        <span>{label}</span>
                      </span>
                    </li>
                  ))}
                </ol>

                <Button
                  size="lg"
                  variant="outline"
                  className="w-full rounded-full h-12 text-base font-medium border-primary/40 bg-transparent text-foreground hover:bg-primary/10 hover:border-primary/60"
                  onClick={handleSignUp}
                  data-testid="button-sign-up-to-get-whisper-box"
                >
                  <Sparkles className="w-4 h-4 mr-2 text-primary" />
                  {t("publicWhisperBoxPage.signUpLinkText")}
                </Button>
              </section>
            </>
          )}
        </main>

        {/* Footer */}
        <footer
          className="px-5 pt-5 text-center border-t border-border/40 relative z-10"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
        >
          <p className="text-xs text-muted-foreground max-w-lg mx-auto leading-relaxed">
            {t("publicWhisperBoxPage.poweredByPrefix")}{" "}
            <a href="/" className="text-primary hover:underline">Blind Whisper</a>
            {" "}{t("publicWhisperBoxPage.poweredBySuffix")}
          </p>
        </footer>
      </div>
    </PullToRefresh>
  );
}
