import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";

const SIZES = {
  sm: { circle: "w-6 h-6", mark: "h-3 w-auto" },
  md: { circle: "w-9 h-9", mark: "h-4.5 w-auto" },
  lg: { circle: "w-16 h-16", mark: "h-8 w-auto" },
} as const;

/**
 * The identity glyph for a message/post that's genuinely anonymous — a
 * Whisper Link, a Text Whisp, a Whisper Box message, a Blind Circle DM.
 * Uses the app's own ear/sound-wave mark (see components/ui/logo.tsx)
 * instead of a generic mask or incognito icon: every messaging app reaches
 * for the same masquerade-mask glyph for "anonymous," which means none of
 * them own it. This app already has a specific, literal visual for "someone
 * whispered" — reusing it here as the sender's "avatar" turns every
 * anonymous message into a small piece of brand recognition instead of a
 * borrowed symbol, and ties the sender's facelessness directly back to the
 * product's own name rather than a generic privacy signifier.
 *
 * NOT the same thing as a chosen, persistent pseudonym (Debate Now's
 * whispererHandle + avatar, AvatarCircle's preset icons) — those are a
 * stage name someone picked and kept, this is true no-identity-at-all. Only
 * use this where the sender is unknowable, never as a stand-in for "no
 * photo set" on an identified/pseudonymous account.
 */
export function AnonymousMark({
  size = "md",
  className,
  pulse = false,
}: {
  size?: keyof typeof SIZES;
  className?: string;
  /** Plays the mark's ambient wave loop (see .logo-wave in index.css)
   *  instead of resting static — reserve this for a single focal moment
   *  (a reveal page's hero, an empty-state illustration), never a list of
   *  many messages at once, where a dozen looping marks would read as
   *  visual noise instead of a considered detail. */
  pulse?: boolean;
}) {
  const sizing = SIZES[size];
  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center shrink-0 bg-primary/10 text-primary",
        sizing.circle,
        className,
      )}
    >
      <Logo className={sizing.mark} animated={pulse} />
    </div>
  );
}
