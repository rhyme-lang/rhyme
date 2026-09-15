// Filesystem locations of the C runtime that ships with this package.
//
// Everything here resolves from this module's own location, never from
// process.cwd(): once rhyme is installed into someone else's node_modules,
// the cwd is their project and "runtime/" does not exist there.

const os = require('os')
const path = require('path')

let pkgRoot = path.resolve(__dirname, '..', '..')

// the C runtime header (rhyme.h), handed to the compiler as -I
let runtimeDir = path.join(pkgRoot, 'runtime')

// vendored yyjson -- a single .c/.h pair, compiled on demand (see yyjsonObject)
let yyjsonDir = path.join(pkgRoot, 'third-party', 'yyjson')
let yyjsonSrc = path.join(yyjsonDir, 'yyjson.c')

// vendored nlohmann/json, header-only, for the c++ backend
let jsonIncludeDir = path.join(pkgRoot, 'third-party', 'json', 'include')

// build products we can regenerate at will, shared across runs
let cacheDir = () =>
  path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'rhyme')

// per-run scratch for the generated .c and the binary built from it. Keyed by
// pid so concurrent processes don't fight over the default outFile ("tmp"),
// and left for the OS to reap rather than deleted on exit, so that a failed
// compile can still be inspected.
let defaultOutDir = () => path.join(os.tmpdir(), `rhyme-${process.pid}`)

module.exports = {
  pkgRoot, runtimeDir, yyjsonDir, yyjsonSrc, jsonIncludeDir,
  cacheDir, defaultOutDir
}
