import { Archive, ArchiveRestore, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

interface ArchivedWhispGateProps {
  videoTitle?: string | null;
  onUnarchive: () => void;
  isUnarchiving: boolean;
  onBack: () => void;
}

// Shown in place of a whisp's real content — on both the sender's own
// detail page (WhispDetail.tsx) and the recipient's page (PublicWhispPage.tsx)
// — whenever the CURRENT viewer has archived their own copy of it. A reply
// or follow-up still triggers the normal notification either way (archiving
// only hides it from that viewer's own list, see whisps.senderArchivedAt/
// recipientArchivedAt); this is what they land on if they click that
// notification or the link itself, instead of being dropped straight back
// into content they deliberately tucked away. Unarchiving is one tap, and
// immediately reveals the real page underneath.
export function ArchivedWhispGate({ videoTitle, onUnarchive, isUnarchiving, onBack }: ArchivedWhispGateProps) {
  const { t } = useTranslation("sharedA");

  return (
    <div className="max-w-md mx-auto text-center py-16 px-6 space-y-5" data-testid="archived-whisp-gate">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
        <Archive className="w-7 h-7 text-muted-foreground" />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-xl font-serif font-semibold text-foreground">{t("archivedWhispGate.title")}</h1>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto">
          {videoTitle ? t("archivedWhispGate.descriptionWithTitle", { title: videoTitle }) : t("archivedWhispGate.description")}
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 justify-center pt-1">
        <Button variant="outline" onClick={onBack} className="rounded-full" data-testid="button-archived-gate-back">
          {t("archivedWhispGate.back")}
        </Button>
        <Button onClick={onUnarchive} disabled={isUnarchiving} className="rounded-full" data-testid="button-archived-gate-unarchive">
          {isUnarchiving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArchiveRestore className="w-4 h-4 mr-2" />}
          {t("archivedWhispGate.unarchive")}
        </Button>
      </div>
    </div>
  );
}
