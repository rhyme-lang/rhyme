// Contraction pushdown: split a reduction so its dense part can run in JAX.
//
// The variable analysis fuses a contraction with the grouping around it. In
//
//     {users.*u.team: sum(A.*u.*k * w.*k)}
//
// the sum reduces over *u (the users in each team) and *k (a dense axis) in
// one loop nest, tmp[K][*u,*k], and since K comes from JSON data the whole
// assignment has to stay in JS. Sum is associative, so contract the
// variables that occur only inside the reduction first:
//
//     {users.*u.team: sum(T.*u)}    T = {*u': sum(A.*u'.*k * w.*k)}
//
// T is dense tensor algebra (an einsum) that the planner offloads; the
// remaining sum over the users in each team stays in JS.
//
// Runs on the preprocessed IR, before the analysis. Applies to
// sum/product/max/min over a product of number constants and dense scalar
// paths (input.X.*i.*j... with X dense-typed and all steps variables), when
//   - some variables occur only inside the reduction (these are contracted
//     in T), and some occur elsewhere too (these index T), and
//   - the reduction could not be offloaded as is: it sits under a grouping
//     by a non-variable key, or a kept variable also ranges over non-dense
//     data.
// The kept variables are renamed inside T, so that T's domain is the dense
// axes alone; the join with the rest of the query happens at T.*u.

const { typing } = require('../typing')
const { typeSyms } = require('../types')

let reducible = { sum: true, product: true, max: true, min: true }

// type of field `name` of a (parsed) object type, or undefined
let fieldType = (t, name) => {
  while (t && t.typeSym == typeSyms.object && t.objKey !== null) {
    if (t.objKey === name) return t.objValue
    t = t.objParent
  }
  return undefined
}

let pushdown = (q, schema) => {
  if (schema === undefined) return q
  schema = typing.parseType(schema)

  // path rooted at a dense input: {dim, depth, vars} or undefined
  let densePath = e => {
    if (e.key != "get" || e.arg.length != 2) return undefined
    let [e1, e2] = e.arg
    if (e1.key == "input" && e2.key == "const" && typeof e2.op == "string") {
      let t = fieldType(schema, e2.op)
      if (!t || !typing.isDense(t)) return undefined
      return { dim: t.tagData.dim, depth: 0, vars: [] }
    }
    let p = densePath(e1)
    if (!p || e2.key != "var" || e2.op == "*" || p.depth >= p.dim) return undefined
    return { dim: p.dim, depth: p.depth + 1, vars: [...p.vars, e2.op] }
  }

  let countVars = (e, acc = {}) => {
    if (e.key == "var") acc[e.op] = (acc[e.op] ?? 0) + 1
    e.arg?.forEach(a => countVars(a, acc))
    return acc
  }
  let counts = countVars(q)

  // variables that also range over something that is not a dense input
  let nonDense = new Set()
  let scan = e => {
    if (e.key == "get" && e.arg?.[1]?.key == "var" && !densePath(e)) nonDense.add(e.arg[1].op)
    e.arg?.forEach(scan)
  }
  scan(q)

  let fresh = 0
  let rename = (e, map) => e.key == "var" && map[e.op] ? { ...e, op: map[e.op] }
    : e.arg ? { ...e, arg: e.arg.map(a => rename(a, map)) } : e

  let tryRewrite = (e, inGroup) => {
    let factors = []
    let flat = x => x.key == "pure" && x.op == "times" ? x.arg.forEach(flat) : factors.push(x)
    flat(e.arg[0])
    let vs = []
    for (let f of factors) {
      if (f.key == "const" && typeof f.op == "number") continue
      let p = densePath(f)
      if (!p || p.depth != p.dim) return undefined
      vs.push(...p.vars)
    }
    vs = [...new Set(vs)]
    let inner = countVars(e)
    let local = vs.filter(v => inner[v] == counts[v])
    let kept = vs.filter(v => inner[v] != counts[v])
    if (!local.length || !kept.length) return undefined
    if (!inGroup && !kept.some(v => nonDense.has(v))) return undefined

    let n = fresh++
    let map = Object.fromEntries(kept.map(v => [v, v + "__T" + n]))
    let t = { ...e, arg: [rename(e.arg[0], map)] }
    for (let v of [...kept].reverse())
      t = { key: "update", arg: [{ key: "const", op: {} }, { key: "var", op: map[v] }, t] }
    let lookup = t
    for (let v of kept)
      lookup = { key: "get", arg: [lookup, { key: "var", op: v }] }
    return { ...e, arg: [lookup] }
  }

  let walk = (e, inGroup) => {
    if (e.key == "update") {
      let [e0, k, v, ...rest] = e.arg
      let g = inGroup || k.key != "var"
      return { ...e, arg: [walk(e0, inGroup), walk(k, inGroup), walk(v, g), ...rest.map(x => walk(x, inGroup))] }
    }
    if (e.key == "stateful" && reducible[e.op] && e.arg?.length == 1) {
      let r = tryRewrite(e, inGroup)
      if (r) return r
    }
    return e.arg ? { ...e, arg: e.arg.map(x => walk(x, inGroup)) } : e
  }
  return walk(q, false)
}

exports.pushdown = pushdown
