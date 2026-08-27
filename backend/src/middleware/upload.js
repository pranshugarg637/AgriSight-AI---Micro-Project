import multer from "multer";
import { config } from "../config/index.js";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(new Error(`Unsupported file type '${file.mimetype}'. Only JPEG, PNG, and WebP images are allowed.`));
    return;
  }
  cb(null, true);
}

export const uploadImage = multer({
  storage,
  limits: { fileSize: config.maxUploadSizeMb * 1024 * 1024 },
  fileFilter,
});
