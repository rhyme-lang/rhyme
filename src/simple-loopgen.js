const { api } = require('./rhyme')
const { sets } = require('./shared')
const { runtime } = require('./simple-runtime')
const { pretty } = require('./simple-codegen')
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
}

let transf = ps => unique([...ps,...ps.flatMap(x => vars[x].varsf)])

let getFilterIndex = () => {
  let res = {}
  for (let i in filters) {
    let f = filters[i]
    let v1 = f.arg[1].op
    let g1 = f.arg[0]
    res[v1] ??= []
    res[v1].push(i)
  }
  return res
}

let emitFilters1 = (scope, free, bnd) => body => {
  // approach: build explicit projection first
  // 1. iterate over transitive iter space to
  //    build projection map
  // 2. iterate over projection map to compute
  //    desired result

  let buf = scope.buf

  let iter = diff(union(free, bnd), scope.vars)

  if (iter.length == 0) return body(scope)

  let full = transf(union(free, bnd))

  // let full2 = union(free,transf(bnd))
  // assertSame(full, full2, "free "+free+" bound "+bnd)

  // full2 doesn't work: free was cut down to out, so
  // any variables not in scope will need to be
  // reconstructed here (through iteration)

  // Questions:
  // 1. does trans(iter) do the right thing, or
  //    do we need to use q.free? (XX: had to use .fre)
  // 2. is it OK to take the ordering of iter, or
  //    do we need to compute topological order?


  // For full outer joins, we compute the iteration domain
  // as a big disjuction, with one loop for each 'data.*A?'
  // generator. This is not the most efficient way, but
  // it works.

  let idx = getFilterIndex()
  let disjunct = []
  for (let v of iter) {
    // does the variable have only 'maybe' generators?
    if (idx[v] && idx[v].every(i => filters[i].mode == "maybe")) {
      disjunct.push(...idx[v])
    }
  }

  // NOTE: by passing `full` to emitFilter2 without diff, we will re-run
  // the full set of filters for each sym that's already in scope.
  // TODO: keep track of which filters were run in scope, not just vars

  if (same(diff(full,scope.vars), iter) && disjunct.length == 0) { // XXX should not disregard order?
    emitFilters2(scope, full, -1)(body)
  } else {

    let id = buf.length // TODO: CSE wrt iter

    buf.push("// PROJECT "+full+" -> "+iter)
    
    // emit: let $projName = {}
    buf.push({key: "declareTemp", arg: [id, iter]})

    // emit one loop per outer join disjuct -- if none, emit at least one loop
    if (disjunct.length == 0) 
      disjunct = [-1]

    for (let u of disjunct) {
      emitFilters2(scope, full, u)((scope1) => {
        // emit: $projName[...iter] = true}
        scope1.buf.push({key: "initTemp", arg: [id, iter]})
      })
    }

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


let emitFilters2 = (scope, iter, u) => body => {

  let buf = scope.buf

  let vars = {}
  let seen = {}

  if (iter.length == 0)
    return body()

  // remember the set of iteration vars
  for (let v of iter) vars[v] = true

  // record current scope
  for (let v of scope.vars) seen[v] = true

  // only consider filters contributing to iteration vars
  let pending = []
  for (let i in filters) {
    let f = filters[i]
    let v1 = f.arg[1].op
    let g1 = f.arg[0]

    if (g1.mode == "maybe" && i !== u)
      continue // disregard outer join! data.*A? --> unless requested!

    if (vars[v1]) // not interested in this? skip
      pending.push(i)
  }

  let filtersInScope = [...scope.filters]

  // compute next set of available filters:
  // all dependent iteration vars have been seen (emitted before)
  let available = []
  let next = () => {
    let p = pending
    pending = []
    for (let i of p) {
      let f = filters[i]
      let v1 = f.arg[1].op
      let g1 = f.arg[0]

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

  let vs = [...scope.vars]

  // process filters one by one
  while (next()) {
    // sort available by estimated selectivity
    // crude proxy: number of free vars
    let selEst = i => filters[i].arg[0].fre.length
    available.sort((a,b) => selEst(b) - selEst(a))

    let i = available.shift()
    filtersInScope.push(i)

    let f = filters[i]
    let v1 = f.arg[1].op
    let g1 = f.arg[0]

    // let found = subset(g1.filters, filtersInScope)
    // buf.push("// "+g1.filters+" | "+filtersInScope + " " +found)

    // buf.push("// FILTER "+i+" := "+pretty(f))
    let scopeg1 = {...scope, vars:g1.fre, filters:filtersInScope}
    let scopef = {...scope, vars:f.fre,filters:filtersInScope}

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

    // scopeg1.vars = [...vs]
    console.assert(subset(g1.fre,vs))
    vs.push(v1)

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

    let buf1 = []
    buf.push({ key: (seen[v1] ? "if" : "for"), body: buf1, arg: [v1,i, g1]})
    buf = buf1
    seen[v1] = true
  }

  // check that all filters were emitted
  if (pending.length > 0) {
    let problem = pending.map(i => pretty(filters[i])).join(", ")
    console.warn("unsolved filter ordering problem: couldn't emit "+problem)
    for (let i of pending) {
      buf.push("// ERROR: unsolved filter ordering problem: "+i+" := "+pretty(filters[i]))
    }
  }

  // check that all variables were seen
  for (let v in vars) {
    if (!seen[v])
      console.error("no suitable generator for variable "+v)
  }


  // emit loop body
  let scope1 = {...scope, buf, vars: [...scope.vars, ...iter], filters: [...filtersInScope]}
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
      if (q.key == "stateful" && q.mode != "maybe" && (q.op+"_init") in runtime.stateful || q.key == "update") {
        emitFilters1(scope,q.fre,[])(scope1 => {
          scope1.buf.push({ key: "init", arg: [{ key: "ref", op: i}, q]})
        })
      }

      emitFilters1(scope,q.fre,q.bnd)(scope1 => {
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

