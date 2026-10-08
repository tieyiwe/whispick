import { describe, it, expect } from "vitest";
import { stripMp4Metadata, stripWebmMetadata, stripVideoMetadata, VideoMetadataError } from "../lib/stripVideoMetadata";

// --- synthetic ISO BMFF builders -------------------------------------------

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, payload]);
}

// size == 1 → 64-bit largesize follows the type.
function largeBox(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(1, 0);
  header.write(type, 4, "latin1");
  header.writeBigUInt64BE(BigInt(16 + payload.length), 8);
  return Buffer.concat([header, payload]);
}

// FullBox with creation/modification times set to recognizable values.
function timedFullBox(type: string, version: 0 | 1, rest = 20): Buffer {
  const timeBytes = version === 1 ? 8 : 4;
  const payload = Buffer.alloc(4 + 2 * timeBytes + rest, 0x11);
  payload[0] = version;
  payload.fill(0, 1, 4); // flags
  if (version === 1) {
    payload.writeBigUInt64BE(0xdeadbeefn, 4);
    payload.writeBigUInt64BE(0xcafebaben, 12);
  } else {
    payload.writeUInt32BE(0xdeadbeef, 4);
    payload.writeUInt32BE(0xcafebabe, 8);
  }
  return box(type, payload);
}

const GPS = Buffer.from("+37.7749-122.4194/", "latin1");
const MDAT_PAYLOAD = Buffer.from("this-is-sample-data-that-must-not-change-+37.7749", "latin1");

function buildMp4() {
  const ftyp = box("ftyp", Buffer.from("isom\0\0\0\0isommp42", "latin1"));
  const mvhd = timedFullBox("mvhd", 0, 80);
  const udta = box("udta", box("©xyz", GPS));
  const tkhd = timedFullBox("tkhd", 1, 60);
  const mdhd = timedFullBox("mdhd", 0, 4);
  const mdia = box("mdia", mdhd);
  const trakMeta = box("meta", Buffer.concat([Buffer.alloc(4), box("keys", Buffer.from("com.apple.quicktime.location.ISO6709", "latin1"))]));
  const trak = box("trak", Buffer.concat([tkhd, mdia, trakMeta]));
  const moov = box("moov", Buffer.concat([mvhd, udta, trak]));
  const xmpUuid = box("uuid", Buffer.concat([Buffer.from("be7acfcb97a942e89c71999491e3afac", "hex"), Buffer.from("<x:xmpmeta GPS/>", "latin1")]));
  const mdat = largeBox("mdat", MDAT_PAYLOAD);
  const file = Buffer.concat([ftyp, moov, xmpUuid, mdat]);

  const moovOffset = ftyp.length;
  const mvhdOffset = moovOffset + 8;
  const udtaOffset = mvhdOffset + mvhd.length;
  const trakOffset = udtaOffset + udta.length;
  const tkhdOffset = trakOffset + 8;
  const mdhdOffset = tkhdOffset + tkhd.length + 8;
  const trakMetaOffset = tkhdOffset + tkhd.length + mdia.length;
  const uuidOffset = moovOffset + moov.length;
  const mdatOffset = uuidOffset + xmpUuid.length;
  return {
    file,
    offsets: { mvhdOffset, udtaOffset, udtaLength: udta.length, tkhdOffset, mdhdOffset, trakMetaOffset, trakMetaLength: trakMeta.length, uuidOffset, uuidLength: xmpUuid.length, mdatOffset, mdatLength: mdat.length },
  };
}

function typeAt(buf: Buffer, offset: number): string {
  return buf.toString("latin1", offset + 4, offset + 8);
}

describe("stripMp4Metadata", () => {
  it("retypes udta/meta/uuid to free, zeroes their payloads, and keeps every size and offset", () => {
    const { file, offsets: o } = buildMp4();
    const original = Buffer.from(file);
    const out = stripMp4Metadata(file);

    expect(out.length).toBe(file.length);
    expect(file.equals(original)).toBe(true); // input never mutated

    for (const [offset, length] of [
      [o.udtaOffset, o.udtaLength],
      [o.trakMetaOffset, o.trakMetaLength],
      [o.uuidOffset, o.uuidLength],
    ]) {
      expect(typeAt(out, offset)).toBe("free");
      expect(out.readUInt32BE(offset)).toBe(length); // size untouched
      expect(out.subarray(offset + 8, offset + length).every((b) => b === 0)).toBe(true);
    }

    // No trace of the location strings anywhere outside mdat.
    const outsideMdat = out.subarray(0, o.mdatOffset).toString("latin1");
    expect(outsideMdat).not.toContain("+37.7749");
    expect(outsideMdat).not.toContain("ISO6709");
    expect(outsideMdat).not.toContain("xmpmeta");
  });

  it("leaves mdat (the actual media) byte-for-byte unchanged", () => {
    const { file, offsets: o } = buildMp4();
    const out = stripMp4Metadata(file);
    expect(out.subarray(o.mdatOffset, o.mdatOffset + o.mdatLength).equals(file.subarray(o.mdatOffset, o.mdatOffset + o.mdatLength))).toBe(true);
  });

  it("zeroes creation/modification times in mvhd (v0), tkhd (v1) and mdhd (v0) and nothing after them", () => {
    const { file, offsets: o } = buildMp4();
    const out = stripMp4Metadata(file);

    expect(out.readUInt32BE(o.mvhdOffset + 12)).toBe(0);
    expect(out.readUInt32BE(o.mvhdOffset + 16)).toBe(0);
    expect(out[o.mvhdOffset + 20]).toBe(0x11); // timescale etc. untouched

    expect(out.readBigUInt64BE(o.tkhdOffset + 12)).toBe(0n);
    expect(out.readBigUInt64BE(o.tkhdOffset + 20)).toBe(0n);
    expect(out[o.tkhdOffset + 28]).toBe(0x11);

    expect(out.readUInt32BE(o.mdhdOffset + 12)).toBe(0);
    expect(out.readUInt32BE(o.mdhdOffset + 16)).toBe(0);
  });

  it("accepts a size-0 (to end of file) final box", () => {
    const ftyp = box("ftyp", Buffer.from("isom\0\0\0\0", "latin1"));
    const moov = box("moov", timedFullBox("mvhd", 0, 80));
    const mdat = box("mdat", MDAT_PAYLOAD);
    mdat.writeUInt32BE(0, 0);
    const out = stripMp4Metadata(Buffer.concat([ftyp, moov, mdat]));
    expect(out.length).toBe(ftyp.length + moov.length + mdat.length);
  });

  it("rejects malformed input instead of passing it through", () => {
    const { file } = buildMp4();
    const ftyp = box("ftyp", Buffer.from("isom\0\0\0\0", "latin1"));

    // Not ISO BMFF at all.
    expect(() => stripMp4Metadata(Buffer.from("definitely not a video"))).toThrow(VideoMetadataError);
    // A box claiming more bytes than the file has.
    expect(() => stripMp4Metadata(file.subarray(0, file.length - 10))).toThrow(VideoMetadataError);
    // A box size smaller than its own header.
    const tiny = box("moov", Buffer.alloc(0));
    tiny.writeUInt32BE(4, 0);
    expect(() => stripMp4Metadata(Buffer.concat([ftyp, tiny]))).toThrow(VideoMetadataError);
    // A child overrunning its parent.
    const overrun = box("moov", box("trak", Buffer.alloc(8)));
    overrun.writeUInt32BE(64, 8);
    expect(() => stripMp4Metadata(Buffer.concat([ftyp, overrun]))).toThrow(VideoMetadataError);
    // No moov — we don't understand it, so we don't vouch for it.
    expect(() => stripMp4Metadata(Buffer.concat([ftyp, box("mdat", MDAT_PAYLOAD)]))).toThrow(VideoMetadataError);
    // Truncated mvhd.
    expect(() => stripMp4Metadata(Buffer.concat([ftyp, box("moov", box("mvhd", Buffer.alloc(6)))]))).toThrow(VideoMetadataError);
  });

  it("zeroes a non-box vendor trailer after a complete file instead of rejecting it", () => {
    const { file } = buildMp4();
    const trailer = Buffer.from("SEFH....+37.7749-122.4194....SEFT", "latin1");
    const out = stripMp4Metadata(Buffer.concat([file, trailer]));
    expect(out.length).toBe(file.length + trailer.length);
    expect(out.subarray(file.length).every((b) => b === 0)).toBe(true);
  });

  it("neutralizes unknown top-level vendor boxes (players skip them anyway)", () => {
    const { file } = buildMp4();
    const vendor = box("sefd", Buffer.from("+37.7749-122.4194", "latin1"));
    const out = stripMp4Metadata(Buffer.concat([file, vendor]));
    expect(typeAt(out, file.length)).toBe("free");
    expect(out.subarray(file.length + 8).every((b) => b === 0)).toBe(true);
  });

  it("guards against absurd nesting depth", () => {
    let inner = box("mvhd", Buffer.alloc(30));
    for (let i = 0; i < 40; i++) inner = box("trak", inner);
    const ftyp = box("ftyp", Buffer.from("isom\0\0\0\0", "latin1"));
    expect(() => stripMp4Metadata(Buffer.concat([ftyp, box("moov", inner)]))).toThrow(VideoMetadataError);
  });
});

// --- synthetic EBML builders -----------------------------------------------

function ebml(idHex: string, payload: Buffer): Buffer {
  if (payload.length >= 127) throw new Error("test helper only does 1-byte sizes");
  return Buffer.concat([Buffer.from(idHex, "hex"), Buffer.from([0x80 | payload.length]), payload]);
}
const UNKNOWN_SIZE = Buffer.from("01ffffffffffffff", "hex");

function buildWebm() {
  const header = ebml("1a45dfa3", ebml("4282", Buffer.from("webm")));
  const dateUtc = ebml("4461", Buffer.from("0102030405060708", "hex"));
  const info = ebml("1549a966", Buffer.concat([ebml("2ad7b1", Buffer.from([0x0f, 0x42, 0x40])), dateUtc, ebml("4d80", Buffer.from("Chrome"))]));
  const tracks = ebml("1654ae6b", ebml("ae", ebml("d7", Buffer.from([1]))));
  const block = ebml("a3", Buffer.from("frame-bytes-unchanged"));
  const cluster = Buffer.concat([Buffer.from("1f43b675", "hex"), UNKNOWN_SIZE, ebml("e7", Buffer.from([0])), block]);
  const tags = ebml("1254c367", ebml("7373", ebml("67c8", ebml("45a3", Buffer.from("LOCATION +37.7749-122.4194")))));
  const segmentBody = Buffer.concat([info, tracks, cluster, tags]);
  const segment = Buffer.concat([Buffer.from("18538067", "hex"), UNKNOWN_SIZE, segmentBody]);
  const file = Buffer.concat([header, segment]);
  const segmentDataStart = header.length + 4 + 8;
  const infoStart = segmentDataStart;
  const dateStart = infoStart + 4 + 1 + 7; // info id+size, then the 7-byte TimecodeScale element
  const clusterStart = segmentDataStart + info.length + tracks.length;
  const blockStart = clusterStart + 12 + 3; // cluster id+unknown size, then the 3-byte Timestamp
  const tagsStart = clusterStart + cluster.length;
  return { file, dateStart, dateLength: dateUtc.length, blockStart, blockLength: block.length, tagsStart, tagsLength: tags.length };
}

describe("stripWebmMetadata", () => {
  it("voids Tags and Info/DateUTC in place, walking past an unknown-size Cluster", () => {
    const w = buildWebm();
    const out = stripWebmMetadata(w.file);
    expect(out.length).toBe(w.file.length);

    expect(out[w.tagsStart]).toBe(0xec);
    expect(out.toString("latin1")).not.toContain("LOCATION");
    expect(out[w.dateStart]).toBe(0xec);
    expect(out.subarray(w.dateStart, w.dateStart + w.dateLength).toString("hex")).not.toContain("0102030405060708");

    // Media untouched; and the voided file still parses.
    expect(out.subarray(w.blockStart, w.blockStart + w.blockLength).equals(w.file.subarray(w.blockStart, w.blockStart + w.blockLength))).toBe(true);
    expect(stripWebmMetadata(out).equals(out)).toBe(true);
  });

  it("rejects input that isn't parseable EBML", () => {
    expect(() => stripWebmMetadata(Buffer.from("not webm at all"))).toThrow(VideoMetadataError);
    const w = buildWebm();
    // Cut mid-element: the Tags element now overruns the file.
    expect(() => stripWebmMetadata(w.file.subarray(0, w.file.length - 3))).toThrow(VideoMetadataError);
  });
});

describe("stripVideoMetadata", () => {
  it("dispatches on the upload's mimetype and refuses anything else", () => {
    const { file } = buildMp4();
    expect(typeAt(stripVideoMetadata(file, "video/quicktime"), buildMp4().offsets.udtaOffset)).toBe("free");
    expect(() => stripVideoMetadata(file, "video/x-msvideo")).toThrow(VideoMetadataError);
  });
});
