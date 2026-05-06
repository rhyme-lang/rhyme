const { quoteVar } = require('./utils')

//
// New IR builder for the C2 (simple-eval) pipeline.
//
// Walks the post-extract0 / inferDims / inferBound / inferFree IR (still
// nested, key/op/arg form, with dims/bnd/fre annotations) and produces
// statements in the format consumed by new-codegen.generate:
//   { assignmentStms, generatorStms, tmpVarWriteRank, res, query }
//
// Modeled on c1-ir.js's structural-walk approach so that loop fusion and
// inlined operators are preserved end-to-end. Unlike c1-ir, this walker
// uses C2's q.fre (free variables) as the natural index for accumulator
// tmps, instead of a heuristic group-path tracked during traversal.
//
// mkset bindings (get(mkset(expr), V)) emit a "guard"-kind generator
// rendered by new-codegen as:  let V = expr; if (V !== undefined) { ... }
// rather than a degenerate for-in loop over a singleton.
//

let quoteConst = e => {
  if (typeof e === "boolean") return String(e)
  if (typeof e === "number") return String(e)
  if (typeof e === "string") return "\"" + e + "\""
  if (Array.isArray(e) && e.length == 0) return "[]"
  if (typeof e === "object" && e !== null && Object.keys(e).length == 0) return "{}"
  if (e === undefined) return "undefined"
  if (e === null) return "null"
  console.error("c2-ir: unsupported const: " + JSON.stringify(e))
  return "undefined"
}

// Pure ops we inline directly, matching c1-ir's behavior.
let inlineBinop = {
  plus: "+",
  concat: "+",
  minus: "-",
  times: "*",
  fdiv: "/",
  and: "&&",
}

exports.createIR = function(query) {
  let assignmentStms = []
  let generatorStms = []
  let tmpVarWriteRank = {}
  let tmpVarCount = 0

  // CSE for stateful/update/prefix and hoisted apply nodes. After
  // optimizer.deduplicate (which runs unconditionally in simple-eval.js),
  // equivalent IR subtrees share JS object identity, so a Map keyed by node
  // reference is enough — no need for JSON.stringify like c1-ir does.
  let nodeCache = new Map()  // node -> lhs expr

  // Substitution map for K-vars bound to mkset(const) — there's no need for
  // a generator, the value is known statically. Substituting in `var` lookups
  // avoids introducing a no-op K1 "loop" that would otherwise prevent the
  // scheduler from fusing surrounding iteration loops.
  let kSubst = new Map()

  // expression representation: { txt, deps }
  let expr = (txt, ...args) => ({ txt, deps: args })

  // build a property-or-index access; uses .name when the key is a quoted
  // identifier (matches c1-ir output), bracket notation otherwise
  let select = (a, b) => {
    let m = b.txt.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)
    if (m)
      return expr(a.txt + "." + m[1], ...a.deps, ...b.deps)
    return expr(a.txt + "[" + b.txt + "]", ...a.deps, ...b.deps)
  }

  function assign(lhs, op, rhs) {
    let e = expr(lhs.txt + " " + op + " " + rhs.txt, ...lhs.deps, ...rhs.deps)
    e.lhs = lhs
    e.op = op
    e.rhs = rhs
    e.writeSym = lhs.root
    e.deps = e.deps.filter(d => d != e.writeSym)  // remove write-self cycle
    tmpVarWriteRank[e.writeSym] ??= 1
    e.writeRank = tmpVarWriteRank[e.writeSym]
    tmpVarWriteRank[e.writeSym] += 1
    assignmentStms.push(e)
  }

  // CSE-by-text generator emission
  function ensureGenerator(g) {
    if (generatorStms.every(g1 => g1.txt != g.txt))
      generatorStms.push(g)
  }

  // Resolve a (possibly substituted) K-var to its key expression.
  let resolveVar = v => kSubst.has(v) ? kSubst.get(v) : expr(quoteVar(v), v)

  // Effective iteration vars produced by `fre`, after K-var substitution.
  // Used both for keying tmps and for the fusion-safety check.
  function effectiveIterVars(fre) {
    let out = []
    for (let v of fre ?? []) {
      let e = resolveVar(v)
      for (let d of e.deps) {
        if (!d.startsWith("tmp") && !out.includes(d)) out.push(d)
      }
      // include v itself if it's a real loop var (no substitution)
      if (!kSubst.has(v) && !out.includes(v)) out.push(v)
    }
    return out
  }

  // Build a fresh tmp keyed by `fre` variables.
  //   tmp.t0 ??= {}; tmp.t0[v1] ??= {}; ...; return tmp.t0[v1][v2]...
  function createTmpKeyedBy(fre) {
    let lhs = select(expr("tmp"), expr('"t' + (tmpVarCount++) + '"'))
    let root = lhs.txt        // e.g. "tmp.t0"
    lhs.root = root
    lhs.deps = [root]
    for (let v of fre) {
      assign(lhs, "??=", expr("{}"))
      lhs = select(lhs, resolveVar(v))
      lhs.root = root
    }
    return lhs
  }

  // Build a fresh tmp keyed directly by raw iteration-var symbols (already
  // resolved, e.g. taken from another expr's deps). Used to hoist expensive
  // subexpressions like `udf.split(...)` so they aren't re-evaluated on
  // every reference inside a loop. Mirrors c1-ir's createFreshDirectTempVar.
  function createDirectTempVar(iterVars) {
    let lhs = select(expr("tmp"), expr('"t' + (tmpVarCount++) + '"'))
    let root = lhs.txt
    lhs.root = root
    lhs.deps = [root]
    for (let v of iterVars) {
      assign(lhs, "??=", expr("{}"))
      lhs = select(lhs, expr(quoteVar(v), v))
      lhs.root = root
    }
    return lhs
  }

  //
  // ---- main walk ----
  //
  // path(q) returns an expr representing q's value, computing into a fresh
  // tmp (with CSE via nodeCache) for stateful/prefix/update nodes. The
  // updateCase recursion uses intoHost() instead when it wants to try
  // fusing the result directly into an enclosing slot.
  //
  function path(q) {
    if (q.key == "input") return expr("inp")
    if (q.key == "const") return expr(quoteConst(q.op))
    if (q.key == "var") {
      // mkset-bound K-vars are substituted with the underlying expr.
      if (kSubst.has(q.op)) return kSubst.get(q.op)
      return expr(quoteVar(q.op), q.op)
    }
    if (q.key == "loadInput") {
      let [e1] = q.arg.map(x => path(x))
      return expr("rt.load" + q.op.toUpperCase() + "(" + e1.txt + ")", ...e1.deps)
    }
    if (q.key == "hint") return expr("{}")
    if (q.key == "mkset") {
      // bare mkset (not inside a get) — wrap as singleton object
      let [e1] = q.arg.map(x => path(x))
      return expr("rt.singleton(" + e1.txt + ")", ...e1.deps)
    }
    if (q.key == "get") return getCase(q)
    if (q.key == "pure") return pureCase(q)
    if (q.key == "stateful" || q.key == "prefix" || q.key == "update") {
      if (nodeCache.has(q)) return nodeCache.get(q)
      let lhs
      if (q.key == "stateful") lhs = stateful(q)
      else if (q.key == "prefix") lhs = prefixCase(q)
      else lhs = updateCase(q)
      nodeCache.set(q, lhs)
      return lhs
    }

    console.error("c2-ir: unknown key '" + q.key + "' in " + JSON.stringify(q))
    return expr("undefined")
  }

  // Compute q's value, fusing the accumulator into hostLhs when safe.
  // Fusion is safe iff every iteration var that gates hostLhs is also in
  // q's effective fre — otherwise the node would be re-accumulated for
  // iterations of a var it doesn't depend on (the decorrelation case).
  // If unsafe, fall back to path() + a copy assignment.
  function intoHost(q, hostLhs) {
    if (q.key == "stateful" || q.key == "prefix" || q.key == "update") {
      let hostIterVars = hostLhs.deps.filter(d => !d.startsWith("tmp"))
      let effFre = effectiveIterVars(q.fre)
      if (hostIterVars.every(v => effFre.includes(v))) {
        if (q.key == "stateful") return stateful(q, hostLhs)
        if (q.key == "prefix") return prefixCase(q, hostLhs)
        return updateCase(q, hostLhs)
      }
    }
    let lhs = path(q)
    // For object-producing sources (updates), a direct reference assignment
    // would alias the source across multiple host slots; subsequent field
    // writes (e.g. tmp.t0[A][B].ratio = ...) would then overwrite earlier
    // iterations' values via the shared reference. Spread the own enumerable
    // fields into a fresh object per slot. (See nestedIterators3.)
    if (q.key == "update") {
      assign(hostLhs, "=", expr("{..." + lhs.txt + "}", ...lhs.deps))
    } else {
      assign(hostLhs, "=", lhs)
    }
    return lhs
  }

  function getCase(q) {
    let [e1, e2] = q.arg

    // mkset binding: get(mkset(expr), V) — substitute V → expr inline
    // wherever V is referenced, no generator. This mirrors c1-ir (which
    // doesn't introduce K-vars at all) and lets the loop scheduler fuse
    // surrounding iterations.
    if (e1.key == "mkset" && e2.key == "var") {
      let inner = path(e1.arg[0])
      kSubst.set(e2.op, inner)
      return inner
    }

    let a
    // c1-ir-style hoist: f(x).a / f(x)[V] patterns are likely expensive
    // (string split, array flatten, matchAll, ...) — cache the apply result
    // in a temp keyed by its iter vars. CSE'd by node identity (which works
    // because optimizer.deduplicate has already shared equivalent subtrees).
    if (e1.key == "pure" && e1.op == "apply") {
      if (nodeCache.has(e1)) {
        a = nodeCache.get(e1)
      } else {
        let raw = path(e1)
        let iterDeps = raw.deps.filter(d => !d.startsWith("tmp"))
        let lhs = createDirectTempVar(iterDeps)
        assign(lhs, "=", raw)
        a = lhs
        nodeCache.set(e1, a)
      }
    } else {
      a = path(e1)
    }
    let b = path(e2)

    if (e2.key == "var") {
      let v = e2.op
      ensureGenerator({
        kind: "iter",
        sym: v,
        rhs: a.txt,
        deps: a.deps,
        txt: "for " + v + " <- " + a.txt,
      })
    }

    // 'maybe' (originally get?) reads should not throw on undefined
    if (q.mode == "maybe")
      return expr(a.txt + "?.[" + b.txt + "]", ...a.deps, ...b.deps)
    return select(a, b)
  }

  function pureCase(q) {
    if (q.op in inlineBinop) {
      let [a, b] = q.arg.map(x => path(x))
      return expr("(" + a.txt + inlineBinop[q.op] + b.txt + ")", ...a.deps, ...b.deps)
    }
    if (q.op == "div") {
      let [a, b] = q.arg.map(x => path(x))
      return expr("Math.trunc(" + a.txt + "/" + b.txt + ")", ...a.deps, ...b.deps)
    }
    if (q.op == "mod") {
      let [a, b] = q.arg.map(x => path(x))
      return expr("Math.trunc(" + a.txt + "%" + b.txt + ")", ...a.deps, ...b.deps)
    }
    if (q.op == "vars") {
      // 'vars' marker is unwrapped by updateCase; should not appear here
      console.error("c2-ir: 'pure vars' encountered outside update context")
      let es = q.arg.map(x => path(x))
      return expr("[" + es.map(e => e.txt).join(",") + "]", ...es.flatMap(e => e.deps))
    }
    if (q.op == "isUndef") {
      let [a] = q.arg.map(x => path(x))
      return expr("(" + a.txt + " === undefined)", ...a.deps)
    }
    if (q.op == "andAlso") {
      let [a, b] = q.arg.map(x => path(x))
      // matches rt.pure.andAlso semantics: undefined -> undefined, else x2
      return expr("rt.pure.andAlso(" + a.txt + "," + b.txt + ")", ...a.deps, ...b.deps)
    }
    if (q.op == "apply") {
      let [e1, ...es] = q.arg.map(x => path(x))
      return expr(e1.txt + "(" + es.map(e => e.txt).join(",") + ")", ...e1.deps, ...es.flatMap(e => e.deps))
    }
    // default: route through rt.pure.<op>
    let es = q.arg.map(x => path(x))
    return expr("rt.pure." + q.op + "(" + es.map(e => e.txt).join(",") + ")",
      ...es.flatMap(e => e.deps))
  }

  function stateful(q, hostLhs) {
    let op = q.op
    let lhs = hostLhs ?? createTmpKeyedBy(q.fre)
    let rhs = path(q.arg[0])

    if (op == "sum") {
      assign(lhs, "??=", expr("0"))
      assign(lhs, "+=", rhs)
    } else if (op == "product") {
      assign(lhs, "??=", expr("1"))
      assign(lhs, "*=", rhs)
    } else if (op == "count") {
      assign(lhs, "??=", expr("0"))
      assign(lhs, "+=", expr("1", ...rhs.deps))
    } else if (op == "min") {
      assign(lhs, "??=", expr("Infinity"))
      assign(lhs, "=", expr("Math.min(" + lhs.txt + "," + rhs.txt + ")", ...rhs.deps))
    } else if (op == "max") {
      assign(lhs, "??=", expr("-Infinity"))
      assign(lhs, "=", expr("Math.max(" + lhs.txt + "," + rhs.txt + ")", ...rhs.deps))
    } else if (op == "first" || op == "all") {
      assign(lhs, "??=", expr(rhs.txt, ...rhs.deps))
    } else if (op == "last" || op == "single" || op == "any") {
      assign(lhs, "=", expr(rhs.txt + " ?? " + lhs.txt, ...rhs.deps))
    } else if (op == "join") {
      assign(lhs, "??=", expr("''"))
      assign(lhs, "+=", rhs)
    } else if (op == "array") {
      assign(lhs, "??=", expr("[]"))
      assign(lhs, ".push", expr("(" + rhs.txt + ")", ...rhs.deps))
    } else if (op == "mkset") {
      assign(lhs, "??=", expr("{}"))
      let lhsKeyed = select(lhs, rhs)
      lhsKeyed.root = lhs.root
      assign(lhsKeyed, "=", expr("true", ...rhs.deps))
    } else if (op == "print") {
      // print is side-effecting; no real accumulator
      assign(lhs, "=", expr("(console.log(" + rhs.txt + "), undefined)", ...rhs.deps))
    } else {
      // Fallback for any unhandled stateful op: route through runtime.
      assign(lhs, "??=", expr("rt.stateful." + op + "_init()"))
      assign(lhs, "=", expr("rt.stateful." + op + "(" + rhs.txt + ")(" + lhs.txt + ")",
        ...rhs.deps))
    }
    return lhs
  }

  function prefixCase(q, hostLhs) {
    let op = q.op
    let lhs = hostLhs ?? createTmpKeyedBy(q.fre)
    let rhs = path(q.arg[0])
    assign(lhs, "??=", expr("[]"))
    assign(lhs, "=", expr(
      "rt.stateful.prefix(rt.stateful." + op + "(" + rhs.txt + "))(" + lhs.txt + ")",
      ...rhs.deps))
    return lhs
  }

  function updateCase(q, hostLhs) {
    let [e0, e1, e2, e3] = q.arg

    // Process the mkset filter (if any) for its side effect: emitting the
    // guard generator that binds the K-var. The expression value is unused.
    if (e3) path(e3)

    let lhs = hostLhs ?? createTmpKeyedBy(q.fre)

    // initialize lhs from e0
    if (e0.key == "const" && Array.isArray(e0.op) && e0.op.length == 0) {
      assign(lhs, "??=", expr("[]"))
    } else if (e0.key == "const" && typeof e0.op == "object"
      && e0.op !== null && Object.keys(e0.op).length == 0) {
      assign(lhs, "??=", expr("{}"))
    } else if (e0.key == "update" || e0.key == "stateful" || e0.key == "prefix") {
      // chained updates / inner statefuls — fuse into outer's tmp if safe
      intoHost(e0, lhs)
    } else {
      // arbitrary seed value: use rt.stateful.update_init for safe deep-copy
      let initE = path(e0)
      assign(lhs, "??=",
        expr("rt.stateful.update_init(" + initE.txt + ")()", ...initE.deps))
    }

    // determine key path: single var, or pure(vars, [v1, v2, ...])
    let keys
    if (e1.key == "pure" && e1.op == "vars") keys = e1.arg
    else keys = [e1]

    // build lhs[k1][k2]... — initializing intermediate levels
    let lhsDeep = lhs
    for (let i = 0; i < keys.length; i++) {
      let keyExpr = path(keys[i])
      lhsDeep = select(lhsDeep, keyExpr)
      lhsDeep.root = lhs.root
      if (i < keys.length - 1)
        assign(lhsDeep, "??=", expr("{}"))
    }

    // body of update — try to fuse into the keyed slot, otherwise compute
    // separately and copy.
    if (e2.key == "stateful" || e2.key == "prefix" || e2.key == "update") {
      intoHost(e2, lhsDeep)
    } else {
      let valExpr = path(e2)
      assign(lhsDeep, "=", valExpr)
    }

    return lhs
  }

  let res = path(query)
  return { assignmentStms, generatorStms, tmpVarWriteRank, res, query }
}
