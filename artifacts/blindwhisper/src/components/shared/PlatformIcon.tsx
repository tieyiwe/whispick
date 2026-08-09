import { PlayCircle, Video } from "lucide-react";
import { SiYoutube, SiTiktok, SiInstagram, SiFacebook } from "react-icons/si";

export function PlatformIcon({ platform, className }: { platform?: string | null; className?: string }) {
  const cls = className ?? "w-5 h-5";
  switch (platform) {
    case "youtube": return <SiYoutube className={cls} style={{ color: "#FF0000" }} />;
    case "tiktok": return <SiTiktok className={cls} />;
    case "instagram": return <SiInstagram className={cls} style={{ color: "#E1306C" }} />;
    case "facebook": return <SiFacebook className={cls} style={{ color: "#1877F2" }} />;
    case "upload": return <Video className={cls} style={{ color: "#7B61FF" }} />;
    default: return <PlayCircle className={cls} />;
  }
}
