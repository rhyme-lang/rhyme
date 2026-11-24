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
// Stage 1 (this file, now): fully boxed. Every Rhyme value is an rh_val, every
// operation a call into rhyme_rt.h. No type-directed specialization yet.
// Common subexpressions (gets, refs, pure ops) are computed once per block
// (see "common subexpressions" below), and each input file is parsed once.
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
//   loadJSON "f"        rh_val in<k>, loaded once at the top of main()

const build = require("./cgen/build")
const { runtime } = require("./simple-runtime")
const { pretty } = require("./prettyprint")
const { value, asBoxed, presentOf } = require("./cnew/value")
const { c, cVar, tmpSym, genSym, projSym, cStr, cKeys, indent } = require("./cnew/utils")


// ----- state -----

let settings
let filters
let assignments

let usesInput // set by emitInput: main() then parses inp from argv[1]
let inputFiles // loadJSON path -> its local in main(), loaded once at the top

let setState = ir => {
  settings = ir.settings
  filters = ir.filters
  assignments = ir.assignments
  usesInput = false
  inputFiles = new Map()
}

// Unimplemented constructs fail at compile time with the offending term,
// rather than producing C that fails in the C compiler or, worse, runs.
let todo = (what, q) => {
  throw new Error("c-new: not implemented: " + what + (q ? " -- " + pretty(q) : ""))
}


let isDeepVarStr = s => s.startsWith("**")


// ----- C names -----
//
// Loop bindings keep the names they have in the source, so the C reads like
// the query: the var's own name (cVar: K1, D0, *A -> xA), gen<i> for filter i,
// tmp<i> for tmp i. Loopgen routinely emits sibling loops over the same var
// (the init nest and the update nest of a tmp both iterate D0), so each loop
// is wrapped in a block of its own (see emitFor) and the names can repeat.
// None of them can shadow a binding still in use: a var and a filter are bound
// at most once along a nest.
//
// Temporary locals -- iterators, slot pointers, values, shared subexpressions
// -- have no source name and get a counter instead (it0, p1, v2, e3, ...),
// unique across main(). No cVar starts with it, p, v or e (user vars become
// x..., loopgen's are K<n> / D<n>).

let newCtx = () => ({ fresh: 0 })

let fresh = (ctx, prefix) => prefix + (ctx.fresh++)

// A scope mirrors emitStmListLowLevel's, with the C side of each binding:
//   buf    the line buffer being written
//   vars   Rhyme var -> the value it is bound to (cnew/value.js)
//   gens   filter index -> the value of gen<i>, for filters in scope
//   cse    the shared-subexpression table of the current C block (below)
//   ctx    the per-program counter for fresh names
// A child scope is a new C block: emitters open one for every { they emit
// expressions into.
let childScope = scope => ({
  ...scope, vars: { ...scope.vars }, gens: { ...scope.gens }, cse: newLayer(scope.cse),
})


// ----- common subexpressions -----
//
// Local value numbering over the C blocks. The first time an expression is
// emitted in a block it is declared as a local, rh_val e<n> = <text>;, at
// that point, and later emissions of the same text in that block or any block
// nested in it read e<n>. The key is the C text itself: arguments are already
// replaced by their locals, so it is short, and it identifies equal
// expressions whatever IR nodes they came from (a genref's fallback, a soft
// get, a filter's generator).
//
// Nothing moves: a local is computed where the expression was computed
// before, so conditional evaluation (init's ??=) is unchanged. A block's
// entries die with it, as its C locals do.
//
// Every value carries deps, the C names its text reads. An entry is dropped
// (kill) when one of them may have changed:
//   tmp<i>     a write to tmp<i> (init, update) kills the reads through it;
//   proj<id>   likewise for a projection (declareTemp, initTemp)
//   HEAP       every read through any tmp or projection. Killed by a write
//              that may mutate a map another tmp also reaches (killsOf):
//              an object update whose base e0 is not fresh, and that is
//              inplace (the slot is e0's map itself) or stores two or more
//              levels below the slot (into a nested map the shallow copy
//              shares with e0's source -- in JS too).
//   a binding  a loop var or gen<i> declared again (shadowing), defensively
// A loop kills, on entry, whatever its body's writes would: an entry made
// before the loop would be stale from the second iteration on.
//
// Loopgen reads a tmp only after the nest that builds it, so in practice the
// per-tmp kills find nothing to drop; they guard that invariant, which is not
// checked anywhere, rather than enforce it.
//
// Not shared: values that may be a fresh container ({} and [] constants,
// mkset, mkTuple, flatten, singleton) or computed from one: two uses must get
// two containers, since either may be stored and then mutated. Bare names and
// constants are not worth a local.
//
// settings.cse = false turns it off (for comparisons).

const HEAP = "$heap"
const NO_DEPS = new Set()

let depsOf = x => x.deps ?? NO_DEPS
let unionDeps = xs => {
  let s = new Set()
  for (let x of xs) for (let d of depsOf(x)) s.add(d)
  return s
}

// a value read from a C name: a loop binding, gen<i>, tmp<i>, proj<id>
let bound = (name, deps = []) => ({ ...value.boxed(name), deps: new Set([name, ...deps]) })

let newLayer = parent => ({ entries: new Map(), parent })

let lookup = (layer, text) => {
  for (let l = layer; l; l = l.parent) if (l.entries.has(text)) return l.entries.get(text)
}

let kill = (scope, name) => {
  for (let l = scope.cse; l; l = l.parent)
    for (let [k, v] of l.entries) if (v.deps.has(name)) l.entries.delete(k)
}

let cseOn = () => settings.cse !== false

// f(args...) as a value, shared through the block's table
let shareCall = (scope, f, args) => {
  let text = c.call(f, ...args.map(x => asBoxed(x).expr))
  let deps = unionDeps(args)
  if (args.some(x => x.fresh)) return { ...value.boxed(text), deps, fresh: true }
  if (!cseOn()) return { ...value.boxed(text), deps }
  let hit = lookup(scope.cse, text)
  if (hit) return hit
  let e = fresh(scope.ctx, "e")
  c.declareVar(scope.buf)("rh_val", e, text)
  let x = { ...value.boxed(e), deps }
  scope.cse.entries.set(text, x)
  return x
}

// record that gen = rh_get(src, key) in this block, so a get of the same
// text reuses the gen (a raw get re-evaluating a filter, hard mode)
// (with src's deps: over a tmp, a write to it must kill the entry)
let rememberGet = (scope, src, key, gen) => {
  if (!cseOn() || src.fresh) return
  let text = c.call("rh_get", asBoxed(src).expr, asBoxed(key).expr)
  scope.cse.entries.set(text, { ...gen, deps: unionDeps([gen, src, key]) })
}

// the deps a statement's writes invalidate, recursively through its body
let killsOf = stm => {
  if (typeof stm == "string") return []
  switch (stm.key) {
    case "declareTemp": case "initTemp": return [projSym(stm.arg[0])]
    case "init": case "update": {
      let [lhs, q] = stm.arg
      // an object update that may mutate a map another tmp also reaches
      let alias = q.key == "update" && !isFresh(q.arg[0]) &&
        (q.mode == "inplace" || q.arg[1].vars.length > 1)
      return [alias ? HEAP : tmpSym(lhs.op)]
    }
    default: return (stm.body ?? []).flatMap(killsOf)
  }
}

// drop what the statements' writes invalidate: after a write statement, and
// before a loop for its whole body
let killWrites = (scope, stms) => { for (let d of stms.flatMap(killsOf)) kill(scope, d) }


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

// {} and [] are fresh containers (see common subexpressions)
let emitConst = (q, scope) => ({ ...value.boxed(cConst(q.op)), fresh: typeof q.op == "object" && q.op !== null })

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

// domref: an outer join var's domain proj<id> (see emitDeclareTemp), indexed
// by the vars it depends on; constant-folded vars are dropped, as initTemp
// drops them
let emitDomref = (q, scope) => {
  let e = bound(projSym(q.op), [HEAP])
  for (let v of projIter(q.arg.map(x => x.op), "domain"))
    e = shareCall(scope, "rh_get", [e, emitVarName(v, scope)])
  return e
}

// ref: tmp<i> indexed by the assignment's free vars, as rh_get chains:
//   tmp1[K1]  ->  rh_get(tmp1, K1)
let emitRef = (q, scope) => {
  let e = bound(tmpSym(q.op), [HEAP])
  for (let v of assignments[q.op].fre)
    e = shareCall(scope, "rh_get", [e, emitVarName(v, scope)])
  return e
}

// get: if the get is a filter (q.filter) whose gen<i> is in scope, it is
// gen<i>; otherwise rh_get(e1, e2). This is soft mode (extractFiltersHard
// off), where extract3 leaves the get in place and tags it.
let emitGet = (q, scope) => {
  if (settings.extractFilters && "filter" in q && q.filter in scope.gens)
    return scope.gens[q.filter]
  let [e1, e2] = q.arg
  if (e2.key == "var" && isDeepVarStr(e2.op)) todo("deep get", q)
  return shareCall(scope, "rh_get", [emitExpr(e1, scope), emitExpr(e2, scope)])
}

// genref: hard mode (extractFiltersHard), where extract3 replaces a filter's
// get by a reference to filters[i]. gen<i> when filter i is in scope;
// otherwise -- after a projection, whose traversal binds the vars but not the
// gens -- the filter's own expression, evaluated again.
//
// The JS emitter declares the missing gen lazily (`let gen<i> = ...`) and
// reuses it. Here that is not safe: the declaration would land in whatever C
// block is open at that point (an init's `if (nullish) { ... }`, say), and a
// later statement reusing the name would be outside it. Re-evaluating costs
// what soft mode already pays for such a get.
let emitGenref = (q, scope) => {
  if (q.op in scope.gens) return scope.gens[q.op]
  return emitExpr(filters[q.op], scope)
}

// pure ops with an rh_pure_<op> in rhyme_rt.h, and their arity (-1: variadic)
let pureOps = {
  plus: 2, minus: 2, times: 2, fdiv: 2, div: 2, mod: 2, concat: 2,
  equal: 2, notEqual: 2,
  lessThan: 2, lessThanOrEqual: 2, greaterThan: 2, greaterThanOrEqual: 2,
  and: 2, andAlso: 2, orElse: 2, ifElse: 3,
  join: 1, flatten: -1,
  singleton: 1, asObj: 1, asNum: 1,
  convert_u8: 1, convert_u16: 1, convert_u32: 1, convert_u64: 1,
  convert_i8: 1, convert_i16: 1, convert_i32: 1, convert_i64: 1,
  convert_f32: 1, convert_f64: 1, convert_string: 1,
}

// pure ops whose result may be a fresh container: not shared
let freshPureOps = { flatten: true, singleton: true }

// pure: rh_pure_<op>(args...). flatten is variadic and takes its argument
// count first. apply (udfs) is rejected: the callee is a JS closure.
let emitPure = (q, scope) => {
  if (q.op == "apply")
    throw new Error("c-new: user-defined functions are not supported -- " + pretty(q))
  let arity = pureOps[q.op]
  if (arity === undefined) todo("pure op " + q.op, q)
  let xs = q.arg.map(x => emitExpr(x, scope))
  let f = "rh_pure_" + q.op
  if (arity != -1 && xs.length != arity)
    throw new Error(`c-new: ${q.op} expects ${arity} arguments -- ` + pretty(q))
  if (freshPureOps[q.op]) return freshCall(f, arity == -1 ? [xs.length] : [], xs)
  return shareCall(scope, f, xs)
}

// a call making a fresh container: never shared
let freshCall = (f, pre, xs) =>
  ({ ...value.boxed(c.call(f, ...pre, ...xs.map(x => asBoxed(x).expr))), deps: unionDeps(xs), fresh: true })

let emitMkset = (q, scope) => freshCall("rh_singleton", [], [emitExpr(q.arg[0], scope)])

// mkTuple (settings.mkTuple): rh_mktuple(n, k1, v1, k2, v2, ...)
let emitMkTuple = (q, scope) => {
  let xs = q.arg.map(x => emitExpr(x, scope))
  return freshCall("rh_mktuple", [xs.length], xs)
}

// loadJSON "f": each distinct path is parsed once, into a local declared at
// the top of main() (emitCodeLowLevelC), and every reference reads that local
// -- as rt.loadJSON caches per path. Only constant paths, so the set of files
// is known statically; a dynamic path would need a runtime cache instead.
//
// Unlike JS, which loads on first evaluation, every file is loaded up front:
// a missing file fails the query even if the load would never be reached.
let emitLoadInput = (q, scope) => {
  if (q.op != "json") todo("loadInput " + q.op, q)
  let [e1] = q.arg
  if (e1.key != "const" || typeof e1.op != "string") todo("non-constant filename", q)
  if (!inputFiles.has(e1.op)) inputFiles.set(e1.op, "in" + inputFiles.size)
  return value.boxed(inputFiles.get(e1.op))
}

// input: the query's argument, parsed once from argv[1] at the top of main()
let emitInput = (q, scope) => {
  usesInput = true
  return value.boxed("inp")
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
    case "genref": return emitGenref(q, scope)
    case "domref": return emitDomref(q, scope)
    case "get": return emitGet(q, scope)
    case "pure": return emitPure(q, scope)
    case "mkset": return emitMkset(q, scope)
    case "loadInput": return emitLoadInput(q, scope)
    // the js backend's `inp`: parsed from argv[1]
    case "input": return emitInput(q, scope)
    // a hint only informs the analysis; as a value it is {}, as in JS
    case "hint": return { ...value.boxed(cConst({})), fresh: true }
    case "mkTuple": return emitMkTuple(q, scope)
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
  mkset: true,
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
  if (q.key == "update") {
    // the copy matters: the same e0 seeds this slot for every value of the
    // keys outside its own path, and they must not share one map
    let e0 = emitBoxed(q.arg[0], scope).expr
    return value.boxed(q.mode == "inplace" || isFresh(q.arg[0]) ? e0 : c.call("rh_map_copy", e0))
  }
  throw new Error("c-new: unexpected init " + pretty(q))
}

// The new value of a tmp slot given its current value `cur`, C text of an
// rh_val lvalue (emitStmUpdate):
//   stateful   rh_stateful_<op>(cur, e1)
//   prefix     not supported yet
// update is not a fold over the slot but a store below it; see emitUpdateStm.
let emitUpdateValue = (q, cur, scope) => {
  if (q.key == "stateful") {
    checkStateful(q)
    return value.boxed(c.call(`rh_stateful_${q.op}`, cur, emitBoxed(q.arg[0], scope).expr))
  }
  if (q.key == "prefix") return todo("prefix", q)
  throw new Error("c-new: unexpected update " + pretty(q))
}


// ----- statements -----
//
// Each takes the statement and the scope, and pushes C lines to scope.buf.
// Loop bindings are declared in a block around the loop (see C names above),
// and recorded in the body's scope (vars, gens) for the expressions
// below.

// for v <- g (filter i):
//   constant-folded var  -> just the body
//   g = mkset(e)         -> { rh_val v = e; if (!rh_is_undef(v)) { body } }
//                           (gen<i> is v itself: mkset(e)[e] is e)
//   otherwise            -> { rh_iter it<n> = rh_iter_begin(g); rh_val v; rh_val gen<i>;
//                             while (rh_iter_next(&it<n>, &v, &gen<i>)) { body } }
// The block scopes the loop's bindings to the loop.
let emitFor = (stm, scope) => {
  let [v1, i, g1] = stm.arg
  let buf = scope.buf

  if (isDeepVarStr(v1)) todo("for over deep var " + v1)

  if (foldedConst(v1)) {
    emitStmList(stm.body, childScope(scope))
    return
  }

  // the generator is evaluated in the outer scope, before v is bound
  let srcV = emitExpr(g1.key == "mkset" ? g1.arg[0] : g1, scope)
  let src = asBoxed(srcV).expr
  let v = cVar(v1)
  let gen = genSym(i)
  kill(scope, v); kill(scope, gen)

  if (g1.key == "mkset") {
    let body = childScope(scope)
    body.vars[v1] = body.gens[i] = bound(v)
    c.block(buf)(buf => {
      c.declareVar(buf)("rh_val", v, src)
      c.if(buf)(presentOf(body.vars[v1]), buf => {
        emitStmList(stm.body, body)
      })
    })
  } else {
    killWrites(scope, stm.body)
    let body = childScope(scope)
    body.vars[v1] = bound(v)
    body.gens[i] = bound(gen)
    rememberGet(body, srcV, body.vars[v1], body.gens[i])
    let it = fresh(scope.ctx, "it")
    c.block(buf)(buf => {
      c.declareVar(buf)("rh_iter", it, c.call("rh_iter_begin", src))
      c.declareVar(buf)("rh_val", v)
      c.declareVar(buf)("rh_val", gen)
      c.while(buf)(c.call("rh_iter_next", c.addr(it), c.addr(v), c.addr(gen)), buf => {
        emitStmList(stm.body, body)
      })
    })
  }
}

// if v in g (filter i), v already bound:
//   constant-folded var  -> just the body
//   otherwise            -> { rh_val gen<i> = rh_get(g, v); if (!rh_is_undef(gen<i>)) { body } }
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

  let src = emitExpr(g1, scope)
  let key = emitVarName(v1, scope)
  let gen = genSym(i)
  kill(scope, gen)

  // an rh_get already computed here serves as the gen; otherwise gen<i>
  // is declared, and recorded for later gets of the same text
  let text = c.call("rh_get", asBoxed(src).expr, asBoxed(key).expr)
  let hit = cseOn() && !src.fresh && lookup(scope.cse, text)
  let body = childScope(scope)
  body.gens[i] = hit || bound(gen, unionDeps([src, key]))

  c.block(buf)(buf => {
    if (!hit) {
      c.declareVar(buf)("rh_val", gen, text)
      rememberGet(body, src, key, body.gens[i])
    }
    c.if(buf)(presentOf(body.gens[i]), buf => {
      emitStmList(stm.body, body)
    })
  })
}

// the slot tmp<i>[fre..., extra...], NULL if the walk bails (an undefined key
// or a non-object on the way).
//
// Only the update store can see NULL. Init and fold paths are the tmp's own
// fre: every key is a bound var, never undefined, and every level above the
// slot is a map rh_slot itself created -- so they use the pointer unchecked,
// as rt.init / rt.update do.
let emitSlot = (stm, scope, extra = []) => {
  let [lhs, q] = stm.arg
  let keys = [...q.fre, ...extra].map(v => asBoxed(emitVarName(v, scope)).expr)
  return c.call("rh_slot", c.addr(tmpSym(lhs.op)), cKeys(keys))
}

// tmp<i>[fre...] ??= init  (rt.init):
//   rh_val *p<n> = rh_slot(&tmp<i>, keys, n); if (rh_is_nullish(*p<n>)) *p<n> = <init>;
// init is evaluated only when the slot is empty, as JS's ??= does.
let emitInitStm = (stm, scope) => {
  let [lhs, q] = stm.arg
  let buf = scope.buf
  c.comment(buf)(`init ${pretty(lhs)} = ${pretty(q)}`)
  if (q.fre.length == 0) {
    c.stmt(buf)(c.assign(tmpSym(lhs.op), asBoxed(emitInitValue(q, scope)).expr))
  } else {
    let slot = fresh(scope.ctx, "p")
    c.declarePtr(buf)("rh_val", slot, emitSlot(stm, scope))
    c.if(buf)(c.call("rh_is_nullish", c.deref(slot)), buf => {
      c.stmt(buf)(c.assign(c.deref(slot), asBoxed(emitInitValue(q, childScope(scope))).expr))
    })
  }
  killWrites(scope, [stm])
}

// tmp<i>[fre...] = fold(tmp<i>[fre...])  (rt.update):
//   rh_val *p<n> = rh_slot(&tmp<i>, keys, n); *p<n> = <update(*p<n>)>;
//
// update (rt.stateful.update([K...], e2), i.e. rt.deepUpdate) is a store at
// tmp<i>[fre..., K...] instead, one rh_slot walk over the combined path --
// rh_slot vivifies each level, as deepUpdate does:
//   rh_val v<n> = e2; if (!rh_is_undef(v<n>)) { rh_val *p<m> = rh_slot(...); if (p<m>) *p<m> = v<n>; }
// e2 comes first: an undefined value writes nothing, not even the levels.
let emitUpdateStm = (stm, scope) => {
  let [lhs, q] = stm.arg
  let buf = scope.buf
  c.comment(buf)(`update ${pretty(lhs)} = ${pretty(q)}`)
  if (q.key == "update") {
    let v = fresh(scope.ctx, "v")
    c.declareVar(buf)("rh_val", v, emitBoxed(q.arg[2], scope).expr)
    c.if(buf)(c.not(c.call("rh_is_undef", v)), buf => {
      let slot = fresh(scope.ctx, "p")
      c.declarePtr(buf)("rh_val", slot, emitSlot(stm, childScope(scope), q.arg[1].vars))
      c.if(buf)(slot, buf => {
        c.stmt(buf)(c.assign(c.deref(slot), v))
      })
    })
  } else if (q.fre.length == 0) {
    let tmp = tmpSym(lhs.op)
    c.stmt(buf)(c.assign(tmp, asBoxed(emitUpdateValue(q, tmp, scope)).expr))
  } else {
    let slot = fresh(scope.ctx, "p")
    c.declarePtr(buf)("rh_val", slot, emitSlot(stm, scope))
    c.stmt(buf)(c.assign(c.deref(slot), asBoxed(emitUpdateValue(q, c.deref(slot), scope)).expr))
  }
  killWrites(scope, [stm])
}

// projections: a set of key paths, proj<id>[x1][x2]... = true. simple-loopgen
// builds one in two places:
//
//   PROJECT / TRAVERSE (emitFilters1): the distinct bindings of iter, then a
//   loop over them (forTempMult)
//   DOMAIN (emitDomains, outer joins): the domain of a maybe-only var, read
//   back through domref generators (forTemp, or an if over a domref)
//
//   declareTemp    rh_val proj<id> = {};
//   initTemp       rh_val *p<n> = rh_slot(&proj<id>, keys, n);
//                  if (p<n> && rh_is_nullish(*p<n>)) *p<n> = true;
//   forTempMult    one nested rh_iter loop per var, over proj<id>, then
//                  rh_get(proj<id>, x1), ...
//
// Map keys are strings, so the vars come back as strings, as JS for-in's do.
// Constant-folded vars are dropped from the path, as the JS emitter does.
// Deep vars are stored encoded in JS (rt.encodeTemp); not supported yet.

let projIter = (iter, what) => {
  for (let x of iter) if (isDeepVarStr(x)) todo(what + " over deep var " + x)
  return iter.filter(x => !foldedConst(x))
}

let emitDeclareTemp = (stm, scope) => {
  let [id] = stm.arg
  c.declareVar(scope.buf)("rh_val", projSym(id), c.call("rh_mapv", c.call("rh_map_new")))
  killWrites(scope, [stm])
}

let emitInitTemp = (stm, scope) => {
  let [id, iter] = stm.arg
  let buf = scope.buf
  let keys = projIter(iter, "projection").map(v => asBoxed(emitVarName(v, scope)).expr)
  let slot = fresh(scope.ctx, "p")
  c.declarePtr(buf)("rh_val", slot, c.call("rh_slot", c.addr(projSym(id)), cKeys(keys)))
  c.if(buf)(c.and(slot, c.call("rh_is_nullish", c.deref(slot))), buf => {
    c.stmt(buf)(c.assign(c.deref(slot), c.call("rh_bool", true)))
  })
  killWrites(scope, [stm])
}

// a loop over the keys of src, binding v1 in body; the value goes to a
// scratch local nothing reads
let emitKeyLoop = (buf, v1, src, body, inner) => {
  let it = fresh(body.ctx, "it")
  let val = fresh(body.ctx, "v")
  let v = cVar(v1)
  kill(body, v)
  body.vars[v1] = bound(v)
  c.block(buf)(buf => {
    c.declareVar(buf)("rh_iter", it, c.call("rh_iter_begin", src))
    c.declareVar(buf)("rh_val", v)
    c.declareVar(buf)("rh_val", val)
    c.while(buf)(c.call("rh_iter_next", c.addr(it), c.addr(v), c.addr(val)), inner)
  })
}

let emitForTempMult = (stm, scope) => {
  let [id, iter] = stm.arg
  killWrites(scope, stm.body)
  let body = childScope(scope)
  let loop = (buf, xs, src) => {
    if (xs.length == 0) {
      emitStmList(stm.body, { ...body, buf })
      return
    }
    let [x, ...rest] = xs
    emitKeyLoop(buf, x, src, body, buf =>
      loop(buf, rest, c.call("rh_get", src, cVar(x))))
  }
  loop(scope.buf, projIter(iter, "traversal"), projSym(id))
}

// for v in domref: the keys of the domain (a domain holds no gen value)
let emitForTemp = (stm, scope) => {
  let [v1, g1] = stm.arg
  if (isDeepVarStr(v1)) todo("forTemp over deep var " + v1)
  if (foldedConst(v1)) {
    emitStmList(stm.body, scope)
    return
  }
  let src = emitBoxed(g1, scope).expr
  killWrites(scope, stm.body)
  let body = childScope(scope)
  emitKeyLoop(scope.buf, v1, src, body, buf => emitStmList(stm.body, { ...body, buf }))
}

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
      case "forTemp": emitForTemp(stm, scope); break
      case "return": emitReturn(stm, scope); break
      // emitted by neither loopgen today; listed so they fail loudly
      case "let": case "raw":
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

  let body = []
  let scope = { buf: body, vars: {}, gens: {}, cse: newLayer(null), ctx: newCtx() }
  emitStmList(loops, scope)

  // one boxed slot per assignment; rh_slot vivifies maps below it
  let tmps = []
  if (usesInput) c.declareVar(tmps)("rh_val", "inp", c.call("rh_read_input", "argc", "argv"))
  for (let [file, sym] of inputFiles) {
    let doc = c.call("rh_load_json", cStr(file).lit)
    c.declareVar(tmps)("rh_val", sym, c.call("rh_jsonv", c.call("yyjson_doc_get_root", doc)))
  }
  assignments.forEach((_, i) => c.declareVar(tmps)("rh_val", tmpSym(i), "rh_undef"))

  let buf = []
  buf.push(`#include "rhyme_rt.h"`)
  buf.push(``)
  buf.push(usesInput ? `int main(int argc, char **argv) {` : `int main(void) {`)
  buf.push(...indent([...tmps, ...body]))
  buf.push(`}`)
  return buf.join("\n") + "\n"
}

// Write the emitted program, compile it, and resolve to a function that runs
// the binary and returns its stdout. `explain` is the caller's explain record
// (the same one the js backend attaches); the C file and binary paths are
// added to it.
let buildCount = 0

let buildBinary = (code, settings = {}, explain = {}) => {
  const fs = require('fs').promises
  const path = require('path')
  const paths = require('./cgen/paths')

  // The default name is unique per build: builds into one directory may run
  // concurrently (a test compiling under both loopgens, parallel jest workers
  // sharing out/), and the binary is run later, when its function is called.
  let outFile = settings.outFile || `tmp_${process.pid}_${buildCount++}`
  let outDir = settings.outDir || paths.defaultOutDir()
  let cFile = path.join(outDir, outFile + ".c")
  let out = path.join(outDir, outFile)

  // The input goes to the binary as JSON text in argv[1] (none: no argument,
  // which it reads as undefined). Resolves to the raw stdout. An argument is
  // size-limited (128 KB on Linux), so this is for small inputs.
  async function func(input) {
    // path.resolve so that an absolute outDir works: a bare relative name
    // would be looked up on PATH rather than in outDir
    return build.run(path.resolve(out), input === undefined ? [] : [JSON.stringify(input)])
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
