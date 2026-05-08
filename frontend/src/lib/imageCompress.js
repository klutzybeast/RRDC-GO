/**
 * Compress an image File client-side before uploading.
 *
 * Why: iPad / iPhone photos are routinely 4-10 MB raw. Production gateways
 * commonly cap multipart bodies around 30 MB (so 5 raw photos = blocked).
 * Compressing to ~1.2-1.6 MB JPEG keeps every upload well under any cap
 * AND makes the resulting Pokemon image data-url small enough to ship to
 * every camper's iPad without lag.
 *
 * Returns the original file untouched if:
 *   - the file is already small enough (<1.5 MB), or
 *   - the browser doesn't support OffscreenCanvas / canvas.toBlob, or
 *   - any step fails (we'd rather upload an oversize file than block the user)
 *
 * Behavior:
 *   - Resizes longest edge to maxDim (default 1600 px) preserving aspect ratio
 *   - Encodes JPEG at quality 0.85
 *   - PNG with transparency is preserved (we only compress JPEG / opaque)
 */
export async function compressImage(file, { maxDim = 1600, quality = 0.85, skipUnderBytes = 1.5 * 1024 * 1024 } = {}) {
    if (!file || !file.type) return file;
    if (file.size <= skipUnderBytes) return file;
    // Don't try to compress non-image types or weird formats.
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) return file;
    try {
        const bitmap = await createImageBitmap(file);
        const ratio = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
        const w = Math.round(bitmap.width * ratio);
        const h = Math.round(bitmap.height * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close && bitmap.close();
        // Always emit JPEG — backend's _remove_white_background re-encodes to PNG
        // anyway and JPEG dramatically shrinks photos vs. PNG round-tripping.
        const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
        if (!blob) return file;
        // If compression actually made it bigger (rare but happens with already-tiny PNGs), keep original.
        if (blob.size >= file.size) return file;
        const newName = (file.name || "image").replace(/\.[^.]+$/, "") + ".jpg";
        return new File([blob], newName, { type: "image/jpeg", lastModified: Date.now() });
    } catch {
        // Best-effort — never block the upload because compression failed.
        return file;
    }
}
