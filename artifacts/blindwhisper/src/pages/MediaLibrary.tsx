import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListMedia, useDeleteMedia, getListMediaQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { uploadMedia, UploadValidationError } from "@/lib/uploadMedia";
import { savePendingForward } from "@/lib/forwardVideo";
import { useCredentialedMediaUrl } from "@/lib/useCredentialedMediaUrl";
import { CirclePostComposer } from "@/components/shared/CirclePostComposer";
import { Thumbnail } from "@/components/shared/Thumbnail";
import { Clapperboard, Upload, Loader2, Send, Trash2, Clock, Users, PlayCircle } from "lucide-react";

function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Matches lib/uploads.ts's UPLOAD_DELETION_WARNING_DAYS (2) — the same
// threshold the backend uses to decide when to email/push-notify the owner
// about an upcoming deletion, reused here so the badge turns urgent at
// exactly the moment the owner's also getting proactively warned elsewhere.
const URGENT_THRESHOLD_MS = 2 * DAY_MS;

// Day-granularity once there's more than a day left (matches the retention
// scheduler's own hourly sweep — see mediaRetentionScheduler.ts's comment on
// why sub-hour precision isn't meaningful here), hour-granularity inside the
// final day so the countdown actually reads like a countdown as the deadline
// gets close, not a "1d" that silently sits there for 23 hours.
function timeRemaining(dateString: string): { unit: "days" | "hours" | "lessThanHour"; count: number; urgent: boolean } {
  const ms = Math.max(0, new Date(dateString).getTime() - Date.now());
  const urgent = ms <= URGENT_THRESHOLD_MS;
  if (ms < HOUR_MS) return { unit: "lessThanHour", count: 0, urgent };
  if (ms < DAY_MS) return { unit: "hours", count: Math.ceil(ms / HOUR_MS), urgent };
  // floor, not ceil: with ceil, anything in (24h, 48h) rounded up to "2 days"
  // so the badge never once read "1 day" and overstated the time left at,
  // say, 25h. floor makes "N days" mean "at least N full days remain" — 25h
  // and 47h both read "1 day", 48h+ reads "2 days" — and it hands cleanly to
  // the hours bucket exactly at the 24h mark ("24 hours" → "1 day").
  return { unit: "days", count: Math.floor(ms / DAY_MS), urgent };
}

export function MediaLibrary() {
  const { t } = useTranslation("media");
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<{ id: string; originalFilename: string } | null>(null);

  const { data: media, isLoading } = useListMedia({ query: { queryKey: getListMediaQueryKey() } });
  const deleteMedia = useDeleteMedia();
  // Only fetched while the preview dialog is actually open — see
  // useCredentialedMediaUrl's own comment for why a plain <video src> can't
  // be used against this owner-only, auth-header-gated route.
  const preview = useCredentialedMediaUrl(previewItem ? `/api/media/${previewItem.id}/file` : null);

  async function handleFileSelect(file: File | undefined) {
    if (!file) return;
    setIsUploading(true);
    try {
      await uploadMedia(file);
      queryClient.invalidateQueries({ queryKey: getListMediaQueryKey() });
      toast({ title: t("mediaLibrary.uploadSuccess") });
    } catch (err) {
      toast({
        title: err instanceof UploadValidationError ? err.message : t("mediaLibrary.uploadFailedDefault"),
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // "Whisp It" — stages this exact upload (by id, not a re-scraped URL) via
  // the same sessionStorage "pass it forward" hand-off WhispsList.tsx's
  // "Whisp again" uses, then drops the sender straight into step 2 of the
  // composer with it already selected — see forwardVideo.ts.
  function handleWhispIt(item: { id: string; originalFilename: string }) {
    savePendingForward({
      videoUrl: "",
      uploadedVideoId: item.id,
      videoTitle: item.originalFilename,
      videoThumbnail: `/api/media/${item.id}/thumbnail`,
      videoPlatform: "upload",
    });
    setLocation("/send");
  }

  function handleDelete() {
    if (!pendingDeleteId) return;
    deleteMedia.mutate(
      { id: pendingDeleteId },
      {
        onSuccess: () => {
          setPendingDeleteId(null);
          queryClient.invalidateQueries({ queryKey: getListMediaQueryKey() });
          toast({ title: t("mediaLibrary.deleteSuccess") });
        },
        onError: () => toast({ title: t("mediaLibrary.deleteError"), variant: "destructive" }),
      }
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-3">
              <Clapperboard className="w-7 h-7 text-primary" /> {t("mediaLibrary.title")}
            </h1>
            <p className="text-muted-foreground mt-1">
              {t("mediaLibrary.description")}
            </p>
          </div>
          <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="rounded-full" data-testid="button-upload-media">
            {isUploading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}
            {t("mediaLibrary.uploadButton")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files?.[0])}
            data-testid="input-upload-media"
          />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-video rounded-xl" />
            ))}
          </div>
        ) : !media?.length ? (
          <Card className="bg-card border-border/50">
            <CardContent className="p-10 text-center space-y-2">
              <Clapperboard className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-muted-foreground">{t("mediaLibrary.emptyState")}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {media.map((item) => (
              <Card key={item.id} className="bg-card border-border/50 overflow-hidden">
                <button
                  type="button"
                  className="aspect-video bg-muted relative w-full block disabled:cursor-default"
                  onClick={() => item.status === "ready" && setPreviewItem({ id: item.id, originalFilename: item.originalFilename })}
                  disabled={item.status !== "ready"}
                  data-testid={`button-preview-${item.id}`}
                >
                  <Thumbnail src={`/api/media/${item.id}/thumbnail`} className="w-full h-full object-cover" />
                  {item.status === "ready" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/0 hover:bg-background/30 transition-colors">
                      <PlayCircle className="w-9 h-9 text-white/90 drop-shadow" />
                    </div>
                  )}
                  {item.status !== "ready" && (
                    <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                      <span className="text-xs text-muted-foreground">{t("mediaLibrary.unavailable")}</span>
                    </div>
                  )}
                </button>
                <CardContent className="p-3 space-y-2">
                  <p className="text-sm font-medium text-foreground truncate">{item.originalFilename}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatSize(item.sizeBytes)}</span>
                    <span>{t("mediaLibrary.usageCount", { count: item.usageCount })}</span>
                  </div>
                  {item.status === "ready" && (() => {
                    const remaining = timeRemaining(item.expiresAt);
                    return (
                      <p
                        className={`text-[11px] flex items-center gap-1 ${remaining.urgent ? "text-amber-500 font-medium" : "text-muted-foreground"}`}
                        data-testid={`text-expires-${item.id}`}
                      >
                        <Clock className="w-3 h-3 shrink-0" />
                        {remaining.unit === "lessThanHour"
                          ? t("mediaLibrary.expiresInLessThanHour")
                          : remaining.unit === "hours"
                            ? t("mediaLibrary.expiresInHours", { count: remaining.count })
                            : t("mediaLibrary.expiresInDays", { count: remaining.count })}
                      </p>
                    );
                  })()}
                  <div className="flex items-center gap-2 pt-1">
                    {item.status === "ready" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 w-full rounded-full"
                        onClick={() => handleWhispIt(item)}
                        data-testid={`button-whisp-it-${item.id}`}
                      >
                        <Send className="w-3.5 h-3.5 mr-1" /> {t("mediaLibrary.whispIt")}
                      </Button>
                    )}
                    {/* Posts this exact upload to the community feed without
                        re-uploading it — the composer takes the existing media
                        id, so the file, its retention and its usage count are
                        the same ones already here. */}
                    {item.status === "ready" && (
                      <CirclePostComposer
                        presetUpload={{ id: item.id, title: item.originalFilename }}
                        trigger={
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 w-full rounded-full"
                            data-testid={`button-post-circle-${item.id}`}
                          >
                            <Users className="w-3.5 h-3.5 mr-1" /> {t("mediaLibrary.postToCircle")}
                          </Button>
                        }
                      />
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setPendingDeleteId(item.id)}
                      data-testid={`button-delete-${item.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <AlertDialog open={!!pendingDeleteId} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("mediaLibrary.removeDialog.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("mediaLibrary.removeDialog.description")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("mediaLibrary.removeDialog.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {t("mediaLibrary.removeDialog.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* A quick "is this the right video?" check before sending/posting/
            deleting it — the thumbnail alone (a single frame) often isn't
            enough to tell two similar clips apart. */}
        <Dialog open={!!previewItem} onOpenChange={(open) => !open && setPreviewItem(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="truncate">{previewItem?.originalFilename}</DialogTitle>
            </DialogHeader>
            <div className="aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center">
              {preview.error ? (
                <p className="text-sm text-muted-foreground px-4 text-center">{t("mediaLibrary.previewError")}</p>
              ) : preview.url ? (
                <video src={preview.url} controls autoPlay className="w-full h-full" data-testid="video-media-preview" />
              ) : (
                <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
