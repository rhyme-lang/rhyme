// Entry point for the c-new backend.
//
// Pipeline: simple-eval IR -> lower.js -> new-codegen (scheduling) -> a program
// tree -> C text -> compile -> run. The tree is what makes this different from
// backend "c": the loop structure survives scheduling, so optimizations can be
// written against it later instead of against rendered text.

const { generate } = require('../new-codegen')
const { symbol } = require('./symbol')
const { c } = require('./cutils')
const { lower } = require('./lower')
const { emitExpr, emitValue, asBoxed, emitStatement, emitLoopHeader,
        decideNativeTmps, cSym } = require('./emit')
const ctypes = require('./ctypes')

// Walk the scheduled tree, emitting C.
let emitTree = (node, buf, ctx) => {
  for (let n of node.body) {
    if (n.k == "loop") {
      let [g, ...rest] = n.gens
      emitLoopHeader(g, buf, ctx)
      // Additional generators bound to the same variable are filters: the JS
      // backend emits `if (rhs[sym] === undefined) continue` (new-codegen.js:418).
      for (let f of rest) {
        buf.push(c.if1(
          c.call("rh_is_undef", c.call("rh_get", emitExpr(f.src, ctx),
            asBoxed(ctx.vars[g.cvar] || { repr: "boxed", expr: g.cvar }))),
          "continue;"))
      }
      emitTree(n, buf, ctx)
      buf.push("}")
    } else if (n.k == "stmt") {
      emitStatement(n.stmt, buf, ctx)
    } else if (n.k == "raw") {
      buf.push(n.text)
    }
  }
}

let indent = (lines) => {
  let out = []
  let depth = 1
  for (let l of lines) {
    if (l.trim().startsWith("}")) depth = Math.max(0, depth - 1)
    out.push("    ".repeat(depth) + l)
    if (l.trim().endsWith("{")) depth++
  }
  return out
}

let emitProgram = (tree, res, tmps, loopVars, stms, assignments) => {
  // `vars` records how each loop variable is represented, filled in by the
  // loop header: a loop over a typed JSON object binds its key as a borrowed
  // (const char*, int) pair, a loop over an unknown value binds an rh_val.
  // emitValue reads it back when it lowers a `var` node.
  let ctx = {
    loads: new Map(),  // path -> C symbol, filled in on first reference
    prolog: [],        // the open calls those references emitted
    vars: {},          // loop variable -> representation
    nativeTmps: decideNativeTmps(stms, assignments), // tmp -> C type, decided up front
    assignments,       // a `ref` resolves its grouping path through this
  }

  // Emitted after the body, because which tmps turned out to be native is only
  // known once their statements have been lowered.
  // Emit the body, retrying if a tmp turns out not to be able to stay native.
  //
  // Whether a value ends up in a native C representation is not something the
  // schema alone decides -- `convert_f64(ref tmp0)` is typed f64 while tmp0 may
  // still be boxed, and a loop variable's representation is only fixed when its
  // loop is emitted. Predicting that would mean duplicating emitValue. Instead
  // emitStatement reports the tmp it could not keep native, and we drop it to
  // boxed and start over. Tmps only ever move native -> boxed, so this settles.
  let body
  for (;;) {
    body = []
    ctx.vars = {}
    ctx.loads = new Map()
    ctx.prolog = []
    symbol.reset()
    try {
      emitTree(tree, body, ctx)
      break
    } catch (e) {
      if (!e.notNative || !ctx.nativeTmps[e.notNative]) throw e
      delete ctx.nativeTmps[e.notNative]
    }
  }

  // Print the result in whatever representation it ended up in.
  let out = emitValue(res.txt, ctx)
  if (out.repr === "cScalar" && ctypes.hasFormat(out.ctype)) {
    let fmt = ctypes.formatFor(out.ctype)
    let show = c.stmt1(c.call("printf", `"%${fmt}"`, out.expr))
    body.push(out.cond
      ? c.if1(out.cond, c.stmt1(c.call("printf", '"undefined"'))) + " else " + show
      : show)
  } else {
    c.stmt(body)(c.call("rh_print_val", asBoxed(out)))
  }
  c.printf(body)("\\n")
  c.return(body)("0")

  let decls = []
  for (let t of tmps) {
    let sym = cSym(t)
    decls.push(ctx.nativeTmps[sym]
      ? c.stmt1(c.assign(`${ctx.nativeTmps[sym]} ${sym}`, "0"))
      : `rh_val ${sym} = rh_undef;`)
  }
  for (let v2 of loopVars) if (!ctx.vars[v2] || ctx.vars[v2].repr === "boxed")
    c.declareVar(decls)("rh_val", v2, "rh_undef")
  body = [...decls, ...body]

  let head = ['#include "rhyme_rt.h"', "", "int main() {"]
  return [...head, ...indent([...ctx.prolog, ...body]), "}", ""].join("\n")
}

let generateCNew = (q, ir, settings) => {
  symbol.reset()

  const fs = require('fs').promises
  const path = require('path')
  const paths = require('../cgen/paths')
  const build = require('../cgen/build')

  let outFile = settings.outFile || "tmp"
  let outDir = settings.outDir || paths.defaultOutDir()

  let logical = lower(q, ir.assignments, ir.filters)
  let tmps = logical.assignmentStms.map(s => s.txt.sym)
  tmps = [...new Set(tmps)]

  let loopVars = [...new Set(logical.generatorStms.map(g => g.cvar))]

  let { tree, res } = generate(logical, "c-new")
  let code = emitProgram(tree, res, tmps, loopVars, logical.assignmentStms, ir.assignments)

  let cFile = path.join(outDir, outFile + ".c")
  let out = path.join(outDir, outFile)

  // The generated program opens the files the query names, so there is nothing
  // to pass in -- same shape as backend "c".
  let func = async () => {
    let stdout = await build.run(path.resolve(out), [])
    // a query with no result prints "undefined", which is what the js backend
    // returns and is not valid JSON
    if (stdout.trim() === "undefined") return undefined
    return JSON.parse(stdout)
  }

  // `ir` is the logical statement IR this backend lowers to, before
  // new-codegen touches it; `tree` is the same statements after scheduling,
  // nested under the loops they ended up in. Both are the representations the
  // old backend does not have -- it is holding rendered C by this point.
  func.explain = { code, ir: logical, tree, cFile, binary: out }

  return (async () => {
    await fs.mkdir(outDir, { recursive: true })
    await fs.writeFile(cFile, code)
    await build.compile({
      cFile, out,
      compiler: settings.compiler || "gcc",
      optFlags: settings.optFlags || ["-O1"],
      cFlags: settings.cFlags || [],
      includePaths: settings.includePaths || [],
      needsYYJSON: true,
      verbose: settings.verbose,
    })
    return func
  })()
}

module.exports = { generateCNew }
