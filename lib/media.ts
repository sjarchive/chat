// ---------- Media attach ----------
// Compressing before upload (rather than sending the original) is what
// actually keeps the Supabase Storage free-tier quota (1GB) from filling up
// fast — a handful of full-resolution phone photos can eat most of that on
// their own.

const MAX_IMAGE_DIMENSION = 1600; // longest edge, px
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // cap after compression
const SKIP_COMPRESSION_BELOW_BYTES = 400 * 1024; // already small — not worth re-encoding

export { MAX_IMAGE_DIMENSION, MAX_UPLOAD_BYTES };

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function toJpegFilename(name: string): string {
  return name.replace(/\.\w+$/, "") + ".jpg";
}

// Resizes to a max dimension and re-encodes as JPEG. Falls back to the
// original file untouched if anything about compression goes wrong, or if
// the "compressed" result would actually end up bigger.
export async function compressImage(file: File): Promise<File> {
  // Canvas only captures a single frame, so redrawing an animated GIF onto
  // one would silently strip its animation — leave those alone.
  if (file.type === "image/gif") return file;
  if (file.size <= SKIP_COMPRESSION_BELOW_BYTES) return file;

  try {
    const img = await loadImageFromFile(file);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
    const width = Math.round(img.width * scale);
    const height = Math.round(img.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], toJpegFilename(file.name), { type: "image/jpeg" });
  } catch (err) {
    console.error(err);
    return file;
  }
}
