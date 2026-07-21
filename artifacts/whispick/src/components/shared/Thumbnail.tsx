import { useState } from "react";
import { PlayCircle } from "lucide-react";

// A thumbnail URL we construct client-side (e.g. /api/media/:id/thumbnail)
// isn't guaranteed to actually resolve — an upload whose client-side
// capture failed (canvas unavailable, toBlob returning null) simply has no
// thumbnail on the server, and there's no boolean flag plumbed through the
// API to know that ahead of time. Rather than show a broken-image icon,
// fall back to a plain placeholder once the <img> itself reports a load
// failure.
export function Thumbnail({ src, alt, className }: { src: string; alt?: string; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className={`${className ?? ""} flex items-center justify-center bg-muted`}>
        <PlayCircle className="w-1/4 h-1/4 min-w-4 min-h-4 text-muted-foreground" />
      </div>
    );
  }

  return <img src={src} alt={alt ?? ""} className={className} onError={() => setFailed(true)} />;
}
