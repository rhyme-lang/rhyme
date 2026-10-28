// C backend on the rhyme_rt.h value runtime.
//
// Emits a C program whose main() evaluates the query and prints the result as
// JSON on stdout; the compiled binary is wrapped in an async function that
// runs it. Compiler driving -- yyjson caching, include paths -- is shared with
// the other C backends through cgen/build.js.

const build = require("./cgen/build")

let emitCodeLowLevelC = (q) => {
  let buf = []
  buf.push(`#include "rhyme_rt.h"`)
  buf.push(``)
  buf.push(`int main(void) {`)
  buf.push(`  rh_map *res = rh_map_new();`)
  buf.push(`  rh_map_set(res, rh_str_lit("hello", 5), rh_strv("rhyme", 5));`)
  buf.push(`  rh_print_val(rh_mapv(res));`)
  buf.push(`  putchar('\\n');`)
  buf.push(`  return 0;`)
  buf.push(`}`)
  return buf.join("\n") + "\n"
}

// Write the emitted program, compile it, and resolve to a function that runs
// the binary and returns its stdout. `explain` is the caller's explain record
// (the same one the js backend attaches); the C file and binary paths are
// added to it.
let buildBinary = (code, settings = {}, explain = {}) => {
  const fs = require('fs').promises
  const path = require('path')
  const paths = require('./cgen/paths')

  let outFile = settings.outFile || "tmp"
  let outDir = settings.outDir || paths.defaultOutDir()
  let cFile = path.join(outDir, outFile + ".c")
  let out = path.join(outDir, outFile)

  async function func() {
    // path.resolve so that an absolute outDir works: a bare relative name
    // would be looked up on PATH rather than in outDir
    return build.run(path.resolve(out), [])
  }

  func.explain = { ...explain, code }

  let writeAndCompile = async () => {
    await fs.mkdir(outDir, { recursive: true })
    await fs.writeFile(cFile, code)

    await build.compile({
      cFile, out,
      compiler: settings.compiler || "clang",
      optFlags: settings.optFlags || ["-O3"],
      cFlags: settings.cFlags,
      includePaths: settings.includePaths,
      needsYYJSON: true, // rhyme_rt.h includes yyjson.h unconditionally
      verbose: settings.verbose,
    })
    func.explain.cFile = cFile
    func.explain.binary = out
    return func
  }

  return writeAndCompile()
}

module.exports = { emitCodeLowLevelC, buildBinary }
