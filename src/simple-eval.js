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



// ----- configuration space -----

let defaultSettings = {
  altInfer: false,
  antiSubstGroupKey: false,
  singleResult: true, // TODO: elim flag? 14 tests failing when false globally

  extractAssignments: true,
  extractFilters: true,

  newCodegen: false,
  backend: "js",

  schema: typing.any,

  outDir: "cgen-sql",
  outFile: "tmp.c"
}


// ----- auxiliary state -----

let settings

let prefixes      // canonicalize * for every prefix, e.g., data.* (preproc)
let path          // current grouping path variables (extract)

let vars          // deps var->var, var->tmp
let hints
let filters
let assignments

let reset = (userSettings) => {
  settings = { ...defaultSettings, ...userSettings }

  prefixes = []
  path = []

  vars = {}
  hints = []
  filters = []
  assignments = []
}


// ----- front end -----

//
// 1. Preprocess: convert from Rhyme AST to our slightly stratified version
//
// We currently support: input, const, var, get, plus, times, sum, group
//

let isVar = s => s.startsWith("*")





//
// 2,4,7,8. Extract: extract key information from program
//  into external data structures
//

// 2: extract0:
// - canonicalize *
// - insert 'single' in nested stateful positions
// - ensure all grouping is wrt a variable, i.e.,
//   transform { e1: e2 } to {}{ K1: e2 } / mkset(e1).K1

let canonicalVarName = (e1, isCorrelatedGroupKey) => {
  let str = JSON.stringify(e1)
  let key = prefixes.indexOf(str)
  if (key < 0) { key = prefixes.length; prefixes.push(str) }
  // let name = e1.key == "mkset" ? "K" : "D"
  let name = isCorrelatedGroupKey ? "K" : "D"
  return name+key
}

let extractFlex0 = q => {
  if (q.key == "stateful" || q.key == "group" || q.key == "update") // prefix?
    return extract0(q)
  else
    return extract0({ key:"stateful", op: "single", mode: "reluctant", arg:[q] })
}

let extractKey0 = q => {
  if (q.key == "var" && q.op == "*WILDCARD") { // XXX
    return { key: "placeholder", op: "*", arg: [] }
  }
  return extract0(q)   // could move more logic here
}


let extract0 = q => {
  if (q.key == "var") {
    if (q.op == "*") throw console.error("cannot support free-standing *")
    return q
  } else if (q.key == "get") {
    let [e1,e2] = q.arg
    if (e2.key == "var") {
      // canonicalize '*' in 'data.*' to a unique variable
      // NOTE: we use e1 _before_ extract as key -- XXX consistent with 'update' below?
      if (e2.op == "*")
        e2 = {...e2, op: canonicalVarName(e1, false) }
    }
    e1 = extract0(e1)
    e2 = extract0(e2)
    return { ...q, arg: [e1,e2]}
  } else if (q.key == "group") {
    let arg = [{key:"const",op:{}}]
    if (q.arg.length == 1) arg.push({key:"placeholder",op:"*",arg:[]})
    arg.push(...q.arg)
    return extract0({...q, key:"update", arg})
  } else if (q.key == "update" || q.key == "update_inplace") {
    let e0 = extract0(q.arg[0])
    let e1 = extractKey0(q.arg[1])
    let e2 = extractFlex0(q.arg[2])
    if (e1.key != "var" && e1.key != "placeholder") {
      let prefix = { key:"mkset", arg:[e1] }
      let v1 = { key: "var", op: canonicalVarName(prefix, true) }
      let v2 = { key: "var", op: canonicalVarName(prefix, true) }
      return { ...q, arg: [e0, v1, e2, { key: "get", arg: [prefix, v2] }], mode: e2.mode }
      // return { ...q, arg: [v1,
      //   { key:"stateful", op: "single", mode: "reluctant", arg:[
      //     { key: "pure", op: "and", arg:[
      //       { key: "get", arg: [prefix, v2] }, e2]}]} ]}
    } else
      return { ...q, arg: [e0,e1,e2], mode: e2.mode }
  } else if (q.arg) {
    let es = q.arg.map(extract0)
    return { ...q, arg: es }
  } else {
    return q
  }
}


// prototype anti-substitution
//
// motivation:
//
//   { data.*.key: data.*.key + 1 }
//
// it's clear that there is a 1:1 mapping,
// so no aggregation is necessary.
// represent this as:
//
//   mkset(data.*.key).K &
//   { K: K + 1 }
//
// but we need to be carefeul:
//
//   { data.*: count(data.*) }
//
// here it seems more logical iterpret
// this as counting multiples


// NOTE: this is early in the pipeline, we
// have not computed dims/bnd/fre yet
let extract0b = (q, out) => {
  if (!prefixes.length) return q // early exit

  if (q.key == "stateful" && q.mode != "reluctant") {
    q.arg = q.arg.map(x => extract0b(x, []))
  } else if (q.key == "update") {
    let [e0,e1,e2,e3] = q.arg
    e0 = extract0b(e0, out)
    if (e1.key == "var" && e1.op.startsWith("K")) {
      e2 = extract0b(e2, union(out,[e1.op]))
    } else {
      e2 = extract0b(e2, out)
    }
    if (e3) {
      e3 = extract0b(e3, out)
      q.arg = [e0,e1,e2,e3]
    } else {
      q.arg = [e0,e1,e2]
    }
  } else {
    if (q.arg) q.arg = q.arg.map(x => extract0b(x, out))
  }

  // return q

  if (!out.length) return q // early exit

  let e1 = { key:"mkset", arg:[q] }
  let str = JSON.stringify(e1)
  let key = prefixes.indexOf(str)
  if (key >= 0 && subset(["K"+key],out)) {
    // console.log("FOUND: K"+key)
    return { key: "var", op: "K"+key }
  }

  return q
}


// 4: extract var -> filter variable deps
//    - runs after inferDims()
let extract1 = q => {
  if (q.arg) q.arg.map(extract1)
  if (q.key == "var") {
    vars[q.op] ??= { vars:[], vars1: [] }
  } else if (q.key == "get") {
    let [e1,e2] = q.arg
    if (e2.key == "var") {
      vars[e2.op].vars = union(vars[e2.op].vars, e1.dims)
      vars[e2.op].vars1 = union(vars[e2.op].vars1, e1.dims)
    }
  }
}


let varsChanged = false

let extract1f = q => {
  if (q.arg) q.arg.map(extract1f)
  if (q.key == "var") {
    vars[q.op] ??= { }
    vars[q.op].varsf ??= []
    vars[q.op].varsf1 ??= []
  } else if (q.key == "get") {
    let [e1,e2] = q.arg
    if (e2.key == "var") {
      if (!subset(e1.fre ?? e1.dims, vars[e2.op].varsf)) {
        varsChanged = true
        vars[e2.op].varsf = union(vars[e2.op].varsf, e1.fre ?? e1.dims)
        vars[e2.op].varsf1 = union(vars[e2.op].varsf1, e1.fre ?? e1.dims)
      }
    }
  }
}

// TODO: cse for array-valued udfs?

// 7: extract assignments
//    - runs after inferBwd()
let extract2 = q => {
  if (!q.arg) return { ...q, tmps:[] }
  let es = q.arg.map(extract2)
  let tmps = unique(es.flatMap(x => x.tmps))
  if (q.key == "prefix" || q.key == "stateful" || q.key == "update") {
    let q1 = { ...q, arg: es, tmps }
    let str = JSON.stringify(q1) // extract & cse
    let ix = assignments.map(JSON.stringify).indexOf(str)
    if (ix < 0) {
      ix = assignments.length
      assignments.push(q1)
    }
    return { ...q, key: "ref", op: ix, arg: [], tmps:[ix] }
  } else {
    return { ...q, arg: es, tmps }
  }
}


// 8: extract filters and hints
//    - runs after inferBwd()
let extract3 = q => {
  if (!q.arg) return
  q.arg.map(extract3)
  q.filters = unique(q.arg.flatMap(x => x.filters??[]))
  if (q.key == "get") {
    let [e1,e2] = q.arg
    if (e2.key == "var") {
      let str = JSON.stringify(q) // extract & cse
      let ix = filters.map(JSON.stringify).indexOf(str)
      if (ix < 0) {
        ix = filters.length
        let q1 = JSON.parse(str)
        filters.push(q1) // deep copy...
      }
      // NOTE: we leave the expression in place, and just add
      // a 'filter' field. This way, we can either generate
      // the expression or a reference, depending on scope.
      // An alternative would be to return a ref expression
      // instead.
      q.filter = ix
      q.filters.push(ix)
    }
  }
  if (q.key == "hint") {
    let str = JSON.stringify(q) // extract & cse
    let ix = hints.map(JSON.stringify).indexOf(str)
    if (ix < 0) {
      ix = hints.length
      let q1 = JSON.parse(str)
      hints.push(q1) // deep copy...
    }
    q.hint = ix
  }
}



// ----- middle-tier -----

//
// 3. Infer dependencies bottom up:
//    - vars: variables used
//    - mind: minimum set of variables in output (not removed through reductions)
//    - dims: desired set of variables in output
//

let inferDims = q => {
  if (q.key == "input" || q.key == "const" || q.key == "placeholder") {
    q.vars = []
    q.mind = []
    q.dims = []
  } else if (q.key == "var") {
    q.vars = [q.op]
    q.mind = [q.op]
    q.dims = [q.op]
  } else if (q.key == "get" || q.key == "pure" || q.key == "hint" || q.key == "mkset" || q.key == "loadInput") {
    let es = q.arg.map(inferDims)
    q.vars = unique(es.flatMap(x => x.vars))
    q.mind = unique(es.flatMap(x => x.mind))
    q.dims = unique(es.flatMap(x => x.dims))
    // special case for 'get': nudge reluctant prefix to aggregate
    if (q.key == "get")
      q.dims = union(es[0].mind, es[1].dims)
  } else if (q.key == "stateful" || q.key == "prefix") {
    let [e1] = q.arg.map(inferDims)

    // NOTE: wo do not include vars/tmps/dims information from path,
    // only from e1. What is the rationale for this?

    // In short: we want to decorrelate paths but we don't have enough
    // information yet. Specifically, transitive var dependencies are
    // only available after inferDims.

    q.vars = e1.vars
    q.mind = [] // can always reduce to one elem
    if (q.mode == "reluctant") {
      q.dims = e1.dims // but prefer not to
    } else {
      q.dims = []
    }
  } else if (q.key == "update" || q.key == "update_inplace" ) {
    let [e0,e1,e2,e3] = q.arg.map(inferDims)
    e3 ??= { vars: [], mind: [], dims: [] }
    if (q.key == "update_inplace") {
      q.mode = "inplace"
      q.key = "update"
    }
    q.vars = unique([...e0.vars, ...e1.vars, ...e2.vars, ...e3.vars])
    // treat e3 like a reduction: do not propagate it's inner mind/dims
    if (e1.key == "placeholder") {
      q.mind = []
      q.dims = e0.dims
    } else {
      q.mind = union(e0.mind, diff(e2.mind, e1.vars))
      q.dims = union(e0.dims, diff(e2.dims, e1.vars))
    }
  } else {
    console.error("unknown op", q)
  }
  console.assert(subset(q.mind, q.dims))
  console.assert(subset(q.dims, q.vars))
  return q
}


//
// 6. Infer dependencies top down:
//    - out:  maximum allowed set of variables in output (provided as input arg)
//    - free: free variables, anticipating conversion to loops
//    - bound: bound variables, anticipating conversion to loops (allBound: incl deep in subterms)
//    - (iter: iteration space for stms (= free + bound))
//
//    Decorrelate paths and eliminate trivial recursion
//

let isCorrelatedKeyVar = s => s.startsWith("K") || s.startsWith("*KEYVAR") // 2nd is a temp hack?

let trans = ps => unique([...ps,...ps.flatMap(x => vars[x].vars)])

let trans1 = ps => unique(ps.flatMap(x => vars[x].vars))

let transf = ps => unique([...ps,...ps.flatMap(x => vars[x].varsf)])

let transf1 = ps => unique(ps.flatMap(x => vars[x].varsf1))


let intersects = (a,b) => intersect(a,b).length > 0

let overlaps = (a,b) => intersects(trans(a),trans(b))

let assertSame = (a,b,msg) => console.assert(same(a,b), msg+": "+a+" != "+b)


// infer bound vars (simple mode)
let inferBound = out => q => {
  if (q.key == "input" || q.key == "const" || q.key == "placeholder") {
    q.bnd = []
  } else if (q.key == "var") {
    q.bnd = []
  } else if (q.key == "get" || q.key == "pure" || q.key == "hint" || q.key == "mkset" || q.key == "loadInput") {
    let es = q.arg.map(inferBound(out))
    q.bnd = []
  } else if (q.key == "stateful" || q.key == "prefix") {
    let out1 = union(out,q.arg[0].dims) // need to consider mode?
    let [e1] = q.arg.map(inferBound(out1))
    q.bnd = diff(e1.dims, out)
  } else if (q.key == "update") {
    let e0 = inferBound(out)(q.arg[0]) // what are we extending
    let e1 = inferBound(out)(q.arg[1]) // key variable

    if (e1.key == "placeholder") {
      let bnd = diff(q.arg[2].dims, out)
      e1 = q.arg[1] = { key: "pure", op: "vars",
        arg: bnd.map(x => ({ key: "var", op: x, arg:[], vars: [x], mind: [x], dims: [x], bnd: [] })),
        vars: bnd, mind: bnd, dims: bnd, bnd: []
      }
    }

    let e1Body
    if (q.arg[3]) {
      let out3 = union(out, union([e1.op], q.arg[3].dims)) // e3 includes e1.op (union left for clarity)
      let e3 = inferBound(out3)(q.arg[3]) // filter expr
      console.assert(e3.key == "get")
      console.assert(e3.arg[0].key == "mkset")
      console.assert(e3.arg[1].key == "var" && e3.arg[1].op == e1.op)
      e1Body = e3.arg[0].arg[0]
    } else {
      e1Body = { key: "const", op: "???",
        vars: [], mind: [], dims: [], bnd: [] }
    }

    q.e1BodyBnd = diff(e1Body.dims, out)

    let e2 = inferBound(union(out, e1.vars))(q.arg[2])

    q.bnd = diff(union(e1.vars, []/*e1Body.dims*/), out)

  } else {
    console.error("unknown op", q)
  }

  console.assert(subset(q.mind, q.dims))
  console.assert(subset(q.dims, q.vars))

  return q
}

let checkDimsFreeTrans = false

// infer free vars (simple mode)
let inferFree = out => q => {
  if (q.key == "input" || q.key == "const" || q.key == "placeholder") {
    q.fre = []
  } else if (q.key == "var") {
    // TODO: check that variables are always defined -- currently not for K vars
    console.assert(subset([q.op], out) || isCorrelatedKeyVar(q.op))
    q.fre = [q.op]
  } else if (q.key == "get" || q.key == "pure"  || q.key == "hint" || q.key == "mkset" || q.key == "loadInput") {
    let es = q.arg.map(inferFree(out))
    q.fre = unique(es.flatMap(x => x.fre))
  } else if (q.key == "stateful" || q.key == "prefix") {
    let out1 = union(out,q.arg[0].dims) // need to consider mode?
    assertSame(out1, union(out,q.bnd)) // same as adding bnd
    let [e1] = q.arg.map(inferFree(out1))

    // NOTE: for consistency with 'update' it would be interesting
    // to eval e1 with path+q.bnd -- this mostly works but leads
    // to unsolved filter ordering issues in testCycles2-2 and
    // testCycles 3-2. We have since restricted path extension
    // for 'update' due to same issues emerging in testCycles2-3.

    // let save = path
    // path = [...path, { xxFree: q.bnd }]
    // let [e1] = q.arg.map(inferFree(out1))
    // path = save

    // find correlated path keys: check overlap with our own bound vars
    let extra = path.filter(x =>
      intersects(trans(x.xxFree), trans(q.bnd))).flatMap(x => x.xxFree)

    let extra2 = out
    .filter(isCorrelatedKeyVar)
    .filter(x => intersects(diff(transf([x]),out), transf(q.bnd)))
    // .flatMap(x => transf([x]))

    if (checkDimsFreeTrans) assertSame(extra, diff(extra2, ["*KEYVAR"]), "extra "+pretty(q)) // XX can use *KEYVAR manually now
    extra = extra2


    // free variables: anything from current scope (out) that is:
    // - used in any filter for q.bnd (here: trans via .dims)
    // - free in e1
    // - an extra K from outer grouping
    q.fre = intersect(union(trans(q.bnd), union(e1.fre, extra)), out)

    let fre2 = intersect(union(e1.fre, union(transf(q.bnd),extra)), out)

    // XXXX is transf1 enough?
    // What if a in (q.bnd \ out), b in (transf1(a) \ out), c in (transf1(b) & out)
    // looks like we'll be missing c?

    if (checkDimsFreeTrans) assertSame(q.fre, fre2, "FRE1.1 "+pretty(q))
    // fre2 = diff(fre2, trans1(fre2))
    // assertSame(q.fre, fre2, "FRE1.2 "+pretty(q))
    q.fre = fre2

    // previous:
    // q.fre = intersect(union(trans(e1.fre), extra), out)

    // NOTE: we cannot just subtract q.bnd, because we'd retain the
    // parts of trans(q.bnd) in q.fre which aren't part of 'out'.
    // Those will be iterated over, but projected out.


  } else if (q.key == "update") {
    let e0 = inferFree(out)(q.arg[0]) // what are we extending
    let e1 = inferFree(union(out,q.arg[1].dims))(q.arg[1]) // key variable

    let e1Body
    if (q.arg[3]) {
      // XXX NOTE: we should do this properly -- wrap it in a count(...) or something
      let out3 = union(out, union([/*e1.op*/], diff(q.arg[3].dims, [e1.op]))) // e3 includes e1.op (union left for clarity)
      let e3 = inferFree(out3)(q.arg[3]) // filter expr
      console.assert(e3.key == "get")
      console.assert(e3.arg[0].key == "mkset")
      console.assert(e3.arg[1].key == "var" && e3.arg[1].op == e1.op)
      e1Body = e3.arg[0].arg[0]
    } else {
      e1Body = { key: "const", op: "???",
        vars: [], mind: [], dims: [], fre: [] }
    }

    let save = path

    // only extend path for nontrivial group expressions (see testCycles2-3)
    if (q.arg[3])
      path = [...path, { xxFree: e1.vars }]

    let e2 = inferFree(union(out, e1.vars))(q.arg[2])

    path = save

    // find correlated path keys: check overlap with our own bound vars
    let extra = path.filter(x =>
      intersects(trans(x.xxFree), trans(q.bnd))).flatMap(x => x.xxFree)

    let extra2 = out
    .filter(isCorrelatedKeyVar)
    .filter(x => intersects(diff(transf([x]),out), transf(q.bnd)))
    // .flatMap(x => transf([x]))

    if (checkDimsFreeTrans) assertSame(extra, diff(extra2, ["*KEYVAR"]), "extra2 "+pretty(q)) // XX can use *KEYVAR manually now
    extra = extra2

    let fv = unique([...e0.fre, ...e1.fre, ...e2.fre, ...diff(e1Body.fre, q.e1BodyBnd)])

    // free variables: see note at stateful above
    q.fre = intersect(union(trans(q.bnd), union(fv, extra)), out)


    let fre2 = intersect(union(fv, union(transf(q.bnd),extra)), out)
    // assertSame(q.fre, intersect(transf(q.fre),out), "FRE2 "+pretty(q))

    if (checkDimsFreeTrans) assertSame(q.fre, fre2, "FRE2.1 "+pretty(q))
    // fre2 = diff(fre2, transf1(fre2))
    // assertSame(q.fre, fre2, "FRE2.2 "+pretty(q))
    q.fre = fre2


  } else {
    console.error("unknown op", q)
  }

  console.assert(subset(q.mind, q.dims))
  console.assert(subset(q.dims, q.vars))

  console.assert(!intersects(q.fre, q.bnd))

  return q
}



// XXX. alternative "denotational" formulation:
//    - try to make "infer" compositional
//    - combine forward and backward pass into a single function
//    - k: dims -> out, i.e. minimum we can produce -> what is observed
//
// (currently not used, needs more work to bring up to date)

let deno = q => k => {
  if (q.key == "input") {
    let {out} = k({vars:[],dims:[]})
    q.real = []
    return pretty(q)
  } else if (q.key == "const") {
    let {out} = k({vars:[],dims:[]})
    q.real = []
    return pretty(q)
  } else if (q.key == "var") {
    let {out} = k({vars:[q.op],dims:[q.op]})
    q.real = [q.op]
    return pretty(q)
  } else if (q.key == "get" || q.key == "pure") {
    console.assert(q.arg.length == 2)
    let [e1,e2] = q.arg
    let r1 = deno(e1)(v1 => { // todo: support multiple?
      let r2 = deno(e2)(v2 => {
        let {out} = k({
          vars: union(v1.vars,v2.vars),
          dims: union(v1.dims,v2.dims)
        })
        q.out = out
        return {out:q.out} // for v2
      })
      return {out:q.out} // for v2
    })
    q.real = union(e1.real, e2.real)
    return pretty(q)
  } else if (q.key == "stateful") {
    console.assert(q.arg.length == 1)
    let [e1] = q.arg
    deno(e1)(v1 => {
      let {out} = k({
        vars: v1.vars,
        dims: []
      })
      q.out = out
      return {out:union(q.out,v1.dims)}
    })
    q.real = intersect(q.out,e1.real)
    console.log("SUM", ""+e1.real+"->"+q.real + " / "+q.out , " --- ", pretty(q))
    return pretty(q)
/*  } else if (q.key == "group") {
    let e1 = extract(q.arg[0])
    let save = path
    path = [...path,e1]
    let e2 = extract(q.arg[1])
    path = save
    let x = assignments.length
    assignments.push({ ...q, arg: [e1,e2], path, vars:[], dims:[], tmps: [] })
    return { key: "ref", arg: x }*/
  } else {
    console.error("unknown op", q)
  }
}


//
// 5: Compute dependencies between vars
//    - fill in vars[i].vars, which has been
//      initialized to q.dims of filter
//      expressions by extract1
//
//    This runs between infer and inferBwd
//
//    NOTE: codegen recomputes dependencies
//    based on q.fre of filter expressions
//

let computeDependencies = () => {
  // calculate transitive dependencies between vars directly

  let deps = {
    var2var: {},
  }

  let followVarVar = (i,j) => {
    if (deps.var2var[i][j]) return
    deps.var2var[i][j] = true
    for (let k of vars[j].vars) followVarVar(i,k)
  }

  for (let i in vars) {
    deps.var2var[i] ??= {}
    for (let j of vars[i].vars) followVarVar(i,j)
  }

  // inject transitive closure info so "inferBwd" will pick it up
  for (let i in deps.var2var) {
    vars[i].vars = Object.keys(deps.var2var[i])
  }
}

let computeDependenciesf = () => {
  // calculate transitive dependencies between vars directly

  let deps = {
    var2var: {},
  }

  let followVarVar = (i,j) => {
    if (deps.var2var[i][j]) return
    deps.var2var[i][j] = true
    for (let k of vars[j].varsf) followVarVar(i,k)
  }

  for (let i in vars) {
    deps.var2var[i] ??= {}
    for (let j of vars[i].varsf) followVarVar(i,j)
  }

  // inject transitive closure info so "inferBwd" will pick it up
  for (let i in deps.var2var) {
    vars[i].varsf = Object.keys(deps.var2var[i])
  }
}




//
// 9: Compute legal order of assignments
//    - topological sort based on q.iter/q.free
//

let computeOrder = q => {
  // after inferBwd, schedule based on union(q.fre, q.bnd)

  if (assignments.length == 0) return [] // do nothing of disabled

  let deps = {
    var2var: {},
    var2tmp: {},
    tmp2var: {},
    tmp2tmp: {}
  }

  for (let v in vars) {
    deps.var2var[v] = {}
    deps.var2tmp[v] = {}
  }

  for (let i in assignments) {
    deps.tmp2var[i] = {}
    deps.tmp2tmp[i] = {}
    let q = assignments[i]
    for (let v of union(q.fre,q.bnd)) deps.tmp2var[i][v] = true
    for (let j of q.tmps) deps.tmp2tmp[i][j] = true
  }

  for (let i in filters) {
    let f = filters[i]
    let v = f.arg[1].op // var name
    f = f.arg[0] // skip dep on var itself
    for (let w of f.fre) deps.var2var[v][w] = true
    for (let j of f.tmps) deps.var2tmp[v][j] = true
  }

  // compute topological order of statements

  // tmp->tmp + tmp->var->tmp
  let deps2 = {
    tmp2tmp: {}
  }
  for (let i in deps.tmp2tmp) {
    deps2.tmp2tmp[i] = {}
    for (let j in deps.tmp2tmp[i])
      deps2.tmp2tmp[i][j] = true
    for (let v in deps.tmp2var[i])
      for (let j in deps.var2tmp[v])
        deps2.tmp2tmp[i][j] = true
  }

  // console.dir(deps)
  // console.dir(deps2)

  let order = scc(Object.keys(deps2.tmp2tmp), x => Object.keys(deps2.tmp2tmp[x])).reverse()
  return order
}



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


const { 
  setCodegenState, 
  codegen, 
  translateToNewCodegen, 
  emitCode,
  emitCodeC,
  emitCodeCPP,
  fixIndent
} = require('./simple-codegen')


let compile = (q,userSettings={}) => {

  if (q.rhyme_ast) q = q.rhyme_ast
  if (!q.xxkey) q = { xxkey: "hole", xxop: q}

  reset(userSettings)

  let trace = {
    log: () => {}
    // log: console.log
  }

  // ---- front end ----

  // 1. Preprocess (after parse, desugar)
  q = preproc(q)
  let src = q

  if (settings.altInfer) { // alternative analysis implementation
    trace.log(q)
    let q0 = JSON.parse(JSON.stringify(q))
    let q1 = deno(q0)(x => {
      let y = { out: x.dims }
      trace.log("K:", x, "->", y)
      return y
    })
    trace.log("RES:",q1)
  }

  // 2. Extract
  q = extract0(q) // basic massaging

  if (settings.antiSubstGroupKey && !settings.newCodegen) {
    // anti-substitution: find occurrences of group key
    // in body and replace with K variable
    q = extract0b(q,[])
  }

  // ---- middle tier ----

  // 3. Infer dependencies bottom up
  q = inferDims(q)

  // 4. Extract var->var dependencies due to filters
  extract1(q)

  // 5. Calculate transitive var->var dependencies
  computeDependencies()

  // 6. Backward pass to infer output dimensions
  let out = settings.singleResult ? q.mind : q.dims
  q = inferBound(out)(q)

  varsChanged = false
  extract1f(q)
  computeDependenciesf()
  q = inferFree(out)(q)

  while (true) {
    varsChanged = false
    extract1f(q)
    if (!varsChanged) break
    computeDependenciesf()
    q = inferFree(out)(q)
  }


  if (out.length > 0) {
    // wrap as (group (vars q.mind) q)
    q = {
     key: "update",
     arg: [
      { key: "const", op: {}, arg: [], vars: [], mind: [], dims: [], bnd: [], fre: [] },
      // NOTE: non-standard way of encoding *multiple*
      // key variables: (vars x y z)
      { key: "pure", op: "vars",
        arg: out.map(x => ({ key: "var", op: x, arg:[], vars: [x], mind: [x], dims: [x] })),
        vars: out, mind: out, dims: out, bnd: [], fre: [] },
      q],
     vars: q.vars,
     mind: [],
     dims: [],
     bnd: out,
     fre: [],
    }
    // NOTE: compared to adding it earlier and
    //       following desugaring pipeline:
    //  1: no embedded 'single' (not needed)
    //  2: multiple vars encoded using (vars *A *B *C)
  }

  // Perform type checking, and modify ast to include types.
  typing.validateIR(settings.schema, q);

  // ---- middle tier, imperative form ----

  if (settings.extractAssignments) {
    // 7. Extract assignments
    q = extract2(q)
  }

  // 8. Extract filters
  for (let e of assignments)
    extract3(e)
  extract3(q)

  // 9. Compute legal order of assignments
  let order = computeOrder(q)


  // ---- back end ----

  setCodegenState({ 
    settings, 
    prefixes,
    path,
    vars,
    hints,
    filters,
    assignments
  })

  // 10. Pretty print (debug out)
  let pseudo = emitPseudo(q)

  // 11. Codegen

  if (settings.newCodegen)
    return translateToNewCodegen(q)


  if (settings.backend == "c" || settings.backend == "cpp") {
    const fs = require('fs/promises')
    const os = require('child_process')

let execPromise = function(cmd) {
    return new Promise(function(resolve, reject) {
        os.exec(cmd, function(err, stdout) {
            if (err) return reject(err);
            resolve(stdout);
        });
    });
}

    let code, cc, filename, flags
    if (settings.backend == "c") {
      code = fixIndent(emitCodeC(q,order))
      cc = "gcc"
      filename = "test.c"
      flags = ""
    } else {
      code = emitCodeCPP(q,order)
      cc = "g++"
      filename = "test.cpp"
      flags = "-std=c++17 -Ithirdparty/json/include"
    }

    let func = (async () => {
      await fs.writeFile(`cgen/${filename}`, code);
      await execPromise(`${cc}  ${flags} cgen/${filename} -o cgen/test.out`)
      return 'cgen/test.out'
    })()

    let wrap = async (input) => {
      let file = await func
      for (let obj in input) {
        await fs.writeFile(`cgen/${obj}.json`, JSON.stringify(input[obj]));
      }
      let res = await execPromise(file)
      return res
    }

    wrap.explain = {
      src,
      ir: {filters, assignments, vars, order},
      pseudo, code
    }
    return wrap
  }

  if (settings.backend == "c-sql") {
    let ir = {filters, assignments, vars, order}
    return generateCSql(q, ir)
  }

  if (settings.backend == "c-sql-new") {
    let ir = {filters, assignments, vars, order}
    return generateCSqlNew(q, ir, settings.outDir, settings.outFile)
  }

  let code = emitCode(q,order)

  code = fixIndent(code)

  trace.log(pseudo)
  trace.log(code)

  // ---- link / eval ----

  let rt = runtime // make available in scope for generated code
  let func = eval(code)

  let wrap = (input) => {
    return func(input)
  }

  wrap.explain = {
    src,
    resultType: q.schema,
    ir: {filters, assignments, vars, order},
    pseudo, code
  }
  return wrap
}


// ------- an alternative code generator follows ------ //

let compilePrimitive = (q,userSettings={}) => {

  reset(userSettings)

  settings.extractAssignments = false
  settings.extractFilters = false

  let trace = {
    log: () => {}
    // log: console.log
  }


  // ---- front end ----

  // 1. Preprocess (after parse, desugar)
  q = preproc(q)
  let src = q


  // 2. Extract
  q = extract0(q) // basic massaging


  // ---- middle tier ----

  // 3. Infer dependencies bottom up
  q = inferDims(q)

  // 4. Extract var->var dependencies due to filters
  extract1(q)

  // 5. Calculate transitive var->var dependencies
  computeDependencies()

  // 6. Backward pass to infer output dimensions
  let out = settings.singleResult ? q.mind : q.dims
  q = inferBound(out)(q)

  varsChanged = false
  extract1f(q)
  computeDependenciesf()
  q = inferFree(out)(q)

  while (true) {
    varsChanged = false
    extract1f(q)
    if (!varsChanged) break
    computeDependenciesf()
    q = inferFree(out)(q)
  }


  if (out.length > 0) {
    // wrap as (group (vars q.mind) q)
    q = {
     key: "update",
     arg: [
      { key: "const", op: {}, arg: [], vars: [], dims: [] },
      { key: "pure", op: "vars",
        arg: out.map(x => ({ key: "var", op: x, arg:[] })),
        vars: out, dims: out },
      q],
     vars: q.vars,
     dims: [],
     bnd: out,
     fre: [],
    }
    // NOTE: compared to adding it earlier and
    //       following desugaring pipeline:
    //  1: no embedded 'single' (not needed)
    //  2: multiple vars encoded using (vars *A *B *C)
  }

  // ---- middle tier, imperative form ----


  // 8. Extract filters
  extract3(q)

  // ---- back end ----

  // 10. Pretty print (debug out)
  let pseudo = emitPseudo(q)

  // 11. Codegen
  let code = emitCode(q/*,order*/)

  code = fixIndent(code)

  trace.log(pseudo)
  trace.log(code)


  // ---- link / eval ----

  let rt = runtime // make available in scope for generated code
  let func = eval(code)

  let wrap = (input) => {
    return func(input)
  }

  wrap.explain = {
    src,
    ir: { filters },
    pseudo, code
  }
  return wrap
}


exports.compile = compile

exports.compilePrimitive = compilePrimitive

// exports.compile = compilePrimitive // TEMP

// exports.compile = require('./primitive-eval').compile



