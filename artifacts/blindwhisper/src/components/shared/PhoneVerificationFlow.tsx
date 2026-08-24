import { useState } from "react";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { CountryPhoneInput } from "@/components/shared/CountryPhoneInput";
import { useStartPhoneVerification, useConfirmPhoneVerification, getGetUserProfileQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

// Pretty-prints an E.164 number for display only (e.g. "+1 555 123 4567")
// — the value sent to the server is always the raw E.164 string from
// CountryPhoneInput, this is purely cosmetic for confirmation copy.
function formatForDisplay(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

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
  const [country, setCountry] = useState("");
  const [code, setCode] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const startVerification = useStartPhoneVerification();
  const confirmVerification = useConfirmPhoneVerification();
  const { t } = useTranslation("sharedB");

  function handleSendCode() {
    if (!phone.trim()) return;
    startVerification.mutate(
      { data: { phone: phone.trim(), countryCode: country || undefined } },
      {
        onSuccess: () => {
          setStep("code");
          toast({ title: t("phoneVerificationFlow.toastCodeSent"), description: t("phoneVerificationFlow.toastCodeSentDescription", { phone: formatForDisplay(phone.trim()) }) });
        },
        onError: (err: any) => {
          toast({
            title: t("phoneVerificationFlow.toastSendFailed"),
            description: err?.data?.error ?? t("phoneVerificationFlow.toastSendFailedDescription"),
            variant: "destructive",
          });
        },
      },
    );
  }

  function handleConfirmCode() {
    if (!code.trim()) return;
    confirmVerification.mutate(
      { data: { phone: phone.trim(), code: code.trim(), countryCode: country || undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetUserProfileQueryKey() });
          toast({ title: t("phoneVerificationFlow.toastVerified") });
          onVerified?.();
        },
        onError: (err: any) => {
          toast({
            title: t("phoneVerificationFlow.toastConfirmFailed"),
            description: err?.data?.error ?? t("phoneVerificationFlow.toastConfirmFailedDescription"),
            variant: "destructive",
          });
        },
      },
    );
  }

  if (step === "phone") {
    return (
      <div className="space-y-3">
        <CountryPhoneInput onChange={setPhone} onCountryChange={setCountry} disabled={startVerification.isPending} />
        <p className="text-xs text-muted-foreground">
          {t("phoneVerificationFlow.explainer")}
        </p>
        {/* A2P 10DLC-required disclosure, shown at the exact point the
            number is entered — this form itself sends a one-time SMS
            verification code. */}
        <p className="text-xs text-muted-foreground" data-testid="text-sms-consent-disclosure">
          {t("phoneVerificationFlow.smsDisclosure")}{" "}
          <a href="/sms-terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {t("phoneVerificationFlow.smsTermsLink")}
          </a>.
        </p>
        <Button
          onClick={handleSendCode}
          disabled={!phone.trim() || startVerification.isPending}
          className="w-full rounded-full"
          data-testid="button-send-verification-code"
        >
          {startVerification.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          {t("phoneVerificationFlow.sendCode")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("phoneVerificationFlow.enterCode", { phone: phone.trim() })}</p>
      {/* inputMode/pattern get mobile browsers to show a numeric keypad
          instead of a full keyboard; autoComplete="one-time-code" is what
          actually lets iOS/Android offer a tap-to-fill suggestion from the
          just-received SMS instead of making someone type all 6 digits by
          hand — without it this field is real but noticeably clunky on a
          phone. autoFocus saves the extra tap into the field on arrival. */}
      <InputOTP
        maxLength={6}
        value={code}
        onChange={setCode}
        inputMode="numeric"
        pattern={REGEXP_ONLY_DIGITS}
        autoComplete="one-time-code"
        autoFocus
        data-testid="input-verification-code"
      >
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
          {t("phoneVerificationFlow.changeNumber")}
        </Button>
        <Button
          onClick={handleConfirmCode}
          disabled={code.trim().length < 4 || confirmVerification.isPending}
          className="flex-1 rounded-full"
          data-testid="button-confirm-verification-code"
        >
          {confirmVerification.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
          {t("phoneVerificationFlow.verify")}
        </Button>
      </div>
    </div>
  );
}
