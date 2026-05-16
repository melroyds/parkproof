/**
 * Pre-flight photo quality check.
 *
 * Runs entirely client-side on a small downscaled canvas (~200×200) so it
 * costs ~5ms per photo and adds zero API spend. The goal is to catch the
 * three failure modes that produce garbage Claude output and waste tokens:
 *
 *   - Blurry / out-of-focus photos (most common — phone autofocus misses
 *     in low light or close-up)
 *   - Too-dark photos (taken at night without flash)
 *   - Blown-out / overexposed photos (direct sunlight on a white sign)
 *
 * We don't reject — we warn. The user can still hit Translate; some signs
 * are legitimately readable through suboptimal photos and the AI handles
 * them. But we surface the issue so they can choose to retake rather than
 * blame the AI for a 50%-confidence result.
 */

export type QualityVerdict = 'ok' | 'blurry' | 'dark' | 'overexposed' | 'tiny'

export interface QualityResult {
  verdict: QualityVerdict
  /** "Photo is blurry — retake for a better read?" etc. UI-ready message. */
  message: string | null
  /** Numeric diagnostics — useful in logs but the UI just consumes message + verdict. */
  diagnostics: {
    width: number
    height: number
    /** Mean grayscale brightness, 0–255. */
    meanLuminance: number
    /** Laplacian-variance sharpness score. Higher = sharper. ~5 = very blurry; ~100+ = sharp. */
    sharpness: number
  }
}

// Thresholds tuned empirically against a few dozen real parking-sign photos.
// You CAN over-fit these — keep them loose so we only warn on clear losers.
const ANALYSIS_TARGET = 240 // analyse a 240px-on-long-edge downscale, plenty for stats
const MIN_DIMENSION = 320 // smaller than this and we just can't get a good read
const SHARPNESS_BLURRY = 15 // below ~15 = definitely blurry
const LUMINANCE_DARK = 50 // mean brightness < 50/255 = too dark to read text reliably
const LUMINANCE_OVEREXPOSED = 215 // mean brightness > 215/255 = blown out

/**
 * Analyse a photo File. Resolves to ok if we can't actually run the analysis
 * (no canvas, weird image format) — we'd rather let the user proceed than
 * block on infrastructure failures.
 */
export async function analyseSignPhoto(file: File): Promise<QualityResult> {
  if (typeof createImageBitmap !== 'function') {
    return passThrough(file, 'image bitmap not supported')
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return passThrough(file, 'image decode failed')
  }

  const { width: w0, height: h0 } = bitmap
  if (w0 < MIN_DIMENSION || h0 < MIN_DIMENSION) {
    bitmap.close()
    return {
      verdict: 'tiny',
      message:
        "Photo is very low resolution — the AI may miss details. Retake closer to the sign?",
      diagnostics: { width: w0, height: h0, meanLuminance: 0, sharpness: 0 },
    }
  }

  // Downscale to a fixed analysis size on the long edge. Stats are
  // resolution-independent so this saves a lot of cycles vs analysing the
  // full-resolution photo.
  const ratio = ANALYSIS_TARGET / Math.max(w0, h0)
  const w = Math.max(1, Math.round(w0 * ratio))
  const h = Math.max(1, Math.round(h0 * ratio))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    bitmap.close()
    return passThrough(file, 'no 2d context')
  }
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  const { data } = ctx.getImageData(0, 0, w, h)

  // Pass 1: build a grayscale buffer + accumulate luminance for the mean.
  const gray = new Float32Array(w * h)
  let sumL = 0
  for (let i = 0; i < gray.length; i++) {
    // Rec.709 luminance — closer to human perception than averaging R/G/B.
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    gray[i] = lum
    sumL += lum
  }
  const meanLuminance = sumL / gray.length

  // Pass 2: discrete Laplacian convolution → variance of the response. Standard
  // sharpness measure (Pech-Pacheco et al.) — sharper images have stronger
  // second-derivative responses, so higher variance.
  let sumLap = 0
  let sumLapSq = 0
  let count = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = gray[y * w + x]
      const n = gray[(y - 1) * w + x]
      const s = gray[(y + 1) * w + x]
      const e = gray[y * w + (x + 1)]
      const wv = gray[y * w + (x - 1)]
      // 4-neighbour Laplacian.
      const lap = -4 * c + n + s + e + wv
      sumLap += lap
      sumLapSq += lap * lap
      count++
    }
  }
  const meanLap = sumLap / count
  const varLap = sumLapSq / count - meanLap * meanLap
  // Take sqrt so the number is in pixel-intensity units. Easier to reason about.
  const sharpness = Math.sqrt(Math.max(0, varLap))

  const diagnostics = { width: w0, height: h0, meanLuminance, sharpness }

  // Order matters: a dark photo will also look blurry because there's no
  // contrast to compute sharpness against. Surface the dominant issue.
  if (meanLuminance < LUMINANCE_DARK) {
    return {
      verdict: 'dark',
      message:
        "Photo looks dark — the AI may misread it. Move closer to a light or retake with flash?",
      diagnostics,
    }
  }
  if (meanLuminance > LUMINANCE_OVEREXPOSED) {
    return {
      verdict: 'overexposed',
      message:
        "Photo looks washed out — direct sunlight on the sign? Shade the lens with your hand and retake?",
      diagnostics,
    }
  }
  if (sharpness < SHARPNESS_BLURRY) {
    return {
      verdict: 'blurry',
      message:
        "Photo looks blurry — tap to focus on the sign and retake for a more reliable read?",
      diagnostics,
    }
  }
  return { verdict: 'ok', message: null, diagnostics }
}

function passThrough(file: File, reason: string): QualityResult {
  console.debug('[photo-quality] skipped check:', reason, file.size)
  return {
    verdict: 'ok',
    message: null,
    diagnostics: { width: 0, height: 0, meanLuminance: 0, sharpness: 0 },
  }
}
