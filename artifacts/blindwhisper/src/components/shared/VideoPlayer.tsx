import { useEffect, useRef, useState } from "react";
import { PlayCircle, ExternalLink } from "lucide-react";
import confetti from "canvas-confetti";

// Proper capitalisation for the "open on ..." link — the stored platform slug
// is lowercase, and "Open on tiktok" looks like a bug.
const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  twitter: "X",
};

type Props = {
  platform?: string | null;
  embedUrl?: string | null;
  videoUrl: string;
  thumbnail?: string | null;
  title?: string | null;
  startSeconds?: number | null;
  // Trim point — playback is paused and treated as "watched to completion"
  // once reached, instead of implying the recipient should watch to the
  // video's own natural end. Enforced in JS (below) rather than relying
  // solely on a platform embed param, so it behaves identically across
  // YouTube/Vimeo/native-upload playback.
  endSeconds?: number | null;
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
export function VideoPlayer({ platform, embedUrl, videoUrl, thumbnail, title, startSeconds, endSeconds, uploadSrc, onWatchEvent }: Props) {
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
    if (endSeconds != null && !fired.complete && currentTime >= endSeconds) {
      fired.complete = true;
      onWatchEvent("watched_complete");
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
          const time = player.getCurrentTime();
          checkProgress(time, player.getDuration());
          if (endSeconds != null && time >= endSeconds && typeof player.pauseVideo === "function") {
            player.pauseVideo();
          }
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
        if (endSeconds != null && seconds >= endSeconds) {
          player?.pause().catch(() => {});
        }
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

  // Anything the server could build an embed for plays here. That's the whole
  // point of a whisp arriving on its own page — being thrown out to the
  // Facebook app mid-moment breaks it, and the recipient may not even be
  // logged in over there.
  const isEmbeddable = !!embedUrl;
  const isNativeVideo = platform === "upload" && !!uploadSrc;
  // ...but only YouTube and Vimeo report progress back, so only those can be
  // *measured* as watched. The rest are embedded blind.
  const hasProgressApi = platform === "youtube" || platform === "vimeo";

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
        onTimeUpdate={(e) => {
          checkProgress(e.currentTarget.currentTime, e.currentTarget.duration);
          if (endSeconds != null && e.currentTarget.currentTime >= endSeconds) e.currentTarget.pause();
        }}
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
    // YouTube's own `end` param gives a precise, native stop — the JS-level
    // checkProgress/pauseVideo above still runs as a fallback (and to
    // reliably fire watched_complete) since not every platform supports a
    // native trim param the same way.
    const endParam = endSeconds != null && platform === "youtube" ? `&end=${endSeconds}` : "";
    // Only appended where it's actually honoured. TikTok and Instagram ignore
    // it, and Facebook's plugin spells it differently — passing it anyway
    // would just be noise in the URL.
    const autoplayParam = hasProgressApi ? "autoplay=1" : "";
    const src = `${embedUrl}${autoplayParam || startParam || endParam ? (embedUrl!.includes("?") ? "&" : "?") : ""}${autoplayParam}${startParam}${endParam}`;

    // TikTok and Instagram are portrait-first; forcing them into 16:9 would
    // letterbox the video into a thin strip with black either side.
    const frameClass =
      platform === "tiktok"
        ? "relative mx-auto w-full max-w-[325px] aspect-[9/16] max-h-[70vh] bg-black"
        : platform === "instagram"
        ? "relative mx-auto w-full max-w-[400px] h-[540px] max-h-[75vh] bg-black"
        : "relative aspect-video w-full bg-black";

    return (
      <div className={frameClass}>
        <iframe
          ref={iframeRef}
          src={src}
          title={title ?? "Video"}
          className="absolute inset-0 w-full h-full"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
        {/* Always reachable, never a fallback that only appears on failure:
            these embeds render public content only, so a restricted or
            login-walled video loads to an empty frame with nothing to click.
            This is also the answer for anyone who'd simply rather watch in
            the app they already use. */}
        <a
          href={videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="link-open-on-platform"
          className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white/90 backdrop-blur transition-colors hover:bg-black/80 hover:text-white"
        >
          <ExternalLink className="w-3 h-3" />
          {platform ? `Open on ${PLATFORM_LABELS[platform] ?? platform}` : "Open original"}
        </a>
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
      // Playing in an embed we can't observe (TikTok, Instagram, Facebook) is
      // the same evidentiary position as opening the link in a new tab: the
      // deliberate tap is the best signal available, and better than a
      // permanent "not watched" that reads to the sender as being ignored.
      // YouTube/Vimeo/uploads are left to the real progress checks above,
      // because a measured signal beats an assumed one.
      if (!hasProgressApi && !isNativeVideo && !firedRef.current.complete) {
        firedRef.current.complete = true;
        onWatchEvent("watched_complete");
      }
    } else {
      // Everything else (TikTok, Instagram, Facebook, X, a bare link) opens
      // in a new tab, where we can never see playback at all. Previously that
      // meant those whisps could NEVER register as watched — the sender's
      // "Watched" timeline step and the Videos Watched stat stayed empty
      // forever no matter what the recipient did, which reads as "they
      // ignored it" rather than "we couldn't tell". Treating the deliberate
      // tap-to-open as watched is the best evidence available on this path,
      // and a truer answer than a permanent no.
      if (!firedRef.current.complete) {
        firedRef.current.complete = true;
        onWatchEvent("watched_complete");
      }
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
