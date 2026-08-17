import { useEffect, useState } from "react";
import { PlayCircle } from "lucide-react";
import { getAuthToken } from "@workspace/api-client-react";

// A thumbnail URL we construct client-side (e.g. /api/media/:id/thumbnail)
// isn't guaranteed to actually resolve — an upload whose client-side
// capture failed (canvas unavailable, toBlob returning null) simply has no
// thumbnail on the server, and there's no boolean flag plumbed through the
// API to know that ahead of time. Rather than show a broken-image icon,
// fall back to a plain placeholder once the load fails.
//
// Owner-only media thumbnails (/api/media/:id/thumbnail) are requireAuth-
// gated, and a native `<img src>` can't carry an Authorization header — the
// browser issues that request itself. Since this app authenticates by bearer
// header rather than cookie (see App.tsx's ClerkAuthTokenBridge), letting the
// browser fetch it directly 401s and every uploaded video shows a placeholder
// to its own owner. So fetch it ourselves with the header and hand the <img>
// a blob URL instead. Public, token-scoped thumbnails
// (/api/public/w/:token/media/thumbnail) need no credential, but going
// through the same path costs nothing and keeps one code path.
export function Thumbnail({ src, alt, className }: { src: string; alt?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    setFailed(false);
    setObjectUrl(null);

    (async () => {
      try {
        const token = await getAuthToken();
        const res = await fetch(src, {
          headers: token ? { authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      // Revoke on unmount/src-change so a long-lived list (Media Library,
      // the composer's picker) doesn't accumulate blobs for the tab's life.
      if (created) URL.revokeObjectURL(created);
    };
  }, [src]);

  if (failed) {
    return (
      <div className={`${className ?? ""} flex items-center justify-center bg-muted`}>
        <PlayCircle className="w-1/4 h-1/4 min-w-4 min-h-4 text-muted-foreground" />
      </div>
    );
  }

  // Placeholder-shaped (not an empty <img>) while the blob resolves, so the
  // surrounding layout doesn't jump once it lands.
  if (!objectUrl) {
    return <div className={`${className ?? ""} bg-muted animate-pulse`} />;
  }

  return <img src={objectUrl} alt={alt ?? ""} className={className} onError={() => setFailed(true)} />;
}
