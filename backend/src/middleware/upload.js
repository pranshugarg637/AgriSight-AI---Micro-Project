import multer from "multer";
import { config } from "../config/index.js";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(new Error(`Unsupported file type '${file.mimetype}'. Only JPEG, PNG, and WebP images are allowed.`));
    return;
  }
  cb(null, true);
}

const makeUploader = (maxMb) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1, fields: 10 },
    fileFilter,
  });

export const uploadImage = makeUploader(config.maxUploadSizeMb);
export const uploadFarmerImage = makeUploader(config.farmerMaxUploadSizeMb);

/**
 * Magic-byte check: the declared MIME type must match the file's actual
 * signature (a renamed .txt with Content-Type image/jpeg is rejected).
 */
export function detectImageType(buf) {
  if (!buf || buf.length < 3) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP")
    return "image/webp";
  return null;
}

export function requireImageMagicBytes(req, res, next) {
  if (!req.file) return next();
  const actual = detectImageType(req.file.buffer);
  if (!actual || actual !== req.file.mimetype) {
    return res.status(422).json({
      error: "invalid_file_type",
      detail: "The file content is not a valid JPEG, PNG, or WebP image.",
    });
  }
  next();
}
