const fs = require('fs');
const sharp = require('sharp');

const MAX_PIXELS = 50_000_000; // refuse decompression bombs: a 5 MB file can still describe a gigantic image

/**
 * Re-encode an uploaded photo in place so it keeps its pixels and loses everything else.
 *
 * A phone photo normally carries EXIF: the GPS position it was taken at, the camera make and model, a timestamp.
 * Citizens send these without thinking, and every staff member who can open the photo would see them. sharp writes
 * no metadata unless asked to, so decoding and re-encoding removes all of it. rotate() first applies the EXIF
 * orientation to the pixels, so dropping the orientation tag does not turn the picture sideways.
 *
 * It also proves the file really is a decodable JPEG, PNG or WebP, which the first-bytes check cannot.
 * Throws if it is not. Returns the real format, which can differ from what the client declared.
 */
async function scrubImage(filePath) {
  const input = await fs.promises.readFile(filePath);
  const { format } = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
  if (!['jpeg', 'png', 'webp'].includes(format)) throw new Error(`unsupported image format: ${format}`);
  const clean = await sharp(input, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .toFormat(format, format === 'jpeg' ? { quality: 88 } : {})
    .toBuffer();
  await fs.promises.writeFile(filePath, clean);
  return { format };
}

module.exports = { scrubImage };
