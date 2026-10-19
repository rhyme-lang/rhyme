const { sets } = require('./shared')
const { pretty } = require('./prettyprint')
const { initRequired } = require('./simple-codegen')
const { emitFilters1 } = require('./simple-loopgen')

const { union, same } = sets

//
// A scheduling loopgen approach for the c2 pipeline
// 
// Mostly the same approach as new-codegen but it attemps to use all analysis
// that are already done on the c2 ir to reduce the amount of bookkeeping.
// 
// This loop scheduler also adheres to c2's semantics on projections where
// necessary, and it also supports outer joins (maybe mode filters).
//
// Currently, statements that needs an explicit projection is only emitted at
// the top level of the generated code since it emitts its own loop nests.
//
// One test is not covered by both this scheduler: testZipNestedRec3.
// Also not handled by new-codegen.
//
// Notably, the scheduled code is in the shape of simple-loopgen's generated
// statements. So it is then passed to emitStmListLowLevel.
//
// The file is in three parts:
//
//   buildGenerators / buildStatements   c2 IR  ->  gens + stmts
//   schedule(gens, stmts)               the scheduler proper
//   scheduleC2(q)                       what simple-eval calls,
//                                       a driver for JS backend
//
// Only the middle one is meant to be shared. It takes its problem as two
// arguments and never looks at `assignments`, so another front end -- cgen2 --
// can build the same gens and stmts its own way and schedule them. What it
// still reads from c2 state is `vars` (loop deps) and `filters` (loop sources),
// which any consumer of the simple-eval IR has.
//
//   gens[v]   = [filter index, ...]   first drives the loop, rest guard it
//   stmts[i]  = { tmp, key, q, fre, bnd, ext, loops, tmps, project }
//     tmp     what it writes -- statements sharing a tmp may share loops, and
//             run in array order, the last one leaving it final. The scheduler
//             needs nothing else to order them; `key` and `q` are only read
//             when emitting.
//     key    the node key this statement emits as: "init" or "update".
//             Not the same as q.key, which is the assignment's own node key
//             ("stateful", "update"): a stateful sum is emitted as an "update"
//     loops   the loops it must sit inside
//     tmps    the tmps it reads
//     project it brings its own loop nest, so it only goes at the top level
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

// build c1 style generater statements from filters
// maybe mode filters are dropped if there is at least one filter that is not
// 'maybe'
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

// build c1 style assignment statements
// determines if projection if necessary
// mirror the idea in emitFilters1
let idempotentWrite = q =>
  q.key == "stateful" && ["single", "first", "last", "all", "any"].includes(q.op) ||
  q.key == "update" && q.arg[2].key == "ref"

// A variable whose generators are *all* 'maybe' is a full outer join: its
let allMaybe = (gens, v) =>
  gens[v] !== undefined && gens[v].every(i => filters[i].mode == "maybe")

// Two statements per assignment, init before update.
let buildStatements = (gens) => {
  let stmts = []
  for (let i in assignments) {
    let q = assignments[i]
    let tmp = Number(i)

    // rt.init writes with ??=, so it is idempotent and never needs a
    // projection -- the same reason emitLoops passes needProject there only
    // when projections are not being eliminated at all.
    if (initRequired(q))
      stmts.push({
        tmp, key: "init", q,
        fre: q.fre, bnd: [], ext: q.extInit,
        loops: q.fre,
        tmps: q.key == "update" ? q.arg[0].tmps : [],
        project: q.fre.some(v => allMaybe(gens, v)),
      })

    // ext holds the variables that have to be enumerated to produce this
    // statement's keys and are then projected away. Nesting the statement under
    // them directly would run it once per *source row* rather than once per
    // distinct key, which double-counts any fold that is not idempotent.
    let loops = union(q.fre, q.bnd)
    stmts.push({
      tmp, key: "update", q,
      fre: q.fre, bnd: q.bnd, ext: q.ext,
      loops,
      tmps: q.tmps,
      project: q.ext.length > 0 &&
        !(settings.elimProjections && idempotentWrite(q)) ||
        loops.some(v => allMaybe(gens, v)),
    })
  }
  return stmts
}


// ----- dependencies -----

// mirror the trans helper from simple-eval.js
let trans = vs => union(vs, vs.flatMap(v => vars[v].vars))

let buildDeps = (stmts, gens) => {
  // the statement that leaves a tmp in its final state -- statements writing
  // one tmp run in array order, so that is the last of them
  let lastWriter = {}
  stmts.forEach((s, ix) => { lastWriter[s.tmp] = ix })

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
    // earlier writes to the same tmp come first (init before update)
    stmts.forEach((s2, j) => { if (s2.tmp == s.tmp && j < ix) ds[j] = true })
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

// Returns the statement list, plus whatever could not be placed.
let schedule = (gens, stmts) => {
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
    let node = { key: s.key, arg: [{ key: "ref", op: s.tmp }, s.q] }
    if (s.project) {
      // reuse the projection emitter: PROJECT the iteration space into a temp,
      // then TRAVERSE it, so the body runs once per distinct key
      emitFilters1({ vars: [], filters: [], buf }, s.fre, s.bnd, s.ext, true)(
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

  // TODO: Optimize the selection here?
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

  // Which loop to open next. Currently same heuristics as new-codegen
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

  // core scheduling loop, each recursive call represents a level of loop nest
  let emitAll = (pending, buf) => {
    // proceed if there are some statements that
    // have their dependencies available
    while (pending.some(depsAvailable)) {
      // but not all of them might be immediately emittable
      let now = pending.filter(emittable)
      pending = pending.filter(t => !emittable(t))
      while (now.length) {
        now.forEach(t => emitStmt(t, buf))
        // new statements might become emittable
        now = pending.filter(emittable)
        pending = pending.filter(t => !emittable(t))
      }
      if (!pending.length) return pending

      // the ones that are only waiting for loops
      let ready = pending.filter(t => fusable(t) && depsAvailable(t))
      if (!ready.length) return pending

      // select a loop to open
      let l = nextLoop(pending.filter(fusable), ready)
      if (l === undefined) return pending

      let body = openLoop(l, buf)
      // only statements that depend on this loop belong inside it
      let inner = pending.filter(t => fusable(t) && loopDeps[t].includes(l))
      // recurse
      let left = emitAll(inner, body)
      closeLoop()
      if (inner.length == left.length)
        throw new Error("opt-loopgen: no progress opening loop " + l)
      pending = pending.filter(t => !inner.includes(t) || left.includes(t))
    }
    return pending
  }

  let left = emitAll(stmts.map((_, i) => i), root)
  return { root, left }
}


// ----- the c2 driver -----

let scheduleC2 = (q) => {
  if (!settings.extractAssignments) {
    console.error("opt-loopgen only works if settings.extractAssignments = true")
    return []
  }

  let gens = buildGenerators()
  let stmts = buildStatements(gens)
  let { root, left } = schedule(gens, stmts)

  for (let t of left)
    console.error("opt-loopgen: could not emit " + stmts[t].key +
      " tmp" + stmts[t].tmp + " := " + pretty(stmts[t].q))

  console.assert(same(q.fre, []))
  root.push({ key: "return", arg: [q] })
  return root
}


exports.buildGenerators = buildGenerators
exports.buildStatements = buildStatements
exports.schedule = schedule
exports.scheduleC2 = scheduleC2
