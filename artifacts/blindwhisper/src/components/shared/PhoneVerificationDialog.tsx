import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PhoneVerificationFlow } from "./PhoneVerificationFlow";
import { MessageCircle } from "lucide-react";

// A one-time, early-account nudge to verify a phone number (real Twilio
// Verify SMS code — see api-server's lib/phoneVerification.ts) so future
// whisps sent to this person over SMS/WhatsApp can skip the Twilio cost
// entirely if the sender happens to address them by this number (see
// lib/deliver.ts's matching). Unlike DemographicsGateDialog, this is
// deliberately SKIPPABLE — verifying a phone number is a real ask (an SMS
// round-trip, sharing a number) that shouldn't block anyone from using the
// app. Dismissing calls onDismiss and this dialog simply doesn't reappear
// for the rest of this session; see Dashboard.tsx for the once-per-account
// trigger (shown only while profile.phoneVerifiedAt is still null).
export function PhoneVerificationDialog({
  open,
  onDismiss,
  onVerified,
}: {
  open: boolean;
  onDismiss: () => void;
  onVerified: () => void;
}) {
  const { t } = useTranslation("sharedB");

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onDismiss(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-serif flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-primary" /> {t("phoneVerificationDialog.title")}
          </DialogTitle>
          <DialogDescription>
            {t("phoneVerificationDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="py-1">
          <PhoneVerificationFlow onVerified={onVerified} />
        </div>
        <DialogFooter>
          <Button variant="ghost" className="w-full rounded-full text-muted-foreground" onClick={onDismiss} data-testid="button-skip-phone-verification">
            {t("phoneVerificationDialog.maybeLater")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
