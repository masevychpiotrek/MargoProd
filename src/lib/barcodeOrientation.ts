// A 1D reader scans across bars. Try a second frame rotated by 90 degrees
// so labels can be held either horizontally or vertically.
export function decodeBarcodeOrientations<T>(canvas: HTMLCanvasElement, decode: (frame: HTMLCanvasElement) => T): T {
  try {
    return decode(canvas)
  } catch (originalError) {
    const rotated = canvas.ownerDocument.createElement('canvas')
    rotated.width = canvas.height
    rotated.height = canvas.width
    const context = rotated.getContext('2d', { willReadFrequently: true })
    if (!context) throw originalError
    context.translate(rotated.width, 0)
    context.rotate(Math.PI / 2)
    context.drawImage(canvas, 0, 0)
    return decode(rotated)
  }
}
