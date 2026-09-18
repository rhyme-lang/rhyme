// Driving the C compiler: shared by the "c" and "c-new" backends.

// Run a command with an argv array rather than a shell string: the include
// paths we pass are absolute paths into node_modules, which routinely contain
// spaces on macOS and Windows.
let run = (file, args) => {
  const cp = require('child_process')
  return new Promise((resolve, reject) => {
    cp.execFile(file, args, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr
        reject(err)
      } else {
        resolve(stdout)
      }
    })
  })
}

// Compile the vendored yyjson.c once into the shared cache and reuse it from
// then on. A cache we cannot write to is not fatal: the caller falls back to
// handing yyjson.c to the compiler directly, which is only slower.
let buildYyjsonObject = async (compiler, optFlags) => {
  const fs = require('fs').promises
  const path = require('path')
  const paths = require('./paths')

  let dir = paths.cacheDir()
  let obj = path.join(dir, "yyjson.o")
  try {
    await fs.access(obj)
    return obj
  } catch (e) {
    // not built yet
  }
  // compile to a pid-unique temp name and rename, so that concurrent
  // processes cannot observe a half-written object
  let tmp = `${obj}.${process.pid}.tmp`
  await fs.mkdir(dir, { recursive: true })
  await run(compiler, [...optFlags, "-c", paths.yyjsonSrc, "-o", tmp])
  await fs.rename(tmp, obj)
  return obj
}

// Memoized per process, on the promise, so concurrent queries neither stat the
// cache repeatedly nor race each other to build the object.
let yyjsonObjectPromise

let yyjsonObject = (compiler, optFlags) => {
  yyjsonObjectPromise ??= buildYyjsonObject(compiler, optFlags)
  return yyjsonObjectPromise
}

// Build the C runtime's compiled dependencies ahead of time, so that the first
// query does not pay for it. Test runners and CI want this: jest gives each
// test a few seconds, and compiling yyjson.c can eat that on its own.
let prepareRuntime = async (settings = {}) => {
  let compiler = settings.compiler || "gcc"
  let optFlags = settings.optFlags || ["-O3"]
  return yyjsonObject(compiler, optFlags)
}

// Assemble the compiler invocation and run it. The runtime ships inside this
// package, so its include path comes from the package location -- not from the
// cwd, which belongs to whoever installed us. settings.cFlags adds to the base
// flags rather than replacing them, so extra flags cannot accidentally drop
// -I<runtime>. Flags are arrays, one argv entry per element, so a path with
// spaces stays intact.
let compile = async ({ cFile, out, compiler, optFlags, cFlags, includePaths,
                       needsYYJSON, needsCublas, verbose }) => {
  const paths = require('./paths')

  let flags = [`-I${paths.runtimeDir}`, ...optFlags]
  for (let dir of includePaths || []) flags.push(`-I${dir}`)

  if (needsYYJSON) {
    flags.push(`-I${paths.yyjsonDir}`)
    try {
      flags.push(await yyjsonObject(compiler, optFlags))
    } catch (e) {
      // no usable cache -- compile yyjson from source alongside the query
      flags.push(paths.yyjsonSrc)
    }
  }
  if (needsCublas) flags.push("-lcublas")

  // user flags last, so they win on conflicting options
  flags.push(...(cFlags || []))

  let args = [cFile, "-o", out, ...flags]
  if (verbose) console.log("Executing: " + [compiler, ...args].join(" "))
  let t0 = performance.now()
  await run(compiler, args)
  return performance.now() - t0
}

module.exports = { run, yyjsonObject, prepareRuntime, compile }
