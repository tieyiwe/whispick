import QRCode from "qrcode";

/**
 * Client-side generator for the Whisper Box "Share to Story" card: a
 * vertical (1080x1920, Instagram/Snapchat/TikTok Story aspect ratio) PNG
 * rendered off-screen with the raw Canvas 2D API — no rendering library, no
 * new dependency (`qrcode` is already a real dependency, used for the 2FA
 * QR in AdminRoute.tsx).
 *
 * Both call sites — SettingsPage's Whisper Box card and WhisperBoxInbox's
 * empty state — share this one implementation via `shareWhisperBoxStoryCard`
 * rather than each hand-rolling their own canvas drawing.
 */

const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;

// Mirrors the HSL custom properties in src/index.css's :root block (Midnight
// / Mist / Blind Whisper Glow / Ember / Gilded / Aqua). Duplicated as plain
// values rather than read off the DOM: this canvas is drawn off-screen and
// a fillStyle needs a concrete CSS color string anyway, so there's nothing
// to gain from a computed-style round trip.
const HSL = {
  background: [240, 33, 8] as const,
  backgroundDeep: [252, 30, 5] as const,
  foreground: [252, 38, 95] as const,
  primary: [252, 97, 67] as const, // Blind Whisper Glow
  secondary: [360, 100, 71] as const, // Ember
  gilded: [43, 73, 67] as const,
  aqua: [180, 72, 62] as const,
};

function hsl(triple: readonly [number, number, number], alpha = 1): string {
  const [h, s, l] = triple;
  return alpha >= 1 ? `hsl(${h}, ${s}%, ${l}%)` : `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
}

// Same path data as components/ui/logo.tsx's <Logo> — the ear outline, its
// inner curl, and the three sound arcs (violet, aqua, gilded, nearest-first)
// — copied rather than imported because this is Canvas Path2D data, not
// JSX, and logo.tsx's paths are the source of truth to keep these in sync
// with if the mark ever changes.
const EAR_OUTLINE_PATH =
  "M118,80 C145,80 158,105 154,130 C151,150 135,155 128,170 C122,183 130,196 122,204 C114,210 104,202 106,190 C108,180 98,178 95,165 C90,145 96,120 108,100 C111,93 113,86 118,80 Z";
const EAR_CURL_PATH = "M112,140 Q124,142 122,158";
const ARCS: Array<{ d: string; width: number; color: readonly [number, number, number]; alpha: number }> = [
  { d: "M155,150 A22,22 0 0,1 155,180", width: 4, color: HSL.primary, alpha: 0.8 },
  { d: "M167,138 A38,38 0 0,1 167,192", width: 3.5, color: HSL.aqua, alpha: 0.5 },
  { d: "M179,126 A54,54 0 0,1 179,204", width: 3, color: HSL.gilded, alpha: 0.28 },
];

async function ensureFontsLoaded(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  try {
    await Promise.all([
      document.fonts.load('italic 700 66px "Playfair Display"'),
      document.fonts.load('700 76px "Playfair Display"'),
      document.fonts.load('600 46px "Inter"'),
      document.fonts.load('500 30px "Inter"'),
      document.fonts.ready,
    ]);
  } catch {
    // Best-effort — if the webfonts haven't finished loading yet, the
    // canvas falls back to the platform's default serif/sans, which still
    // reads fine on a story card.
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load QR image"));
    img.src = src;
  });
}

/** Word-wraps `text` to `maxWidth` under `ctx`'s current font. Falls back to
 *  breaking a single run character-by-character (CJK sentences, or any
 *  other script with no whitespace to split on) so a long unbroken run
 *  never just overflows the canvas silently. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  const tokens = text.split(/(\s+)/).filter(Boolean);

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      if (current && ctx.measureText(`${current} `).width <= maxWidth) current += " ";
      continue;
    }
    let word = token;
    while (word) {
      const attempt = current ? `${current}${word}` : word;
      if (ctx.measureText(attempt).width <= maxWidth) {
        current = attempt;
        word = "";
      } else if (!current) {
        let i = 1;
        while (i < word.length && ctx.measureText(word.slice(0, i + 1)).width <= maxWidth) i++;
        lines.push(word.slice(0, i));
        word = word.slice(i);
      } else {
        lines.push(current.trimEnd());
        current = "";
      }
    }
  }
  if (current) lines.push(current.trimEnd());
  return lines;
}

function drawBackground(ctx: CanvasRenderingContext2D): void {
  const backdrop = ctx.createLinearGradient(0, 0, STORY_WIDTH, STORY_HEIGHT);
  backdrop.addColorStop(0, hsl([247, 24, 15]));
  backdrop.addColorStop(1, hsl(HSL.backgroundDeep));
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);

  const glow = (x: number, y: number, radius: number, color: readonly [number, number, number], alpha: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, hsl(color, alpha));
    g.addColorStop(1, hsl(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
  };
  // Same two soft corner blooms RecapPage's card uses (primary top-left,
  // secondary bottom-right), just re-expressed as radial gradients since
  // canvas has no CSS blur filter to lean on cross-browser.
  glow(STORY_WIDTH * 0.12, STORY_HEIGHT * 0.16, 640, HSL.primary, 0.35);
  glow(STORY_WIDTH * 0.9, STORY_HEIGHT * 0.86, 700, HSL.secondary, 0.28);
}

function drawLogoLockup(ctx: CanvasRenderingContext2D): void {
  const markHeight = 210;
  const scale = markHeight / 138;
  const markWidth = 112 * scale;
  const originX = STORY_WIDTH / 2 - markWidth / 2 - 88 * scale;
  const originY = 176 - 74 * scale;

  ctx.save();
  ctx.translate(originX, originY);
  ctx.scale(scale, scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.strokeStyle = hsl(HSL.primary);
  ctx.lineWidth = 5;
  ctx.stroke(new Path2D(EAR_OUTLINE_PATH));
  ctx.lineWidth = 4;
  ctx.stroke(new Path2D(EAR_CURL_PATH));

  for (const arc of ARCS) {
    ctx.globalAlpha = arc.alpha;
    ctx.lineWidth = arc.width;
    ctx.strokeStyle = hsl(arc.color);
    ctx.stroke(new Path2D(arc.d));
  }
  ctx.restore();

  ctx.save();
  ctx.direction = "ltr";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = hsl(HSL.foreground);
  ctx.font = '700 76px "Playfair Display", Georgia, serif';
  ctx.fillText("Blind Whisper", STORY_WIDTH / 2, 176 + markHeight + 62);
  ctx.restore();
}

function drawHandleBadge(ctx: CanvasRenderingContext2D, handle: string): number {
  const y = 508;
  const text = `@${handle}`;
  ctx.save();
  ctx.direction = "ltr";
  ctx.font = '600 46px "Inter", sans-serif';
  const textWidth = ctx.measureText(text).width;
  const paddingX = 44;
  const h = 90;
  const w = textWidth + paddingX * 2;
  const x = STORY_WIDTH / 2 - w / 2;

  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = hsl(HSL.secondary, 0.16);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = hsl(HSL.secondary, 0.55);
  ctx.stroke();

  ctx.fillStyle = hsl(HSL.secondary);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, STORY_WIDTH / 2, y + h / 2 + 3);
  ctx.restore();
  return y + h;
}

function drawPrompt(ctx: CanvasRenderingContext2D, text: string, dir: "ltr" | "rtl", startY: number): void {
  ctx.save();
  ctx.direction = dir;
  ctx.font = 'italic 700 66px "Playfair Display", Georgia, serif';
  ctx.fillStyle = hsl(HSL.foreground);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const maxWidth = STORY_WIDTH - 180;
  const lineHeight = 84;
  const lines = wrapText(ctx, text, maxWidth).slice(0, 3);
  let y = startY;
  for (const line of lines) {
    ctx.fillText(line, STORY_WIDTH / 2, y);
    y += lineHeight;
  }
  ctx.restore();
}

async function drawLinkPanel(ctx: CanvasRenderingContext2D, url: string): Promise<void> {
  const panelX = 90;
  const panelY = 1000;
  const panelW = STORY_WIDTH - panelX * 2;
  const panelH = 560;

  ctx.save();
  roundRect(ctx, panelX, panelY, panelW, panelH, 48);
  ctx.fillStyle = hsl(HSL.foreground, 0.98);
  ctx.shadowColor = hsl(HSL.background, 0.4);
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 20;
  ctx.fill();
  ctx.restore();

  const qrSize = 300;
  const qrX = STORY_WIDTH / 2 - qrSize / 2;
  const qrY = panelY + 54;
  try {
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: qrSize,
      margin: 1,
      color: { dark: "#171233", light: "#FFFFFFFF" },
    });
    const qrImage = await loadImage(qrDataUrl);
    ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
  } catch {
    // QR generation is a nicety, not the point — the URL text below still
    // carries the link on its own if this fails for any reason.
  }

  const displayUrl = url.replace(/^https?:\/\//, "");
  const maxTextWidth = panelW - 100;
  ctx.save();
  ctx.direction = "ltr";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = hsl(HSL.backgroundDeep);

  let fontSize = 42;
  let lines: string[] = [];
  do {
    ctx.font = `600 ${fontSize}px "Inter", sans-serif`;
    lines = wrapText(ctx, displayUrl, maxTextWidth);
    if (lines.length <= 2) break;
    fontSize -= 2;
  } while (fontSize > 22);

  const lineHeight = fontSize + 14;
  let textY = qrY + qrSize + 68;
  for (const line of lines) {
    ctx.fillText(line, STORY_WIDTH / 2, textY);
    textY += lineHeight;
  }
  ctx.restore();
}

function drawFooter(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.direction = "ltr";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = '500 30px "Inter", sans-serif';
  // Same untranslated brand tagline components/ui/logo.tsx's LogoLockup
  // hardcodes in English, kept consistent with it here.
  ctx.fillStyle = hsl(HSL.foreground, 0.55);
  ctx.fillText("Say it without saying it was you", STORY_WIDTH / 2, 1848);
  ctx.restore();
}

export interface WhisperBoxStoryCardOptions {
  /** The user's whispererHandle, without the leading "@". */
  handle: string;
  /** Full absolute Whisper Box URL, e.g. `${origin}/whisper-box/${handle}`. */
  url: string;
  /** Already-translated call-to-action line, e.g. "Send me an anonymous Whisper 👀". */
  promptText: string;
  /** Paragraph direction for `promptText` — pass i18n.dir() for correct RTL layout under Arabic. */
  dir?: "ltr" | "rtl";
}

/** Renders the branded Story card to an off-screen canvas (never attached
 *  to the DOM) and returns it. Exported on its own — separate from the
 *  Blob/File conversion below — so callers (and tests) that just want the
 *  pixels don't have to go through toBlob(). */
export async function renderWhisperBoxStoryCardCanvas(options: WhisperBoxStoryCardOptions): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  await ensureFontsLoaded();

  drawBackground(ctx);
  drawLogoLockup(ctx);
  const afterBadge = drawHandleBadge(ctx, options.handle);
  drawPrompt(ctx, options.promptText, options.dir ?? "ltr", afterBadge + 108);
  await drawLinkPanel(ctx, options.url);
  drawFooter(ctx);

  return canvas;
}

async function whisperBoxStoryCardToFile(options: WhisperBoxStoryCardOptions): Promise<File | null> {
  const canvas = await renderWhisperBoxStoryCardCanvas(options);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  return new File([blob], "whisper-box-story.png", { type: "image/png" });
}

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Delay the revoke so Safari/Firefox have a moment to actually start the
  // download before the blob URL backing it disappears.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export type ShareWhisperBoxStoryResult = "shared-image" | "shared-link" | "downloaded" | "unsupported" | "cancelled";

/**
 * Generates the card and shares it, in this order of preference:
 * 1. Web Share API with the PNG attached as a file (`navigator.canShare`) —
 *    the only path that lands the card directly in the native share sheet
 *    where Instagram/Snapchat/TikTok appear as targets.
 * 2. Plain Web Share API with just the link, if file-sharing specifically
 *    isn't supported but sharing is.
 * 3. A browser download of the PNG — the desktop fallback, so a user can
 *    still save the image and post it manually. The existing copy-link
 *    button stays right next to this one for that same desktop case.
 *
 * Matches the fire-and-forget `.catch(() => {})` convention the existing
 * plain-link share buttons (SettingsPage, RecapPage) already use for
 * `navigator.share` — a user cancelling the native share sheet rejects that
 * promise and isn't an error worth surfacing.
 *
 * The card image itself can never be a real hyperlink — it's a flat PNG,
 * pixels aren't interactive, and the QR code only works for someone with a
 * camera pointed at it, not a tap. So the file-share call below also passes
 * `url` (Web Share API level 2 allows `files` and `url` together) and folds
 * the same URL into `text` as a plain string. Neither is guaranteed by every
 * destination app, but both are real, commonly-honored paths: Instagram's
 * "Add to Your Story" sheet can pick up a shared `url` and attach it as a
 * tappable link sticker automatically, and most other targets (Snapchat,
 * TikTok, WhatsApp, iMessage) auto-linkify a bare URL that appears in shared
 * text. This is the actual mechanism, not a cosmetic tweak — leaving `url`
 * off the file-share call (the bug this fixes) meant the only path back to
 * the Whisper Box page was a manual QR scan.
 */
export async function shareWhisperBoxStoryCard(
  options: WhisperBoxStoryCardOptions & { shareTitle: string; shareText: string },
): Promise<ShareWhisperBoxStoryResult> {
  const file = await whisperBoxStoryCardToFile(options);
  const textWithLink = `${options.shareText}\n${options.url}`;

  // The share promise is now AWAITED, not fire-and-forget: cancelling the
  // native share sheet rejects with an AbortError, and swallowing that (the
  // old `.catch(() => {})`) meant the caller showed a "Shared to your story!"
  // toast even when the user backed out without sharing anything. Awaiting
  // lets us tell the three outcomes apart — shared, cancelled, or a real
  // failure — and report each honestly. A genuine share error (not a cancel)
  // still propagates so the caller's catch can surface it.
  if (file && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: options.shareTitle, text: textWithLink, url: options.url });
    } catch (err) {
      if (isShareCancel(err)) return "cancelled";
      throw err;
    }
    // `url` riding alongside `files` in the share call above is the documented
    // path to a tappable Instagram Story link sticker, but it's the
    // destination app's call whether to honor it, not something this page can
    // verify. Also having the link sitting on the clipboard means it's one
    // paste away regardless, rather than the QR code being the only fallback
    // if a given target ignores `url`.
    navigator.clipboard?.writeText(options.url).catch(() => {});
    return "shared-image";
  }
  if (navigator.share) {
    try {
      await navigator.share({ title: options.shareTitle, text: options.shareText, url: options.url });
    } catch (err) {
      if (isShareCancel(err)) return "cancelled";
      throw err;
    }
    return "shared-link";
  }
  if (file) {
    downloadFile(file);
    return "downloaded";
  }
  return "unsupported";
}

// A user dismissing the OS share sheet rejects navigator.share with an
// AbortError (name "AbortError", or a NotAllowedError in a few older engines)
// — that's a normal cancel, not a failure worth a red error toast. Any other
// rejection is a real problem and should surface.
function isShareCancel(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "AbortError" || err.name === "NotAllowedError");
}
