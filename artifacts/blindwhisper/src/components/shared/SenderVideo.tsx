import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Loader2, PlayCircle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Thumbnail } from "@/components/shared/Thumbnail";
import { safeExternalHref } from "@/lib/safeHref";
import { useCredentialedMediaUrl } from "@/lib/useCredentialedMediaUrl";

// The video a SENDER sent, as their own Sent/Archived views show it — kept
// separate from the recipient's player (PublicWhispPage.tsx) because the two
// have different lifetimes. The recipient's link expires and its public
// /api/public/w/:token/media stream 410s with it, but the sender keeps
// access to what they sent for as long as it exists: an external link
// (YouTube, TikTok…) always, and an upload through the owner-only
// /api/whisps/:id/media routes until lib/mediaRetentionScheduler.ts phases
// the file itself out. Only a moderation takedown (contentRemoved) hides it.
export interface SenderVideoWhisp {
  id: string;
  videoUrl: string;
  videoTitle?: string | null;
  videoThumbnail?: string | null;
  videoPlatform?: string | null;
  contentRemoved?: boolean;
}

/**
 * The thumbnail the SENDER should load. An upload's stored videoThumbnail
 * is the token-scoped public route, which stops answering once the
 * recipient's link expires — so a sender's own Sent list lost the picture
 * 48 hours in. The owner-scoped route has no such window. Goes through
 * <Thumbnail>, which attaches the bearer header for /api/ paths.
 */
export function senderThumbnailSrc(whisp: SenderVideoWhisp): string | null {
  if (whisp.videoPlatform === "upload") return whisp.videoThumbnail ? `/api/whisps/${whisp.id}/media/thumbnail` : null;
  return whisp.videoThumbnail ?? null;
}

/**
 * The thumbnail-with-play-button header of the sender's own whisp page.
 * Always offers a way to the video — previously the play link only existed
 * when the whisp had a thumbnail, so a link without one (common for TikTok,
 * Instagram, X) left the sender nothing to click at all.
 */
export function SenderVideoPreview({ whisp }: { whisp: SenderVideoWhisp }) {
  const { t } = useTranslation("whisp");
  const [playing, setPlaying] = useState(false);
  const isUpload = whisp.videoPlatform === "upload";
  const thumbnail = senderThumbnailSrc(whisp);
  const externalHref = isUpload ? undefined : safeExternalHref(whisp.videoUrl);

  if (whisp.contentRemoved) {
    return (
      <div className="flex h-32 items-center justify-center gap-2 bg-muted px-6 text-center text-sm text-muted-foreground" data-testid="sender-video-removed">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        {t("whispDetail.videoRemovedByModeration")}
      </div>
    );
  }

  if (isUpload && playing) {
    return <SenderUploadPlayer whispId={whisp.id} />;
  }

  const playButton = (
    <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-md ring-1 ring-white/30 flex items-center justify-center hover:bg-white/30 transition-colors duration-200">
      <PlayCircle className="w-8 h-8 text-white" />
    </div>
  );

  return (
    <div className="relative h-48 sm:h-56 overflow-hidden bg-muted">
      {thumbnail &&
        (isUpload ? (
          <Thumbnail src={thumbnail} alt={whisp.videoTitle || t("whispDetail.videoFallback")} className="w-full h-full object-cover" />
        ) : (
          <img src={thumbnail} alt={whisp.videoTitle || t("whispDetail.videoFallback")} className="w-full h-full object-cover" />
        ))}
      <div className="absolute inset-0 bg-black/35 flex items-center justify-center">
        {isUpload ? (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={t("whispDetail.watchVideo")}
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            data-testid="button-sender-play-upload"
          >
            {playButton}
          </button>
        ) : externalHref ? (
          <a
            aria-label={t("whispDetail.watchVideo")}
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            href={externalHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="link-sender-open-video"
          >
            {playButton}
          </a>
        ) : null}
      </div>
    </div>
  );
}

// Fetched with the bearer header (a bare <video src> can't carry one — see
// useCredentialedMediaUrl) only once the sender actually taps play, so
// opening the page never downloads the clip up front.
function SenderUploadPlayer({ whispId }: { whispId: string }) {
  const { t } = useTranslation("whisp");
  const { url, error, loading } = useCredentialedMediaUrl(`/api/whisps/${whispId}/media`);

  if (error) {
    return (
      <div className="flex h-32 items-center justify-center bg-muted px-6 text-center text-sm text-muted-foreground" data-testid="sender-video-unavailable">
        {t("whispDetail.videoNoLongerAvailable")}
      </div>
    );
  }
  if (loading || !url) {
    return (
      <div className="flex h-48 sm:h-56 items-center justify-center bg-black" aria-busy="true">
        <Loader2 className="h-6 w-6 animate-spin text-white/80" />
      </div>
    );
  }
  return <video src={url} controls autoPlay playsInline className="w-full max-h-[70vh] bg-black" data-testid="sender-video-player" />;
}

/**
 * A compact "Watch video" action for places that don't show the full
 * preview — the archived gate, which otherwise left the sender no way to
 * what they sent short of unarchiving it first.
 */
export function SenderVideoButton({ whisp }: { whisp: SenderVideoWhisp }) {
  const { t } = useTranslation("whisp");
  const [open, setOpen] = useState(false);

  if (whisp.contentRemoved) return null;

  if (whisp.videoPlatform === "upload") {
    if (open) {
      return (
        <div className="overflow-hidden rounded-2xl text-left">
          <SenderUploadPlayer whispId={whisp.id} />
        </div>
      );
    }
    return (
      <Button variant="ghost" onClick={() => setOpen(true)} className="rounded-full h-11 px-5" data-testid="button-sender-watch-video">
        <PlayCircle className="w-4 h-4 mr-2" /> {t("whispDetail.watchVideo")}
      </Button>
    );
  }

  const href = safeExternalHref(whisp.videoUrl);
  if (!href) return null;
  return (
    <Button asChild variant="ghost" className="rounded-full h-11 px-5">
      <a href={href} target="_blank" rel="noopener noreferrer" data-testid="link-sender-watch-video">
        <ExternalLink className="w-4 h-4 mr-2" /> {t("whispDetail.watchVideo")}
      </a>
    </Button>
  );
}
