import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import {
  useUpdateUserProfile,
  useRefreshWhisperBoxHandle,
  getGetUserRecapQueryKey,
  getGetUserProfileQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Copy, Share2, Image, Loader2, Sparkles } from "lucide-react";
import { shareWhisperBoxStoryCard } from "@/lib/whisperBoxStoryCard";
import { whisperBoxShareUrl } from "@/lib/whisperBoxUrl";
import i18n from "@/i18n";

// Centered popup showing the caller's Whisper Box link, so "Get your link"
// doesn't have to send them off to Settings just to see it. Also owns the
// "personalize before you share" step: a Whisper Box handle is only
// recognizable to a friend if it's built from a display name (see
// whisperBoxHandle's schema comment) — without one, the handle is the same
// anonymous-style random word-pair whispererHandle uses. So whenever the
// caller has no display name set yet, this dialog captures one first (via
// PATCH /user/profile) and immediately regenerates the handle from it
// (POST /whisper-box/refresh-handle) before showing the QR/link — matching
// the moment someone actually cares about their link, rather than nagging
// them about it earlier.
export function WhisperBoxLinkDialog({
  handle,
  handlePersonalized,
  currentDisplayName,
  open,
  onOpenChange,
}: {
  handle: string;
  /** Whether `handle` already reflects the caller's current display name —
   *  see routes/user.ts's whisperBoxHandlePersonalized doc comment. False
   *  also covers "no display name yet", so this alone decides whether the
   *  name-capture step below shows, not a separate hasDisplayName check. */
  handlePersonalized: boolean;
  /** Prefills the name-capture input when it does show — e.g. the account
   *  already has a display name on file, it just changed since the link was
   *  last (re)personalized, so re-typing it would be pure friction. */
  currentDisplayName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("whisperBox");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateProfile = useUpdateUserProfile();
  const refreshHandle = useRefreshWhisperBoxHandle();

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [storyShareLoading, setStoryShareLoading] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [personalizing, setPersonalizing] = useState(false);
  // Once personalization succeeds this replaces the `handle` prop for the
  // rest of this dialog's lifetime — the parent's own query refetch will
  // eventually catch up, but the popup shouldn't flicker back to a
  // capture step (or a stale handle) in the meantime.
  const [resolvedHandle, setResolvedHandle] = useState<string | null>(null);
  const [needsName, setNeedsName] = useState(!handlePersonalized);

  useEffect(() => {
    if (open) {
      setNeedsName(!handlePersonalized);
      setResolvedHandle(null);
      setNameDraft(currentDisplayName ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, handlePersonalized]);

  const effectiveHandle = resolvedHandle ?? handle;
  const url = whisperBoxShareUrl(effectiveHandle);

  useEffect(() => {
    if (!open || needsName) return;
    let cancelled = false;
    void QRCode.toDataURL(url, { width: 220, margin: 1 }).then((dataUrl) => {
      if (!cancelled) setQrDataUrl(dataUrl);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, needsName, url]);

  function handlePersonalizeSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nameDraft.trim();
    if (!trimmed || personalizing) return;
    setPersonalizing(true);
    updateProfile.mutate(
      { data: { fullName: trimmed } },
      {
        onSuccess: () => {
          refreshHandle.mutate(undefined, {
            onSuccess: (result) => {
              setResolvedHandle(result.handle);
              setNeedsName(false);
              queryClient.invalidateQueries({ queryKey: getGetUserRecapQueryKey() });
              queryClient.invalidateQueries({ queryKey: getGetUserProfileQueryKey() });
              toast(
                result.requestedNameTaken
                  ? { title: t("linkDialog.toastNameTaken", { handle: result.handle }) }
                  : { title: t("linkDialog.toastPersonalized") },
              );
            },
            onError: () => toast({ title: t("linkDialog.toastPersonalizeFailed"), variant: "destructive" }),
            onSettled: () => setPersonalizing(false),
          });
        },
        onError: () => {
          toast({ title: t("linkDialog.toastPersonalizeFailed"), variant: "destructive" });
          setPersonalizing(false);
        },
      },
    );
  }

  function handleSkip() {
    setNeedsName(false);
  }

  function handleCopy() {
    navigator.clipboard
      .writeText(url)
      .then(() => toast({ title: t("settingsSection.toastLinkCopied") }))
      .catch(() => toast({ title: t("settingsSection.toastCopyFailed"), variant: "destructive" }));
  }

  function handleShare() {
    if (navigator.share) {
      navigator.share({ title: t("settingsSection.shareTitle"), url }).catch(() => {});
      return;
    }
    handleCopy();
  }

  async function handleShareStory() {
    if (storyShareLoading) return;
    setStoryShareLoading(true);
    try {
      const result = await shareWhisperBoxStoryCard({
        handle: effectiveHandle,
        url,
        promptText: t("settingsSection.storyPromptText"),
        dir: i18n.dir(),
        shareTitle: t("settingsSection.shareTitle"),
        shareText: t("settingsSection.storyShareText"),
      });
      if (result === "downloaded") {
        toast({ title: t("settingsSection.toastStoryDownloaded") });
      } else if (result === "shared-image" || result === "shared-link") {
        // shared-link is the plain-URL fallback (this device can't share the
        // image file) — it still successfully handed the link off to the
        // native share sheet, so it earns the same success toast rather than
        // the silent no-feedback it used to get.
        toast({ title: t("settingsSection.toastStoryShared") });
      } else if (result === "unsupported") {
        toast({ title: t("settingsSection.toastStoryUnsupported"), variant: "destructive" });
      }
      // result === "cancelled": the user dismissed the share sheet without
      // sharing — deliberately no toast, since claiming success there was the
      // bug this fixes.
    } catch {
      toast({ title: t("settingsSection.toastStoryFailed"), variant: "destructive" });
    } finally {
      setStoryShareLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md text-center">
        {needsName ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-center flex items-center justify-center gap-1.5">
                <Sparkles className="w-4 h-4 text-primary" />
                {t("linkDialog.namePromptTitle")}
              </DialogTitle>
              <DialogDescription className="text-center">{t("linkDialog.namePromptDescription")}</DialogDescription>
            </DialogHeader>
            <form onSubmit={handlePersonalizeSubmit} className="space-y-4 pt-1">
              <div className="space-y-2 text-left">
                <Label htmlFor="whisper-box-name-draft" className="text-muted-foreground">
                  {t("linkDialog.nameInputLabel")}
                </Label>
                <Input
                  id="whisper-box-name-draft"
                  className="bg-input/50 border-border/50 rounded-xl"
                  placeholder={t("linkDialog.nameInputPlaceholder")}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  autoFocus
                  data-testid="input-whisper-box-dialog-name"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  type="submit"
                  disabled={!nameDraft.trim() || personalizing}
                  className="w-full rounded-full"
                  data-testid="button-whisper-box-dialog-personalize"
                >
                  {personalizing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                  {t("linkDialog.nameSaveCta")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleSkip}
                  disabled={personalizing}
                  className="w-full rounded-full text-muted-foreground"
                  data-testid="button-whisper-box-dialog-skip"
                >
                  {t("linkDialog.nameSkipCta")}
                </Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-center">{t("linkDialog.title")}</DialogTitle>
              <DialogDescription className="text-center">{t("linkDialog.description")}</DialogDescription>
            </DialogHeader>

            {qrDataUrl && (
              <div className="flex justify-center py-2">
                <img src={qrDataUrl} alt="" className="rounded-xl border border-border/50 bg-white p-2" width={160} height={160} />
              </div>
            )}

            <div
              className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground break-all select-all"
              data-testid="text-whisper-box-dialog-link"
            >
              {url}
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <Button type="button" onClick={handleCopy} className="w-full rounded-full" data-testid="button-whisper-box-dialog-copy">
                <Copy className="w-4 h-4 mr-1.5" />
                {t("linkDialog.copyButton")}
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={handleShare} className="flex-1 rounded-full" data-testid="button-whisper-box-dialog-share">
                  <Share2 className="w-4 h-4 mr-1.5" />
                  {t("settingsSection.shareButton")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleShareStory}
                  disabled={storyShareLoading}
                  className="flex-1 rounded-full"
                  data-testid="button-whisper-box-dialog-share-story"
                >
                  {storyShareLoading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Image className="w-4 h-4 mr-1.5" />}
                  {t("settingsSection.shareStoryButton")}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
