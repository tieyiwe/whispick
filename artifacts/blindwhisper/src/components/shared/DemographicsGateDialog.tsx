import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUpdateUserProfile, getGetUserProfileQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { GENDER_OPTIONS, AGE_RANGE_OPTIONS } from "@/lib/demographics";
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS, guessBrowserLanguage } from "@/lib/languages";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

// The one-time confirmation step for lib/demographics.ts's first-whisp gate
// (mirrored server-side in POST /whisps and POST /whisper-groups/:id/send —
// this dialog is a UX nicety, not the enforcement; a request that somehow
// gets here without answering still gets a 428 from the server). Answering
// once satisfies the gate permanently, so this never shows again after
// `onConfirmed` fires.
export function DemographicsGateDialog({ open, onConfirmed }: { open: boolean; onConfirmed: () => void }) {
  const [gender, setGender] = useState("");
  const [ageRange, setAgeRange] = useState("");
  // Pre-selected from the browser's own language setting as a convenience —
  // the user still has to explicitly confirm it, same as every other field
  // here; this never silently locks in a language without them looking at it.
  const [preferredLanguage, setPreferredLanguage] = useState<string>(() => guessBrowserLanguage());
  const queryClient = useQueryClient();
  const updateProfile = useUpdateUserProfile();
  const { t } = useTranslation("demographics");
  const { t: tShared } = useTranslation("sharedA");

  function handleConfirm() {
    if (!gender || !ageRange || !preferredLanguage) return;
    updateProfile.mutate(
      { data: { gender, ageRange, preferredLanguage: preferredLanguage as any } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetUserProfileQueryKey() });
          // Confirming this gate is effectively "finishing signup" from the
          // language-preference's point of view — the app should land in
          // the chosen language right away, not after a refetch.
          void i18n.changeLanguage(preferredLanguage);
          onConfirmed();
        },
      },
    );
  }

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-sm [&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="font-serif">{tShared("demographicsGateDialog.title")}</DialogTitle>
          <DialogDescription>
            {tShared("demographicsGateDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{tShared("demographicsGateDialog.languageLabel")}</Label>
            <Select value={preferredLanguage} onValueChange={setPreferredLanguage}>
              <SelectTrigger className="bg-input/50 border-border/50 rounded-xl" data-testid="select-gate-language">
                <SelectValue placeholder={tShared("demographicsGateDialog.selectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LANGUAGES.map((code) => (
                  <SelectItem key={code} value={code}>{LANGUAGE_LABELS[code]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{tShared("demographicsGateDialog.genderLabel")}</Label>
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger className="bg-input/50 border-border/50 rounded-xl" data-testid="select-gate-gender">
                <SelectValue placeholder={tShared("demographicsGateDialog.selectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {GENDER_OPTIONS.map((g) => (
                  <SelectItem key={g} value={g}>{t(`gender.${g}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{tShared("demographicsGateDialog.ageRangeLabel")}</Label>
            <Select value={ageRange} onValueChange={setAgeRange}>
              <SelectTrigger className="bg-input/50 border-border/50 rounded-xl" data-testid="select-gate-age-range">
                <SelectValue placeholder={tShared("demographicsGateDialog.selectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {AGE_RANGE_OPTIONS.map((a) => (
                  <SelectItem key={a} value={a}>{t(`ageRange.${a}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handleConfirm}
            disabled={!gender || !ageRange || !preferredLanguage || updateProfile.isPending}
            className="w-full rounded-full"
            data-testid="button-confirm-demographics"
          >
            {updateProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {tShared("demographicsGateDialog.continue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
