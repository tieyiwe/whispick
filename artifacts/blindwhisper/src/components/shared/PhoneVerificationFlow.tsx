import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useStartPhoneVerification, useConfirmPhoneVerification, getGetUserProfileQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Phone, ShieldCheck } from "lucide-react";

// The one real, one-time-SMS phone verification flow in the app (Twilio
// Verify — see api-server's lib/phoneVerification.ts for why this can't be
// TOTP/push-based). Shared between PhoneVerificationDialog (the dismissible
// onboarding nudge) and SettingsPage's "Verify your phone number" section —
// same two-step phone -> code UI either way, just embedded in a different
// shell. `onVerified` fires once the code is confirmed and users.phone /
// phoneVerifiedAt are set server-side.
export function PhoneVerificationFlow({ onVerified }: { onVerified?: () => void }) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const startVerification = useStartPhoneVerification();
  const confirmVerification = useConfirmPhoneVerification();

  function handleSendCode() {
    if (!phone.trim()) return;
    startVerification.mutate(
      { data: { phone: phone.trim() } },
      {
        onSuccess: () => {
          setStep("code");
          toast({ title: "Code sent", description: `We texted a 6-digit code to ${phone.trim()}.` });
        },
        onError: (err: any) => {
          toast({
            title: "Couldn't send a code",
            description: err?.data?.error ?? "Please check the number and try again.",
            variant: "destructive",
          });
        },
      },
    );
  }

  function handleConfirmCode() {
    if (!code.trim()) return;
    confirmVerification.mutate(
      { data: { phone: phone.trim(), code: code.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetUserProfileQueryKey() });
          toast({ title: "Phone number verified" });
          onVerified?.();
        },
        onError: (err: any) => {
          toast({
            title: "That code didn't work",
            description: err?.data?.error ?? "Please try again.",
            variant: "destructive",
          });
        },
      },
    );
  }

  if (step === "phone") {
    return (
      <div className="space-y-3">
        <div className="relative">
          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9 bg-input/50 border-border/50 rounded-xl"
            placeholder="+1 555 123 4567"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            data-testid="input-phone-verification-number"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          We'll verify your number so whisps sent to you deliver instantly if you're already on Blind Whisper — what
          you send and receive is still 100% anonymous, always.
        </p>
        <Button
          onClick={handleSendCode}
          disabled={!phone.trim() || startVerification.isPending}
          className="w-full rounded-full"
          data-testid="button-send-verification-code"
        >
          {startVerification.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          Send verification code
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Enter the 6-digit code we texted to {phone.trim()}.</p>
      <InputOTP maxLength={6} value={code} onChange={setCode} data-testid="input-verification-code">
        <InputOTPGroup>
          {Array.from({ length: 6 }, (_, i) => (
            <InputOTPSlot key={i} index={i} />
          ))}
        </InputOTPGroup>
      </InputOTP>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => {
            setStep("phone");
            setCode("");
          }}
          data-testid="button-change-phone-number"
        >
          Change number
        </Button>
        <Button
          onClick={handleConfirmCode}
          disabled={code.trim().length < 4 || confirmVerification.isPending}
          className="flex-1 rounded-full"
          data-testid="button-confirm-verification-code"
        >
          {confirmVerification.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
          Verify
        </Button>
      </div>
    </div>
  );
}
