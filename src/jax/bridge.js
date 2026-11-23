// Synchronous bridge from generated JS code to a persistent JAX worker.
//
// The compiled query stays a plain synchronous JS function: requests and
// responses go over two named pipes opened with blocking fds, and the worker
// (src/jax/worker.py) is started on first use and reused for every stage.
//
// Python: settings.jaxPython, else $RHYME_JAX_PYTHON, else "python3"; it
// needs jax installed. POSIX only (mkfifo).

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, execFileSync } = require('child_process')

let pythonFor = settings => settings?.jaxPython || process.env.RHYME_JAX_PYTHON || "python3"

let worker = null

let start = python => {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhyme-jax-'))
  let reqPath = path.join(dir, 'req'), respPath = path.join(dir, 'resp')
  execFileSync('mkfifo', [reqPath, respPath])
  let proc = spawn(python, [path.join(__dirname, 'worker.py'), reqPath, respPath],
    { stdio: ['ignore', 'inherit', 'inherit'] })
  proc.unref()
  let failed = null
  proc.on('error', e => { failed = e })
  // blocking opens, in the worker's order (req, then resp); each returns once
  // the worker has opened the other end
  let req = fs.openSync(reqPath, 'w')
  let resp = fs.openSync(respPath, 'r')
  fs.rmSync(dir, { recursive: true, force: true }) // both ends are open now
  worker = { proc, req, resp, python, failed: () => failed }
}

let stop = () => {
  if (!worker) return
  fs.closeSync(worker.req) // the worker exits on EOF
  fs.closeSync(worker.resp)
  worker = null
}
process.on('exit', stop)

let readExact = n => {
  let buf = Buffer.alloc(n), off = 0
  while (off < n) {
    let k = fs.readSync(worker.resp, buf, off, n - off, null)
    if (k == 0) throw new Error("jax worker exited" + (worker.failed() ? ": " + worker.failed().message : ""))
    off += k
  }
  return buf
}

let writeMsg = (header, bufs) => {
  let h = Buffer.from(JSON.stringify(header))
  let len = Buffer.alloc(8)
  len.writeBigUInt64LE(BigInt(h.length))
  for (let b of [len, h, ...bufs]) fs.writeSync(worker.req, b)
}

// ---- marshaling: JS nested arrays <-> flat f64 ----

let shapeOf = x => Array.isArray(x) ? [x.length, ...(x.length ? shapeOf(x[0]) : [])] : []

let flatten = (name, x, shape) => {
  let out = new Float64Array(shape.reduce((a, b) => a * b, 1)), k = 0
  let go = (x, d) => {
    if (d == shape.length) {
      if (typeof x != "number") throw new Error(`jax: input ${name} is not a dense numeric array`)
      out[k++] = x
      return
    }
    if (!Array.isArray(x) || x.length != shape[d])
      throw new Error(`jax: input ${name} is not a dense (rectangular) array`)
    for (let i = 0; i < x.length; i++) go(x[i], d + 1)
  }
  go(x, 0)
  return out
}

// Rhyme objects keyed by index, as the JS backend builds them
let unflatten = (data, shape, off = 0, d = 0) => {
  if (d == shape.length) return data[off]
  let stride = 1
  for (let i = d + 1; i < shape.length; i++) stride *= shape[i]
  let res = {}
  for (let i = 0; i < shape[d]; i++) res[i] = unflatten(data, shape, off + i * stride, d + 1)
  return res
}

// ---- entry point for generated code ----

let stats = { calls: 0, marshalMs: 0, jaxMs: 0 }

let run = (stage, inp, tmp) => {
  if (!worker || worker.python != stage.python) { stop(); start(stage.python) }
  let t0 = performance.now()
  let inputs = stage.roots.map(r => {
    let shape = shapeOf(inp?.[r])
    return { name: stage.args[r], shape, data: flatten(r, inp?.[r], shape) }
  })
  let t1 = performance.now()
  writeMsg({ src: stage.src, inputs: inputs.map(x => [x.name, x.shape]) },
    inputs.map(x => Buffer.from(x.data.buffer, x.data.byteOffset, x.data.byteLength)))
  let header = JSON.parse(readExact(Number(readExact(8).readBigUInt64LE())))
  if (header.error) throw new Error("jax stage failed:\n" + header.error + "\nstage source:\n" + stage.src)
  let t2 = performance.now()
  header.shapes.forEach((shape, k) => {
    let n = shape.reduce((a, b) => a * b, 1)
    let raw = readExact(8 * n)
    let data = new Float64Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + 8 * n))
    tmp[stage.outs[k]] = unflatten(data, shape)
  })
  let t3 = performance.now()
  stats.calls++
  stats.marshalMs += (t1 - t0) + (t3 - t2)
  stats.jaxMs += t2 - t1
}

// Can the configured python run the worker? {ok, python, error}
let check = settings => {
  let python = pythonFor(settings)
  try {
    execFileSync(python, ['-c', 'import jax'], { stdio: ['ignore', 'ignore', 'pipe'] })
    return { ok: true, python }
  } catch (e) {
    let why = e.code == 'ENOENT' ? "no such file or command"
      : (e.stderr?.toString().trim().split("\n").pop() || e.message)
    return { ok: false, python, error: `cannot use ${python} for jax: ${why}` }
  }
}

let available = settings => check(settings).ok

module.exports = { run, stop, stats, check, available, pythonFor }
