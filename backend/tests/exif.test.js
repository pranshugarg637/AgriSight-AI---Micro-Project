import "./setup-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripJpegMetadata, stripPngMetadata, stripWebpMetadata, stripImageMetadata } from "../src/services/exif.js";

function seg(marker, payload) {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
}

test("JPEG: APP1 (EXIF/GPS), APP13 and COM are removed; JFIF and scan data kept", () => {
  const jfif = seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "binary"));
  const exif = seg(0xe1, Buffer.from("Exif\0\0GPSLatitude=28.61;GPSLongitude=77.20", "binary"));
  const iptc = seg(0xed, Buffer.from("Photoshop 3.0 secret", "binary"));
  const com = seg(0xfe, Buffer.from("taken at my farm", "binary"));
  const dqt = seg(0xdb, Buffer.alloc(67, 1));
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6, 0xaa, 0xbb, 0xff, 0xd9]);
  const input = Buffer.concat([Buffer.from([0xff, 0xd8]), jfif, exif, iptc, com, dqt, sos]);
  const out = stripJpegMetadata(input);
  const s = out.toString("binary");
  assert.ok(!s.includes("GPSLatitude"));
  assert.ok(!s.includes("Photoshop"));
  assert.ok(!s.includes("my farm"));
  assert.ok(s.includes("JFIF"));
  assert.ok(out.subarray(-14).equals(sos));
  assert.equal(out.length, input.length - exif.length - iptc.length - com.length);
});

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
}

test("PNG: eXIf and text chunks removed", () => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const input = Buffer.concat([
    sig,
    pngChunk("IHDR", Buffer.alloc(13)),
    pngChunk("eXIf", Buffer.from("GPS data")),
    pngChunk("tEXt", Buffer.from("Comment\0location")),
    pngChunk("IDAT", Buffer.alloc(10, 7)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const out = stripPngMetadata(input);
  const s = out.toString("binary");
  assert.ok(!s.includes("eXIf") && !s.includes("GPS data") && !s.includes("tEXt"));
  assert.ok(s.includes("IHDR") && s.includes("IDAT") && s.includes("IEND"));
});

test("WebP: EXIF/XMP chunks removed and VP8X flags cleared, RIFF size fixed", () => {
  const chunk = (type, data) => {
    const size = Buffer.alloc(4);
    size.writeUInt32LE(data.length);
    return Buffer.concat([Buffer.from(type, "ascii"), size, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x0c;
  const body = Buffer.concat([chunk("VP8X", vp8x), chunk("VP8 ", Buffer.alloc(20, 3)), chunk("EXIF", Buffer.from("GPS!")), chunk("XMP ", Buffer.from("<x/>"))]);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0);
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8);
  const out = stripWebpMetadata(Buffer.concat([header, body]));
  assert.ok(!out.toString("binary").includes("GPS!"));
  assert.equal(out.readUInt32LE(4), out.length - 8);
  assert.equal(out[20] & 0x0c, 0);
});

test("stripImageMetadata rejects non-images", () => {
  assert.throws(() => stripImageMetadata(Buffer.from("hello world, not an image")));
});
