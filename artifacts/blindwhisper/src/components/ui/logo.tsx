import { SVGProps } from "react";

/**
 * The Blind Whisper mark: an ear, with sound arriving as three arcs that fade
 * as they widen.
 *
 * Drawn in `currentColor` rather than the artwork's literal purples so a call
 * site can tint it (`text-primary`) and so it stays legible on the light legal
 * and admin pages as well as the dark app. The arcs keep their relative
 * opacities, which is what produces the fade — that reads the same tinted as
 * it does in the original two-purple version.
 *
 * Stroke weights are heavier than the source artwork. The artwork's 3/2.5/2/1.5
 * scale to well under a device pixel at the sizes this actually renders at
 * (a 24px header mark is a 0.18 scale factor), which left the arcs invisible
 * and the ear a faint smudge. These weights hold from ~24px up without going
 * chunky at hero sizes.
 *
 * No width/height attributes on purpose: with only a viewBox, `h-10 w-auto`
 * lets height drive the size and width follow the mark's natural 0.81 ratio,
 * instead of a square box leaving dead space beside a mark that is taller
 * than it is wide.
 */
export function Logo({
  waveOnce = false,
  ...props
}: SVGProps<SVGSVGElement> & {
  /** Plays the arc pulse through a single cycle instead of looping forever —
   *  see .logo-wave-once in index.css. For a one-off moment (a send
   *  confirmation) rather than the ambient loop every other use of the mark
   *  wants. */
  waveOnce?: boolean;
}) {
  const waveClassName = waveOnce ? "logo-wave-once" : "logo-wave";
  return (
    <svg viewBox="88 74 112 138" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* Ear outline */}
        <path
          d="M118,80 C145,80 158,105 154,130 C151,150 135,155 128,170 C122,183 130,196 122,204 C114,210 104,202 106,190 C108,180 98,178 95,165 C90,145 96,120 108,100 C111,93 113,86 118,80 Z"
          strokeWidth="5"
        />
        {/* Inner curl */}
        <path d="M112,140 Q124,142 122,158" strokeWidth="4" />
        {/* Sound arriving, fading as it widens. Each arc brightens in turn,
            nearest first, so the pulse travels outward instead of blinking
            all three together — and each peaks in its own colour, violet to
            aqua to gold, so the ripple shifts hue as it goes rather than only
            getting brighter. The two non-violet peaks are the palette's
            complements to it (see --aqua and --gilded in index.css).

            The opacity and strokeWidth attributes are the resting values the
            animation returns to, and the whole appearance when it's switched
            off for reduced motion. */}
        <path
          d="M155,150 A22,22 0 0,1 155,180"
          strokeWidth="4"
          opacity="0.8"
          className={waveClassName}
          style={
            {
              "--wave-base": 0.8,
              "--wave-peak": 1,
              "--wave-weight": 4,
              "--wave-weight-peak": 4.8,
              "--wave-color": "hsl(var(--primary))",
              "--wave-delay": "0s",
            } as React.CSSProperties
          }
        />
        <path
          d="M167,138 A38,38 0 0,1 167,192"
          strokeWidth="3.5"
          opacity="0.5"
          className={waveClassName}
          style={
            {
              "--wave-base": 0.5,
              "--wave-peak": 0.95,
              "--wave-weight": 3.5,
              "--wave-weight-peak": 4.3,
              "--wave-color": "hsl(var(--aqua))",
              "--wave-delay": "0.15s",
            } as React.CSSProperties
          }
        />
        <path
          d="M179,126 A54,54 0 0,1 179,204"
          strokeWidth="3"
          opacity="0.28"
          className={waveClassName}
          style={
            {
              "--wave-base": 0.28,
              "--wave-peak": 0.9,
              "--wave-weight": 3,
              "--wave-weight-peak": 3.8,
              "--wave-color": "hsl(var(--gilded))",
              "--wave-delay": "0.3s",
            } as React.CSSProperties
          }
        />
      </g>
    </svg>
  );
}

const LOCKUP_SIZES = {
  sm: { mark: "h-8 w-auto", title: "text-lg", tagline: "text-[10px]" },
  md: { mark: "h-9 w-auto sm:h-10", title: "text-xl sm:text-2xl", tagline: "text-[11px]" },
  lg: { mark: "h-11 w-auto sm:h-14", title: "text-2xl sm:text-3xl", tagline: "text-xs" },
} as const;

/**
 * Mark plus wordmark, which is what "the logo" means everywhere it's used.
 *
 * This existed as the same four lines of markup copied into eleven files, each
 * free to drift on size, gap and font weight — and several had, which is why
 * the mark was three different sizes across pages that sit next to each other
 * in the same flow.
 *
 * The wordmark is real text rather than the artwork's <text> elements: it uses
 * the app's own Playfair Display and Inter (the same faces the artwork asks
 * for), so it stays selectable, readable to a screen reader, scales with the
 * user's font size, and follows the theme instead of being baked to one fill.
 */
export function LogoLockup({
  size = "md",
  tagline = false,
  className = "",
}: {
  size?: keyof typeof LOCKUP_SIZES;
  /** The strapline under the wordmark. Off by default — it needs horizontal
   *  room, so it belongs on landing and first-impression pages, not in a
   *  cramped app header. */
  tagline?: boolean;
  className?: string;
}) {
  const s = LOCKUP_SIZES[size];
  return (
    <div className={`flex items-center gap-2.5 min-w-0 ${className}`}>
      <Logo className={`${s.mark} shrink-0 text-primary`} />
      <div className="min-w-0">
        <span className={`block font-serif font-bold tracking-tight text-foreground truncate ${s.title}`}>
          Blind Whisper
        </span>
        {tagline && (
          <span className={`block text-muted-foreground truncate ${s.tagline}`}>
            Say it without saying it was you
          </span>
        )}
      </div>
    </div>
  );
}
