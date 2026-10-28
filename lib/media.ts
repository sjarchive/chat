// ---------- Media attach ----------
// Compressing before upload (rather than sending the original) is what
// actually keeps the Supabase Storage free-tier quota (1GB) from filling up
// fast — a handful of full-resolution phone photos can eat most of that on
// their own.

const MAX_IMAGE_DIMENSION = 1600; // longest edge, px
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // cap after compression
const SKIP_COMPRESSION_BELOW_BYTES = 400 * 1024; // already small — not worth re-encoding

// Video/audio are re-encoded (transcoded) before upload too — phone videos
// are exactly the quota killers. Targets: 720p H.264 + low-quality AAC,
// which lands a typical clip at a few MB. 25MB stays as the final upload
// cap for anything that couldn't be compressed (or generic files).
const MAX_BINARY_UPLOAD_BYTES = 25 * 1024 * 1024; // final cap, post-transcode
const MAX_MEDIA_INPUT_BYTES = 100 * 1024 * 1024; // input cap before transcoding
const MAX_VIDEO_HEIGHT = 720; // px, post-transcode (width follows aspect ratio)

export { MAX_IMAGE_DIMENSION, MAX_UPLOAD_BYTES, MAX_BINARY_UPLOAD_BYTES, MAX_MEDIA_INPUT_BYTES };

// "1.2 MB" — label for file chips. Small units get one decimal, larger round
// to whole numbers.
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 || v >= 100 ? 0 : 1;
  return `${v.toFixed(digits)} ${units[i]}`;
}

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

// ---------- Video/audio transcode ----------
// Re-encodes video (→ 720p H.264 + low-quality AAC in an MP4) and audio
// (→ low-quality AAC in an .m4a) with mediabunny, which drives the browser's
// native WebCodecs — hardware-accelerated where available, and far smaller
// and faster than a wasm FFmpeg. Returns the original file untouched
// whenever transcoding isn't supported (no WebCodecs — older Firefox,
// missing hardware codecs), the source can't be processed, or the result
// wouldn't actually be smaller than the original.
export async function compressMedia(file: File): Promise<File> {
  let mod: typeof import("mediabunny");
  try {
    // Dynamic import keeps the transcoder out of the initial page bundle;
    // it loads on the first attachment instead.
    mod = await import("mediabunny");
  } catch {
    return file; // chunk failed to load — send as-is
  }

  try {
    const input = new mod.Input({ formats: mod.ALL_FORMATS, source: new mod.BlobSource(file) });
    const output = new mod.Output({
      format: new mod.Mp4OutputFormat(),
      target: new mod.BufferTarget(),
    });

    const isVideo = file.type.startsWith("video/");
    // Setting `quality` forces a transcode; `height` caps the resolution
    // with the width deduced from the aspect ratio. `tracks: "primary"`
    // drops secondary/extra tracks (multi-angle video etc.).
    const conversion = await mod.Conversion.init({
      input,
      output,
      tracks: "primary",
      video: isVideo ? { height: MAX_VIDEO_HEIGHT, quality: new mod.Quality("low") } : undefined,
      audio: { quality: new mod.Quality("low") },
      tags: {},
    });

    if (!conversion.isValid) return file;
    await conversion.execute();

    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength === 0 || buffer.byteLength >= file.size) return file;

    const ext = isVideo ? ".mp4" : ".m4a";
    const mime = isVideo ? "video/mp4" : "audio/mp4";
    return new File([buffer], file.name.replace(/\.\w+$/, "") + ext, { type: mime });
  } catch (err) {
    console.error("Media compression failed — sending original:", err);
    return file;
  }
}
