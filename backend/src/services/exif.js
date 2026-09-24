/**
 * Dependency-free metadata stripping for JPEG / PNG / WebP.
 * Removes EXIF (incl. GPS), XMP, IPTC and text comments by rewriting the
 * container without those segments/chunks. Pixel data is untouched.
 */
import { detectImageType } from "../middleware/upload.js";

const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]); // APP1 (EXIF/XMP), APP13 (IPTC), COM

export function stripJpegMetadata(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("not a JPEG");
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error("corrupt JPEG marker");
    let marker = buf[i + 1];
    // fill bytes
    while (marker === 0xff) {
      i += 1;
      marker = buf[i + 1];
    }
    if (marker === 0xda || marker === 0xd9) {
      // start of scan / end of image: copy the rest verbatim
      out.push(buf.subarray(i));
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    const segEnd = i + 2 + len;
    if (!JPEG_DROP.has(marker)) out.push(buf.subarray(i, segEnd));
    i = segEnd;
  }
  return Buffer.concat(out);
}

const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

export function stripPngMetadata(buf) {
  const out = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString("ascii");
    const end = i + 12 + len;
    if (!PNG_DROP.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === "IEND") break;
  }
  return Buffer.concat(out);
}

export function stripWebpMetadata(buf) {
  const chunks = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.subarray(i, i + 4).toString("ascii");
    const size = buf.readUInt32LE(i + 4);
    const end = i + 8 + size + (size % 2);
    if (type !== "EXIF" && type !== "XMP ") {
      let chunk = Buffer.from(buf.subarray(i, end));
      if (type === "VP8X") chunk[8] = chunk[8] & ~0x0c; // clear EXIF(0x08) + XMP(0x04) flags
      chunks.push(chunk);
    }
    i = end;
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "ascii");
  return Buffer.concat([header, body]);
}

export function stripImageMetadata(buf) {
  const type = detectImageType(buf);
  if (type === "image/jpeg") return stripJpegMetadata(buf);
  if (type === "image/png") return stripPngMetadata(buf);
  if (type === "image/webp") return stripWebpMetadata(buf);
  throw new Error("Unsupported image type for metadata stripping");
}
