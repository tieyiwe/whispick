import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Copy, Share2, Image, Loader2 } from "lucide-react";
import { shareWhisperBoxStoryCard } from "@/lib/whisperBoxStoryCard";
import i18n from "@/i18n";

// Centered popup showing the caller's Whisper Box link, so "Get your link"
// doesn't have to send them off to Settings just to see it — the actual bug
// this fixes was that button navigating to /settings and landing at the top
// of the page (profile section) instead of anywhere near the Whisper Box
// card. Reuses the exact same copy/share/story-share logic SettingsPage's
// Whisper Box card already has, rather than duplicating three toast strings
// under a new key set.
export function WhisperBoxLinkDialog({
  handle,
  open,
  onOpenChange,
}: {
  handle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("whisperBox");
  const { toast } = useToast();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [storyShareLoading, setStoryShareLoading] = useState(false);
  const url = `${window.location.origin}/whisper-box/${handle}`;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void QRCode.toDataURL(url, { width: 220, margin: 1 }).then((dataUrl) => {
      if (!cancelled) setQrDataUrl(dataUrl);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, url]);

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
        handle,
        url,
        promptText: t("settingsSection.storyPromptText"),
        dir: i18n.dir(),
        shareTitle: t("settingsSection.shareTitle"),
        shareText: t("settingsSection.storyShareText"),
      });
      if (result === "downloaded") {
        toast({ title: t("settingsSection.toastStoryDownloaded") });
      } else if (result === "unsupported") {
        toast({ title: t("settingsSection.toastStoryUnsupported"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("settingsSection.toastStoryFailed"), variant: "destructive" });
    } finally {
      setStoryShareLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md text-center">
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
      </DialogContent>
    </Dialog>
  );
}
