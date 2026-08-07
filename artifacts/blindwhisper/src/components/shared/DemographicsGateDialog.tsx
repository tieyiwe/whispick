import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUpdateUserProfile, getGetUserProfileQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { GENDER_OPTIONS, GENDER_LABELS, AGE_RANGE_OPTIONS, AGE_RANGE_LABELS } from "@/lib/demographics";
import { Loader2 } from "lucide-react";

// The one-time confirmation step for lib/demographics.ts's first-whisp gate
// (mirrored server-side in POST /whisps and POST /whisper-groups/:id/send —
// this dialog is a UX nicety, not the enforcement; a request that somehow
// gets here without answering still gets a 428 from the server). Answering
// once satisfies the gate permanently, so this never shows again after
// `onConfirmed` fires.
export function DemographicsGateDialog({ open, onConfirmed }: { open: boolean; onConfirmed: () => void }) {
  const [gender, setGender] = useState("");
  const [ageRange, setAgeRange] = useState("");
  const queryClient = useQueryClient();
  const updateProfile = useUpdateUserProfile();

  function handleConfirm() {
    if (!gender || !ageRange) return;
    updateProfile.mutate(
      { data: { gender, ageRange } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetUserProfileQueryKey() });
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
          <DialogTitle className="font-serif">Just one quick thing</DialogTitle>
          <DialogDescription>
            Before your first whisp goes out, help us understand who's using Blind Whisper. This is never shown to anyone you send to,
            and you can change it later in Settings.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Gender</Label>
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger className="bg-input/50 border-border/50 rounded-xl" data-testid="select-gate-gender">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {GENDER_OPTIONS.map((g) => (
                  <SelectItem key={g} value={g}>{GENDER_LABELS[g]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Age range</Label>
            <Select value={ageRange} onValueChange={setAgeRange}>
              <SelectTrigger className="bg-input/50 border-border/50 rounded-xl" data-testid="select-gate-age-range">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {AGE_RANGE_OPTIONS.map((a) => (
                  <SelectItem key={a} value={a}>{AGE_RANGE_LABELS[a]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handleConfirm}
            disabled={!gender || !ageRange || updateProfile.isPending}
            className="w-full rounded-full"
            data-testid="button-confirm-demographics"
          >
            {updateProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
