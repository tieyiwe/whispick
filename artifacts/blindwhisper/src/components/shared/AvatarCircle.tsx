import { cn } from "@/lib/utils";
import { avatarIcon, avatarBgClass, isKnownAvatarId } from "@/lib/avatars";

const SIZES = {
  sm: { circle: "w-6 h-6", icon: "w-3.5 h-3.5", text: "text-[10px]" },
  md: { circle: "w-9 h-9", icon: "w-5 h-5", text: "text-sm" },
  lg: { circle: "w-16 h-16", icon: "w-8 h-8", text: "text-2xl" },
} as const;

// Debate Topics' X/Twitter-style identity circle — a preset icon-on-color
// avatar when avatarId is a known preset, otherwise the handle's first
// letter. null avatarId is a real, explicit "no avatar" choice, so this
// never tries to fetch or render an uploaded photo — there isn't one.
export function AvatarCircle({
  avatarId,
  handle,
  size = "md",
  className,
}: {
  avatarId: string | null | undefined;
  handle: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const sizing = SIZES[size];

  if (isKnownAvatarId(avatarId)) {
    const Icon = avatarIcon(avatarId);
    return (
      <div
        className={cn(
          "shrink-0 rounded-full flex items-center justify-center text-white",
          sizing.circle,
          avatarBgClass(avatarId),
          className,
        )}
      >
        <Icon className={sizing.icon} strokeWidth={2.25} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "shrink-0 rounded-full flex items-center justify-center bg-muted text-muted-foreground font-serif font-bold",
        sizing.circle,
        sizing.text,
        className,
      )}
    >
      {handle.charAt(0).toUpperCase() || "?"}
    </div>
  );
}
