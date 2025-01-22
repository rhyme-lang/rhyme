const { api } = require('./rhyme')
const { parse } = require('./parser')
const { sets } = require('./shared')
const { scc } = require('./scc')
const { generate } = require('./new-codegen')
const { preproc } = require('./preprocess')
const { runtime } = require('./simple-runtime')
const { generateCSql } = require('./sql-codegen')
const { generateCSqlNew } = require('./sql-newcodegen')
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


exports.setCodegenState = st => {
  settings = st.settings
  prefixes = st.prefixes
  path = st.path
  vars = st.vars
  hints = st.hints
  filters = st.filters
  assignments = st.assignments
}

let transf = ps => unique([...ps,...ps.flatMap(x => vars[x].varsf)])



// ----- back end -----

//
// 10. Pretty print
//

let prettyPath = es => {
  if (es === undefined) return "[?]"
  let sub = x => typeof(x) === "string" ? x : pretty(x)
  return "[" + es.map(sub).join(",") + "]"
}

let pretty = q => {
  if (q.key == "input") {
    return "inp"
  } else if (q.key == "loadInput") {
    let [e1] = q.arg.map(pretty)
    return `loadInput('${q.op}', ${e1})`
  } else if (q.key == "const") {
    if (typeof q.op === "object" && Object.keys(q.op).length == 0) return "{}"
    else return ""+q.op
  } else if (q.key == "var") {
    return q.op
  } else if (q.key == "ref") {
    let e1 = assignments[q.op]
    return "tmp"+q.op+prettyPath(e1.fre)
  } else if (q.key == "get") {
    let [e1,e2] = q.arg.map(pretty)
    if (e1 == "inp") return e2
    // if (q.arg[1].key == "var") { // hampers CSE pre-extract
      // if (q.filter === undefined) // def
        // return e2 + " <- " + e1
    // }
    if (q.mode == "maybe")
      return e1+"["+e2+"?]"
    return e1+"["+e2+"]"
  } else if (q.key == "pure") {
    let es = q.arg.map(pretty)
    return q.op + "(" + es.join(", ") + ")"
  } else if (q.key == "hint") {
    let es = q.arg.map(pretty)
    return q.op + "(" + es.join(", ") + ")"
  } else if (q.key == "mkset") {
    let [e1] = q.arg.map(pretty)
    return "mkset("+e1+")"
  } else if (q.key == "prefix") {
    let [e1] = q.arg.map(pretty)
    return "prefix_"+q.op+"("+e1+")"
  } else if (q.key == "stateful") {
    let [e1] = q.arg.map(pretty)
    return q.op+"("+e1+")"
  } else if (q.key == "group") {
    let [e1,e2] = q.arg.map(pretty)
    return "{ "+ e1 + ": " + e2 + " }"
  } else if (q.key == "update") {
    let [e0,e1,e2,e3] = q.arg.map(pretty)
    if (e3) return e0+ "{ "+ e1 + ": " + e2 + " } / " + e3
    return e0+ "{ "+ e1 + ": " + e2 + " }"
  } else {
    console.error("unknown op", q)
  }
}


let pseudoVerbose = false

let emitPseudo = (q) => {
  let margin = 16
  let buf = []
  for (let i in filters) {
    let q = filters[i]
    buf.push(("gen"+i + prettyPath(q.fre)).padEnd(margin) + " = " + pretty(q))
    buf.push("".padEnd(margin) + " : " + typing.prettyPrintTuple(q.schema))
    if (pseudoVerbose && q.fre.length)
      buf.push("  " + q.fre)
  }
  if (hints.length) buf.push("")
  for (let i in hints) {
    let q = hints[i]
    buf.push(("hint"+i + prettyPath(q.fre)).padEnd(margin) + " = " + pretty(q))
    buf.push("".padEnd(margin) + " : " + typing.prettyPrintTuple(q.schema))
    if (pseudoVerbose && q.fre.length)
      buf.push("  " + q.fre)
  }
  if (pseudoVerbose) {
    buf.push("")
    let hi = buf.length
    for (let v in vars) {
      if (vars[v].vars.length > 0 || vars[v].tmps && vars[v].tmps.length > 0)
        buf.push(v + " -> " + vars[v].vars +"  "+ (vars[v].tmps??[]))
    }
  }
  buf.push("")
  hi = buf.length
  for (let v in vars) {
    if (vars[v].varsf.length > 0 || vars[v].tmps && vars[v].tmps.length > 0)
      buf.push(v + " -> " + vars[v].varsf +"  "+ (vars[v].tmps??[]))
  }
  if (buf.length > hi)
    buf.push("")
  for (let i in assignments) {
    let q = assignments[i]
    buf.push(("tmp"+i + prettyPath(q.fre) + prettyPath(q.bnd)).padEnd(margin) + " = " + pretty(q))
    buf.push("".padEnd(margin) + " : " + typing.prettyPrintTuple(q.schema))
    if (!pseudoVerbose) continue
    if (q.path?.length > 0)
      buf.push("  pth: " + q.path.map(pretty))
    if (q.vars.length > 0)
      buf.push("  var: " + q.vars)
    if (q.tmps?.length > 0)
      buf.push("  tmp: " + q.tmps)
    if (q.mind.length > 0)
      buf.push("  min: " + q.mind)
    if (q.dims.length > 0)
      buf.push("  dim: " + q.dims)
    if (q.out?.length > 0)
      buf.push("  out: " + q.out)
    if (q.iterInit?.length > 0)
      buf.push("  it0: " + q.iterInit)
    if (q.iter?.length > 0)
      buf.push("  itr: " + q.iter)
    if (q.free?.length > 0)
      buf.push("  fr1: " + q.free)
    if (q.fre?.length > 0)
      buf.push("  fre: " + q.fre)
    if (q.bound?.length > 0)
      buf.push("  bn1: " + q.bound)
    if (q.bnd?.length > 0)
      buf.push("  bnd: " + q.bnd)
  }
  buf.push(pretty(q))
  buf.push(": " + typing.prettyPrintTuple(q.schema))
  if (q.fre?.length > 0)
    buf.push("  " + q.fre)
  return buf.join("\n")
}



//
// 10-11. Analysis
//

// does the expression produce a result that's
// not aliased with any other mutable value?
let isFresh = q => {
  if (q.key == "const") {
    return true
  } else if (q.key == "pure") {
    // contract for udfs: arguments fresh, result fresh
    if (q.op == "apply")
      return q.arg.slice(1).every(isFresh)
  }
  return false
}



//
// 11. Code generation
//


let isDeepVarStr = s => s.startsWith("**")

let isDeepVarExp = s => s.key == "var" && isDeepVarStr(s.op)


let quoteVar = s => s.replaceAll("*", "x")

let quoteIndex = s => "?.["+s+"]"

let quoteIndexVars = (s,vs) => s + vs.map(quoteVar).map(quoteIndex).join("")

let quoteStr = s => "\""+s+"\""

// XXX trouble with tmp path vars, see testPathGroup3
let quoteVarXS = s => isDeepVarStr(s) ? quoteVar(s)+".join('-')+'-'" : quoteVar(s)
let quoteIndexVarsXS = (s,vs) => s + vs.map(quoteVarXS).map(quoteIndex).join("")

let quoteConst = e => {
    if (typeof e === "boolean") {
        return String(e)
    } else if (typeof e === "number") {
        return String(e)
    } else if (typeof e === "string") {
        return '"'+e+'"'
    } else if (typeof e === "object" && e instanceof Array && e.length == 0) {
        return "[]"
    } else if (typeof e === "object" && Object.keys(e).length == 0) {
        return "{}"
    } else {
        console.error("emit unsupported constant: "+e)
        return "(throw new Error('unsupported constant:"+e+"'))"
    }
}


let codegen = (q, scope) => {
  console.assert(scope.vars)
  console.assert(scope.filters)
  // console.assert(scope.buf)
  if (q.key == "raw") {
    return q.op
  } else if (q.key == "input") {
    return "inp"
  } else if (q.key == "loadInput") {
    console.error("op not implemented: ", pretty(q))
    let [e1] = q.arg.map(x => codegen(x,scope))
    return `loadInput('${q.op}', ${e1})`
  } else if (q.key == "const") {
    return quoteConst(q.op)
  } else if (q.key == "var") {
    // TODO: check that variables are always defined
    // console.assert(scope.vars.indexOf(q.op) >= 0)
    if (!settings.extractAssignments) // TODO: fails otherwise...
      if (scope.vars.indexOf(q.op) < 0) {
        scope.buf.push("// ERROR: var '"+q.op+"' not defined in "+scope.vars)
        console.error("// ERROR: var '"+q.op+"' not defined")
      }
    return quoteVar(q.op)
  } else if (q.key == "ref") {
    let q1 = assignments[q.op]
    let xs = [String(q.op),...q1.fre]
    return quoteIndexVarsXS("tmp", xs)
  } else if (settings.extractFilters
          && q.key == "get" && "filter" in q
          && scope.filters.indexOf(q.filter) >= 0) {
    // TODO: check that filters are always defined (currently still best-effort)
    // console.assert(scope.filters.indexOf(q.filter) >= 0)
    return "gen"+q.filter
  } else if (q.key == "get" && isDeepVarExp(q.arg[1])) {
    let [e1,e2] = q.arg.map(x => codegen(x,scope))
    return "rt.deepGet("+e1+","+e2+")"
  } else if (q.key == "get") {
    let [e1,e2] = q.arg.map(x => codegen(x,scope))
    return e1+quoteIndex(e2)
  } else if (q.key == "pure") {
    let es = q.arg.map(x => codegen(x,scope))
    return "rt.pure."+q.op+"("+es.join(",")+")"
  } else if (q.key == "hint") {
    // no-op!
    return "{}"
  } else if (q.key == "mkset") {
    let [e1] = q.arg.map(x => codegen(x,scope))
    return "rt.singleton("+e1+")"
  } else if (q.key == "stateful" || q.key == "prefix" || q.key == "update") {
    if (settings.extractAssignments) {
      console.error("unexpected nested assignment "+pretty(q))
    } else {
      return emitStmInline(q, scope)
    }
  } else {
    console.error("unknown op", pretty(q))
    return "<?"+q.key+"?>"
  }
}


let emitStmInit = (q, scope) => {
  if (q.key == "stateful") {
    return "rt.stateful."+q.op+"_init"
  } else if (q.key == "update") {
    let e0 = codegen(q.arg[0], scope)
    if (q.mode == "inplace" || isFresh(q.arg[0]))
      return "(() => "+e0+")"
    else
      return "rt.stateful.update_init("+e0+")" // need to create copy
  } else {
    console.error("unknown op", q)
  }
}

let emitStmUpdate = (q, scope) => {
  if (q.key == "prefix") {
    let [e1] = q.arg.map(x => codegen(x, scope))
    // XXX TODO: add prefix wrapper?
    return "rt.stateful.prefix(rt.stateful."+q.op+"("+e1+"))"
  } else if (q.key == "stateful") {
    let [e1] = q.arg.map(x => codegen(x, scope))
    return "rt.stateful."+q.op+"("+e1+")"
  } else if (q.key == "update") {
    let e0 = codegen(q.arg[0], scope)
    let e2 = codegen(q.arg[2], scope)
    let e1 = q.arg[1].vars.map(quoteVar)
    return "rt.stateful.update("+e0+", ["+e1+"], "+e2+")" // XXX: init is still needed for tree paths
    // return "rt.stateful.update("+"null"+", "+e1+", "+e2+")" // see testPathGroup4-2
  } else {
    console.error("unknown op", q)
  }
}


// XX no longer used, now using transf/computeDependenciesf
let transViaFiltersFree = iter => {
  let vars = {}

  // remember the set of iteration vars
  for (let v of iter) vars[v] = true

  // transitive closure
  let done = false
  while (!done) {
    done = true
    for (let i in filters) {
      let f = filters[i]
      let v1 = f.arg[1].op
      let g1 = f.arg[0]
      if (vars[v1]) { // not interested in this? skip
        for (v2 of g1.fre) {
          if (!vars[v2]) {
            vars[v2] = true
            done = false
          }
        }
      }
    }
  }

  let res = []
  for (let v in vars)
    res.push(v)
  return res
}

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

let emitFilters1 = (scope, free, bnd) => (buf, codegen) => body => {
  // approach: build explicit projection first
  // 1. iterate over transitive iter space to
  //    build projection map
  // 2. iterate over projection map to compute
  //    desired result

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

  // NOTE: by passing `full` to emitFilters2 without diff, we will re-run
  // the full set of filters for each sym that's already in scope.
  // TODO: keep track of which filters were run in scope, not just vars

  if (same(diff(full,scope.vars), iter) && disjunct.length == 0) { // XXX should not disregard order?
    emitFilters2(scope, full, -1)(buf, codegen)(body)
  } else {

    let closing = ""//"}"
    // buf.push("{")

    let projName = "proj"+buf.length // TODO: CSE wrt iter

    buf.push("// PROJECT "+full+" -> "+iter)
    buf.push("let "+projName+" = {}")

    // emit one loop per outer join disjuct -- if none, emit at least one loop
    if (disjunct.length == 0) 
      disjunct = [-1]

    for (let u of disjunct) {
      emitFilters2(scope, full, u)(buf, codegen)(() => {
        let xs = [...iter.map(quoteVar)]
        let ys = xs.map(x => ","+x).join("")
        buf.push("  rt.initTemp("+projName+ys+")(() => true)")
      })
    }

    buf.push("// TRAVERSE "+iter)

    let prefix = projName
    for (let x of iter) {
      if (isDeepVarStr(x)) { // ok, just emit current
        buf.push("rt.deepForInTemp("+prefix+", ("+quoteVar(x)+"_key, "+quoteVar(x)+") => {")
        prefix += "["+quoteVar(x)+"_key]"
        closing = "})\n"+closing
      } else {
        buf.push("for (let "+quoteVar(x)+" in "+prefix+") {")
        prefix += "["+quoteVar(x)+"]"
        closing = "}\n"+closing
      }
    }

    // NOTE: right now we don't add any generator variables for the
    // loops we're in -- technically we're reading from 'proj', not
    // evaluating the filters proper.

    // TODO: another choice would be to add variables for *all*
    // filters -- investigate if that works
    // (how to access? could grab and store the scope passed to
    // emitFilters2's body)

    let scope1 = {...scope, vars: [...scope.vars,...iter]}
    body(scope1)

    buf.push(closing)
  }
}


let emitFilters2 = (scope, iter, u) => (buf, codegen) => body => {

  // let watermark = buf.length
  // let buf0 = buf
  // let buf1 = []

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
      continue // disregard outer join! data.*A?

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

  let closing = ""

  let vs = [...scope.vars]

  // process filters
  while (next()) {
    // sort available by estimated selectivity
    // crude proxy: number of free vars
    let selEst = i => filters[i].arg[0].fre.length
    available.sort((a,b) => selEst(b) - selEst(a))

    let i = available.shift()
    filtersInScope.push(i)

    // for (let i of available) {
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

      if (isDeepVarStr(v1)) { // ok, just emit current
        if (!seen[v1]) {
          buf.push("rt.deepForIn("+codegen(g1,scopeg1)+", "+quoteVar(v1)+" => {")
        } else {
          buf.push("rt.deepIfIn("+codegen(g1,scopeg1)+", "+quoteVar(v1)+", () => {")
        }
        buf.push("let gen"+i+" = "+codegen(f,scopef))
        seen[v1] = true
        closing = "})\n"+closing
      } else { // ok, just emit current
        if (!seen[v1]) {
          buf.push("for (let ["+quoteVar(v1)+", gen"+i+"] of rt.entries("+codegen(g1,scopeg1)+")) {")
        //   buf.push("for (let "+quoteVar(v1)+" in "+codegen(g1,scopeg1)+") {")
        //   buf.push("let gen"+i+" = "+codegen(f,scopef))
        } else {
          buf.push("if (rt.has("+codegen(g1,scopeg1)+", "+quoteVar(v1)+")) {")
        }
        seen[v1] = true
        closing = "}\n"+closing
      }
    // }
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

  // combine buffers
  // if (buf.length > watermark) buf.push("// main loop")
  // buf.push(...buf1)

  let scope1 = {...scope, vars: [...scope.vars, ...iter], filters: [...filtersInScope]}
  body(scope1)

  buf.push(closing)
}


let emitStmInline = (q, scope) => {
  let buf = scope.buf
  if (!("stmCount" in scope))
    scope.stmCount = [0]
  let i = scope.stmCount[0]++

  let bound
  if (q.key == "update") {
    bound = diff(q.arg[1].vars, scope.vars) // explicit var -- still no traversal if already in scope
  } else
    bound = diff(q.arg[0].dims, scope.vars)


  buf.push("/* --- begin "+q.key+"_"+i+" --- "+pretty(q)+" ---*/")
  buf.push("// env: "+scope.vars+" dims: "+q.dims+" bound: "+bound)

  if (!same(bound,q.bnd)) {
    buf.push("// WARNING! q.bound "+q.bnd)
    console.warn("// WARNING! bound "+bound+" -> q.bnd "+q.bnd)
  }
  bound = q.bnd

  if (intersect(bound,scope.vars).length > 0) {
    buf.push("// WARNING: var '"+bound+"' already defined in "+scope.vars)
    console.warn("// WARNING: var '"+bound+"' already defined in "+scope.vars)
  }

  // emit initialization
  if (q.key == "stateful" && (q.op+"_init") in runtime.stateful || q.key == "update") {
      buf.push("let tmp"+i+" = "+ emitStmInit(q, scope)+"()")
  } else {
      buf.push("let tmp"+i)
  }

  // emit main computation
  emitFilters1(scope, q.fre, bound)(buf, codegen)(scope1 => {
    buf.push("tmp"+i+" = "+emitStmUpdate(q, scope1) + ".next(tmp"+i+")")
  })

  buf.push("/* --- end "+q.key+"_"+i+" */")

  // return reference
  return "tmp"+i
}


let emitCode = (q, order) => {
  let buf = []
  buf.push("(inp => {")
  buf.push("let tmp = {}")

  if (settings.extractAssignments) {
    for (let is of order) {
      if (is.length > 1)
        console.error("cycle "+is)
      let [i] = is
      let q = assignments[i]

      buf.push("// --- tmp"+i+" ---")
      let scope = { vars:[], filters:[], buf }

      // emit initialization first (so that sum empty = 0)
      if (q.key == "stateful" && (q.op+"_init") in runtime.stateful || q.key == "update") {
        emitFilters1(scope,q.fre,[])(buf, codegen)(scope1 => {
          let xs = [i,...q.fre.map(quoteVar)]
          let ys = xs.map(x => ","+x).join("")

          buf.push("  rt.init(tmp"+ys+")\n  ("+ emitStmInit(q, scope1) + ")")
        })
      }

      emitFilters1(scope,q.fre,q.bnd)(buf, codegen)(scope1 => {
        let xs = [i,...q.fre.map(quoteVar)]
        let ys = xs.map(x => ","+x).join("")

        buf.push("  rt.update(tmp"+ys+")\n  ("+ emitStmUpdate(q, scope1) + ")")
      })

      buf.push("")
    }

    buf.push("// --- res ---")
  }

  console.assert(same(q.fre,[]))
  let scope = { vars:[], filters: [], buf }
  buf.push("return "+codegen(q,scope))

  buf.push("})")

  return buf.join("\n")
}



// the following is called with the output of simple-loopgen

let cgList = xs => xs.map(x => x.key ? pretty(x) : String(x)).join(", ")

let emitStmListLowLevel = (q, buf) => {
  for (let stm of q) {
    if (stm.key == "for") {
      let [v1, i, g1] = stm.arg
      let f = filters[i]
      let scopeg1 = { vars: [], filters: [] }
      let scopef = { vars: [], filters: [] }

      if (isDeepVarStr(v1)) {
          buf.push("rt.deepForIn("+codegen(g1,scopeg1)+", "+quoteVar(v1)+" => {")
          buf.push("let gen"+i+" = "+codegen(f,scopef))
          emitStmListLowLevel(stm.body, buf)
          buf.push("})")
      } else {
          buf.push("for (let ["+quoteVar(v1)+", gen"+i+"] of rt.entries("+codegen(g1,scopeg1)+")) {")
          emitStmListLowLevel(stm.body, buf)
          buf.push("}")
      }

    } else if (stm.key == "if") {
      let [v1, i, g1] = stm.arg
      let f = filters[i]
      let scopeg1 = { vars: [], filters: [] }
      let scopef = { vars: [], filters: [] }

      if (isDeepVarStr(v1)) {
          buf.push("rt.deepIfIn("+codegen(g1,scopeg1)+", "+quoteVar(v1)+", () => {")
          buf.push("let gen"+i+" = "+codegen(f,scopef))
          emitStmListLowLevel(stm.body, buf)
          buf.push("})")
      } else {
          buf.push("if (rt.has("+codegen(g1,scopeg1)+", "+quoteVar(v1)+")) {")
          emitStmListLowLevel(stm.body, buf)
          buf.push("}")
      }

    } else if (stm.key == "forTemp") {
      let [x, prefix] = stm.arg
      let scopeg1 = { vars: [], filters: [] }

      if (isDeepVarStr(x)) {
          buf.push("rt.deepForInTemp("+codegen(prefix,scopeg1)+", ("+quoteVar(x)+"_key, "+quoteVar(x)+") => {")
          emitStmListLowLevel(stm.body, buf)
          buf.push("})")
      } else {
          buf.push("for (let "+quoteVar(x)+" in "+codegen(prefix,scopeg1)+") {")
          emitStmListLowLevel(stm.body, buf)
          buf.push("}")
      }

    } else if (stm.key == "forTempMult") {
      let [id, iter] = stm.arg
      let scopeg1 = { vars: [], filters: [] }

      let projName = "proj"+id
      let closing = ""
      let prefix = projName
      for (let x of iter) {
        if (isDeepVarStr(x)) { // ok, just emit current
          buf.push("rt.deepForInTemp("+prefix+", ("+quoteVar(x)+"_key, "+quoteVar(x)+") => {")
          prefix += "["+quoteVar(x)+"_key]"
          closing = "})\n"+closing
        } else {
          buf.push("for (let "+quoteVar(x)+" in "+prefix+") {")
          prefix += "["+quoteVar(x)+"]"
          closing = "}\n"+closing
        }
      }

      emitStmListLowLevel(stm.body, buf)
      buf.push(closing)


    } else if (stm.key == "init") {
      let [lhs,q] = stm.arg
      let i = lhs.op
      let scope1 = { vars: [], filters: [] }

          let xs = [i,...q.fre.map(quoteVar)]
          let ys = xs.map(x => ","+x).join("")

          buf.push("  rt.init(tmp"+ys+")\n  ("+ emitStmInit(q, scope1) + ")")

    } else if (stm.key == "declareTemp") {

      let [id,iter] = stm.arg

          buf.push("let proj"+id+" = {}")

    } else if (stm.key == "initTemp") {

      let [id,iter] = stm.arg

        let xs = [...iter.map(quoteVar)]
        let ys = xs.map(x => ","+x).join("")
        buf.push("  rt.initTemp(proj"+id+ys+")(() => true)")

    } else if (stm.key == "update") {

      let [lhs,q] = stm.arg
      let i = lhs.op
      let scope1 = { vars: [], filters: [] }

          let xs = [i,...q.fre.map(quoteVar)]
          let ys = xs.map(x => ","+x).join("")

          buf.push("  rt.update(tmp"+ys+")\n  ("+ emitStmUpdate(q, scope1) + ")")

    } else if (stm.key == "return") {

      let scope = { vars:[], filters: [], buf }
          buf.push("return " + codegen(stm.arg[0], scope))

    } else if (stm.key == "raw") {
      buf.push(stm.op)
    } else if (stm.key) {
      buf.push(stm.key.padEnd(9) + " -- " + cgList(stm.arg))
    } else {
      buf.push(stm)
    }
  }
}

let emitCodeLowLevel = (q) => {
  let buf = []
  buf.push("(inp => {")
  buf.push("let tmp = {}")

  emitStmListLowLevel(q, buf)

  buf.push("})")
  return buf.join("\n")

}







let quoteIndexVarsXS_C = (s, vs) => {
  let res = s
  for (let v of vs) {
    res = "rt_get("+res+", "+quoteVarXS(v)+")"
  }
  return res
}


let codegenC = q => {
  if (q.key == "input") {
    return "inp"
  } else if (q.key == "const") {
    if (typeof q.op === "number") {
      if (Number.isInteger(q.op))
        return "rt_const_int("+q.op+")"
      else
        return "rt_const_float("+q.op+")"
    } else if (typeof q.op === "string") {
      return "rt_const_string(\""+q.op+"\")"
    } else if (typeof q.op === "object" && Object.keys(q.op).length == 0){
      return "rt_const_obj()"
    } else {
      console.error("unsupported constant ", pretty(q))
      return String(q.op)
    }
  } else if (q.key == "var") {
    return quoteVar(q.op)
  } else if (q.key == "ref") {
    let q1 = assignments[q.op]
    let xs = ["rt_const_int("+q.op+")",...q1.fre]
    return quoteIndexVarsXS_C("tmp", xs)
  } else if (q.key == "get" && isDeepVarExp(q.arg[1])) {
    let [e1,e2] = q.arg.map(codegenC)
    return "rt_deepGet("+e1+","+e2+")"
  } else if (q.key == "get") {
    let [e1,e2] = q.arg.map(codegenC)
    return "rt_get("+e1+","+e2+")"
  } else if (q.key == "pure") {
    let es = q.arg.map(codegenC)
    return "rt_pure_"+q.op+"("+es.join(",")+")"
  } else if (q.key == "hint") {
    // no-op!
    return "rt_const_int(1)"
  } else if (q.key == "mkset") {
    let [e1] = q.arg.map(codegenC)
    return "rt_singleton("+e1+")"
  } else {
    console.error("unknown op ", pretty(q))
    return "<?"+q.key+"?>"
  }
}


let emitCodeC = (q, order) => {
  let buf = []
  buf.push("#include <stdio.h>")
  buf.push("#include \"rhyme.h\"")
  buf.push("int main() {")
  buf.push("rh inp = 0; // input?")
  buf.push("rh tmp = rt_const_obj();")

  for (let is of order) {
    if (is.length > 1)
      console.error("cycle "+is)
    let [i] = is
    let q = assignments[i]

    buf.push("// --- tmp"+i+" ---")
    buf.push("// XXX NOT IMPLEMENTED")
  }

  buf.push("// --- res ---")
  buf.push("rh res = "+codegenC(q)+";")
  buf.push("write_result(res);")
  buf.push("}\n")

  return buf.join("\n")
}

let nameEnv = {}
/* TODO: Unused. Are they needed anymore?
let quoteIndexVarsXS_CPP = (s, vs) => {
  let res = s
  for (let v of vs) {
    res = res+"["+quoteVarXS(v)+"]"
  }
  return res
}*/

let quoteCppOp = op => {
  if (op == "plus") {
    return "+"
  } else if (op == "minus") {
    return "-"
  } else if (op == "times") {
    return "*"
  } else if (op == "and") {
    return "&&"
  } else {
    console.error("Unsupported Op")
  }
}

let quoteGet = (a, b) => a+"["+b+"]"
let quoteGets = (s, vs) => {
  let res = s
  for (let v of vs) {
    res = quoteGet(res, v)
  }
  return res
}

let tmpSym = i => "tmp"+i

let quoteStateful = op => "stateful_"+op

let quoteExpr = q => {
  if (q.key == "stateful") {
    let es = q.arg.map(quoteExpr).filter(x => x != "hint")
    return quoteStateful(q.op)+"("+es.join(",")+")"
  } else if (q.key == "update") {
    console.error("unsupported op", pretty(q))
  } else {
    if (q.key == "input") {
      return "inp"
    } else if (q.key == "const") {
      if (typeof q.op === "number") {
        return `${q.op}`
      } else if (typeof q.op === "string") {
        return quoteStr(q.op)
      } else if (typeof q.op === "object" && Object.keys(q.op).length == 0){
        return "{}"
      } else {
        console.error("unsupported constant ", pretty(q))
        return String(q.op)
      }
    } else if (q.key == "var") {
      return quoteVar(q.op)
    } else if (q.key == "ref") {
      let q1 = assignments[q.op]
      let xs = [...q1.fre]
      return quoteGets(tmpSym(q.op), xs)
    } else if (q.key == "get") {
      // TODO: check deep get
      let [e1,e2] = q.arg.map(quoteExpr)
      return quoteGet(e1, e2)
    } else if (q.key == "pure") {
      let es = q.arg.map(quoteExpr).filter(x => x != "hint")
      if (es.length == 0) return "hint"
      else if (es.length == 1) return es[0]
      else return q.op+"("+es.join(",")+")"
    } else if (q.key == "hint") {
      // no-op!
      return "hint"
    } else if (q.key == "mkset") {
      let [e1] = q.arg.map(quoteExpr)
      return "singleton("+e1+")"
    } else {
      console.error("unknown op ", pretty(q))
      return "<?"+q.key+"?>"
    }
  }
}

// TODO: add explicit type cast when type does not check
let codegenCPP = q => {
  let ty = q.schema.type
  let expr = quoteExpr(q)
  if (expr in nameEnv) return nameEnv[expr]
  if (q.key == "input") {
    return "inp"
  } else if (q.key == "const") {
    if (typeof q.op === "number") {
      return String(q.op)
    } else if (typeof q.op === "string") {
      return quoteStr(q.op)
    } else if (typeof q.op === "object" && Object.keys(q.op).length == 0){
      return "rt_const_obj()"
    } else {
      console.error("unsupported constant ", pretty(q))
      return String(q.op)
    }
  } else if (q.key == "var") {
    return quoteVar(q.op)
  } else if (q.key == "ref") {
    return expr
  } else if (q.key == "get") {
    // TODO: handle deep get
    let [e1,e2] = q.arg.map(codegenCPP)
    return e1+"["+e2+"]"
  } else if (q.key == "pure") {
    let es = q.arg.map(codegenCPP).filter(x => x != "hint")
    if (es.length == 0) return "hint"
    else if (es.length == 1) return es[0]
    else {
      if (typing.isInteger(ty)) return "("+es.join(" "+quoteCppOp(q.op)+" ")+")"
      else return "rt_pure_"+q.op+"("+es.join(",")+")"
    }
  } else if (q.key == "hint") {
    // no-op!
    return "hint"
  } else if (q.key == "mkset") {
    console.error("unhandled op ", pretty(q))
    return "<?"+q.key+"?>"
  } else {
    console.error("unknown op ", pretty(q))
    return "<?"+q.key+"?>"
  }
}

let statefulOpCPP = (q, typed = false) => {
  if (q.op == "sum")
    if (typed) return "+="
    else return "rt_pure_plus"
  else if (q.op == "product")
    console.error("unsupported op", q)
  else if (q.op == "count")
    console.error("unsupported op", q)
  else if (q.op == "array")
    console.error("unsupported op", q)
  else
    console.error("unsupported op", q)
}

let quoteTypeCPP = ty => {
    if (ty === undefined)
        throw new Error("Unknown undefined type.");
    if (ty === null)
        throw new Error("Unknown null type.");
    if (ty.typeSym === typeSyms.union)
        return "rh";
    if (ty.typeSym === typeSyms.tagged_type) {
        if (ty.tag === "dense") {
            return "std::vector<" + quoteTypeCPP(typing.removeTag(ty).objValue) + ">";
        }
        if (ty.tag === "sparse") {
            if (ty.tagData.dim == 1) {
                return "CSVector<" + quoteTypeCPP(typing.removeTag(ty).objValue) + ", " + quoteTypeCPP(typing.removeTag(ty).objKey) + ">";
            } else if (ty.tagData.dim == 2) {
                return "CSRMatrix<" + quoteTypeCPP(typing.removeTag(typing.removeTag(ty).objValue).objValue) + ", " + quoteTypeCPP(typing.removeTag(ty).objKey) + ">";
            }
            throw new Error("Unknown sparse item with data: " + ty.tagData);
        }
        throw new Error("Unknown tag: " + ty.tag);
    }
    if (ty.typeSym === typeSyms.dynkey) {
        return quoteTypeCPP(ty.keySupertype);
    }
    let ctypeMap = {
      any:  "rh",
      never:"rh",
      boolean:  "rh",
      string:"rh",
      u8:   "uint8_t",
      u16:  "uint16_t",
      u32:  "uint32_t",
      u64:  "uint64_t",
      i8:   "int8_t",
      i16:  "int16_t",
      i32:  "int", // should be int32_t?
      i64:  "int64_t",
      f32:  "float",
      f64:  "double",
    }

    if (ty.typeSym in ctypeMap) {
      return ctypeMap[ty.typeSym]
      // throw new Error("Unknown CPP type of: " + typing.prettyPrintType(ty));
    }
    if (typing.isObject(ty))
        return "rh";
    throw new Error("Unknown type: " + JSON.stringify(ty));
}

let quoteFileReadCPP = ty => {
  if (ty.typeSym === typeSyms.tagged_type) {
    if (ty.tag === "dense") {
        if (ty.tagData.dim == 1) {
            return "read_1D_dense_tensor<" + quoteTypeCPP(typing.removeTag(ty).objValue) + ">";
        } else if (ty.tagData.dim == 2) {
            return "read_2D_dense_tensor<" + quoteTypeCPP(typing.removeTag(typing.removeTag(ty).objValue).objValue) + ">";
        }
        throw new Error("Unknown dense item with data: " + ty.tagData);
    }
    if (ty.tag === "sparse") {
        if (ty.tagData.dim == 1) {
            return "read_1D_sparse_tensor<" + quoteTypeCPP(typing.removeTag(ty).objValue) + ", " + quoteTypeCPP(typing.removeTag(ty).objKey) + ">";
        } else if (ty.tagData.dim == 2) {
            return "read_2D_sparse_tensor<" + quoteTypeCPP(typing.removeTag(typing.removeTag(ty).objValue).objValue) + ", " + quoteTypeCPP(typing.removeTag(ty).objKey) + ">";
        }
        throw new Error("Unknown sparse item with data: " + ty.tagData);
    }
    throw new Error("Unknown tag: " + ty.tag);
  } else {
    if (typing.isObject(ty)) {
        return "read_json";
    } else {
        throw new Error("Unknown how to read: " + typing.prettyPrintType(ty));
    }
  }
}

let emitStmInitCPP = (q) => {
  if (q.key == "stateful") {
    if (q.op == "sum")
      return "= 0"
    else if (q.op == "product")
      console.error("unsupported op", q)
    else if (q.op == "count")
      console.error("unsupported op", q)
    else if (q.op == "array")
      console.error("unsupported op", q)
    else
      console.error("unsupported op", q)
  } else if (q.key == "update") {
    console.error("unsupported op", q)
  } else {
    console.error("unknown op", q)
  }
}

let emitStmUpdateCPP = (agg, q) => {
  if (q.key == "prefix") {
    console.error("unsupported op", q)
  } else if (q.key == "stateful") {
    let ty = q.schema.type
    let [e1] = q.arg.map(codegenCPP)
    //if (!isDefaultTy(ty)) {
      let cast = "("+quoteTypeCPP(ty)+")"
      return agg+" "+statefulOpCPP(q, true)+" "+cast+"("+e1+")"
    //} else {
    //  return agg+" = "+statefulOpCPP(q)+"("+agg+","+e1+")"
    //}
  } else if (q.key == "update") {
    console.error("unsupported op", q)
  } else {
    console.error("unknown op", q)
  }
}

let emitCodeCPP = (q, order) => {
  let assignmentStms = []
  let generatorStms = []
  let tmpVarWriteRank = {}
  nameEnv = {}

  // generator ir api: mirroring necessary bits from ir.js
  let expr = (txt, ...args) => ({ txt, deps: args })

  let assign = (txt, lhs_root_sym, lhs_deps, rhs_deps) => {
      let e = expr(txt+";", ...lhs_deps, ...rhs_deps) // lhs.txt + " " + op + " " + rhs.txt
      e.lhs = expr("LHS", ...lhs_deps)
      e.op = "=?="
      e.rhs = expr("RHS", ...rhs_deps)
      e.writeSym = lhs_root_sym
      e.deps = e.deps.filter(e1 => e1 != e.writeSym) // remove cycles
      // update sym to rank dep map
      tmpVarWriteRank[e.writeSym] ??= 1
      e.writeRank = tmpVarWriteRank[e.writeSym]
      // if (e.op != "+=") // do not increment for idempotent ops? (XX todo opt)
      tmpVarWriteRank[e.writeSym] += 1
      assignmentStms.push(e)
  }

  let quoteLoop = (e1, e2) => {
    let ty = e1.schema.type
    let source = codegenCPP(e1)
    let sym = codegenCPP(e2)
    if (ty.typeSym === typeSyms.tagged_type) {
        if (ty.tag == "dense") {
            let sym = quoteExpr(e2)
            return `for (int ${sym}=0; ${sym}<${source}.size(); ${sym}++) {`
        } else if (ty.tag == "sparse") {
            return `for (const auto& [${sym}, ${sym}_val] : ${source}) {`
        }
    }
    if (typing.isObject(ty)) {
        return `for (const auto& [${sym}, ${sym}_val] : ${source}.items()) {`
    }
    throw new Error("Unknown loop type: " + typing.prettyPrintType(ty));
  }

  function selectGenFilter(gen, loops) {
    let b = transExpr(gen)
    let b1 = b.deps[0]
    if (loops.length == 1) {
      let l = loops[0]
      let a = transExpr(l)
      let e = expr("FOR", ...a.deps)
      e.sym = b1
      e.rhs = a.txt
      e.loopTxt = quoteLoop(l, gen)
      generatorStms.push(e)
    } else {
      let sources = loops.map(transExpr)
      let tys = loops.map(x => x.schema.type)
      if (!tys.every(typing.isSparseVec)) {
        throw new Error("Unsupported container types")
      }
      let sourceTxts = sources.map(x => "&"+x.txt)
      let iter = b.txt+"_mit"
      let prolog = "for (auto "+iter+" = "+quoteTypeCPP(tys[0])+"::multi_iterator({"+sourceTxts.join(",")+"});!"+iter+".finish(); ++"+iter+") {"
      for (l of loops) {
        let l = loops[0]
        let a = transExpr(l)
        let e = expr("FOR", ...a.deps)
        e.sym = b1
        e.rhs = a.txt
        e.loopTxt = prolog
        generatorStms.push(e)
      }
    }
  }


  let getDeps = q => [...q.fre,...q.tmps.map(tmpSym)]

  let transExpr = q => expr(codegenCPP(q), ...getDeps(q))

  let objs = {}
  let collectObj = q => {
    if (q.key == "get") {
      let e1 = quoteExpr(q.arg[0])
      let obj = q.arg[1].op
      if (e1 == "inp" && !(obj in objs)) {
        let expr = quoteExpr(q)
        objs[obj] = {expr: expr, schema: q.schema}
        nameEnv[expr] = obj
        return
      }
    }
    if (q.arg) {
      q.arg.forEach(collectObj)
    }
  }

  let getScopedName = (ty, gen) => {
    if (typing.isSparse(ty) || (typing.isObject(ty) && !typing.isDense(ty))) {
        return gen+"_val"
    }
  }

  let getMitScopedName = (tys, gen, i) => {
    if (!tys.every(typing.isSparseVec)) {
      throw new Error("Unsupported container types")
    }
    return "(*"+gen+"_mit).second["+i+"]"
  }

  let loopsByGen = {}

  for (let i in filters) {
    let q = filters[i]
    let genexpr = q.arg[1]
    let gensym = genexpr.op
    let source = q.arg[0]
    loopsByGen[gensym] ??= {}
    loopsByGen[gensym].expr = genexpr
    loopsByGen[gensym].loops ??= []
    loopsByGen[gensym].loops.push(source)
  }

  for (let gen in loopsByGen) {
    let loops = loopsByGen[gen].loops
    loops.forEach(collectObj)
    let gensym = quoteVar(gen)

    if (loops.length == 1) {
      let q1 = loops[0]
      let e1 = quoteExpr(q1)
      let ty1 = q1.schema.type
      let expr = quoteGet(e1, gensym)
      let scopedName = getScopedName(ty1, gensym)
      if (scopedName) {
        nameEnv[expr] = scopedName
      }
    } else {
      let tys = loops.map(x => x.schema.type)
      if (!tys.every(typing.isSparseVec)) {
        throw new Error("Unsupported container types")
      }
      for (let i in loops) {
        let l = loops[i]
        let e1 = quoteExpr(l)
        let expr = quoteGet(e1, gensym)
        let scopedName = getMitScopedName(tys, gensym, i)
        if (scopedName) {
          nameEnv[expr] = scopedName
        }
      }
    }
  }

  for (let i in assignments) {
    let q = assignments[i]
    collectObj(q)
  }
  collectObj(q)
  let resTy = q.schema.type
  // map assignments
  for (let i in assignments) {
    let sym = tmpSym(i)

    let q = assignments[i]

    // emit initialization (see 'emitCode')
    if (q.key == "stateful" && (q.op+"_init") in runtime.stateful) {
        let xs = [...q.fre.map(quoteVar)]
        let ys = xs.map(x => "[\""+x+"\"]").join("")

        if (xs.length > 0) {
          assign(sym+ys+emitStmInitCPP(q), sym, q.fre, [])
        } else {
          // Init temp-i
          assign(quoteTypeCPP(q.schema.type)+" "+sym+" "+emitStmInitCPP(q), sym, q.fre, [])
        }
    } else if (q.key == "update") {
        console.error("Unsupported Op")
    }

    // emit update (see 'emitCode')
    {
      let fv = union(q.fre, q.bnd)
      let xs = [...q.fre.map(quoteVar)]
      let ys = xs.map(x => "[\""+x+"\"]").join("")

      let deps = [...fv,...q.tmps.map(tmpSym)] // XXX rhs dims only?

      assign(emitStmUpdateCPP(sym+ys, q), sym, q.fre, deps)
    }
  }

  // map filters/generators
  for (let gen in loopsByGen) {
    let genexpr = loopsByGen[gen].expr
    let loops = loopsByGen[gen].loops
    selectGenFilter(genexpr, loops)
  }

  // map final result

  let res = transExpr(q)

  let prolog = []
  prolog.push("#include \"rhyme.hpp\"")
  prolog.push("int main() {")
  for (let obj in objs) {
    let expr = objs[obj]
    let ty = expr.schema.type
    prolog.push(`${quoteTypeCPP(ty)} ${obj} = ${quoteFileReadCPP(ty)}(\"cgen/${obj}.json\");`)
  }

  let epilog = []
  epilog.push(quoteTypeCPP(resTy)+" res = "+res.txt+";")
  epilog.push("write_result(res);")
  epilog.push("}")

  let ir = {
    assignmentStms,
    generatorStms,
    tmpVarWriteRank,
    res,
    prolog,
    epilog
  }

  return generate(ir, "cpp")
}

let fixIndent = s => {
  let lines = s.split("\n")
  let out = []
  let indent = 0
  for (let str of lines) {
    if (str.trim() == "") continue
    let count = r => (str.match(r)??[]).length
    let delta = count(/{/g) - count(/}/g)
    if (str[0] == "}") indent += delta
    out.push("".padEnd(indent * 4, ' ') + str.trim())
    if (str[0] != "}") indent += delta
  }
  return out.join("\n")
}

let translateToNewCodegen = q => {

  let assignmentStms = []
  let generatorStms = []
  let tmpVarWriteRank = {}


  // generator ir api: mirroring necessary bits from ir.js
  let expr = (txt, ...args) => ({ txt, deps: args })

  let call = (func, ...es) => expr(func+"("+es.map(x => x.txt).join(",")+")", ...es.flatMap(x => x.deps))

  let assign = (txt, lhs_root_sym, lhs_deps, rhs_deps) => {
      let e = expr(txt, ...lhs_deps, ...rhs_deps) // lhs.txt + " " + op + " " + rhs.txt
      e.lhs = expr("LHS", ...lhs_deps)
      e.op = "=?="
      e.rhs = expr("RHS", ...rhs_deps)
      e.writeSym = lhs_root_sym
      e.deps = e.deps.filter(e1 => e1 != e.writeSym) // remove cycles
      // update sym to rank dep map
      tmpVarWriteRank[e.writeSym] ??= 1
      e.writeRank = tmpVarWriteRank[e.writeSym]
      // if (e.op != "+=") // do not increment for idempotent ops? (XX todo opt)
      tmpVarWriteRank[e.writeSym] += 1
      assignmentStms.push(e)
  }

  function selectGenFilter(a, b) {
    let b1 = b.deps[0]
    let e = expr("FOR", ...a.deps) // "for " + b1 + " <- " + a.txt
    e.sym = b1
    e.rhs = a.txt
    // if (generatorStms.every(e1 => e1.txt != e.txt)) // generator CSE
      generatorStms.push(e)
  }

  // TODO: make reusable generator/filter variable for the "current"
  // value of an iteration available in new-codgen. The "scope" object
  // passed to 'codegen' should list all available such variables in
  // scope -- right now there are none, filters = q.filters would
  // mean all used filters have associated variables.

  let tmpSym = i => "tmp-"+i

  // XXX could add dependencies on computed generator vars hare (gen2,...)
  let getDeps = q => [...q.fre,...q.tmps.map(tmpSym)]

  let transExpr = (q, scope) => expr(codegen(q, scope), ...getDeps(q))

  // map assignments
  for (let i in assignments) {
    let sym = tmpSym(i)

    let q = assignments[i]

    // emit initialization (see 'emitCode')
    if (q.key == "stateful" && (q.op+"_init") in runtime.stateful || q.key == "update") {
        let xs = [i,...q.fre.map(quoteVar)]
        let ys = xs.map(x => ","+x).join("")

        let init_deps = []
        if (q.key == "update") {
          let init_arg = q.arg[0]
          init_deps = [...union(init_arg.fre, init_arg.bnd),...init_arg.tmps.map(tmpSym)]
        }

        let scope = { vars: q.fre, filters: [], buf: [] } // XXX filters?
        assign("rt.init(tmp"+ys+")("+ emitStmInit(q,scope) + ")", sym, q.fre, init_deps)
    }

    // emit update (see 'emitCode')
    {
      let fv = union(q.fre, q.bnd)
      let xs = [i,...q.fre.map(quoteVar)]
      let ys = xs.map(x => ","+x).join("")

      let deps = [...fv,...q.tmps.map(tmpSym)] // XXX rhs dims only?

      let scope = { vars: q.fre, filters: [], buf: [] } // XXX filters?
      assign("rt.update(tmp"+ys+")("+ emitStmUpdate(q,scope) + ")", sym, q.fre, deps)
    }
  }

  // map filters/generators
  for (let i in filters) {
    let q = filters[i]
    let scope = { vars: q.fre, filters: [] } // XXX filters?
    let [a,b] = q.arg.map(x => transExpr(x, scope))
    selectGenFilter(a, b)
  }

  // map final result
  let scope = { vars: q.fre, filters: [] } // XXX filters?
  let res = transExpr(q, scope)

  let ir = {
    assignmentStms,
    generatorStms,
    tmpVarWriteRank,
    res
  }

  return generate(ir)
}



exports.pretty = pretty

exports.codegen = codegen

exports.translateToNewCodegen = translateToNewCodegen

exports.emitCode = emitCode

exports.emitCodeLowLevel = emitCodeLowLevel

exports.emitCodeC = emitCodeC

exports.emitCodeCPP = emitCodeCPP

exports.fixIndent = fixIndent
