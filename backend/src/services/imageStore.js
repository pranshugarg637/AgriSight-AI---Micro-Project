import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { config } from "../config/index.js";
import { stripImageMetadata } from "./exif.js";

/**
 * Image storage behind a tiny interface (save / read / remove). Local disk
 * by default; an object-storage implementation only needs these methods.
 * Every image is metadata-stripped (EXIF incl. GPS) before it touches disk.
 */
export class LocalImageStore {
  constructor(dir = config.storage.imageDir) {
    this.dir = dir;
  }

  async save(buffer, mimetype) {
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mimetype];
    if (!ext) throw new Error("unsupported image type");
    const clean = stripImageMetadata(buffer);
    const ref = `${crypto.randomUUID()}.${ext}`;
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(path.join(this.dir, ref), clean);
    return ref;
  }

  resolve(ref) {
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(ref)) throw new Error("invalid image ref");
    return path.join(this.dir, ref);
  }

  async read(ref) {
    return fs.readFile(this.resolve(ref));
  }

  async remove(ref) {
    if (!ref) return;
    try {
      await fs.unlink(this.resolve(ref));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
}

let store = new LocalImageStore();
export const getImageStore = () => store;
export const setImageStore = (s) => {
  store = s;
};

export async function deleteImagesForUser(db, userId) {
  const rows = await db("scans").where({ user_id: userId }).select("image_ref", "gradcam_ref");
  for (const r of rows) {
    await getImageStore().remove(r.image_ref);
    await getImageStore().remove(r.gradcam_ref);
  }
}

/** Retention: deletes stored images older than IMAGE_RETENTION_DAYS (scan rows are kept). */
export async function enforceImageRetention(db, days = config.storage.imageRetentionDays) {
  const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const rows = await db("scans")
    .where((q) => q.whereNotNull("image_ref").orWhereNotNull("gradcam_ref"))
    .where("created_at", "<", cutoff)
    .select("id", "image_ref", "gradcam_ref");
  for (const r of rows) {
    await getImageStore().remove(r.image_ref);
    await getImageStore().remove(r.gradcam_ref);
    await db("scans").where({ id: r.id }).update({ image_ref: null, gradcam_ref: null });
  }
  return rows.length;
}
