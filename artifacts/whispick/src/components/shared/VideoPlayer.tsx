import { useEffect, useRef, useState } from "react";
import { PlayCircle } from "lucide-react";
import confetti from "canvas-confetti";

type Props = {
  platform?: string | null;
  embedUrl?: string | null;
  videoUrl: string;
  thumbnail?: string | null;
  title?: string | null;
  startSeconds?: number | null;
  // For platform === "upload": the actual streamable bytes URL and poster
  // image. videoUrl itself is a non-navigable "upload:<id>" marker in that
  // case (see routes/whisps.ts), so the caller resolves the real src — it's
  // the only one who knows the whisp's public token (or, for a sender's own
  // authenticated views, the media id).
  uploadSrc?: string | null;
  onWatchEvent: (eventType: "clicked" | "watched_10s" | "watched_50pct" | "watched_complete") => void;
};

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });

  return youtubeApiPromise;
}

/**
 * Embeds YouTube/Vimeo playback in-page and reports real watch progress via
 * each platform's JS player API. Every other platform has no embeddable
 * player with progress events, so we fall back to opening the original link
 * and can only ever know it was clicked, not watched.
 */
export function VideoPlayer({ platform, embedUrl, videoUrl, thumbnail, title, startSeconds, uploadSrc, onWatchEvent }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const firedRef = useRef({ tenSec: false, halfway: false, complete: false });
  const [playing, setPlaying] = useState(false);
  // A thumbnail URL we construct client-side (e.g. an upload whose
  // client-side capture failed) isn't guaranteed to actually resolve — fall
  // back to the plain "no thumbnail" state rather than showing a broken
  // image behind the play button.
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  function checkProgress(currentTime: number, duration: number) {
    const fired = firedRef.current;
    if (!fired.tenSec && currentTime >= 10) {
      fired.tenSec = true;
      onWatchEvent("watched_10s");
    }
    if (!fired.halfway && duration > 0 && currentTime / duration >= 0.5) {
      fired.halfway = true;
      onWatchEvent("watched_50pct");
    }
  }

  useEffect(() => {
    if (!playing || platform !== "youtube" || !iframeRef.current) return;

    let player: any;
    let interval: ReturnType<typeof setInterval>;
    let cancelled = false;

    loadYouTubeApi().then(() => {
      if (cancelled || !iframeRef.current) return;
      player = new window.YT.Player(iframeRef.current, {
        events: {
          onStateChange: (event: any) => {
            if (event.data === window.YT.PlayerState.ENDED && !firedRef.current.complete) {
              firedRef.current.complete = true;
              onWatchEvent("watched_complete");
            }
          },
        },
      });
      interval = setInterval(() => {
        if (typeof player.getCurrentTime === "function") {
          checkProgress(player.getCurrentTime(), player.getDuration());
        }
      }, 2000);
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, platform]);

  useEffect(() => {
    if (!playing || platform !== "vimeo" || !iframeRef.current) return;

    let cancelled = false;
    let player: import("@vimeo/player").default | undefined;

    import("@vimeo/player").then(({ default: Player }) => {
      if (cancelled || !iframeRef.current) return;
      player = new Player(iframeRef.current);
      if (startSeconds) {
        player.setCurrentTime(startSeconds).catch(() => {});
      }
      player.on("timeupdate", ({ seconds, duration }: { seconds: number; duration: number }) => {
        checkProgress(seconds, duration);
      });
      player.on("ended", () => {
        if (!firedRef.current.complete) {
          firedRef.current.complete = true;
          onWatchEvent("watched_complete");
        }
      });
    });

    return () => {
      cancelled = true;
      player?.unload().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, platform]);

  const isEmbeddable = !!embedUrl && (platform === "youtube" || platform === "vimeo");
  const isNativeVideo = platform === "upload" && !!uploadSrc;

  if (isNativeVideo && playing) {
    return (
      <video
        ref={videoRef}
        src={uploadSrc!}
        poster={thumbnail ?? undefined}
        controls
        autoPlay
        playsInline
        className="w-full max-h-64 bg-black"
        onLoadedMetadata={(e) => {
          if (startSeconds) e.currentTarget.currentTime = startSeconds;
        }}
        onTimeUpdate={(e) => checkProgress(e.currentTarget.currentTime, e.currentTarget.duration)}
        onEnded={() => {
          if (!firedRef.current.complete) {
            firedRef.current.complete = true;
            onWatchEvent("watched_complete");
          }
        }}
      />
    );
  }

  if (isEmbeddable && playing) {
    const startParam = startSeconds ? (platform === "youtube" ? `&start=${startSeconds}` : "") : "";
    return (
      <div className="relative aspect-video w-full bg-black">
        <iframe
          ref={iframeRef}
          src={`${embedUrl}${embedUrl!.includes("?") ? "&" : "?"}autoplay=1${startParam}`}
          title={title ?? "Video"}
          className="absolute inset-0 w-full h-full"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  function handlePlayClick(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    confetti({
      particleCount: 80,
      spread: 70,
      startVelocity: 35,
      origin: {
        x: (rect.left + rect.width / 2) / window.innerWidth,
        y: (rect.top + rect.height / 2) / window.innerHeight,
      },
      colors: ["#7C5CFC", "#FF6B6B", "#a78bfa", "#F5F0E8"],
      disableForReducedMotion: true,
    });

    onWatchEvent("clicked");
    if (isEmbeddable || isNativeVideo) {
      setPlaying(true);
    } else {
      window.open(videoUrl, "_blank", "noopener,noreferrer");
    }
  }

  return thumbnail && !thumbnailFailed ? (
    <div className="relative">
      <img
        src={thumbnail}
        alt={title ?? "Video"}
        className="w-full object-cover max-h-64"
        onError={() => setThumbnailFailed(true)}
      />
      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
        <button
          onClick={handlePlayClick}
          className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 active:scale-95 transition-all"
          data-testid="button-watch-video"
        >
          <PlayCircle className="w-9 h-9 text-white" />
        </button>
      </div>
    </div>
  ) : (
    <button
      onClick={handlePlayClick}
      className="w-full h-36 bg-muted flex flex-col items-center justify-center gap-2 hover:bg-muted/80 transition-colors"
      data-testid="button-watch-video-no-thumb"
    >
      <PlayCircle className="w-10 h-10 text-primary" />
      <span className="text-sm text-muted-foreground">Watch the video</span>
    </button>
  );
}
