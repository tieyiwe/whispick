import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSendDebateTopicWhisp } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { isContactPickerSupported, pickContact } from "@/lib/contactPicker";
import { useNeedsSmsConsent } from "@/lib/useSmsConsent";
import { usePublicConfig } from "@/lib/usePublicConfig";
import { Mail, Phone, Contact, Loader2, Send, CheckCircle2, Share2 } from "lucide-react";
import { SiWhatsapp } from "react-icons/si";

const NOTE_MAX_LENGTH = 200;
const CHANNELS = ["email", "sms", "whatsapp"] as const;
type Channel = (typeof CHANNELS)[number];
const CHANNEL_ICONS: Record<Channel, typeof Mail> = { email: Mail, sms: Phone, whatsapp: SiWhatsapp as unknown as typeof Mail };

// "Whisper this topic" — Whisps a Debate Now topic to one contact over
// email/SMS/WhatsApp, anonymously, same delivery pipeline every other whisp
// type uses (see routes/debateTopicWhisps.ts). Open to any signed-in viewer
// of the topic, not just its author.
//
// Also keeps the plain native-share/copy-link option this button used to be
// (handleShareTopic on DebateTopicDetail.tsx) as a secondary path inside
// this same dialog, rather than a second button in the action row — "beside
// the regular sharing" per the product ask, not instead of it.
export function SendDebateTopicWhispDialog({
  topicId,
  topicText,
  open,
  onOpenChange,
}: {
  topicId: string;
  topicText: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("debateTopics");
  // The SMS opt-in copy is shared verbatim with the invite page's — reused
  // from there rather than duplicated into every locale's debateTopics file.
  const { t: tAccount } = useTranslation("account");
  const { toast } = useToast();
  const sendWhisp = useSendDebateTopicWhisp();

  const [channel, setChannel] = useState<Channel>("email");
  // SMS/WhatsApp are off at launch (see lib/usePublicConfig.ts) — only offer
  // what the server will accept. The dialog always (re)opens on email via
  // reset(), so a disabled channel can't be left selected.
  const { smsEnabled, whatsappEnabled } = usePublicConfig();
  const availableChannels = CHANNELS.filter((ch) => ch === "email" || (ch === "sms" ? smsEnabled : whatsappEnabled));
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [senderAlias, setSenderAlias] = useState("");
  const [sent, setSent] = useState(false);
  // Same server-enforced, once-per-recipient SMS consent as every other
  // send screen (see lib/useSmsConsent.ts) — SMS only; WhatsApp is carved out.
  const [smsConsentConfirmed, setSmsConsentConfirmed] = useState(false);
  const needsSmsConsent = useNeedsSmsConsent(
    channel === "sms" && recipient.trim() ? [recipient.trim()] : [],
    channel === "sms" && !!recipient.trim(),
  );

  function reset() {
    setChannel("email");
    setRecipient("");
    setNote("");
    setSenderAlias("");
    setSmsConsentConfirmed(false);
    setSent(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleSend() {
    if (!canSend) return;
    sendWhisp.mutate(
      {
        id: topicId,
        data: {
          channel,
          recipientEmail: channel === "email" ? recipient.trim() : null,
          recipientPhone: channel !== "email" ? recipient.trim() : null,
          note: note.trim() || null,
          senderAlias: senderAlias.trim() || null,
          smsConsentConfirmed: channel === "sms" ? smsConsentConfirmed : null,
        },
      },
      {
        onSuccess: () => setSent(true),
        onError: (err: any) => toast({ title: err?.data?.error ?? t("debateTopicDetail.sendWhispDialog.toastSendFailed"), variant: "destructive" }),
      },
    );
  }

  async function handlePickContact() {
    const contact = await pickContact();
    if (!contact) return;
    const value = channel === "email" ? contact.email : contact.tel;
    if (!value) {
      toast({
        title: channel === "email" ? t("debateTopicDetail.sendWhispDialog.toastNoEmailOnContact") : t("debateTopicDetail.sendWhispDialog.toastNoPhoneOnContact"),
        variant: "destructive",
      });
      return;
    }
    setRecipient(value);
  }

  function handleCopyLink() {
    const url = `${window.location.origin}/debate-topics/${topicId}`;
    if (navigator.share) {
      navigator.share({ title: t("debateTopicDetail.shareTitle"), text: topicText, url }).catch(() => {});
      return;
    }
    navigator.clipboard
      .writeText(url)
      .then(() => toast({ title: t("debateTopicDetail.toast.linkCopied") }))
      // A rejected clipboard write (permissions, unfocused document) should
      // say so rather than vanish silently.
      .catch(() => toast({ title: t("debateTopicDetail.toast.copyFailed"), variant: "destructive" }));
  }

  const remaining = NOTE_MAX_LENGTH - note.length;
  const canSend =
    recipient.trim().length > 0 && remaining >= 0 && !sendWhisp.isPending && (!needsSmsConsent || smsConsentConfirmed);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {sent ? (
          <div className="text-center space-y-4 py-2">
            <div className="mx-auto w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">{t("debateTopicDetail.sendWhispDialog.sentTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("debateTopicDetail.sendWhispDialog.sentDescription")}</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <Button variant="outline" className="flex-1 rounded-full" onClick={reset} data-testid="button-topic-whisp-send-another">
                {t("debateTopicDetail.sendWhispDialog.sendAnotherButton")}
              </Button>
              <Button className="flex-1 rounded-full" onClick={() => handleOpenChange(false)} data-testid="button-topic-whisp-done">
                {t("debateTopicDetail.sendWhispDialog.doneButton")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-1.5">
                <Send className="w-4 h-4 text-primary" /> {t("debateTopicDetail.sendWhispDialog.title")}
              </DialogTitle>
              <DialogDescription>{t("debateTopicDetail.sendWhispDialog.description")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* No picker at all while email is the only channel on. */}
              {availableChannels.length > 1 && (
                <div className={`grid gap-2 ${availableChannels.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
                  {availableChannels.map((ch) => {
                    const Icon = CHANNEL_ICONS[ch];
                    return (
                      <button
                        key={ch}
                        type="button"
                        onClick={() => {
                          setChannel(ch);
                          setRecipient("");
                        }}
                        data-testid={`topic-whisp-channel-${ch}`}
                        className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                          channel === ch
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border/50 text-muted-foreground hover:border-border"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {t(`debateTopicDetail.sendWhispDialog.channels.${ch}`)}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="space-y-1.5">
                <div className="relative">
                  {channel === "email" ? (
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
                  ) : (
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
                  )}
                  <Input
                    className={`pl-9 bg-input/50 border-border/50 rounded-xl ${isContactPickerSupported() ? "pr-11" : ""}`}
                    placeholder={channel === "email" ? t("debateTopicDetail.sendWhispDialog.emailPlaceholder") : t("debateTopicDetail.sendWhispDialog.phonePlaceholder")}
                    type={channel === "email" ? "email" : "tel"}
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    autoFocus
                    data-testid="input-topic-whisp-recipient"
                  />
                  {isContactPickerSupported() && (
                    <button
                      type="button"
                      onClick={handlePickContact}
                      aria-label={t("debateTopicDetail.sendWhispDialog.pickFromContactsLabel")}
                      title={t("debateTopicDetail.sendWhispDialog.pickFromContactsLabel")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-primary/70 hover:text-primary hover:bg-primary/10 transition-colors"
                      data-testid="button-topic-whisp-pick-contact"
                    >
                      <Contact className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="relative">
                  <Textarea
                    className="bg-input/50 border-border/50 rounded-xl min-h-[70px] resize-none"
                    placeholder={t("debateTopicDetail.sendWhispDialog.notePlaceholder")}
                    maxLength={NOTE_MAX_LENGTH}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    data-testid="textarea-topic-whisp-note"
                  />
                  <span className={`absolute bottom-2 right-3 text-xs ${remaining < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {note.length}/{NOTE_MAX_LENGTH}
                  </span>
                </div>
              </div>

              <Input
                className="bg-input/50 border-border/50 rounded-xl text-sm"
                placeholder={t("debateTopicDetail.sendWhispDialog.aliasPlaceholder")}
                value={senderAlias}
                onChange={(e) => setSenderAlias(e.target.value)}
                data-testid="input-topic-whisp-alias"
              />

              {channel === "sms" && needsSmsConsent && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground" data-testid="text-topic-whisp-sms-consent-disclosure">
                    {tAccount("invitePage.smsDisclosure")}{" "}
                    <a href="/sms-terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      {tAccount("invitePage.smsTermsLinkText")}
                    </a>.
                  </p>
                  <label className="flex items-start gap-2 text-sm text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={smsConsentConfirmed}
                      onChange={(e) => setSmsConsentConfirmed(e.target.checked)}
                      className="rounded border-border/50 mt-0.5"
                      data-testid="checkbox-topic-whisp-sms-consent"
                    />
                    {tAccount("invitePage.smsConsentCheckbox")}
                  </label>
                  <p className="text-[11px] text-muted-foreground/80">{tAccount("invitePage.smsConsentOneTime")}</p>
                </div>
              )}

              <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 border border-border/40">
                {t("debateTopicDetail.sendWhispDialog.privacyNote")}
              </p>

              <Button
                onClick={handleSend}
                disabled={!canSend}
                className="w-full rounded-full shadow-[0_0_15px_rgba(124,92,252,0.3)]"
                data-testid="button-topic-whisp-send"
              >
                {sendWhisp.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                {t("debateTopicDetail.sendWhispDialog.sendButton")}
              </Button>

              <button
                type="button"
                onClick={handleCopyLink}
                className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors py-1"
                data-testid="button-topic-whisp-copy-link-instead"
              >
                <Share2 className="w-3.5 h-3.5" /> {t("debateTopicDetail.sendWhispDialog.copyLinkInsteadButton")}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
