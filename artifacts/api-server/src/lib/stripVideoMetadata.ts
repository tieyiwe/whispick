// Removes identifying metadata (GPS, device make/model, capture time) from an
// uploaded video before it's stored — a phone recording carries the exact
// place it was shot, which, served to an anonymous recipient or a public
// Circle feed, would deanonymize the sender outright.
//
// Pure JS on purpose: no ffmpeg/native media parser ever runs on
// attacker-supplied bytes. Nothing is re-encoded or re-muxed — metadata boxes
// are neutralized IN PLACE (same length, same offsets), so chunk offsets
// (stco/co64) stay valid and the file plays exactly as before.
//
// Fails closed: anything that can't be parsed throws VideoMetadataError and
// the caller rejects the upload, rather than storing un-stripped bytes.
//
// Known limit: metadata carried as a media TRACK (e.g. GoPro's GPMF
// telemetry) lives in mdat sample data and is not touched — that's not what
// phones write; their location lives in moov/udta (Android ©xyz) or moov/meta
// (iOS com.apple.quicktime.location.ISO6709), both handled here.

export class VideoMetadataError extends Error {}

const MAX_DEPTH = 16;
const MAX_BOXES = 1_000_000;

// ---------------------------------------------------------------------------
// ISO BMFF (mp4 / mov / m4v / 3gp)
// ---------------------------------------------------------------------------

// Boxes walked into. udta/meta aren't listed: they're neutralized whole.
const MP4_CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "moof", "traf", "mvex"]);
// Everything metadata-shaped: user data (Android GPS ©xyz, Samsung smta,
// loci...), iTunes/QuickTime meta (iOS location keys), XMP, vendor uuid
// boxes (XMP in a uuid, Sony/Canon/etc. vendor blobs).
const MP4_STRIP = new Set(["udta", "meta", "XMP_", "uuid"]);
const TIMESTAMPED_FULL_BOXES = new Set(["mvhd", "tkhd", "mdhd"]);
// Top-level boxes a player actually reads. Anything else at the top level
// (vendor blobs such as Samsung's SEF data, QuickTime pnot previews, ...) is
// skipped by players, so it's neutralized too rather than trusted.
const MP4_TOP_LEVEL_KEEP = new Set(["ftyp", "styp", "moov", "mdat", "moof", "mfra", "sidx", "ssix", "free", "skip", "wide", "pdin", "emsg", "prft"]);
const FREE = Buffer.from("free", "ascii");

type WalkState = { boxes: number; sawMoov: boolean; sawMdat: boolean };

// Some phones append a non-box trailer after the last top-level box (Samsung's
// "SEF" trailer, which can carry capture metadata). Once the file's moov and
// mdat have both been seen, unparseable bytes at the top level are such a
// trailer: zero them (players never read past the boxes) rather than reject
// a real phone video. Anywhere else, malformed means reject.
function zeroTopLevelTrailer(buf: Buffer, offset: number, end: number, depth: number, state: WalkState): boolean {
  if (depth !== 0 || !state.sawMoov || !state.sawMdat) return false;
  buf.fill(0, offset, end);
  return true;
}

function walkMp4(buf: Buffer, start: number, end: number, depth: number, parent: string | null, state: WalkState): void {
  if (depth > MAX_DEPTH) throw new VideoMetadataError("Video structure is nested too deeply");
  let offset = start;
  while (offset < end) {
    if (++state.boxes > MAX_BOXES) throw new VideoMetadataError("Video has too many boxes");
    // A few trailing zero bytes (padding some muxers leave) are tolerated; a
    // partial header with real data in it is not.
    if (end - offset < 8) {
      if (buf.subarray(offset, end).every((b) => b === 0) || zeroTopLevelTrailer(buf, offset, end, depth, state)) return;
      throw new VideoMetadataError("Truncated box header");
    }
    const size32 = buf.readUInt32BE(offset);
    const type = buf.toString("latin1", offset + 4, offset + 8);
    let header = 8;
    let size: number;
    if (size32 === 1) {
      if (end - offset < 16) {
        if (zeroTopLevelTrailer(buf, offset, end, depth, state)) return;
        throw new VideoMetadataError("Truncated largesize header");
      }
      const large = buf.readBigUInt64BE(offset + 8);
      size = large > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(large);
      header = 16;
    } else if (size32 === 0) {
      size = end - offset; // extends to the end of its parent
    } else {
      size = size32;
    }
    if (size < header || offset + size > end) {
      if (zeroTopLevelTrailer(buf, offset, end, depth, state)) return;
      throw new VideoMetadataError(`Malformed ${JSON.stringify(type)} box size`);
    }
    const boxEnd = offset + size;

    if (depth === 0 && type === "moov") state.sawMoov = true;
    if (depth === 0 && type === "mdat") state.sawMdat = true;

    // uuid inside fragments can be required sample data (e.g. PIFF), so
    // only strip it outside moof/traf.
    const insideFragment = parent === "moof" || parent === "traf";
    const unknownTopLevel = depth === 0 && !MP4_TOP_LEVEL_KEEP.has(type);
    if ((MP4_STRIP.has(type) && !(type === "uuid" && insideFragment)) || unknownTopLevel) {
      // Retype to `free` and zero everything after the size fields (for a
      // uuid that includes its 16-byte usertype). Size/largesize untouched.
      FREE.copy(buf, offset + 4);
      buf.fill(0, offset + header, boxEnd);
    } else if (TIMESTAMPED_FULL_BOXES.has(type)) {
      // FullBox: version(1) flags(3), then creation_time and
      // modification_time — 32-bit each in version 0, 64-bit in version 1.
      const p = offset + header;
      const version = buf[p];
      const fieldBytes = version === 1 ? 8 : 4;
      if (boxEnd - p < 4 + 2 * fieldBytes) throw new VideoMetadataError(`Truncated ${type}`);
      buf.fill(0, p + 4, p + 4 + 2 * fieldBytes);
    } else if (MP4_CONTAINERS.has(type)) {
      walkMp4(buf, offset + header, boxEnd, depth + 1, type, state);
    }
    offset = boxEnd;
  }
}

export function stripMp4Metadata(input: Buffer): Buffer {
  if (input.length < 8 || input.toString("latin1", 4, 8) !== "ftyp") throw new VideoMetadataError("Not an MP4/QuickTime file");
  const buf = Buffer.from(input); // never mutate the caller's buffer
  const state: WalkState = { boxes: 0, sawMoov: false, sawMdat: false };
  walkMp4(buf, 0, buf.length, 0, null, state);
  // Every playable file has a moov; its absence means we didn't actually
  // understand this file, so don't vouch for it.
  if (!state.sawMoov) throw new VideoMetadataError("No moov box");
  return buf;
}

// ---------------------------------------------------------------------------
// WebM / Matroska
// ---------------------------------------------------------------------------
//
// Browser MediaRecorder output (the in-app camera) carries no location, but a
// WebM/MKV picked from disk can carry Tags (arbitrary key/values, incl.
// location/author), Attachments (cover art, arbitrary files) and Info's
// DateUTC (capture time). Each is overwritten in place with an EBML Void
// element of exactly the same length, so no offsets move.

const EBML_HEADER = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const CLUSTER = 0x1f43b675;
const INFO = 0x1549a966;
const DATE_UTC = 0x4461;
const MKV_STRIP = new Set([0x1254c367 /* Tags */, 0x1941a469 /* Attachments */]);
// Top-level (Segment children) ids — used to find where an unknown-sized
// Cluster ends, since live-recorded WebM leaves Segment/Cluster sizes unknown.
const SEGMENT_CHILDREN = new Set([
  0x114d9b74 /* SeekHead */, INFO, 0x1654ae6b /* Tracks */, CLUSTER, 0x1c53bb6b /* Cues */,
  0x1941a469 /* Attachments */, 0x1043a770 /* Chapters */, 0x1254c367 /* Tags */,
]);

type Vint = { value: number; length: number; unknown: boolean };

function readVint(buf: Buffer, offset: number, end: number, keepMarker: boolean): Vint {
  if (offset >= end) throw new VideoMetadataError("Truncated EBML");
  const first = buf[offset];
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || offset + length > end) throw new VideoMetadataError("Invalid EBML vint");
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = (first & (0xff >> length)) === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + buf[offset + i];
    if (buf[offset + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

// Overwrites [offset, offset+total) with a Void element (id 0xEC) of the
// same total length and a zeroed payload.
function writeVoid(buf: Buffer, offset: number, total: number): void {
  if (total < 2) throw new VideoMetadataError("Element too small to void");
  const sizeLen = Math.min(8, total - 1);
  const payload = total - 1 - sizeLen;
  buf.fill(0, offset, offset + total);
  buf[offset] = 0xec;
  // sizeLen-byte vint: marker bit then the value, big-endian.
  let v = payload;
  for (let i = sizeLen - 1; i >= 0; i--) {
    buf[offset + 1 + i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  buf[offset + 1] |= 0x80 >> (sizeLen - 1);
}

type Element = { id: number; dataStart: number; dataEnd: number; unknown: boolean; start: number };

function readElement(buf: Buffer, offset: number, end: number): Element {
  const id = readVint(buf, offset, end, true);
  const size = readVint(buf, offset + id.length, end, false);
  const dataStart = offset + id.length + size.length;
  if (size.unknown) return { id: id.value, dataStart, dataEnd: end, unknown: true, start: offset };
  const dataEnd = dataStart + size.value;
  if (dataEnd > end) throw new VideoMetadataError("EBML element overruns its parent");
  return { id: id.value, dataStart, dataEnd, unknown: false, start: offset };
}

function stripInfo(buf: Buffer, el: Element): void {
  let offset = el.dataStart;
  while (offset < el.dataEnd) {
    const child = readElement(buf, offset, el.dataEnd);
    if (child.unknown) throw new VideoMetadataError("Unknown-size element in Info");
    if (child.id === DATE_UTC) writeVoid(buf, child.start, child.dataEnd - child.start);
    offset = child.dataEnd;
  }
}

// Skips an unknown-size Cluster by walking its (known-size) children until a
// Segment-level id shows up. Returns the offset where the Cluster ended.
function skipUnknownCluster(buf: Buffer, offset: number, end: number): number {
  let boxes = 0;
  while (offset < end) {
    if (++boxes > MAX_BOXES) throw new VideoMetadataError("Too many EBML elements");
    const id = readVint(buf, offset, end, true);
    if (SEGMENT_CHILDREN.has(id.value)) return offset;
    const child = readElement(buf, offset, end);
    if (child.unknown) throw new VideoMetadataError("Unknown-size element in Cluster");
    offset = child.dataEnd;
  }
  return end;
}

export function stripWebmMetadata(input: Buffer): Buffer {
  const buf = Buffer.from(input);
  const end = buf.length;
  const header = readElement(buf, 0, end);
  if (header.id !== EBML_HEADER || header.unknown) throw new VideoMetadataError("Not a WebM/Matroska file");
  let offset = header.dataEnd;
  let sawSegment = false;
  let elements = 0;
  while (offset < end) {
    const segment = readElement(buf, offset, end);
    if (segment.id !== SEGMENT) {
      // Only Void/CRC junk may sit beside the Segment; anything else means we
      // don't understand the file.
      if ((segment.id !== 0xec && segment.id !== 0xbf) || segment.unknown) throw new VideoMetadataError("Unexpected top-level EBML element");
      offset = segment.dataEnd;
      continue;
    }
    sawSegment = true;
    let p = segment.dataStart;
    while (p < segment.dataEnd) {
      if (++elements > MAX_BOXES) throw new VideoMetadataError("Too many EBML elements");
      const el = readElement(buf, p, segment.dataEnd);
      if (el.unknown) {
        if (el.id !== CLUSTER) throw new VideoMetadataError("Unknown-size element in Segment");
        p = skipUnknownCluster(buf, el.dataStart, segment.dataEnd);
        continue;
      }
      if (MKV_STRIP.has(el.id)) writeVoid(buf, el.start, el.dataEnd - el.start);
      else if (el.id === INFO) stripInfo(buf, el);
      p = el.dataEnd;
    }
    offset = segment.dataEnd;
  }
  if (!sawSegment) throw new VideoMetadataError("No Segment element");
  return buf;
}

// ---------------------------------------------------------------------------

/** Strips metadata for any upload mimetype routes/media.ts accepts. */
export function stripVideoMetadata(buffer: Buffer, mimeType: string): Buffer {
  if (mimeType === "video/mp4" || mimeType === "video/quicktime") return stripMp4Metadata(buffer);
  if (mimeType === "video/webm") return stripWebmMetadata(buffer);
  throw new VideoMetadataError("Unsupported video format");
}
