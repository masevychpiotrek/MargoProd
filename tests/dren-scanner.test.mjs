import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = fs.readFileSync(new URL('../src/components/DrenBarcodeScanner.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX }
}).outputText
const domain = ts.transpileModule(fs.readFileSync(new URL('../src/lib/productionJobs.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 }
}).outputText
const { isPlausibleBatchNumber } = await import(`data:text/javascript;base64,${Buffer.from(domain).toString('base64')}`)
const tick = () => new Promise(resolve => setImmediate(resolve))

function mount({ cameraError, pendingCamera } = {}) {
  let cleanup, decode, stopped = 0, controlStops = 0, detected = [], closed = 0
  const states = []
  const listeners = new Map()
  const stream = { getTracks: () => [{ stop: () => stopped++ }] }
  const controls = { stop: () => controlStops++ }
  class Reader {
    async decodeFromStream(_stream, _video, callback) { decode = callback; return controls }
  }
  const exports = {}
  vm.runInNewContext(compiled, {
    Error,
    exports,
    require: name => {
      if (name === 'react') return {
        useRef: value => ({ current: value === null ? {} : value }),
        useState: value => [value, next => states.push(next)],
        useEffect: callback => { cleanup = callback() }
      }
      if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null }
      if (name === 'lucide-react') return { X: () => null }
      if (name === '@zxing/browser') return { BrowserMultiFormatOneDReader: Reader }
      if (name === '@/lib/productionJobs') return { isPlausibleBatchNumber }
      if (name === '@/lib/barcodeOrientation') return { decodeBarcodeOrientations: (canvas, decode) => decode(canvas) }
      throw new Error(`Unexpected import: ${name}`)
    },
    window: { isSecureContext: true },
    navigator: { mediaDevices: { getUserMedia: async () => {
      if (cameraError) throw cameraError
      if (pendingCamera) await pendingCamera
      return stream
    } } },
    document: {
      hidden: false,
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: name => listeners.delete(name)
    }
  })
  exports.default({ label: 'Stacja 1', onDetected: value => detected.push(value), onClose: () => closed++ })
  return {
    unmount: () => cleanup(),
    scan: value => decode({ getText: () => value }, undefined, controls),
    escape: () => listeners.get('keydown')({ key: 'Escape' }),
    get stopped() { return stopped },
    get controlStops() { return controlStops },
    get detected() { return detected },
    get closed() { return closed },
    states, listeners
  }
}

test('valid barcode preserves leading zeros, reports once and stops the camera', async () => {
  const scanner = mount()
  await tick()
  scanner.scan(' 0012345 ')
  scanner.scan('999888')
  assert.deepEqual(scanner.detected, ['0012345'])
  assert.ok(scanner.stopped > 0)
  assert.ok(scanner.controlStops > 0)
  scanner.unmount()
  assert.equal(scanner.listeners.size, 0)
})

test('invalid barcode is rejected and scanning continues for the next label', async () => {
  const scanner = mount()
  await tick()
  scanner.scan('test')
  scanner.scan('LOT\n123')
  assert.deepEqual(scanner.detected, [])
  assert.equal(scanner.stopped, 0)
  scanner.scan('LOT-123')
  assert.deepEqual(scanner.detected, ['LOT-123'])
  scanner.unmount()
})

test('closing an active scanner stops tracks and ignores late results', async () => {
  const scanner = mount()
  await tick()
  scanner.escape()
  assert.equal(scanner.closed, 1)
  scanner.unmount()
  scanner.scan('LOT-123')
  assert.ok(scanner.stopped > 0)
  assert.deepEqual(scanner.detected, [])
})

test('closing while permission is pending stops the subsequently acquired camera', async () => {
  let grant
  const scanner = mount({ pendingCamera: new Promise(resolve => { grant = resolve }) })
  await tick()
  scanner.unmount()
  grant()
  await tick()
  assert.equal(scanner.stopped, 1)
  assert.deepEqual(scanner.detected, [])
})

test('camera permission denial displays an actionable message', async () => {
  const scanner = mount({ cameraError: Object.assign(new Error('denied'), { name: 'NotAllowedError' }) })
  await tick()
  assert.ok(scanner.states.some(value => typeof value === 'string' && value.includes('Zezwól na używanie kamery')))
  scanner.unmount()
})
