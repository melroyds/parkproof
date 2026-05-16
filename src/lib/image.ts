const DEFAULT_MAX_DIM = 1200
const DEFAULT_QUALITY = 0.82

/**
 * Resize an image file to a JPEG data URL with a sensible max dimension and
 * compression. Prevents 3-8MB phone photos from blowing through localStorage's
 * ~5MB-per-origin quota, and shrinks the payload sent to Claude.
 *
 * Falls back to the original file (read as a data URL) if the browser can't
 * decode the image — better to upload a 5MB raw photo than to lose the photo.
 */
export async function resizeImageFile(
  file: File,
  maxDim = DEFAULT_MAX_DIM,
  quality = DEFAULT_QUALITY,
): Promise<{ dataUrl: string; mediaType: string }> {
  if (typeof createImageBitmap !== 'function') {
    return await rawDataUrl(file)
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return await rawDataUrl(file)
  }

  const { width, height } = bitmap
  const ratio = Math.min(1, maxDim / Math.max(width, height))
  const targetW = Math.max(1, Math.round(width * ratio))
  const targetH = Math.max(1, Math.round(height * ratio))

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return await rawDataUrl(file)
  }

  ctx.drawImage(bitmap, 0, 0, targetW, targetH)
  bitmap.close()

  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  return { dataUrl, mediaType: 'image/jpeg' }
}

function rawDataUrl(file: File): Promise<{ dataUrl: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve({
        dataUrl: reader.result as string,
        mediaType: file.type || 'image/jpeg',
      })
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}
