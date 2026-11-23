// JAX acceleration for the JS backend: plan and lower.
//
// After computeOrder, `plan` picks the assignments that are dense tensor
// algebra and lowers them to one JAX function (a "stage"). The JS loop
// generator then skips those assignments and emits a single call
//
//     rt.accel.run(<stage>, inp, tmp)
//
// in their place, which fills tmp[i] for every stage member the rest of the
// query reads. Everything else is generated as ordinary JS loops.
//
// An assignment can be lowered when (type-directed):
//   - every index variable it is parameterized by or reduces over ranges only
//     over axes of dense-typed inputs (all of the variable's generators, not
//     just the ones in the assignment: that is the variable's domain), or over
//     the axes of another stage member;
//   - its body consists of numeric pure ops over such generators, refs to
//     other stage members, and number constants;
//   - its reduction is sum/product/max/min (or the implicit single), or it
//     is a grouping {*v: e} by an index variable;
//   - its result cannot be nothing.
//
// Values are lowered at compile time to {expr, fre, inner}: a Python
// expression whose array layout is [...fre, ...inner dims], where fre are the
// index variables (named axes) and inner counts the nested dims of the value
// itself. This is the same layout the JS code reads tmp[i] in -- tmp[i][x][y]
// for fre [x, y] -- so consumers of a stage member need no change.
//
// Rhyme's domains are intersections of keys. For dense 0..n-1 keys that is
// the shorter extent, which is static under jax.jit.

const { typing } = require('../typing')

class Unsupported extends Error {}
let unsupported = msg => { throw new Unsupported(msg) }

let binops = { plus: "+", minus: "-", times: "*", fdiv: "/" }
let reducers = { sum: "jnp.sum", product: "jnp.prod", max: "jnp.max", min: "jnp.min" }

let pyName = v => "n_" + v.replace(/\W/g, "_")
let pyArg = s => "in_" + String(s).replace(/\W/g, "_")
// a Python tuple literal: (), (a,), (a, b)
let pyTuple = xs => xs.length == 1 ? `(${xs[0]},)` : `(${xs.join(", ")})`

let align = (v, dst) => v.fre.join() == dst.join() ? v.expr
  : `_align(${v.expr}, ${JSON.stringify(v.fre)}, ${JSON.stringify(dst)}, ${v.inner})`

let refsOf = (e, acc = []) => {
  if (e.key == "ref") acc.push(e.op)
  e.arg?.forEach(a => refsOf(a, acc))
  return acc
}

let denseDim = q => q?.schema && typing.isDense(q.schema.type) ? q.schema.type.tagData.dim : 0

let plan = (ir, q, order) => {
  let { filters, assignments } = ir

  // dense generator paths: get(...get(get(input, "A"), *i)..., *k)
  let pathOf = g => {
    if (g.key == "get" && g.arg[0].key == "input" && g.arg[1].key == "const" && typeof g.arg[1].op == "string")
      return { root: g.arg[1].op, steps: [] }
    if (g.key != "get" || g.mode == "maybe") unsupported("generator " + g.key)
    let p = pathOf(g.arg[0])
    if (denseDim(g.arg[0]) == 0) unsupported("generator over non-dense data")
    let s = g.arg[1]
    if (s.key == "var") p.steps.push({ var: s.op })
    else if (s.key == "const" && typeof s.op == "number") p.steps.push({ idx: s.op })
    else unsupported("path step " + s.key)
    return p
  }

  // the generators of every variable, across the whole query
  let varGens = {}
  filters.forEach((f, i) => {
    if (f.key == "get" && f.arg[1].key == "var") (varGens[f.arg[1].op] ??= []).push(i)
  })

  let newCtx = () => ({ tmps: {}, known: new Set(), roots: new Set(), extents: {}, prolog: [] })

  // a variable's extent: the shortest of the axes it ranges over
  let useVar = (ctx, v) => {
    if (ctx.extents[v] || ctx.known.has(v)) return
    let gens = varGens[v] ?? unsupported("variable without generator " + v)
    let axes = gens.map(i => {
      let p = pathOf(filters[i])
      ctx.roots.add(p.root)
      return `${pyArg(p.root)}.shape[${p.steps.length - 1}]`
    })
    axes = [...new Set(axes)]
    ctx.extents[v] = axes
    ctx.prolog.push(`${pyName(v)} = ${axes.length > 1 ? `min(${axes.join(", ")})` : axes[0]}`)
  }

  let lowerGen = (ctx, i) => {
    let f = filters[i]
    let g = pathOf(f)
    ctx.roots.add(g.root)
    let axes = g.steps.filter(s => s.var).map(s => s.var)
    if (new Set(axes).size != axes.length) unsupported("repeated index") // TODO: diagonal via einsum
    axes.forEach(v => useVar(ctx, v))
    // a sub-tensor as a value: JS passes the input's own arrays by reference,
    // so there is nothing to compute -- and rebuilding them would change the
    // result's shape (index-keyed objects instead of the input arrays)
    if (denseDim(f)) unsupported("sub-tensor as a value")
    if (!typing.isNumber(f.schema.type)) unsupported("non-numeric tensor element")
    let idx = g.steps.map(s => s.var ? `:${pyName(s.var)}` : String(s.idx))
    return { expr: `${pyArg(g.root)}[${idx.join(", ")}]`, fre: axes, inner: 0 }
  }

  let lower = (ctx, e) => {
    if (e.key == "genref") return lowerGen(ctx, e.op)
    if (e.key == "ref") {
      let t = ctx.tmps[e.op] ?? unsupported("ref to a tmp computed in JS")
      t.fre.forEach(v => ctx.known.add(v)) // its axes have the extents of the member
      return t
    }
    if (e.key == "const" && typeof e.op == "number") return { expr: String(e.op), fre: [], inner: 0 }
    if (e.key == "pure" && Object.hasOwn(binops, e.op) && e.arg.length == 2) {
      let [a, b] = e.arg.map(x => lower(ctx, x))
      if (a.inner || b.inner) unsupported("arithmetic on nested values")
      let fre = [...new Set([...a.fre, ...b.fre])]
      return { expr: `(${align(a, fre)} ${binops[e.op]} ${align(b, fre)})`, fre, inner: 0 }
    }
    unsupported("node " + e.key + (e.op !== undefined ? " " + e.op : ""))
  }

  let lowerAssign1 = (ctx, a) => {
    if (a.key == "stateful") {
      if (a.mode == "maybe") unsupported("maybe reduction")
      if (!a.schema || a.schema.props.length) unsupported("result may be nothing")
      if (a.op == "single") return lower(ctx, a.arg[0])
      if (!Object.hasOwn(reducers, a.op)) unsupported("reduction " + a.op)
      if (a.ext?.length) unsupported("existential variables")
      let space = [...a.fre, ...a.bnd]
      space.forEach(v => useVar(ctx, v))

      // a sum over a product is a contraction: emit einsum so that XLA gets a
      // dot_general -- it does not recover one from broadcast * reduce
      let factors = []
      let flat = e => e.key == "pure" && e.op == "times" ? e.arg.forEach(flat) : factors.push(lower(ctx, e))
      flat(a.arg[0])
      if (a.op == "sum" && factors.length > 1 && factors.every(x => !x.inner) &&
          space.every(v => factors.some(x => x.fre.includes(v))) && space.length <= 26) {
        let letter = v => String.fromCharCode(97 + space.indexOf(v))
        let spec = factors.map(x => x.fre.map(letter).join("")).join(",") + "->" + a.fre.map(letter).join("")
        return { expr: `jnp.einsum("${spec}", ${factors.map(x => x.expr).join(", ")})`, fre: a.fre, inner: 0 }
      }

      let body = lower(ctx, a.arg[0])
      if (body.inner) unsupported("reduction over nested values")
      let full = `jnp.broadcast_to(${align(body, space)}, ${pyTuple(space.map(pyName))})`
      // nothing to reduce over (e.g. {*i: sum data.*i}): every reduction sees
      // exactly one element, and sum/product/max/min of one element is itself
      if (a.bnd.length == 0)
        return { expr: full, fre: a.fre, inner: 0 }
      let axes = a.bnd.map((_, i) => a.fre.length + i)
      return { expr: `${reducers[a.op]}(${full}, axis=${pyTuple(axes)})`, fre: a.fre, inner: 0 }
    }
    if (a.key == "update") {
      // {}{ *v: e } -- grouping by an index variable is a re-layout
      let [e0, k, body] = a.arg
      if (a.arg.length > 3 || e0.key != "const" || typeof e0.op != "object" ||
          Object.keys(e0.op).length || k.key != "var")
        unsupported("update with a non-variable key")
      // existentials of a grouping are domain checks only: dense axes are
      // never empty unless their extent is 0 (TODO)
      let v = lower(ctx, body)
      useVar(ctx, k.op)
      let fre = v.fre.filter(x => x != k.op)
      return { expr: align(v, [...fre, k.op]), fre, inner: v.inner + 1 }
    }
    unsupported("assignment " + a.key)
  }

  let lowerAssign = (ctx, a) => {
    let res = lowerAssign1(ctx, a)
    for (let v of [...a.fre, ...a.bnd])
      if (!ctx.extents[v] && !ctx.known.has(v)) unsupported("index " + v + " not over a dense axis")
    return res
  }

  // members: assignments that lower, all of whose refs are members (in order)
  let members = new Set()
  let reasons = {}
  for (let [i] of order) {
    i = Number(i)
    let a = assignments[i]
    let refs = refsOf(a)
    if (!refs.every(r => members.has(r))) { reasons[i] = "depends on a tmp computed in JS"; continue }
    let ctx = newCtx()
    for (let j of members) ctx.tmps[j] = { expr: `tmp${j}`, fre: assignments[j].fre, inner: 0 }
    try { lowerAssign(ctx, a); members.add(i) }
    catch (e) { if (!(e instanceof Unsupported)) throw e; reasons[i] = e.message }
  }
  if (members.size == 0) return { members, reasons }

  // generate the stage
  let ctx = newCtx()
  let body = []
  for (let [i] of order) {
    i = Number(i)
    if (!members.has(i)) continue
    let v = lowerAssign(ctx, assignments[i])
    body.push(`tmp${i} = ${v.expr}`)
    ctx.tmps[i] = { expr: `tmp${i}`, fre: v.fre, inner: v.inner }
  }

  // export the members read by JS: by an assignment, a generator, or the result
  let used = new Set([...refsOf(q), ...filters.flatMap(f => refsOf(f))])
  for (let [i] of order) if (!members.has(Number(i))) refsOf(assignments[i]).forEach(r => used.add(r))
  let outs = [...members].filter(i => used.has(i))

  let roots = [...ctx.roots]
  let src = [
    `def stage(${roots.map(pyArg).join(", ")}):`,
    ...[...ctx.prolog, ...body].map(l => "    " + l),
    `    return (${outs.map(i => "tmp" + i).join(", ")}${outs.length ? "," : ""})`,
  ].join("\n") + "\n"

  return { members, reasons, roots, outs, src }
}

exports.plan = plan
exports.Unsupported = Unsupported
