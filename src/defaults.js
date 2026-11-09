// Inferred defaults for empty loops (setting 'inferDefaults').
//
// Implements the translation D of the PLDI'27 draft (Figure 6, "the
// translation and its guards"): every sum and every group receives a
// default that applies when no iteration succeeds,
//
//   D(sum t)      = sum? D(t)      || (G & 0)
//   D({ *i: t })  = { *i: D(t) }?  || (G & z)
//
// where the guard G is computed from the translated body by the domain
// check C, and the default z of a group is the shape Z of its collections
// ({} for maps, n for the number n). Loops written without a default
// (sum?, group?) are kept as they are; their bodies are translated.
//
// The pass runs after extract0, on a tree annotated by inferDims and
// inferBound (simple-eval.js), and reads the binders of each loop from
// 'bnd'. A Rhyme loop may bind several variables; the domain check takes
// the set of them as I. Its output is an unannotated tree in which every
// loop is a core loop (sum?, group?), so the rest of the pipeline treats
// it like any other query.
//
// Paper -> IR:
//
//   Σi.t            { key: "stateful", op: "sum", bnd: [i] }
//   Λi.t            { key: "update", arg: [{}/undefined, *i, t] }
//   t1 ∥ t2, t1 & t2   pure orElse, pure and
//   asfun, asnum    pure asObj, pure asNum
//   ⟨t⟩             pure singleton / mkset
//
// A lookup p.*x is a generator of *x; every other lookup, e.g. p.(1 & *x)
// or p.(9), is a filter. A maybe lookup p.*x? is a filter if *x also has a
// strict generator, and a generator otherwise (outer joins).
//
// Not supported: other aggregates (count, min, array, ...), prefix
// aggregates, non-strict primitives inside loops (ifElse, isUndef, udf
// apply), 'single' that binds variables, and groups that extend a
// non-empty map. Records with constant keys are built as before; their
// domain check and shape combine their parts like a strict operator.
//
// The input tree carries the annotations of inferDims and inferBound
// (vars, mind, dims, bnd, and placeholder keys replaced by 'vars'), and
// compile infers them again on the output. So the output must not share
// nodes with the input: every node is built anew (translate, clone), and
// strip removes the annotations.
//
// Rhyme variables are global to a query, so a guard that binds a loop
// variable itself (the case "i must take real keys") uses a fresh copy.

const { sets } = require('./shared')
const { unique, union, intersect, diff } = sets

let fail = msg => { throw new Error("inferDefaults: " + msg) }

// ----- node constructors -----

let cnst = op => ({ key: "const", op, arg: [] })
let one = () => cnst(1)
let emp = () => cnst({})
let vr = x => ({ key: "var", op: x, arg: [] })
let pure = (op, ...arg) => ({ key: "pure", op, arg })
let and = (a, b) => pure("and", a, b)
let or = (a, b) => pure("orElse", a, b)
let get = (a, b) => ({ key: "get", arg: [a, b] })

let isStateful = q => q.key == "stateful" || q.key == "update"

// the body of a group must be stateful (cf. extractFlex0)
let single = q => isStateful(q) ? q :
  { key: "stateful", op: "single", mode: "reluctant", arg: [q], bnd: [] }

let groupQ = (x, body) =>
  ({ key: "update", arg: [cnst(undefined), vr(x), single(body)], bnd: [x] })

// leaf(t) = asnum(t) ∥ (asfun(t) & {})
let leaf = t => or(pure("asNum", t), and(pure("asObj", clone(t)), emp()))

// t1 ⊓ t2 = ⟨asnum t1⟩_{t2} ∥ (asfun t1 & asfun t2 & {})
let meet = (x, y) => or(
  get(pure("singleton", pure("asNum", x)), y),
  and(pure("asObj", clone(x)), and(pure("asObj", clone(y)), emp())))

let omeet = (x, y) => x && y ? meet(x, y) : (x || y)

// ----- trees -----

let clone = q => ({ ...q, arg: q.arg?.map(clone), bnd: q.bnd && [...q.bnd] })

let rename = (q, m) => {
  let r = x => m[x] ?? x
  let q1 = { ...q, arg: q.arg?.map(e => rename(e, m)), bnd: q.bnd?.map(r) }
  if (q.key == "var") q1.op = r(q.op)
  return q1
}

// free variables: loops bind the variables in 'bnd'
let fv = q => {
  if (q.key == "var") return [q.op]
  let vs = unique((q.arg ?? []).flatMap(fv))
  if (q.key == "stateful" || q.key == "update" || q.key == "prefix")
    vs = diff(vs, q.bnd ?? [])
  return vs
}

let mentions = (q, xs) => intersect(fv(q), xs).length > 0

let isLoop = q =>
  (q.key == "stateful" && (q.op == "sum" || q.op == "single")) ||
  (q.key == "update" && !q._rec)

// the body of a loop node
let body = q => q.key == "update" ? q.arg[2] : q.arg[0]

let isEmptyObj = op => op && typeof op == "object" && !Array.isArray(op) &&
  Object.keys(op).length == 0

// a lookup whose key is a constant-key record field: update(e0, K, v, mkset(c).K)
let isRecordField = q => q.key == "update" && q.arg.length == 4 &&
  q.arg[3].key == "get" && q.arg[3].arg[0].key == "mkset" &&
  q.arg[3].arg[0].arg[0].key == "const"

let strictPure = op => op != "orElse" && op != "ifElse" && op != "isUndef" && op != "apply"

// ----- domain checks C and shapes Z (Figure 6b, 6c) -----
//
// I: the variables of the loop whose collections are checked
// E: the variables of loops nested inside its body
// kind: "sum" (generators checked by asfun) or "group" (by leaf)

let fresh

// variables with a strict generator p.*x somewhere in the query
let strict

// p.*x is a generator of x, unless it is a maybe lookup p.*x? and x also
// has a strict generator (as in strictVars, simple-eval.js): then it is a
// filter. If every lookup on x is a maybe lookup, they are its
// generators, as in Rhyme's outer joins.
let isGen = q => q.arg[1].key == "var" && (q.mode != "maybe" || !strict[q.arg[1].op])

let strictVars = q => {
  let res = {}
  let go = q => {
    q.arg?.forEach(go)
    if (q.key == "get" && q.arg[1].key == "var" && q.mode != "maybe") res[q.arg[1].op] = true
  }
  go(q)
  return res
}

let freshCopy = (xs, q) => {
  let m = {}
  for (let x of xs) m[x] = "*" + x.replace(/^\*/, "") + "_g" + (fresh++)
  return [xs.map(x => m[x]), rename(q, m)]
}

// Λ_xs.c, with fresh copies of xs
let bindFresh = (xs, c) => {
  let [ys, c1] = freshCopy(xs, c)
  for (let y of ys.reverse()) c1 = groupQ(y, c1)
  return c1
}

let check = (q, I, E, kind) => {
  let C = q1 => check(q1, I, E, kind)
  if (q.key == "const" || q.key == "input" || q.key == "var" || q.key == "placeholder")
    return one()
  if (q.key == "get") {
    let [p, k] = q.arg
    if (isGen(q)) {
      let x = k.op
      if (E.includes(x)) return C(p)
      if (I.includes(x)) return kind == "sum" ? pure("asObj", clone(p)) : leaf(clone(p))
      return clone(q) // generator of an outer variable: kept unchanged
    }
    return and(C(p), C(k))
  }
  if (q.key == "mkset" || q.key == "loadInput")
    return q.arg.map(C).reduce(and)
  if (q.key == "pure") {
    if (q._dflt) return C(q.arg[0]) // skip the default of an inner loop
    if (q.op == "orElse") return or(C(q.arg[0]), C(q.arg[1]))
    if (!strictPure(q.op)) fail("'" + q.op + "' is not supported in a loop")
    return q.arg.length ? q.arg.map(C).reduce(and) : one()
  }
  if (q._rec) return and(C(q.arg[0]), C(q.arg[2]))
  if (isLoop(q)) {
    let B = q.bnd
    let c = check(body(q), I, union(E, B), kind)
    if (!mentions(c, B)) return c
    return bindFresh(B, check(body(q), I, E, kind))
  }
  fail("unexpected term in a loop: " + q.key + " " + (q.op ?? ""))
}

let shape = (q, I, E) => {
  let Z = q1 => shape(q1, I, E)
  if (q.key == "const" || q.key == "input" || q.key == "var" || q.key == "placeholder")
    return null
  if (q.key == "get") {
    let [p, k] = q.arg
    if (isGen(q)) {
      let x = k.op
      if (E.includes(x)) return Z(p)
      if (I.includes(x)) return leaf(clone(p))
      return null
    }
    return omeet(Z(p), Z(k))
  }
  if (q.key == "mkset" || q.key == "loadInput")
    return q.arg.map(Z).reduce(omeet, null)
  if (q.key == "pure") {
    if (q._dflt) return Z(q.arg[0])
    if (q.op == "orElse") {
      let [sa, sb] = q.arg.map(Z)
      return sa && sb ? or(sa, sb) : null
    }
    return q.arg.map(Z).reduce(omeet, null)
  }
  if (q._rec) return omeet(Z(q.arg[0]), Z(q.arg[2]))
  if (isLoop(q)) {
    let B = q.bnd
    let s = shape(body(q), I, union(E, B))
    return s && !mentions(s, B) ? s : null
  }
  fail("unexpected term in a loop: " + q.key + " " + (q.op ?? ""))
}

// the guard G of a loop over B with translated body X
let guard = (B, X, kind) => {
  let c = check(X, B, [], kind)
  if (!mentions(c, B)) return [c, false]
  return [bindFresh(B, check(X, [], [], kind)), true] // B must take real keys
}

// the default of a group: its shape, or {} if it has none
let groupDefault = (B, X, realKeys) => {
  if (realKeys) return emp()
  let s = shape(X, B, [])
  return s && !mentions(s, B) ? s : emp()
}

let withDefault = (core, dflt) => ({ ...or(core, dflt), _dflt: true })

// ----- the translation D -----

// group-by: { e: t } is update(e0, K, t, mkset(e).K). The paper reads it as
// Λk.(⟨e⟩_k & t), with the filter inside the loops of t that bind the
// variables of e. Push the filter there.
let pushFilter = (q, scope) => {
  let [e0, k, t, filter] = q.arg
  let extra = diff(diff(fv(filter), scope), q.bnd)
  let inner = t.key == "stateful" && t.op == "single" && t.bnd.length == 0 ? t.arg[0] : t
  let t1
  if (extra.length == 0) {
    t1 = single(and(filter, inner))
  } else if (inner.key == "stateful" && inner.op == "sum" &&
             diff(extra, inner.bnd).length == 0) {
    t1 = { ...inner, arg: [and(filter, inner.arg[0])] }
  } else if (inner.key == "update" && !isRecordField(inner) && inner.arg.length == 3 &&
             diff(extra, inner.bnd).length == 0) {
    let b = inner.arg[2]
    let b1 = b.key == "stateful" && b.op == "single" && b.bnd.length == 0 ?
      { ...b, arg: [and(filter, b.arg[0])] } : single(and(filter, b))
    t1 = { ...inner, arg: [inner.arg[0], inner.arg[1], b1] }
  } else {
    fail("group key uses variables that are not bound by a sum or group in its value")
  }
  // The key is now an ordinary loop variable. Rename it: names K<n> are
  // treated as correlated group keys (isCorrelatedKeyVar in simple-eval.js).
  return freshCopy(q.bnd, { ...q, arg: [e0, k, t1] })[1]
}

let translate = (q, scope) => {
  let D = q1 => translate(q1, scope)
  if (q.key == "const" || q.key == "input" || q.key == "var" || q.key == "placeholder")
    return { ...q, arg: [] }
  if (q.key == "get" || q.key == "mkset" || q.key == "pure" || q.key == "loadInput" || q.key == "hint")
    return { ...q, arg: q.arg.map(D) }
  if (q.key == "stateful") {
    let B = q.bnd
    let scope1 = union(scope, B)
    if (q.op == "single") {
      if (q.mode != "reluctant" || B.length > 0) fail("'single' that binds variables is not supported")
      return { ...q, arg: [translate(q.arg[0], scope1)], bnd: [] }
    }
    if (q.op != "sum") fail("'" + q.op + "' is not supported")
    if (q.mode != undefined && q.mode != "maybe") fail("'sum' in mode " + q.mode + " is not supported")
    let X = translate(q.arg[0], scope1)
    let core = { key: "stateful", op: "sum", mode: "maybe", arg: [X], bnd: B }
    if (q.mode == "maybe") return core
    let [G] = guard(B, X, "sum")
    return withDefault(core, and(G, cnst(0)))
  }
  if (q.key == "update") {
    if (q.mode == "inplace") fail("in-place update is not supported")
    if (isRecordField(q)) {
      let [e0, k, v, filter] = q.arg
      return { ...q, arg: [D(e0), clone(k), translate(v, union(scope, q.bnd)), clone(filter)],
               bnd: [...q.bnd], _rec: true }
    }
    let [e0] = q.arg
    if (e0.key != "const" || !(e0.op === undefined || isEmptyObj(e0.op)))
      fail("a group that extends a non-empty map is not supported")
    if (q.arg.length == 4) q = pushFilter(q, scope)
    let B = q.bnd
    let X = translate(q.arg[2], union(scope, B))
    let core = { ...q, arg: [cnst(undefined), clone(q.arg[1]), X], bnd: B }
    if (e0.op === undefined) return core // group?: no default
    let [G, realKeys] = guard(B, X, "group")
    return withDefault(core, and(G, groupDefault(B, X, realKeys)))
  }
  fail("unexpected term: " + q.key + " " + (q.op ?? ""))
}

let strip = q => {
  let { vars, mind, dims, bnd, _dflt, _rec, ...q1 } = q
  if (q.arg) q1.arg = q.arg.map(strip)
  return q1
}

// q: the output of extract0, annotated by inferDims and inferBound(out)
exports.inferDefaults = (q, out) => {
  fresh = 1
  strict = strictVars(q)
  let res
  if (out.length > 0) {
    // the top level is a group over the free variables (cf. compile)
    let key = { key: "pure", op: "vars", arg: out.map(vr) }
    let X = translate(q, out)
    let core = { key: "update", arg: [cnst(undefined), key, single(X)], bnd: out }
    let [G, realKeys] = guard(out, single(X), "group")
    res = withDefault(core, and(G, groupDefault(out, single(X), realKeys)))
  } else {
    res = translate(q, [])
  }
  return strip(res)
}
