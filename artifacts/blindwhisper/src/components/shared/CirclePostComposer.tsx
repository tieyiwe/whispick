import { useRef, useState } from "react";
import {
  useCreateWhisp,
  useScrapeVideoMeta,
  useListMyCircles,
  getListMyCirclesQueryKey,
  getListCircleFeedQueryKey,
  getGetWhispStatsQueryKey,
  getListWhispsQueryKey,
  getListMediaQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { MOOD_CONFIG, MOOD_TAGS } from "@/components/shared/MoodTag";
import { Thumbnail } from "@/components/shared/Thumbnail";
import { uploadMedia, UploadValidationError, MAX_UPLOAD_DURATION_SECONDS } from "@/lib/uploadMedia";
import { Globe, Users, Link2, Upload, Loader2, X, PlayCircle, Plus } from "lucide-react";

type VideoMeta = {
  title?: string | null;
  thumbnail?: string | null;
  embedUrl?: string | null;
  platform?: string;
};

/**
 * Posting straight into the Blind Circle, from the Blind Circle.
 *
 * This used to be reachable only as one of four delivery methods buried in
 * step 4 of the send-a-whisp wizard, which asked people to start a flow built
 * around choosing a recipient in order to do the one thing that has no
 * recipient at all. Posting to a community feed is its own act, and it belongs
 * on the page showing that feed.
 */
export function CirclePostComposer({
  presetUpload,
  trigger,
}: {
  /** An already-uploaded video, so the Media Library can post one straight to
   *  the circle without re-uploading it. Skips the link/upload chooser. */
  presetUpload?: { id: string; title: string };
  trigger?: React.ReactNode;
} = {}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"link" | "upload">(presetUpload ? "upload" : "link");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(
    presetUpload
      ? { title: presetUpload.title, thumbnail: `/api/media/${presetUpload.id}/thumbnail`, platform: "upload" }
      : null,
  );
  const [uploadedVideoId, setUploadedVideoId] = useState<string | null>(presetUpload?.id ?? null);
  const [uploading, setUploading] = useState(false);
  // Required for a pasted link. A scrape gives a title only when the platform
  // exposes one, and even then it's the uploader's SEO headline rather than
  // anything about why this is worth watching — so the community feed would
  // fill up with untitled cards. An upload already has its filename.
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [alias, setAlias] = useState("");
  const [moodTag, setMoodTag] = useState<string | null>(null);
  const [circleId, setCircleId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createWhisp = useCreateWhisp();
  const scrapeVideo = useScrapeVideoMeta();
  const { data: myCircles } = useListMyCircles({
    query: { enabled: open, queryKey: getListMyCirclesQueryKey() },
  });

  const hasVideo = !!uploadedVideoId || (!!videoUrl.trim() && !!videoMeta);
  // Title is mandatory for a link, and supplied by the filename for an upload.
  const needsTitle = source === "link" && !uploadedVideoId;
  const canPost = hasVideo && (!needsTitle || !!title.trim());

  function reset() {
    setSource(presetUpload ? "upload" : "link");
    setVideoUrl("");
    setVideoMeta(
      presetUpload
        ? { title: presetUpload.title, thumbnail: `/api/media/${presetUpload.id}/thumbnail`, platform: "upload" }
        : null,
    );
    setUploadedVideoId(presetUpload?.id ?? null);
    setTitle("");
    setNote("");
    setAlias("");
    setMoodTag(null);
    setCircleId(null);
  }

  function handleFetchMeta() {
    const url = videoUrl.trim();
    if (!url) return;
    scrapeVideo.mutate(
      { data: { url } },
      {
        onSuccess: (meta) => {
          setVideoMeta(meta);
          if (meta.title) setTitle((current) => current || meta.title!);
        },
        // Same tolerant fallback the send flow uses: a platform we couldn't
        // parse is still postable, just without a title or thumbnail.
        onError: () => setVideoMeta({ platform: "other" }),
      },
    );
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadMedia(file);
      setUploadedVideoId(result.id);
      setVideoUrl("");
      setVideoMeta({
        title: result.originalFilename,
        thumbnail: `/api/media/${result.id}/thumbnail`,
        platform: "upload",
      });
      queryClient.invalidateQueries({ queryKey: getListMediaQueryKey() });
    } catch (err) {
      toast({
        title:
          err instanceof UploadValidationError
            ? err.message
            : `Upload failed — videos must be under ${MAX_UPLOAD_DURATION_SECONDS} seconds`,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function handlePost() {
    if (!canPost) return;
    createWhisp.mutate(
      {
        data: {
          videoUrl: uploadedVideoId ? null : videoUrl.trim(),
          videoTitle: needsTitle ? title.trim() : videoMeta?.title ?? null,
          videoThumbnail: videoMeta?.thumbnail ?? null,
          videoEmbedUrl: uploadedVideoId ? null : videoMeta?.embedUrl ?? null,
          videoPlatform: videoMeta?.platform ?? null,
          uploadedVideoId,
          deliveryMethod: "circle_drop",
          circleId,
          anonymousNote: note.trim() || null,
          senderAlias: alias.trim() || null,
          moodTag,
          // A circle post has no recipient at all — that's the whole point.
          whisperChannel: null,
          recipientEmail: null,
          recipientPhone: null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Posted to Blind Circle" });
          setOpen(false);
          reset();
          queryClient.invalidateQueries({ queryKey: getListCircleFeedQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetWhispStatsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListWhispsQueryKey() });
        },
        onError: (err: any) =>
          toast({ title: err?.data?.error ?? "Couldn't post to Blind Circle", variant: "destructive" }),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button data-testid="button-open-circle-composer" className="rounded-full">
            <Plus className="w-4 h-4 mr-1.5" /> Post to Blind Circle
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif">Post to Blind Circle</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Link or upload — the upload path is the same pipeline the Media
              Library uses, so a file posted here behaves identically to one
              sent as a whisp: same retention, same playback. */}
          {!presetUpload && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSource("link")}
              data-testid="circle-source-link"
              className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 text-sm font-medium transition-all ${
                source === "link" ? "border-primary bg-primary/10 text-foreground" : "border-border/50 text-muted-foreground"
              }`}
            >
              <Link2 className="w-4 h-4" /> Paste a link
            </button>
            <button
              type="button"
              onClick={() => setSource("upload")}
              data-testid="circle-source-upload"
              className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 text-sm font-medium transition-all ${
                source === "upload" ? "border-primary bg-primary/10 text-foreground" : "border-border/50 text-muted-foreground"
              }`}
            >
              <Upload className="w-4 h-4" /> Upload a video
            </button>
          </div>
          )}

          {presetUpload ? null : source === "link" ? (
            <div className="flex gap-2">
              <Input
                placeholder="Paste a video link..."
                value={videoUrl}
                onChange={(e) => {
                  setVideoUrl(e.target.value);
                  setVideoMeta(null);
                  setUploadedVideoId(null);
                  setTitle("");
                }}
                data-testid="input-circle-video-url"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={handleFetchMeta}
                disabled={!videoUrl.trim() || scrapeVideo.isPending}
                data-testid="button-circle-fetch-video"
              >
                {scrapeVideo.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Fetch"}
              </Button>
            </div>
          ) : (
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
                data-testid="input-circle-file"
              />
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                data-testid="button-circle-choose-file"
              >
                {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                {uploading ? "Uploading..." : "Choose a video"}
              </Button>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Up to {MAX_UPLOAD_DURATION_SECONDS} seconds. MP4, WebM or MOV.
              </p>
            </div>
          )}

          {videoMeta && (
            <div className="flex items-center gap-3 rounded-xl bg-muted/30 p-3" data-testid="circle-video-preview">
              {videoMeta.thumbnail ? (
                <Thumbnail src={videoMeta.thumbnail} alt="" className="h-12 w-20 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <PlayCircle className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <p className="min-w-0 flex-1 truncate text-sm text-foreground">{videoMeta.title || videoUrl}</p>
              <button
                type="button"
                onClick={() => {
                  setVideoMeta(null);
                  setUploadedVideoId(null);
                  setVideoUrl("");
                  setTitle("");
                }}
                aria-label="Remove video"
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Required for a link. A scraped title is only ever a suggestion —
              it's prefilled and editable, and plenty of links return none at
              all, which would leave untitled cards in the feed. */}
          {needsTitle && (
            <div className="space-y-1">
              <div className="flex items-baseline justify-between">
                <label htmlFor="circle-title" className="text-xs font-medium text-muted-foreground">
                  Title <span className="text-destructive">*</span>
                </label>
                <span className="text-[11px] text-muted-foreground">{title.length}/120</span>
              </div>
              <Input
                id="circle-title"
                placeholder="What is it? Give it a title"
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="input-circle-title"
              />
            </div>
          )}

          <Textarea
            className="min-h-[70px] resize-none rounded-xl"
            placeholder={needsTitle ? "Short description (optional)" : "Say something about it (optional)"}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            data-testid="input-circle-note"
          />

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Mood (optional)</p>
            <div className="flex flex-wrap gap-1.5">
              {MOOD_TAGS.map((mood) => {
                const config = MOOD_CONFIG[mood];
                const active = moodTag === mood;
                return (
                  <button
                    key={mood}
                    type="button"
                    onClick={() => setMoodTag(active ? null : mood)}
                    data-testid={`circle-mood-${mood}`}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-all ${
                      active ? "border-primary bg-primary/15 text-foreground" : "border-border/50 text-muted-foreground"
                    }`}
                  >
                    {config.label}
                  </button>
                );
              })}
            </div>
          </div>

          <Input
            placeholder="Sign it as... (optional)"
            maxLength={200}
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            data-testid="input-circle-alias"
          />

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Where should it go?</p>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => setCircleId(null)}
                data-testid="circle-target-public"
                className={`flex items-center gap-2 rounded-xl border p-2.5 text-sm font-medium transition-all ${
                  circleId === null ? "border-primary bg-primary/10 text-foreground" : "border-border/50 text-muted-foreground"
                }`}
              >
                <Globe className="h-4 w-4" /> Public Blind Circle
              </button>
              {(myCircles ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCircleId(c.id)}
                  data-testid={`circle-target-${c.id}`}
                  className={`flex items-center gap-2 rounded-xl border p-2.5 text-sm font-medium transition-all ${
                    circleId === c.id ? "border-primary bg-primary/10 text-foreground" : "border-border/50 text-muted-foreground"
                  }`}
                >
                  <Users className="h-4 w-4" /> {c.name}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Posted anonymously — your name is never attached. Anyone who can see this circle can see the post.
          </p>

          <Button
            className="w-full"
            onClick={handlePost}
            disabled={!canPost || createWhisp.isPending || uploading}
            data-testid="button-circle-post"
          >
            {createWhisp.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Post anonymously
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
