// Wspolna kompresja zdjec przed uploadem do Supabase Storage.
// Domyslne wartosci dopasowane do zdjec pojedynczego obiektu (np. awaria).
// Dla zdjec gestego tekstu (np. ekran PLC z tabela liczb) uzyj wyzszych
// maxDimension/quality, zeby AI mialo szanse odczytac drobne cyfry.
export interface CompressImageOptions {
  minSizeBytes?: number
  maxDimension?: number
  quality?: number
}

export async function compressImage(file: File, options: CompressImageOptions = {}): Promise<File> {
  const { minSizeBytes = 700_000, maxDimension = 1600, quality = 0.78 } = options
  if (!file.type.startsWith('image/') || file.size < minSizeBytes) return file

  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, width, height)

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
  bitmap.close()
  if (!blob) return file

  return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
}

// Dla zdjec ekranow PLC z gesta tabela liczb - wyzsza rozdzielczosc i jakosc,
// zeby AI mialo szanse odczytac drobny tekst (limit wysokiej rozdzielczosci Claude ~2600px).
// minSizeBytes: 0 - zawsze konwertuje do JPEG (przewidywalny media_type dla wywolania AI),
// niezaleznie od oryginalnego formatu/rozmiaru pliku (np. HEIC z telefonu).
export const SCREEN_PHOTO_OPTIONS: CompressImageOptions = { minSizeBytes: 0, maxDimension: 2560, quality: 0.92 }
