import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCheckTextWhispRecipient,
  useCreateTextWhisp,
  getListTextWhispsQueryKey,
} from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { TextWhispScroll } from "@/components/shared/TextWhispScroll";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ArrowRight, Phone, Loader2, CheckCircle2, XCircle, ShieldQuestion, ScrollText } from "lucide-react";

const MESSAGE_MAX_LENGTH = 260;

// Mirrors SendWhisp.tsx's SENDER_ALIASES list — kept as its own copy rather
// than importing from that page (not exported there, and this component
// intentionally doesn't depend on the video-whisp composer's internals).
const SENDER_ALIASES = [
  "Someone who cares",
  "A friend",
  "Someone who loves you",
  "An admirer",
];

// Debounce length for the eligibility check while typing — long enough that
// a normal typing cadence doesn't fire a request per keystroke (see
// lib/rateLimit.ts's textWhispRecipientCheckLimiter, which is deliberately
// tight), short enough that pausing mid-number still gets a timely answer.
// A blur also checks immediately regardless of this timer.
const CHECK_DEBOUNCE_MS = 700;

type EligibilityState = "idle" | "checking" | "eligible" | "ineligible" | "error";

export function SendTextWhisp() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [phone, setPhone] = useState("");
  const [eligibility, setEligibility] = useState<EligibilityState>("idle");
  const [messageText, setMessageText] = useState("");
  const [senderAlias, setSenderAlias] = useState(SENDER_ALIASES[0]);
  const [customAlias, setCustomAlias] = useState("");
  const [sent, setSent] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);
  const [animationDone, setAnimationDone] = useState(false);

  const checkRecipient = useCheckTextWhispRecipient();
  const createTextWhisp = useCreateTextWhisp();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheckedPhone = useRef<string | null>(null);

  function runCheck(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      setEligibility("idle");
      return;
    }
    if (lastCheckedPhone.current === trimmed && eligibility !== "idle" && eligibility !== "error") return;
    lastCheckedPhone.current = trimmed;
    setEligibility("checking");
    checkRecipient.mutate(
      { data: { phone: trimmed } },
      {
        onSuccess: (result) => setEligibility(result.eligible ? "eligible" : "ineligible"),
        onError: () => setEligibility("error"),
      },
    );
  }

  function handlePhoneChange(value: string) {
    setPhone(value);
    setEligibility("idle");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runCheck(value), CHECK_DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleSend() {
    const alias = customAlias.trim() || senderAlias;
    createTextWhisp.mutate(
      { data: { recipientPhone: phone.trim(), messageText: messageText.trim(), senderAlias: alias } },
      {
        onSuccess: (result) => {
          setSentId(result.id);
          setSent(true);
          queryClient.invalidateQueries({ queryKey: getListTextWhispsQueryKey() });
        },
        onError: (err: any) => {
          // The recipient could have become ineligible between the check and
          // this submit (e.g. they never actually verified) — the server
          // re-verifies independently and this is the honest error for that.
          toast({ title: err?.data?.error ?? "Failed to send Text Whisp", variant: "destructive" });
        },
      },
    );
  }

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
              View this Text Whisp
            </Button>
            <Button
              className="rounded-full"
              onClick={() => {
                setSent(false);
                setSentId(null);
                setAnimationDone(false);
                setPhone("");
                setEligibility("idle");
                setMessageText("");
                setSenderAlias(SENDER_ALIASES[0]);
                setCustomAlias("");
              }}
              data-testid="button-send-another-text-whisp"
            >
              Send another
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const remaining = MESSAGE_MAX_LENGTH - messageText.length;
  const canSend = eligibility === "eligible" && messageText.trim().length > 0 && remaining >= 0;

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-2">
            <ScrollText className="w-7 h-7 text-primary" /> Send a Text Whisp
          </h1>
          <p className="text-muted-foreground mt-1">
            A short, anonymous note straight to someone who's already on Blind Whisper.
          </p>
        </div>

        <Card className="bg-card border-border/50">
          <CardContent className="p-6 space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Who's it for?</p>
              <p className="text-xs text-muted-foreground">
                Text Whisps only work between two Blind Whisper accounts — we'll check as you type.
              </p>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9 bg-input/50 border-border/50 rounded-xl"
                  placeholder="+1 555 123 4567"
                  type="tel"
                  value={phone}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  onBlur={() => runCheck(phone)}
                  data-testid="input-text-whisp-recipient-phone"
                />
              </div>
              <div className="min-h-5 flex items-center gap-1.5 text-xs" data-testid="text-recipient-eligibility">
                {eligibility === "checking" && (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking...
                  </span>
                )}
                {eligibility === "eligible" && (
                  <span className="flex items-center gap-1.5 text-primary">
                    <CheckCircle2 className="w-3.5 h-3.5" /> They're on Blind Whisper — you can send a Text Whisp.
                  </span>
                )}
                {eligibility === "ineligible" && (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <XCircle className="w-3.5 h-3.5" /> Not eligible yet — they'd need a verified Blind Whisper account. Try a regular Whisper Link instead.
                  </span>
                )}
                {eligibility === "error" && (
                  <span className="flex items-center gap-1.5 text-destructive">
                    <ShieldQuestion className="w-3.5 h-3.5" /> Couldn't check that number just now — try again.
                  </span>
                )}
              </div>
            </div>

            {eligibility === "eligible" && (
              <>
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-foreground">Your message</p>
                  {/* Required privacy reminder — visible right next to the
                      compose textarea, not just implied by "anonymous" copy
                      elsewhere. */}
                  <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 border border-border/40">
                    Avoid sharing anything that could identify you, unless you want to — this stays anonymous unless you choose to reveal yourself.
                  </p>
                  <div className="relative">
                    <Textarea
                      className="bg-input/50 border-border/50 rounded-xl min-h-[100px] resize-none"
                      placeholder="Write something kind, honest, or brave..."
                      maxLength={MESSAGE_MAX_LENGTH}
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      data-testid="textarea-text-whisp-message"
                    />
                    <span className={`absolute bottom-2 right-3 text-xs ${remaining < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {messageText.length}/{MESSAGE_MAX_LENGTH}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Sign as:</p>
                  <div className="grid grid-cols-2 gap-2">
                    {SENDER_ALIASES.map((alias) => (
                      <button
                        key={alias}
                        type="button"
                        onClick={() => { setSenderAlias(alias); setCustomAlias(""); }}
                        data-testid={`text-whisp-alias-${alias.replace(/\s+/g, "-").toLowerCase()}`}
                        className={`p-2 rounded-xl text-xs text-left border transition-all ${
                          senderAlias === alias && !customAlias
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border/50 text-muted-foreground hover:border-border"
                        }`}
                      >
                        {alias}
                      </button>
                    ))}
                  </div>
                  <Input
                    placeholder="Or type a custom alias..."
                    className="bg-input/50 border-border/50 rounded-xl text-sm"
                    value={customAlias}
                    onChange={(e) => setCustomAlias(e.target.value)}
                    data-testid="input-text-whisp-custom-alias"
                  />
                </div>

                <Button
                  onClick={handleSend}
                  disabled={!canSend || createTextWhisp.isPending}
                  className="w-full rounded-full shadow-[0_0_15px_rgba(124,92,252,0.3)]"
                  data-testid="button-send-text-whisp"
                >
                  {createTextWhisp.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ArrowRight className="w-4 h-4 mr-2" />}
                  Send Text Whisp
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Button variant="ghost" onClick={() => setLocation("/text-whisps")} className="text-muted-foreground">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Text Whisps
        </Button>
      </div>
    </AppLayout>
  );
}
