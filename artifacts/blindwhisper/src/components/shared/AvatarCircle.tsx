import { cn } from "@/lib/utils";
import { avatarIcon, avatarBgClass, isKnownAvatarId } from "@/lib/avatars";

const SIZES = {
  sm: { circle: "w-6 h-6", icon: "w-3.5 h-3.5", text: "text-[10px]" },
  md: { circle: "w-9 h-9", icon: "w-5 h-5", text: "text-sm" },
  lg: { circle: "w-16 h-16", icon: "w-8 h-8", text: "text-2xl" },
} as const;

// A small filled dot pinned to the bottom-right corner of the avatar circle
// — the "online in Debate Now" indicator, same absolute-overlay + background
// ring shape as NotificationBell's unread dot, sized down to fit an avatar
// corner instead of a bell icon. Only ever rendered when the caller has
// already confirmed presence for this handle (see GET /follows/online-status)
// — never a gray "offline" state, since absence from that response means
// "not applicable to check," not "confirmed offline."
function OnlineDot({ label }: { label?: string }) {
  return (
    <span
      className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background"
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-testid="badge-online"
    />
  );
}

// Debate Topics' X/Twitter-style identity circle — a preset icon-on-color
// avatar when avatarId is a known preset, otherwise the handle's first
// letter. null avatarId is a real, explicit "no avatar" choice, so this
// never tries to fetch or render an uploaded photo — there isn't one.
export function AvatarCircle({
  avatarId,
  handle,
  size = "md",
  className,
  online = false,
  onlineLabel,
}: {
  avatarId: string | null | undefined;
  handle: string;
  size?: keyof typeof SIZES;
  className?: string;
  /** Whether the account behind this handle is currently online (Debate Now
   * follow relationships only — see GET /follows/online-status). Defaults to
   * false, which renders no dot at all rather than an "offline" one. */
  online?: boolean;
  /** Accessible label for the online dot; omit to leave it decorative
   * (aria-hidden) when the caller has no translated string handy. */
  onlineLabel?: string;
}) {
  const sizing = SIZES[size];

  if (isKnownAvatarId(avatarId)) {
    const Icon = avatarIcon(avatarId);
    return (
      <div className={cn("relative shrink-0", className)}>
        <div
          className={cn(
            "rounded-full flex items-center justify-center text-white",
            sizing.circle,
            avatarBgClass(avatarId),
          )}
        >
          <Icon className={sizing.icon} strokeWidth={2.25} />
        </div>
        {online && <OnlineDot label={onlineLabel} />}
      </div>
    );
  }

  return (
    <div className={cn("relative shrink-0", className)}>
      <div
        className={cn(
          "rounded-full flex items-center justify-center bg-muted text-muted-foreground font-serif font-bold",
          sizing.circle,
          sizing.text,
        )}
      >
        {handle.charAt(0).toUpperCase() || "?"}
      </div>
      {online && <OnlineDot label={onlineLabel} />}
    </div>
  );
}
