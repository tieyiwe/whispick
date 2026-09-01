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
import { isContactPickerSupported, pickContact } from "@/lib/contactPicker";
import { ArrowLeft, ArrowRight, Phone, Loader2, ScrollText, CalendarClock, Contact } from "lucide-react";

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
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledAtValue, setScheduledAtValue] = useState("");
  const [wasScheduled, setWasScheduled] = useState(false);
  // A2P 10DLC opt-in evidence: an affirmative, unchecked-by-default
  // confirmation the Sender must actively check before Send is enabled —
  // mirrors SendWhisp.tsx's own smsConsentConfirmed, right down to the
  // reasoning (disclosure text alone isn't verifiable as having been read).
  const [smsConsentConfirmed, setSmsConsentConfirmed] = useState(false);

  const createTextWhisp = useCreateTextWhisp();

  // Same "a past pick becomes an immediate send" rule the backend enforces
  // (see routes/textWhisps.ts's isScheduled check) — mirrored here purely so
  // the post-send confirmation screen (TextWhispScroll's `scheduled` prop)
  // shows "Sent!" rather than "Scheduled!" for a datetime that's already elapsed.
  const isScheduling = scheduleEnabled && !!scheduledAtValue && new Date(scheduledAtValue).getTime() > Date.now();

  function handleSend() {
    const alias = customAlias.trim() || t(`sendTextWhisp.aliases.${senderAliasKey}`);
    createTextWhisp.mutate(
      {
        data: {
          recipientPhone: phone.trim(),
          messageText: messageText.trim(),
          senderAlias: alias,
          scheduledAt: isScheduling ? new Date(scheduledAtValue).toISOString() : null,
        },
      },
      {
        onSuccess: (result) => {
          setSentId(result.id);
          setWasScheduled(isScheduling);
          setSent(true);
          queryClient.invalidateQueries({ queryKey: getListTextWhispsQueryKey() });
        },
        onError: (err: any) => {
          toast({ title: err?.data?.error ?? t("sendTextWhisp.toastSendFailed"), variant: "destructive" });
        },
      },
    );
  }

  // Single-recipient counterpart to SendWhisp.tsx's handlePickContact — this
  // field takes exactly one phone number, so multiple:false and we take
  // whichever tel the OS contact picker returns first (a contact can have
  // several). Same no-formatting behavior as manual typing: the raw string
  // goes straight into `phone`, trimmed only on submit.
  async function handlePickContact() {
    const contact = await pickContact();
    if (!contact) return;
    if (!contact.tel) {
      toast({ title: t("sendTextWhisp.toastNoPhoneOnContact"), variant: "destructive" });
      return;
    }
    setPhone(contact.tel);
  }

  const remaining = MESSAGE_MAX_LENGTH - messageText.length;
  const canSend =
    phone.trim().length > 0 &&
    messageText.trim().length > 0 &&
    remaining >= 0 &&
    (!scheduleEnabled || !!scheduledAtValue) &&
    smsConsentConfirmed;

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
          <TextWhispScroll
            mode="send"
            messageText={messageText}
            scheduled={wasScheduled}
            onSendAnimationComplete={() => setAnimationDone(true)}
          />
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
                setScheduleEnabled(false);
                setScheduledAtValue("");
                setWasScheduled(false);
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
              {/* Every other field on this page uses the app's low-emphasis
                  bg-input/50 + border-border/50 treatment, but this is the
                  one field nothing can be sent without — it needs to read as
                  an obviously-empty box waiting for input, not blend into
                  the page like a label. Solid background, a visible border
                  even at rest (not just on focus), and a slightly darker
                  placeholder for legibility. */}
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
                <Input
                  className={`pl-9 h-12 bg-input border-2 border-primary/40 hover:border-primary/60 focus-visible:border-primary rounded-xl text-base placeholder:text-muted-foreground/80 ${
                    isContactPickerSupported() ? "pr-11" : ""
                  }`}
                  placeholder={t("sendTextWhisp.phonePlaceholder")}
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  data-testid="input-text-whisp-recipient-phone"
                />
                {/* Progressive enhancement — Android Chrome/Edge/Samsung
                    Internet only (see lib/contactPicker.ts). Sits as a
                    trailing adornment inside the same field rather than a
                    separate button, so the one-tap "pick instead of type"
                    path reads as part of this field, not bolted on. */}
                {isContactPickerSupported() && (
                  <button
                    type="button"
                    onClick={handlePickContact}
                    aria-label={t("sendTextWhisp.pickFromContactsLabel")}
                    title={t("sendTextWhisp.pickFromContactsLabel")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-primary/70 hover:text-primary hover:bg-primary/10 transition-colors"
                    data-testid="button-text-whisp-pick-contact"
                  >
                    <Contact className="w-4 h-4" />
                  </button>
                )}
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
              {/* The actual opt-in evidence: an affirmative, unchecked-by-
                  default checkbox, not just the disclosure text above. */}
              <label className="flex items-start gap-2 text-sm text-foreground cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={smsConsentConfirmed}
                  onChange={(e) => setSmsConsentConfirmed(e.target.checked)}
                  className="rounded border-border/50 mt-0.5"
                  data-testid="checkbox-sms-consent"
                />
                {t("sendTextWhisp.smsConsentCheckbox")}
              </label>
            </div>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => setScheduleEnabled(!scheduleEnabled)}
                data-testid="button-toggle-text-whisp-schedule"
                className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                  scheduleEnabled ? "border-primary bg-primary/10" : "border-border/50 hover:border-border"
                }`}
              >
                <CalendarClock className="w-5 h-5 text-primary" />
                <div className="flex-1">
                  <p className="font-medium text-foreground text-sm">{t("sendTextWhisp.scheduleTitle")}</p>
                  <p className="text-xs text-muted-foreground">{t("sendTextWhisp.scheduleDescription")}</p>
                </div>
                <div className={`w-9 h-5 rounded-full transition-colors relative ${scheduleEnabled ? "bg-primary" : "bg-muted"}`}>
                  <div
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      scheduleEnabled ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </div>
              </button>
              {scheduleEnabled && (
                <Input
                  type="datetime-local"
                  className="bg-input/50 border-border/50 rounded-xl"
                  value={scheduledAtValue}
                  onChange={(e) => setScheduledAtValue(e.target.value)}
                  data-testid="input-text-whisp-scheduled-at"
                />
              )}
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
