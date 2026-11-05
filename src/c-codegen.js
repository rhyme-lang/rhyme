// C backend on the rhyme_rt.h value runtime.
//
// Emits a C program whose main() evaluates the query and prints the result as
// JSON on stdout; the compiled binary is wrapped in an async function that
// runs it. Compiler driving -- yyjson caching, include paths -- is shared with
// the other C backends through cgen/build.js.
//
// Input: the statement list produced by simple-loopgen (emitLoops) or
// opt-loopgen (scheduleC2) -- the same list emitStmListLowLevel in
// simple-codegen.js turns into JavaScript. This file is its C counterpart and
// follows it statement by statement; the JS emitter is the reference.
//
// Stage 1 (this file, now): fully boxed and deliberately rough. Every Rhyme
// value is an rh_val, every operation a call into rhyme_rt.h. No type-directed
// specialization, no CSE -- an input is re-read at each reference.
//
// C text helpers (symbols, literals, key arrays, indentation) are in
// cnew/utils.js, value representations in cnew/value.js.
//
// The file is in four parts:
//
//   state           the c2 IR the statements refer to (filters, assignments)
//   expressions     emitExpr: IR expression -> C rvalue of type rh_val
//   statements      emitStmList: loopgen statement -> C lines
//   program         emitCodeLowLevelC (assembly), buildBinary (compile + run)
//
// Shapes of the generated code (boxed):
//
//   tmp_i[fre...]       rh_val tmp<i> = rh_undef, a slot path walked with rh_slot
//   loop over g         rh_iter, rh_iter_next binding the key var and gen<i>
//   filter on bound v   rh_val gen<i> = rh_get(g, v); if (!rh_is_undef(gen<i>))
//   loadJSON "f"        rh_jsonv(yyjson_doc_get_root(rh_load_json("f"))), inline

const build = require("./cgen/build")
const { runtime } = require("./simple-runtime")
const { pretty } = require("./prettyprint")
const { value, asBoxed, presentOf } = require("./cnew/value")
const { c, cVar, tmpSym, genSym, projSym, cStr, cKeys, indent } = require("./cnew/utils")


// ----- state -----

let settings
let filters
let assignments

let setState = ir => {
  settings = ir.settings
  filters = ir.filters
  assignments = ir.assignments
}

// Unimplemented constructs fail at compile time with the offending term,
// rather than producing C that fails in the C compiler or, worse, runs.
let todo = (what, q) => {
  throw new Error("c-new: not implemented: " + what + (q ? " -- " + pretty(q) : ""))
}


let isDeepVarStr = s => s.startsWith("**")


// ----- program context -----
//
// One per compiled query, shared by every scope.
//
//   fresh      counter for generated local names (iterators, slot pointers)
//   declared   every C name declared so far in main()
//
// Loops emit no block of their own: everything is declared straight into the
// enclosing C scope. Loopgen routinely emits sibling loops over the same
// variable (the init nest and the update nest of a tmp both iterate D0), so a
// name is reused only if nothing has declared it yet -- otherwise the binding
// gets a suffix (D0, D0_1, ...). Names are never reused across scopes, which
// is more conservative than C requires but needs no scope tracking.

let newCtx = () => ({ fresh: 0, declared: new Set() })

// A C name based on `base` that nothing has declared yet, and reserve it.
let declName = (ctx, base) => {
  let name = base
  for (let n = 1; ctx.declared.has(name); n++) name = base + "_" + n
  ctx.declared.add(name)
  return name
}

let fresh = (ctx, prefix) => declName(ctx, prefix + (ctx.fresh++))

// A scope mirrors emitStmListLowLevel's, with the C side of each binding:
//   buf    the line buffer being written
//   vars   Rhyme var -> the value it is bound to (cnew/value.js)
//   gens   filter index -> the value of gen<i>, for filters in scope
//   ctx    the program context above
let childScope = scope => ({ ...scope, vars: { ...scope.vars }, gens: { ...scope.gens } })


// ----- expressions -----
//
// emitExpr(q, scope) returns a value (cnew/value.js), annotated with
// q.schema. Every emitter below currently produces a boxed one.
// emitBoxed(q, scope) is the common shorthand for it as a boxed value;
// take .expr for its rh_val text.

// The rh_val text of a constant. number -> rh_i64 for safe integers, rh_f64
// otherwise; string -> rh_strv; {} and [] -> a fresh map / array. A non-empty
// object or array literal is an error, as in quoteConst.
let cConst = k => {
  if (k === undefined) return "rh_undef"
  if (k === null) return "rh_null"
  if (typeof k == "boolean") return c.call("rh_bool", k)
  if (typeof k == "number") {
    if (Number.isSafeInteger(k)) return c.call("rh_i64", k)
    if (Number.isNaN(k)) return c.call("rh_f64", "NAN")
    if (!Number.isFinite(k)) return c.call("rh_f64", k > 0 ? "INFINITY" : "-INFINITY")
    return c.call("rh_f64", k)
  }
  if (typeof k == "string") {
    let { lit, len } = cStr(k)
    return c.call("rh_strv", lit, len)
  }
  if (k instanceof Array && k.length == 0) return c.call("rh_arrv", c.call("rh_arr_new"))
  if (typeof k == "object" && Object.keys(k).length == 0) return c.call("rh_mapv", c.call("rh_map_new"))
  throw new Error("c-new: unsupported constant " + JSON.stringify(k))
}

let emitConst = (q, scope) => value.boxed(cConst(q.op))

// The constant a var is folded to, or undefined. Same truthiness test as
// quoteVar and emitStmListLowLevel, so a var is folded here exactly when the
// loop that would bind it is skipped.
let foldedConst = s => settings.constantFold ? resolveConstForVar(s) : undefined

// var: the value the enclosing loop bound it to (see emitFor), or its folded
// constant
let emitVarName = (s, scope) => {
  if (isDeepVarStr(s)) todo("deep var " + s)
  let k = foldedConst(s)
  if (k) return value.boxed(cConst(k))
  if (!(s in scope.vars)) throw new Error("c-new: variable " + s + " is not bound here")
  return scope.vars[s]
}

let emitVar = (q, scope) => emitVarName(q.op, scope)

// ref: tmp<i> indexed by the assignment's free vars, as rh_get chains:
//   tmp1[K1]  ->  rh_get(tmp1, K1)
let emitRef = (q, scope) => {
  let e = tmpSym(q.op)
  for (let v of assignments[q.op].fre)
    e = c.call("rh_get", e, asBoxed(emitVarName(v, scope)).expr)
  return value.boxed(e)
}

// get: if the get is a filter (q.filter) whose gen<i> is in scope, it is
// gen<i>; otherwise rh_get(e1, e2).
let emitGet = (q, scope) => {
  if (settings.extractFilters && "filter" in q && q.filter in scope.gens)
    return scope.gens[q.filter]
  let [e1, e2] = q.arg
  if (e2.key == "var" && isDeepVarStr(e2.op)) todo("deep get", q)
  return value.boxed(c.call("rh_get", emitBoxed(e1, scope).expr, emitBoxed(e2, scope).expr))
}

// pure ops with an rh_pure_<op> in rhyme_rt.h, and their arity (-1: variadic)
let pureOps = {
  plus: 2, minus: 2, times: 2, fdiv: 2, div: 2, mod: 2, concat: 2,
  equal: 2, notEqual: 2,
  lessThan: 2, lessThanOrEqual: 2, greaterThan: 2, greaterThanOrEqual: 2,
  and: 2, andAlso: 2, orElse: 2, ifElse: 3,
  join: 1, flatten: -1,
  convert_u8: 1, convert_u16: 1, convert_u32: 1, convert_u64: 1,
  convert_i8: 1, convert_i16: 1, convert_i32: 1, convert_i64: 1,
  convert_f32: 1, convert_f64: 1, convert_string: 1,
}

// pure: rh_pure_<op>(args...). flatten is variadic and takes its argument
// count first. apply (udfs) is rejected: the callee is a JS closure.
let emitPure = (q, scope) => {
  if (q.op == "apply")
    throw new Error("c-new: user-defined functions are not supported -- " + pretty(q))
  let arity = pureOps[q.op]
  if (arity === undefined) todo("pure op " + q.op, q)
  let es = q.arg.map(x => emitBoxed(x, scope).expr)
  let f = "rh_pure_" + q.op
  if (arity == -1) return value.boxed(c.call(f, es.length, ...es))
  if (es.length != arity)
    throw new Error(`c-new: ${q.op} expects ${arity} arguments -- ` + pretty(q))
  return value.boxed(c.call(f, ...es))
}

let emitMkset = (q, scope) => value.boxed(c.call("rh_singleton", emitBoxed(q.arg[0], scope).expr))

// loadInput: only json with a constant filename, read at every reference
let emitLoadInput = (q, scope) => {
  if (q.op != "json") todo("loadInput " + q.op, q)
  let [e1] = q.arg
  if (e1.key != "const" || typeof e1.op != "string") todo("non-constant filename", q)
  let doc = c.call("rh_load_json", cStr(e1.op).lit)
  return value.boxed(c.call("rh_jsonv", c.call("yyjson_doc_get_root", doc)))
}

let emitExpr = (q, scope) => {
  let x = emitExpr1(q, scope)
  return { ...x, schema: x.schema ?? q.schema }
}

let emitBoxed = (q, scope) => asBoxed(emitExpr(q, scope))

let emitExpr1 = (q, scope) => {
  switch (q.key) {
    case "const": return emitConst(q, scope)
    case "var": return emitVar(q, scope)
    case "ref": return emitRef(q, scope)
    case "get": return emitGet(q, scope)
    case "pure": return emitPure(q, scope)
    case "mkset": return emitMkset(q, scope)
    case "loadInput": return emitLoadInput(q, scope)
    // the js backend's `inp`: the binary takes no input yet
    case "input": return todo("runtime input (inp)", q)
    case "hint": return todo("hint", q)
    case "mkTuple": return todo("mkTuple", q) // off by default for c-new
    case "stateful": case "prefix": case "update":
      throw new Error("c-new: unexpected nested assignment " + pretty(q))
    default:
      throw new Error("c-new: unknown expression " + pretty(q))
  }
}

// The constant a var is bound to, when every filter for it is mkset(const).
// A copy of simple-codegen.js's helper, over this file's filters.
let resolveConstForVar = s => {
  let c
  for (let f of filters) {
    let v1 = f.arg[1].op
    let g1 = f.arg[0]
    if (v1 == s && g1.key == "mkset" && g1.arg[0].key == "const") {
      if (c === undefined)
        c = g1.arg[0].op
      else
        return undefined
    }
  }
  return c
}


// ----- statement payloads -----

// reducers with an rh_stateful_<op> in rhyme_rt.h
let statefulOps = {
  sum: true, product: true, count: true, min: true, max: true,
  first: true, last: true, single: true, any: true, all: true, array: true,
}

let statefulInitRequired = q =>
  q.key == "stateful" && q.mode != "maybe" && (q.op + "_init") in runtime.stateful

// does the expression produce a value not aliased with any mutable one?
// (simple-codegen.js isFresh, minus udfs)
let isFresh = q => q.key == "const"

let checkStateful = q => {
  if (!statefulOps[q.op]) todo("stateful op " + q.op, q)
}

// tmp slots are rh_val storage, so both payloads below are boxed values.

// The initial value of a tmp slot (emitStmInit):
//   stateful   rh_stateful_<op>_init()
//   update     e0, or rh_map_copy(e0) unless mode inplace / e0 fresh
let emitInitValue = (q, scope) => {
  if (q.key == "stateful") {
    checkStateful(q)
    return value.boxed(c.call(`rh_stateful_${q.op}_init`))
  }
  if (q.key == "update") return todo("update init", q)
  throw new Error("c-new: unexpected init " + pretty(q))
}

// The new value of a tmp slot given its current value `cur`, C text of an
// rh_val lvalue (emitStmUpdate):
//   stateful   rh_stateful_<op>(cur, e1)
//   update     rh_stateful_update(cur, keys, n, e2)   -- NEW in rhyme_rt.h:
//              rt.stateful.update with an array key, i.e. rt.deepUpdate
//   prefix     not supported yet
let emitUpdateValue = (q, cur, scope) => {
  if (q.key == "stateful") {
    checkStateful(q)
    return value.boxed(c.call(`rh_stateful_${q.op}`, cur, emitBoxed(q.arg[0], scope).expr))
  }
  if (q.key == "update") return todo("update", q)
  if (q.key == "prefix") return todo("prefix", q)
  throw new Error("c-new: unexpected update " + pretty(q))
}


// ----- statements -----
//
// Each takes the statement and the scope, and pushes C lines to scope.buf.
// Bindings are declared in the enclosing C scope under names from declName,
// and recorded in the body's scope (vars, gens) for the expressions below.

// for v <- g (filter i):
//   constant-folded var  -> just the body
//   g = mkset(e)         -> rh_val v = e; if (!rh_is_undef(v)) { body }
//                           (gen<i> is v itself: mkset(e)[e] is e)
//   otherwise            -> rh_iter it = rh_iter_begin(g); rh_val v; rh_val gen<i>;
//                           while (rh_iter_next(&it, &v, &gen<i>)) { body }
let emitFor = (stm, scope) => {
  let [v1, i, g1] = stm.arg
  let buf = scope.buf
  let body = childScope(scope)

  if (isDeepVarStr(v1)) todo("for over deep var " + v1)

  if (foldedConst(v1)) {
    emitStmList(stm.body, body)
    return
  }

  // the generator is evaluated in the outer scope, before v is bound
  let src = emitBoxed(g1.key == "mkset" ? g1.arg[0] : g1, childScope(scope)).expr
  let v = declName(scope.ctx, cVar(v1))
  body.vars[v1] = value.boxed(v)

  if (g1.key == "mkset") {
    body.gens[i] = body.vars[v1]
    c.declareVar(buf)("rh_val", v, src)
    c.if(buf)(presentOf(body.vars[v1]), buf => {
      emitStmList(stm.body, body)
    })
  } else {
    let it = fresh(scope.ctx, "it")
    let gen = declName(scope.ctx, genSym(i))
    body.gens[i] = value.boxed(gen)
    c.declareVar(buf)("rh_iter", it, c.call("rh_iter_begin", src))
    c.declareVar(buf)("rh_val", v)
    c.declareVar(buf)("rh_val", gen)
    c.while(buf)(c.call("rh_iter_next", c.addr(it), c.addr(v), c.addr(gen)), buf => {
      emitStmList(stm.body, body)
    })
  }
}

// if v in g (filter i), v already bound:
//   constant-folded var  -> just the body
//   otherwise            -> rh_val gen<i> = rh_get(g, v); if (!rh_is_undef(gen<i>)) { body }
// The JS emitter writes `if (gen === undefined) continue`; nothing follows an
// `if` in its statement list, so wrapping the body is equivalent.
let emitIf = (stm, scope) => {
  let [v1, i, g1] = stm.arg
  let buf = scope.buf

  if (isDeepVarStr(v1)) todo("if on deep var " + v1)

  if (foldedConst(v1)) {
    emitStmList(stm.body, scope)
    return
  }

  let src = emitBoxed(g1, childScope(scope)).expr
  let key = asBoxed(emitVarName(v1, scope)).expr
  let gen = declName(scope.ctx, genSym(i))

  let body = childScope(scope)
  body.gens[i] = value.boxed(gen)

  c.declareVar(buf)("rh_val", gen, c.call("rh_get", src, key))
  c.if(buf)(presentOf(body.gens[i]), buf => {
    emitStmList(stm.body, body)
  })
}

// the slot tmp<i>[fre...], NULL if the walk bails (an undefined key)
let emitSlot = (stm, scope) => {
  let [lhs, q] = stm.arg
  let keys = q.fre.map(v => asBoxed(emitVarName(v, scope)).expr)
  return c.call("rh_slot", c.addr(tmpSym(lhs.op)), cKeys(keys))
}

// tmp<i>[fre...] ??= init  (rt.init):
//   { rh_val *p = rh_slot(&tmp<i>, keys, n); if (p && rh_is_nullish(*p)) *p = <init>; }
// init is evaluated only when the slot is empty, as JS's ??= does.
let emitInitStm = (stm, scope) => {
  let [lhs, q] = stm.arg
  let buf = scope.buf
  if (q.fre.length == 0) {
    c.stmt(buf)(c.assign(tmpSym(lhs.op), asBoxed(emitInitValue(q, scope)).expr))
  } else {
    let slot = fresh(scope.ctx, "x")
    c.declarePtr(buf)("rh_val", slot, emitSlot(stm, scope))
    c.if(buf)(c.and(slot, c.call("rh_is_undef", c.deref(slot))), buf => {
      c.stmt(buf)(c.assign(c.deref(slot), asBoxed(emitInitValue(q, scope)).expr))
    })
  }
}

// tmp<i>[fre...] = fold(tmp<i>[fre...])  (rt.update):
//   { rh_val *p = rh_slot(&tmp<i>, keys, n); if (p) *p = <update(*p)>; }
let emitUpdateStm = (stm, scope) => {
  let [lhs, q] = stm.arg
  let buf = scope.buf
  if (q.fre.length == 0) {
    let tmp = tmpSym(lhs.op)
    c.stmt(buf)(c.assign(tmp, asBoxed(emitUpdateValue(q, tmp, scope)).expr))
  } else {
    let slot = fresh(scope.ctx, "x")
    c.declarePtr(buf)("rh_val", slot, emitSlot(stm, scope))
    c.if(buf)(slot, buf => {
      c.stmt(buf)(c.assign(c.deref(slot), asBoxed(emitUpdateValue(q, c.deref(slot), scope)).expr))
    })
  }
}

// projections (emitFilters1's PROJECT / TRAVERSE):
//   declareTemp    rh_val proj<id> = rh_undef;   (rh_slot vivifies the map)
//   initTemp       { rh_val *p = rh_slot(&proj<id>, keys, n); if (p && rh_is_nullish(*p)) *p = rh_bool(true); }
//   forTempMult    one nested rh_iter loop per var, over proj<id>, then
//                  rh_get(proj<id>, x1), ... -- keys come back as strings, as
//                  JS for-in's do. Constant-folded vars are skipped.
let emitDeclareTemp = (stm, scope) => todo("declareTemp")
let emitInitTemp = (stm, scope) => todo("initTemp")
let emitForTempMult = (stm, scope) => todo("forTempMult")

// return q: print the result as JSON and exit
let emitReturn = (stm, scope) => {
  let buf = scope.buf
  c.stmt(buf)(c.call("rh_print_val", emitBoxed(stm.arg[0], scope).expr))
  c.stmt(buf)(c.call("putchar", "'\\n'"))
  c.return(buf)("0")
}

let emitStmList = (stms, scope) => {
  for (let stm of stms) {
    if (typeof stm == "string") {
      // loopgen comments, e.g. "// --- tmp0 ---"
      if (stm) scope.buf.push(stm.startsWith("//") ? stm : "// " + stm)
      continue
    }
    switch (stm.key) {
      case "for": emitFor(stm, scope); break
      case "if": emitIf(stm, scope); break
      case "init": emitInitStm(stm, scope); break
      case "update": emitUpdateStm(stm, scope); break
      case "declareTemp": emitDeclareTemp(stm, scope); break
      case "initTemp": emitInitTemp(stm, scope); break
      case "forTempMult": emitForTempMult(stm, scope); break
      case "return": emitReturn(stm, scope); break
      // emitted by neither loopgen today; listed so they fail loudly
      case "let": case "forTemp": case "raw":
      default:
        throw new Error("c-new: unknown statement " + stm.key)
    }
  }
}


// ----- program -----

// loops: the loopgen statement list. ir: simple-eval's backendIR (settings,
// filters, assignments, ...), which the statements refer to by index.
let emitCodeLowLevelC = (loops, ir) => {
  setState(ir)

  let ctx = newCtx()
  assignments.forEach((_, i) => ctx.declared.add(tmpSym(i)))
  let body = []
  let scope = { buf: body, vars: {}, gens: {}, ctx }
  emitStmList(loops, scope)

  // one boxed slot per assignment; rh_slot vivifies maps below it
  let tmps = []
  assignments.forEach((_, i) => c.declareVar(tmps)("rh_val", tmpSym(i), "rh_undef"))

  let buf = []
  buf.push(`#include "rhyme_rt.h"`)
  buf.push(``)
  buf.push(`int main(void) {`)
  buf.push(...indent([...tmps, ...body]))
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
