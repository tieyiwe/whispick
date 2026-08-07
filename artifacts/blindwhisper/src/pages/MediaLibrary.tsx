import { useRef, useState } from "react";
import { Link } from "wouter";
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
import { useToast } from "@/hooks/use-toast";
import { uploadMedia, UploadValidationError } from "@/lib/uploadMedia";
import { Thumbnail } from "@/components/shared/Thumbnail";
import { Clapperboard, Upload, Loader2, Send, Trash2, Clock } from "lucide-react";

function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function daysUntil(dateString: string): number {
  return Math.max(0, Math.ceil((new Date(dateString).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function MediaLibrary() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const { data: media, isLoading } = useListMedia({ query: { queryKey: getListMediaQueryKey() } });
  const deleteMedia = useDeleteMedia();

  async function handleFileSelect(file: File | undefined) {
    if (!file) return;
    setIsUploading(true);
    try {
      await uploadMedia(file);
      queryClient.invalidateQueries({ queryKey: getListMediaQueryKey() });
      toast({ title: "Video uploaded" });
    } catch (err) {
      toast({
        title: err instanceof UploadValidationError ? err.message : "Upload failed. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleDelete() {
    if (!pendingDeleteId) return;
    deleteMedia.mutate(
      { id: pendingDeleteId },
      {
        onSuccess: () => {
          setPendingDeleteId(null);
          queryClient.invalidateQueries({ queryKey: getListMediaQueryKey() });
          toast({ title: "Video removed" });
        },
        onError: () => toast({ title: "Failed to remove video", variant: "destructive" }),
      }
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-3">
              <Clapperboard className="w-7 h-7 text-primary" /> Media Library
            </h1>
            <p className="text-muted-foreground mt-1">
              Videos you've uploaded from your device, ready to reuse in a whisp.
            </p>
          </div>
          <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="rounded-full" data-testid="button-upload-media">
            {isUploading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}
            Upload a video
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
              <p className="text-muted-foreground">No uploads yet — add a video to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {media.map((item) => (
              <Card key={item.id} className="bg-card border-border/50 overflow-hidden">
                <div className="aspect-video bg-muted relative">
                  <Thumbnail src={`/api/media/${item.id}/thumbnail`} className="w-full h-full object-cover" />
                  {item.status !== "ready" && (
                    <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                      <span className="text-xs text-muted-foreground">No longer available</span>
                    </div>
                  )}
                </div>
                <CardContent className="p-3 space-y-2">
                  <p className="text-sm font-medium text-foreground truncate">{item.originalFilename}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatSize(item.sizeBytes)}</span>
                    <span>{item.usageCount} whisp{item.usageCount === 1 ? "" : "s"}</span>
                  </div>
                  {item.status === "ready" && (
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Removed in {daysUntil(item.expiresAt)}d
                    </p>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    {item.status === "ready" && (
                      <Link href="/send" className="flex-1">
                        <Button size="sm" variant="outline" className="w-full rounded-full" data-testid={`button-use-${item.id}`}>
                          <Send className="w-3.5 h-3.5 mr-1" /> Use
                        </Button>
                      </Link>
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
              <AlertDialogTitle>Remove this video?</AlertDialogTitle>
              <AlertDialogDescription>
                Any whisp that already used it will show "no longer available" instead of the video.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  );
}
