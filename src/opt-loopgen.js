const { sets } = require('./shared')
const { pretty } = require('./prettyprint')
const { initRequired } = require('./simple-codegen')
const { emitFilters1 } = require('./simple-loopgen')

const { union, same } = sets


//
// A fusing loop scheduler for the c2 pipeline.
//
// Same contract as emitLoops (simple-loopgen.js): it takes the analyzed IR and
// a statement order, and returns the statement IR that emitStmListLowLevel
// renders. The difference is what it does with the loops. emitLoops gives each
// assignment its own nest, so a query over one input walks it once per
// assignment. This emits every statement exactly once, inside exactly the loops
// it depends on, fusing the nests of statements that share them.
//
// That scheduling idea is new-codegen.js's. This is a separate implementation
// rather than a use of it, for two reasons:
//
//  - new-codegen.js is shared with the c1 pipeline (c1-ir.js), whose statements
//    carry different information. Everything here speaks c2: a statement knows
//    its fre/bnd/ext, not a list of strings to be sorted by a "tmp" prefix.
//  - new-codegen renders text while it schedules. This emits the statement IR
//    instead, so expressions are rendered afterwards, by a walk that carries a
//    live scope. That is what lets generator variables (genN) be reused: being
//    in scope is a fact at emission time rather than a prediction.
//
// Because the c2 sets are already computed, most of new-codegen's bookkeeping
// is unnecessary here: a statement's loops are union(fre, bnd), its transitive
// loop dependencies come from the closure in vars[], and the two writes to a
// tmp are init-then-update rather than an arbitrary ranked sequence.
//
// Not handled yet, both as in translateToNewCodegen and both fine in emitLoops:
// a variable whose generators are all 'maybe' (full outer join), and a
// generator that depends on its own variable (testZipNestedRec3).
//

let settings
let vars          // deps var->var (transitively closed by computeDependencies)
let filters
let assignments

exports.setOptLoopgenState = st => {
  settings = st.settings
  vars = st.vars
  filters = st.filters
  assignments = st.assignments
}


// ----- generators -----

// The filters that act as a loop over each variable.
//
// A 'maybe' generator does not constrain the domain, so where a total one
// supplies it the maybe ones are dropped -- the optional side is still read
// through its path expression, where a missing key yields undefined. (A
// variable whose generators are *all* maybe is a full outer join, whose domain
// is their union; not handled yet, as in translateToNewCodegen.)
//
// Constant-folded variables are deliberately kept: emitStmListLowLevel drops
// the loop and keeps the body for those, so the decision belongs there.
let buildGenerators = () => {
  let byVar = {}
  // Group the filters by var
  for (let i in filters) {
    let v = filters[i].arg[1].op
    byVar[v] ??= []
    byVar[v].push(Number(i))
  }
  let gens = {}
  for (let v in byVar) {
    let is = byVar[v]
    // Drop the filter for a gen if:
    //   the filter itself is 'maybe' AND
    //   at least one filter in the gen is not 'maybe'
    //   (i.e.) not a full-outer join
    let keep = is.filter(i =>
      !(filters[i].mode == "maybe" && is.some(j => filters[j].mode != "maybe")))
    if (keep.length) gens[v] = keep
  }
  return gens
}


// ----- statements -----

// Writes whose multiplicity cannot be observed: running one twice for the same
// key is the same as running it once. Mirrors the whitelist in emitLoops.
let idempotentWrite = q =>
  q.key == "stateful" && ["single", "first", "last", "all", "any"].includes(q.op) ||
  q.key == "update" && q.arg[2].key == "ref"

// Two statements per assignment, init before update.
let buildStatements = () => {
  let stmts = []
  for (let i in assignments) {
    let q = assignments[i]
    let tmp = Number(i)

    // rt.init writes with ??=, so it is idempotent and never needs a
    // projection -- the same reason emitLoops passes needProject there only
    // when projections are not being eliminated at all.
    if (initRequired(q))
      stmts.push({
        tmp, kind: "init", q, project: false,
        loops: q.fre,
        tmps: q.key == "update" ? q.arg[0].tmps : [],
      })

    // ext holds the variables that have to be enumerated to produce this
    // statement's keys and are then projected away. Nesting the statement under
    // them directly would run it once per *source row* rather than once per
    // distinct key, which double-counts any fold that is not idempotent.
    stmts.push({
      tmp, kind: "update", q,
      loops: union(q.fre, q.bnd),
      tmps: q.tmps,
      project: q.ext.length > 0 &&
        !(settings.elimProjections && idempotentWrite(q)),
    })
  }
  return stmts
}


// ----- dependencies -----

// mirror the trans helper from simple-eval.js
let trans = vs => union(vs, vs.flatMap(v => vars[v].vars))

let buildDeps = (stmts, gens) => {
  // the statement that leaves a tmp in its final state
  let lastWriter = {}
  stmts.forEach((s, ix) => { if (s.kind == "update") lastWriter[s.tmp] = ix })

  // getting ready for stmt -> stmt dependencies
  // get what tmp a loop depends on
  let loopTmps = {}
  for (let v in gens) {
    loopTmps[v] = []
    for (let i of gens[v]) {
      let g = filters[i].arg[0]
      loopTmps[v] = union(loopTmps[v], g.tmps ?? [])
    }
  }

  // full iteration space, see emitFilters1
  let loopDeps = stmts.map(s => trans(s.loops))

  // direct stmt -> stmt edges
  let pre = stmts.map((s, ix) => {
    let ds = {}
    let need = t => {
      let w = lastWriter[t]
      if (w !== undefined && w != ix) ds[w] = true
    }
    for (let t of s.tmps) need(t)
    // a loop this statement sits under may itself read a tmp
    for (let v of loopDeps[ix]) for (let t of loopTmps[v] ?? []) need(t)
    // init before update
    if (s.kind == "update")
      stmts.forEach((s2, j) => { if (s2.tmp == s.tmp && s2.kind == "init") ds[j] = true })
    return ds
  })

  // transitive closure
  let stmtDeps = stmts.map(() => ({}))
  let visit = (root, cur, seen) => {
    for (let p in pre[cur]) {
      if (seen[p]) continue
      seen[p] = true
      stmtDeps[root][p] = true
      visit(root, p, seen)
    }
  }
  stmts.forEach((_, ix) => visit(ix, ix, {}))

  // Which of a dependency's loops have to close before we can read its result.
  // If both statements sit in the same loop they can share it; a loop only the
  // dependency sits in must finish first, or its tmp is read half-accumulated.
  let byLoop = stmts.map(() => ({}))
  let afterLoop = stmts.map(() => ({}))
  stmts.forEach((s, t) => {
    for (let p in stmtDeps[t]) {
      byLoop[t][p] = {}
      afterLoop[t][p] = {}
      if (stmts[p].tmp == s.tmp) continue
      for (let l of stmts[p].loops) {
        if (s.loops.includes(l)) continue
        byLoop[t][p][l] = true
        for (let l1 of s.loops) {
          if (stmts[p].loops.includes(l1)) continue
          afterLoop[t][p][l1] ??= {}
          afterLoop[t][p][l1][l] = true
        }
      }
    }
  })

  return { stmtDeps, loopDeps, byLoop, afterLoop }
}


// ----- scheduling -----

// 'order' is part of emitLoops' signature but unused here: the schedule is
// derived from the dependencies below rather than given.
let schedule = (q, order) => {
  if (!settings.extractAssignments) {
    console.error("opt-loopgen only works if settings.extractAssignments = true")
    return []
  }

  let gens = buildGenerators()
  let stmts = buildStatements()
  let { stmtDeps, loopDeps, byLoop, afterLoop } = buildDeps(stmts, gens)

  let root = []
  let openedLoops = []
  let emitted = {}
  let closedByStmt = stmts.map(() => ({}))

  let isOpened = l => openedLoops.includes(l)

  // a dependency is usable once it is emitted and the loops it alone sits in
  // have closed
  let available = (t, p) =>
    emitted[p] && Object.keys(byLoop[t][p] ?? {}).every(l => closedByStmt[p][l])
  let depsAvailable = t => Object.keys(stmtDeps[t]).every(p => available(t, p))

  // A projected statement brings its own complete nest (project then traverse),
  // so it needs no loop open -- but it must not be emitted inside one either,
  // or the whole nest would re-run per iteration.
  let placeable = t =>
    stmts[t].project ? openedLoops.length == 0 : stmts[t].loops.every(isOpened)
  let emittable = t => placeable(t) && depsAvailable(t)

  let loopEmittable = l =>
    !isOpened(l) && gens[l] &&
    (vars[l].vars).every(l2 => l2 === l || isOpened(l2))

  let emitStmt = (t, buf) => {
    let s = stmts[t]
    let node = { key: s.kind, arg: [{ key: "ref", op: s.tmp }, s.q] }
    if (s.project) {
      // reuse the projection emitter: PROJECT the iteration space into a temp,
      // then TRAVERSE it, so the body runs once per distinct key
      emitFilters1({ vars: [], filters: [], buf }, s.q.fre, s.q.bnd, s.q.ext, true)(
        scope1 => scope1.buf.push(node))
    } else {
      buf.push(node)
    }
    emitted[t] = true
    // A projected statement emits its whole nest at once, so its loops are
    // already closed; a fused one sits in loops that closeLoop will finish.
    for (let l of s.loops) closedByStmt[t][l] = !!s.project
  }

  // the for/if chain for one variable: the first generator is the loop, the
  // rest guard it -- the same split emitFilters2 makes
  let openLoop = (v, buf) => {
    let [i0, ...rest] = gens[v]
    let body = []
    buf.push({ key: "for", body, arg: [v, i0, filters[i0].arg[0]] })
    for (let j of rest) {
      let inner = []
      body.push({ key: "if", body: inner, arg: [v, j, filters[j].arg[0]] })
      body = inner
    }
    openedLoops.push(v)
    return body
  }

  let closeLoop = () => {
    let l = openedLoops.pop()
    stmts.forEach((s, i) => {
      if (s.loops.includes(l) && closedByStmt[i][l] === false) closedByStmt[i][l] = true
    })
  }

  // Which loop to open next. Prefer one that lets the most ready statements be
  // emitted, so their nests fuse; break ties by total interest in the loop.
  // A projected statement carries its own nest, so it never goes inside a loop
  // we open -- it waits until the nest unwinds back to the top level.
  let fusable = t => !stmts[t].project

  let nextLoop = (pending, ready) => {
    let readyCnt = {}, totalCnt = {}
    for (let t of pending)
      for (let l of loopDeps[t]) {
        if (!loopEmittable(l)) continue
        totalCnt[l] = (totalCnt[l] ?? 0) + 1
        if (ready.includes(t)) readyCnt[l] = (readyCnt[l] ?? 0) + 1
      }

    let cands = Object.keys(readyCnt)
    if (!cands.length) return undefined

    // A loop that has to come after another unopened one is a poor choice: it
    // would have to be closed halfway and reopened. Only a hint -- correctness
    // rests on stmtDeps and byLoop.
    let after = {}
    for (let t of pending)
      for (let p of pending)
        for (let l1 in afterLoop[t][p] ?? {})
          for (let l2 in afterLoop[t][p][l1])
            if (!isOpened(l1) && !isOpened(l2)) (after[l1] ??= {})[l2] = true

    let free = cands.filter(l => !after[l] || !Object.keys(after[l]).length)
    if (free.length) cands = free

    let best
    for (let l of cands) {
      if (best === undefined) { best = l; continue }
      if (readyCnt[l] > readyCnt[best] ||
        (readyCnt[l] === readyCnt[best] && (totalCnt[l] ?? 0) > (totalCnt[best] ?? 0)))
        best = l
    }
    return best
  }

  let emitAll = (pending, buf) => {
    while (pending.some(depsAvailable)) {
      let now = pending.filter(emittable)
      pending = pending.filter(t => !emittable(t))
      while (now.length) {
        now.forEach(t => emitStmt(t, buf))
        now = pending.filter(emittable)
        pending = pending.filter(t => !emittable(t))
      }
      if (!pending.length) return pending

      let ready = pending.filter(t => fusable(t) && depsAvailable(t))
      if (!ready.length) return pending

      let l = nextLoop(pending.filter(fusable), ready)
      if (l === undefined) return pending

      let body = openLoop(l, buf)
      // only statements that depend on this loop belong inside it
      let inner = pending.filter(t => fusable(t) && loopDeps[t].includes(l))
      let left = emitAll(inner, body)
      closeLoop()
      if (inner.length == left.length)
        throw new Error("opt-loopgen: no progress opening loop " + l)
      pending = pending.filter(t => !inner.includes(t) || left.includes(t))
    }
    return pending
  }

  let left = emitAll(stmts.map((_, i) => i), root)
  if (left.length) {
    for (let t of left)
      console.error("opt-loopgen: could not emit " + stmts[t].kind +
        " tmp" + stmts[t].tmp + " := " + pretty(stmts[t].q))
  }

  console.assert(same(q.fre, []))
  root.push({ key: "return", arg: [q] })
  return root
}


exports.schedule = schedule
