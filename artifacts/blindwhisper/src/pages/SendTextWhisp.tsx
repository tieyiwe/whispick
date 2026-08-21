import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateTextWhisp, getListTextWhispsQueryKey } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { TextWhispScroll } from "@/components/shared/TextWhispScroll";
import { useMobileSendAction } from "@/contexts/MobileSendAction";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ArrowRight, Phone, Loader2, ScrollText } from "lucide-react";

const MESSAGE_MAX_LENGTH = 260;

// Mirrors SendWhisp.tsx's SENDER_ALIASES list — kept as its own copy rather
// than importing from that page (not exported there, and this component
// intentionally doesn't depend on the video-whisp composer's internals).
// The translation key resolves against sendTextWhisp.aliases.* (see
// src/i18n/locales/*/textWhisp.json); testid stays a fixed, non-localized
// string so it doesn't change per language.
const SENDER_ALIASES = [
  { key: "someoneWhoCares", testid: "someone-who-cares" },
  { key: "aFriend", testid: "a-friend" },
  { key: "someoneWhoLovesYou", testid: "someone-who-loves-you" },
  { key: "anAdmirer", testid: "an-admirer" },
] as const;
type SenderAliasKey = (typeof SENDER_ALIASES)[number]["key"];

export function SendTextWhisp() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation("textWhisp");

  const [phone, setPhone] = useState("");
  const [messageText, setMessageText] = useState("");
  const [senderAliasKey, setSenderAliasKey] = useState<SenderAliasKey>(SENDER_ALIASES[0].key);
  const [customAlias, setCustomAlias] = useState("");
  const [sent, setSent] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);
  const [animationDone, setAnimationDone] = useState(false);

  const createTextWhisp = useCreateTextWhisp();

  function handleSend() {
    const alias = customAlias.trim() || t(`sendTextWhisp.aliases.${senderAliasKey}`);
    createTextWhisp.mutate(
      { data: { recipientPhone: phone.trim(), messageText: messageText.trim(), senderAlias: alias } },
      {
        onSuccess: (result) => {
          setSentId(result.id);
          setSent(true);
          queryClient.invalidateQueries({ queryKey: getListTextWhispsQueryKey() });
        },
        onError: (err: any) => {
          toast({ title: err?.data?.error ?? t("sendTextWhisp.toastSendFailed"), variant: "destructive" });
        },
      },
    );
  }

  const remaining = MESSAGE_MAX_LENGTH - messageText.length;
  const canSend = phone.trim().length > 0 && messageText.trim().length > 0 && remaining >= 0;

  // Drives the mobile bottom nav's raised round button while this page is
  // composing — see AppLayout.tsx and contexts/MobileSendAction.tsx. Without
  // this, that button stayed a live link to the (unrelated) video-whisp
  // composer the whole time, so tapping it mid-compose here abandoned the
  // Text Whisp draft and opened a different flow instead of sending it.
  // Cleared (falls back to the default /send link) once sending completes —
  // there's nothing left on this page for it to submit.
  useMobileSendAction(sent ? null : { onClick: handleSend, disabled: !canSend || createTextWhisp.isPending });

  if (sent) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto py-10 space-y-6">
          <TextWhispScroll mode="send" messageText={messageText} onSendAnimationComplete={() => setAnimationDone(true)} />
          <div
            className="flex flex-col sm:flex-row gap-3 justify-center"
            style={{ opacity: animationDone ? 1 : 0, transition: "opacity 300ms ease" }}
          >
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => sentId && setLocation(`/text-whisps/${sentId}`)}
              data-testid="button-track-text-whisp"
            >
              {t("sendTextWhisp.viewButton")}
            </Button>
            <Button
              className="rounded-full"
              onClick={() => {
                setSent(false);
                setSentId(null);
                setAnimationDone(false);
                setPhone("");
                setMessageText("");
                setSenderAliasKey(SENDER_ALIASES[0].key);
                setCustomAlias("");
              }}
              data-testid="button-send-another-text-whisp"
            >
              {t("sendTextWhisp.sendAnotherButton")}
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-2">
            <ScrollText className="w-7 h-7 text-primary" /> {t("sendTextWhisp.heading")}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t("sendTextWhisp.description")}
          </p>
        </div>

        <Card className="bg-card border-border/50">
          <CardContent className="p-6 space-y-5">
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">{t("sendTextWhisp.yourMessageLabel")}</p>
              {/* Required privacy reminder — visible right next to the
                  compose textarea, not just implied by "anonymous" copy
                  elsewhere. */}
              <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 border border-border/40">
                {t("sendTextWhisp.privacyReminder")}
              </p>
              <div className="relative">
                <Textarea
                  className="bg-input/50 border-border/50 rounded-xl min-h-[100px] resize-none"
                  placeholder={t("sendTextWhisp.messagePlaceholder")}
                  maxLength={MESSAGE_MAX_LENGTH}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  autoFocus
                  data-testid="textarea-text-whisp-message"
                />
                <span className={`absolute bottom-2 right-3 text-xs ${remaining < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                  {messageText.length}/{MESSAGE_MAX_LENGTH}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{t("sendTextWhisp.signAsLabel")}</p>
              <div className="grid grid-cols-2 gap-2">
                {SENDER_ALIASES.map((alias) => (
                  <button
                    key={alias.key}
                    type="button"
                    onClick={() => { setSenderAliasKey(alias.key); setCustomAlias(""); }}
                    data-testid={`text-whisp-alias-${alias.testid}`}
                    className={`p-2 rounded-xl text-xs text-left border transition-all ${
                      senderAliasKey === alias.key && !customAlias
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border/50 text-muted-foreground hover:border-border"
                    }`}
                  >
                    {t(`sendTextWhisp.aliases.${alias.key}`)}
                  </button>
                ))}
              </div>
              <Input
                placeholder={t("sendTextWhisp.customAliasPlaceholder")}
                className="bg-input/50 border-border/50 rounded-xl text-sm"
                value={customAlias}
                onChange={(e) => setCustomAlias(e.target.value)}
                data-testid="input-text-whisp-custom-alias"
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">{t("sendTextWhisp.recipientLabel")}</p>
              {/* General, always-shown disclosure about how the feature
                  works — never per-number feedback, so it can't be used to
                  probe whether a specific number is a Blind Whisper account
                  (see api-server's anti-enumeration posture on POST
                  /text-whisps). */}
              <p className="text-xs text-muted-foreground">
                {t("sendTextWhisp.recipientDisclosure")}
              </p>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9 bg-input/50 border-border/50 rounded-xl"
                  placeholder={t("sendTextWhisp.phonePlaceholder")}
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  data-testid="input-text-whisp-recipient-phone"
                />
              </div>
              {/* A2P 10DLC-required disclosure, shown at the exact point a
                  phone number is collected for SMS delivery — mirrors
                  SendWhisp.tsx's own step5.smsDisclosure. Unconditional here
                  (unlike SendWhisp, which gates on a WhatsApp/SMS channel
                  toggle) since a Text Whisp recipient is always a phone
                  number and, for anyone not already a verified Blind Whisper
                  user, always delivered by SMS (see textWhispGuestSmsBody in
                  lib/sms.ts). */}
              <p className="text-xs text-muted-foreground" data-testid="text-sms-consent-disclosure">
                {t("sendTextWhisp.smsDisclosure")}{" "}
                <a href="/sms-terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  {t("sendTextWhisp.smsTermsLinkText")}
                </a>.
              </p>
            </div>

            <Button
              onClick={handleSend}
              disabled={!canSend || createTextWhisp.isPending}
              className="w-full rounded-full shadow-[0_0_15px_rgba(124,92,252,0.3)]"
              data-testid="button-send-text-whisp"
            >
              {createTextWhisp.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ArrowRight className="w-4 h-4 mr-2" />}
              {t("sendTextWhisp.sendButton")}
            </Button>
          </CardContent>
        </Card>

        <Button variant="ghost" onClick={() => setLocation("/text-whisps")} className="text-muted-foreground">
          <ArrowLeft className="w-4 h-4 mr-1" /> {t("sendTextWhisp.backButton")}
        </Button>
      </div>
    </AppLayout>
  );
}
