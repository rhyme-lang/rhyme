const { api } = require('./rhyme')
const { sets } = require('./shared')
const { pretty, initRequired } = require('./simple-codegen')

let isDeepVarStr = s => s.startsWith("**")
const { typing, types, typeSyms } = require('./typing')

const { unique, union, intersect, diff, subset, same } = sets


// ----- auxiliary state -----

let settings

let prefixes      // canonicalize * for every prefix, e.g., data.* (preproc)
let path          // current grouping path variables (extract)

let vars          // deps var->var, var->tmp
let hints
let filters
let assignments


exports.setLoopgenState = st => {
  settings = st.settings
  prefixes = st.prefixes
  path = st.path
  vars = st.vars
  hints = st.hints
  filters = st.filters
  assignments = st.assignments
  projCount = 0
}

// let trans = ps => unique([...ps,...ps.flatMap(x => vars[x].vars)])

// projections (PROJECT, DOMAIN) get distinct names: proj<n>
let projCount = 0

let getFilterIndex = () => {
  let res = {}
  for (let i in filters) {
    let f = filters[i]
    let v1 = f.arg[1].op
    let g1 = f.arg[0]
    res[v1] ??= []
    res[v1].push(Number(i))
  }
  return res
}

let emitFilters1 = (scope, free, bnd, ext, careAboutOrderingAndMultiplicity) => body => {
  // approach: build explicit projection first
  // 1. iterate over transitive iter space to
  //    build projection map
  // 2. iterate over projection map to compute
  //    desired result

  if (settings.extractAssignments) {
    console.assert(intersect(free, scope.vars).length == 0)
    console.assert(intersect(bnd, scope.vars).length == 0)
    console.assert(intersect(ext, scope.vars).length == 0)
  } else
    console.assert(subset(free, scope.vars))

  let buf = scope.buf

  let iter = union(bnd, diff(free, scope.vars)) // either bnd or bnd\free, depending on mode

  if (iter.length == 0) return body(scope)

  let full = union(ext, union(free, bnd))

  // let full2 = union(free,trans(bnd))
  // assertSame(full, full2, "free "+free+" bound "+bnd)

  // full2 doesn't work: free was cut down to out, so
  // any variables not in scope will need to be
  // reconstructed here (through iteration)

  // Questions:
  // 1. does trans(iter) do the right thing, or
  //    do we need to use q.free? (XX: had to use .fre)
  // 2. is it OK to take the ordering of iter, or
  //    do we need to compute topological order?


  // Full outer joins: a variable whose generators are all 'maybe'
  // (data.*A?) has no strict generator, so emitFilters2 would skip all of
  // them. The variable ranges over the union of its maybe generators,
  // which is built first, as a projection keyed by the variable's
  // dependencies (emitDomains); the variable is then looped over that
  // projection. Every such variable gets its generator in the same loop
  // nest, so a loop may contain any number of them.
  // TODO: a variable with a single maybe generator could loop over it
  // directly, without the projection.

  let idx = getFilterIndex()
  let maybeVars = [] // variables with only maybe generators
  for (let v of full)
    if (idx[v] && idx[v].every(i => filters[i].mode == "maybe"))
      maybeVars.push(v)

  let trueFree = intersect(free, scope.vars)
  let domains = emitDomains(scope, trueFree, maybeVars, idx)

  // NOTE: by passing `full` to emitFilter2 without diff, we will re-run
  // the full set of filters for each sym that's already in scope.
  // This is necessary!
  // TODO: keep track of which filters were run in scope, not just vars

  if (ext.length == 0 || !careAboutOrderingAndMultiplicity) { // XXX should not disregard order?
    emitFilters2(scope, trueFree, full, [], domains)(body)
  } else {

    let id = projCount++ // TODO: CSE wrt iter

    buf.push("// PROJECT "+full+" -> "+iter)

    // emit: let $projName = {}
    buf.push({key: "declareTemp", arg: [id, iter]})

    emitFilters2(scope, trueFree, full, [], domains)((scope1) => {
      // emit: $projName[...iter] = true}
      scope1.buf.push({key: "initTemp", arg: [id, iter]})
    })

    buf.push("// TRAVERSE "+iter)

    // emit: with [x1, x2, ...] = iter
    //
    //  for (let $x1 <- proj)
    //    for (let $x2 <- proj[$iter[0]])
    //      ...

    // NOTE: we can either generate a single 'multi-loop' 
    // (to let codegen deal with the entire loop nest) or
    // individual loops. Right now we prefer a multi-loop here,
    // since it reduces entannglement with individual codegen
    // choice (e.g. how the variable is called), but ultimately
    // using individual loops might be more flexible. 
    //
    // One concern is that for deep vars, adressing of 'proj'
    // work differently (path is flattened to single key).
    // We need better abstractions to deal with such differences.

    let buf1 = []
    buf.push({ key: "forTempMult", body: buf1, arg: [id,iter] })
    buf = buf1

/*
    let prefix = { key: "raw", op: projName }
    for (let x of iter) {
      let buf1 = []
      buf.push({ key: "forTemp", body: buf1, arg: [x,prefix] })
      let varName = isDeepVarStr(x) ? quoteVar(x)+"_key" : quoteVar(x)
      prefix = { key: "get", arg: [prefix, { key: "var", op: x }] }
      buf = buf1
        // buf.push("for (let "+quoteVar(x)+" in "+prefix+") {")
        // // buf.push({ key: "for1", arg: [quoteVar(x), prefix]})
        // prefix += "["+quoteVar(x)+"]"
        // closing = "}\n"+closing
      // }
    }
*/

    // NOTE: right now we don't add any generator variables for the
    // loops we're in -- technically we're reading from 'proj', not
    // evaluating the filters proper.

    // TODO: another choice would be to add variables for *all*
    // filters -- investigate if that works
    // (how to access? could grab and store the scope passed to
    // emitFilters2's body)

    let scope1 = {...scope, buf: buf, vars: [...scope.vars,...iter]}
    body(scope1)
  }
}


// The domain of each variable in 'maybeVars' (see emitFilters1): the union of
// its maybe generators, built as a projection
//
//   proj[...deps][v] = true    for each generator of v
//
// keyed by the variables v depends on, so that a domain that varies with
// an enclosing variable is kept apart per value of it. Returns one
// pseudo-generator per variable, which reads v from its projection.
let emitDomains = (scope, trueFree, maybeVars, idx) => {
  let domains = []
  let rest = [...maybeVars]
  while (rest.length) {
    // build the domains a variable depends on first
    let v = rest.find(v => !rest.some(w => w != v && vars[v].vars.includes(w)))
    if (v === undefined) {
      console.error("cyclic outer join domains: "+rest)
      break
    }
    rest = rest.filter(w => w != v)
    if (isDeepVarStr(v))
      console.error("outer join not supported for deep var "+v)

    let deps = vars[v].vars.filter(x => x != v) // transitively closed
    let key = [...deps, v]
    let id = projCount++

    scope.buf.push("// DOMAIN "+v+" = "+idx[v].map(i => pretty(filters[i])).join(" | "))
    scope.buf.push({key: "declareTemp", arg: [id, key]})
    for (let i of idx[v]) {
      emitFilters2(scope, trueFree, key, [i], domains)((scope1) => {
        scope1.buf.push({key: "initTemp", arg: [id, key]})
      })
    }

    let g1 = { key: "projRef", op: id, arg: deps.map(x => ({ key: "var", op: x, arg: [] })),
               fre: deps, filters: [] }
    domains.push({ id: "dom"+id, v1: v, g1 })
  }
  return domains
}


// enabled: the maybe filters to treat as generators (all others are skipped)
// domains: pseudo-generators reading a variable from its projected domain
let emitFilters2 = (scope, trueFree, iter, enabled = [], domains = []) => body => {

  let buf = scope.buf

  let vars = {}
  let seen = {}

  if (iter.length == 0)
    return body()

  // remember the set of iteration vars
  for (let v of iter) vars[v] = true

  // record current scope
  for (let v of trueFree) seen[v] = true

  // generator i: a filter index, or the id of a domain
  let domainById = {}
  for (let d of domains) domainById[d.id] = d
  let gen = i => typeof i == "number"
    ? { v1: filters[i].arg[1].op, g1: filters[i].arg[0] }
    : domainById[i]
  let show = i => typeof i == "number" ? pretty(filters[i]) : "domain of "+domainById[i].v1

  // only consider filters contributing to iteration vars
  let pending = []
  for (let i in filters) {
    let f = filters[i]
    let v1 = f.arg[1].op

    if (f.mode == "maybe" && !enabled.includes(Number(i)))
      continue // disregard outer join! data.*A? --> unless requested!

    if (vars[v1]) // not interested in this? skip
      pending.push(Number(i))
  }
  for (let d of domains)
    if (vars[d.v1])
      pending.push(d.id)

  let filtersInScope = [...scope.filters]
  let varsInScope = [...scope.vars]

  scope = { ...scope, vars: varsInScope, filters: filtersInScope }

  // compute next set of available filters:
  // all dependent iteration vars have been seen (emitted before)
  let available = []
  let next = () => {
    let p = pending
    pending = []
    for (let i of p) {
      let { g1 } = gen(i)

      let avail = g1.fre.every(x => seen[x])

      // NOTE: doesn't work yet for nested codegen: filters
      // propagates too far -- it should only propagate
      // as far upwards as they are used!

      if (settings.extractFilters)
         avail &&= subset(g1.filters??[], filtersInScope) // plusTest4a has g1.filters null?

      if (avail)
        available.push(i) // TODO: insert in proper place
      else
        pending.push(i)
    }
    return available.length > 0
  }

  // process filters one by one
  while (next()) {
    // sort available by estimated selectivity
    // crude proxy: number of free vars
    let selEst = i => gen(i).g1.fre.length
    available.sort((a,b) => selEst(b) - selEst(a))

    let i = available.shift()

    let { v1, g1 } = gen(i)

    let scopeg1 = {...scope}
    let scopef = {...scope}

    // NOTE: we're restricting the scope to g1.fre when evaluating g1.
    //
    //       Why? The filter expression may have bound variables that
    //       are already in scope here. We need to iterate over them
    //       again to match the semantic behavior of the alternative
    //       case where we're hoisting out assignments and the var
    //       isn't already in scope.
    //
    //       An alternative would be to try and make reusing the
    //       outer var the default case in the semantics. Then we
    //       would have to detect this case and mark the variable
    //       free instead of bound. This seems like it might
    //
    //  See: testGroup0-a3, aggregateAsKey_encoded1
    //
    //  Q:   do we need to prune scope.filters accordingly as well?

    console.assert(subset(g1.fre,varsInScope))

    // Contract: input is already transitively closed, so we don't
    // depend on any variables that we don't want to iterate over.
    // (sanity check!)
    let extra = g1.fre.filter(x => !vars[x])
    if (extra.length != 0) {
      console.error("extra dependency: "+extra)
    }

    // enter loop or if statement:
    //
    //    for (let [$v1, gen$i] of Object.entries($g1 | $scopeg1) ?? {}) {
    //      ... use $scopeg1
    //
    //    if ($v1 in $g1 | $scopeg1) {
    //      ...
    //

    let buf1 = []
    buf.push({ key: (seen[v1] ? "if" : "for"), body: buf1, arg: [v1,i, g1]})
    buf = buf1
    if (!seen[v1]) {
      seen[v1] = true
      varsInScope.push(v1)
    }
    filtersInScope.push(i)
  }

  // check that all filters were emitted
  if (pending.length > 0) {
    let problem = pending.map(show).join(", ")
    console.warn("unsolved filter ordering problem: couldn't emit "+problem)
    for (let i of pending) {
      buf.push("// ERROR: unsolved filter ordering problem: "+i+" := "+show(i))
    }
  }

  // check that all variables were seen
  for (let v in vars) {
    if (!seen[v]) {
      console.error("no suitable generator for variable "+v)
      buf.push("// ERROR: no suitable generator for variable "+v)
    }
  }


  // emit loop body
  let scope1 = {...scope, buf, vars: [...varsInScope], filters: [...filtersInScope]}
  body(scope1)

  // all loops implicitly closed
}


let emitLoops = (q, order) => {
  let buf = []

  if (settings.extractAssignments) {
    for (let is of order) {
      if (is.length > 1)
        console.error("cycle "+is)
      let [i] = is
      let q = assignments[i]

      buf.push("// --- tmp"+i+" ---")
      let scope = { vars:[], filters:[], buf }

      // emit initialization first (so that sum empty = 0)
      if (initRequired(q)) {
        let needProject = !settings.elimProjections
        emitFilters1(scope, q.fre, [], q.extInit, needProject)(scope1 => {
          scope1.buf.push({ key: "init", arg: [{ key: "ref", op: i}, q]})
        })
      }

      // idempotent ops do not need projection
      let needProject = true
      if (settings.elimProjections) {
        if (q.key == "stateful" && ["single","first","last","all","any"].includes(q.op))
          needProject = false
        else if (q.key == "update" && q.arg[2].key == "ref")
          needProject = false
      }

      emitFilters1(scope, q.fre, q.bnd, q.ext, needProject)(scope1 => {
        scope1.buf.push({ key: "update", arg: [{ key: "ref", op: i}, q]})
      })

      buf.push("")
    }

    buf.push("// --- res ---")
  } else {
    console.error("loopgen only works if settings.extractAssignments = true")
  }

  console.assert(same(q.fre,[]))
  let scope = { vars:[], filters: [], buf }
  buf.push({ key: "return", arg: [q]})

  return buf
}


exports.emitLoops = emitLoops

// opt-loopgen reuses the projection nest for the statements that need one
exports.emitFilters1 = emitFilters1

