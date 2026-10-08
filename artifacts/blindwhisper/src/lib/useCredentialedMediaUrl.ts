import { useEffect, useState } from "react";
import { getAuthToken } from "@workspace/api-client-react";

// Owner-only /api/media/... routes are requireAuth-gated, and this app
// authenticates by bearer header rather than cookie — a native <video src>/
// <img src> can't attach one, since the browser issues that request itself
// (see Thumbnail.tsx's own comment on the identical problem for images).
// Fetches the URL with the header and hands back a blob URL a real
// <video>/<img> element can use instead. Only fetches while `src` is
// non-null, so a caller can gate it behind "the preview is actually open"
// rather than downloading every clip in a list up front.
export function useCredentialedMediaUrl(src: string | null): { url: string | null; error: boolean; loading: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!src) {
      setUrl(null);
      setError(false);
      return;
    }

    let cancelled = false;
    let created: string | null = null;
    setUrl(null);
    setError(false);

    (async () => {
      try {
        const token = await getAuthToken();
        const res = await fetch(src, { headers: token ? { authorization: `Bearer ${token}` } : undefined });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
      // Revoke on unmount/src-change so switching between previews doesn't
      // accumulate blobs for the tab's life.
      if (created) URL.revokeObjectURL(created);
    };
  }, [src]);

  return { url, error, loading: !url && !error && !!src };
}
