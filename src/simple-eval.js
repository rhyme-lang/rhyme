const { api } = require('./rhyme')
const { parse } = require('./parser')
const { scc } = require('./scc')
const { generate } = require('./new-codegen')
const { preproc } = require('./preprocess')
const { runtime } = require('./simple-runtime')
const { generateCSql } = require('./sql-codegen')
const { generateCSqlNew } = require('./sql-newcodegen')
const { typing, types, typeSyms } = require('./typing')


// ----- utils -----

// sets, implemented as arrays

let unique = xs => xs.filter((x,i) => xs.indexOf(x) == i)

let union = (a,b) => unique([...a,...b])

let intersect = (a,b) => {
  let keys = {}
  let res = []
  for (let k of b)
    keys[k] = true
  for (let k of a)
    if (keys[k])
      res.push(k)
  return res
}

let diff = (a,b) => {
  let keys = {}
  let res = []
  for (let k of b)
    keys[k] = true
  for (let k of a)
    if (!keys[k])
      res.push(k)
  return res
}

let subset = (a,b) => {
  let keys = {}
  for (let k of b)
    keys[k] = true
  for (let k of a)
    if (!keys[k])
      return false
  return true
}

let same = (a,b) => subset(a,b) && subset(b,a)


// deep maps, access with key arrays

let traverse = (...objs) => depth => body => {
  console.assert(objs.length > 0)
  if (depth == 0) return body([],...objs)
  let [first, ...rest] = objs
  for (let k in first) {
    if (rest && !rest.every(e => k in e)) continue // inner join semantics
    traverse(...objs.map(o=>o[k]))(depth-1)((ks,...os) => {
      body([k,...ks],...os)
    })
  }
}

let update = obj => path => value => {
  if (value === undefined) return obj
  if (path.length > 0) {
    let [k,...rest] = path
    obj ??= {}
    obj[k] = update(obj[k] ?? {})(rest)(value)
    return obj
  } else
    return value
}

let reshape = obj => (path1, path2) => {
  console.assert(same(path1, path2))
  let perm = path2.map(x => path1.indexOf(x))
  let res = {}
  traverse(obj)(path1.length)((a1,o1) => {
    let a2 = perm.map(i => a1[i])
    res = update(res)(a2)(o1)
  })
  return res
}


let join = (obj1, obj2) => (schema1, schema2, schema3) => func => {
  let r1 = schema1; let r2 = schema2; let real = schema3
  let v1 = obj1; let v2 = obj2
  console.assert(subset(r1, real))
  console.assert(subset(r2, real))
  console.assert(same(real, union(r1,r2)))
  let r1only = diff(real,r2)
  let r2only = diff(real,r1)
  let r1r2 = intersect(r1,r2)
  v1 = reshape(v1)(r1, [...r1only,...r1r2])
  v2 = reshape(v2)(r2, [...r2only,...r1r2])
  let res = {}
  traverse(v1)(r1only.length)((a1,o1) =>
    traverse(v2)(r2only.length)((a2,o2) => {
      traverse(o1,o2)(r1r2.length)((a3,o3,o4) => {
        res = update(res)([...a1,...a2,...a3])(func(o3,o4))
      })
    })
  )
  res = reshape(res)([...r1only,...r2only,...r1r2],real)
  return res
}


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



let withoutSchema = (q) => {
    let {arg: arg, schema: schema, ...restQ} = q;
    if(arg === undefined)
        return {...restQ};
    return {
        arg: arg.map(withoutSchema),
        ...restQ
    };
}

let deepCopy = (q) => {
    if(Array.isArray(q)) {
        return q.map(elem => deepCopy(elem));
    }
    if(typeof q !== "object")
        return q;
    let {schema: schema, ...restQ} = q;
    let res = {schema: schema};
    for(let key of Object.keys(restQ)) {
        res[key] = deepCopy(restQ[key])
    }
    return res;
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
    let str = JSON.stringify(withoutSchema(q1)) // extract & cse
    let ix = assignments.map(x => JSON.stringify(withoutSchema(x))).indexOf(str)
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
      let str = JSON.stringify(withoutSchema(q)) // extract & cse
      let ix = filters.map(x => JSON.stringify(withoutSchema(x))).indexOf(str)
      if (ix < 0) {
        ix = filters.length
        // JSON.stringify removes keys of type Symbol
        // Only add the schema at the top level for now
        // In codegen we extract row schema from filters
        let q1 = deepCopy(q);//{ ...JSON.parse(str), schema: q.schema }
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
    let ix = hints.map(x => JSON.stringify(x)).indexOf(str)
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
    buf.push("".padEnd(margin) + " : " + typing.prettyPrintType(q.schema))
    if (pseudoVerbose && q.fre.length)
      buf.push("  " + q.fre)
  }
  if (hints.length) buf.push("")
  for (let i in hints) {
    let q = hints[i]
    buf.push(("hint"+i + prettyPath(q.fre)).padEnd(margin) + " = " + pretty(q))
    buf.push("".padEnd(margin) + " : " + typing.prettyPrintType(q.schema))
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
    buf.push("".padEnd(margin) + " : " + typing.prettyPrintType(q.schema))
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
  buf.push(": " + typing.prettyPrintType(q.schema))
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

let isCSVColAcess = (q) => {
  let [e1, e2] = q.arg
  if (!e1.arg) {
    return false
  }
  let [e11, e12] = e1.arg

  return e11.key == "loadInput" &&
         e12.key == "var" &&
         e2.key == "const" && typeof e2.op == "string"
}

let quoteCSVColAcess = (q) => {
  let [e1, e2] = q.arg
  let [e11, e12] = e1.arg

  let mappedFile = "csv0"
  return ["csv0", quoteVar(e12.op), e2.op].join("_")
}


let codegen = (q, scope) => {
  console.assert(scope.vars)
  console.assert(scope.filters)
  // console.assert(scope.buf)
  if (q.key == "input") {
    return "inp"
  } else if (q.key == "loadInput") {
    console.error("op not implemented: ", pretty(q))
    let [e1] = q.arg.map(x => codegen(x,scope))
    return `loadInput('${q.op}', ${e1})`
  } else if (q.key == "const") {
    if (typeof q.op === "string")
      return "'"+q.op+"'"
    else if (typeof q.op === "object" && Object.keys(q.op).length == 0)
      return "{}"
    else
      return String(q.op)
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
    // Check for the specific shape of get here:
    // loadInput(...).var.const_str
    if (isCSVColAcess(q)) {
      let [e1, e2] = q.arg
      let [e11, e12] = e1.arg

      return quoteCSVColAcess(q)
    } else {
      let [e1,e2] = q.arg.map(x => codegen(x,scope))
      return e1+quoteIndex(e2)
    }

    
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

  // NOTE: by passing `full` to emitFilter2 without diff, we will re-run
  // the full set of filters for each sym that's already in scope.
  // TODO: keep track of which filters were run in scope, not just vars

  if (same(diff(full,scope.vars), iter)) { // XXX should not disregard order?
    emitFilters2(scope, full)(buf, codegen)(body)
  } else {

    let closing = "}"
    buf.push("{")
    buf.push("// PROJECT "+full+" -> "+iter)
    buf.push("let proj = {}")

    emitFilters2(scope, full)(buf, codegen)(() => {
      let xs = [...iter.map(quoteVar)]
      let ys = xs.map(x => ","+x).join("")
      buf.push("  rt.initTemp(proj"+ys+")(() => true)")
    })

    buf.push("// TRAVERSE "+iter)

    let prefix = "proj"
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


let emitFilters2 = (scope, iter) => (buf, codegen) => body => {

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

        // Loops generated for loadInput will be different
        if (g1.key == "loadInput") {
          // only do codegen for the filename
          let filename = codegen(g1.arg[0], scopeg1)
          buf.push(`// filter ${v1} <- ${filename}`)
          buf.push(`let csv0 = fs.readFileSync(${filename}, 'utf8')`)
          buf.push(`let i0 = 0`)
          buf.push(`while (i0 < csv0.length && csv0[i0] != '\\n') {`)
          buf.push(`i0++`)
          buf.push("}")
          buf.push(`i0++`)
          buf.push(`while (i0 < csv0.length) {`)

          let columns = f.schema
          let mappedFile = "csv0"
          let cursor = "i0"
          let size = "csv0.length"
          for (let i in columns) {
            buf.push(`// reading column ${columns[i][0]}`)
            let delim = i == columns.length - 1 ? "\\n" : ","
            let start = [mappedFile, quoteVar(v1), columns[i][0], "start"].join("_")
            let end = [mappedFile, quoteVar(v1), columns[i][0], "end"].join("_")
            let colname = [mappedFile, quoteVar(v1), columns[i][0]].join("_")
            if (typing.isInteger(columns[i][1])) {
              buf.push(`let ${colname} = 0`)
            }
            buf.push(`let ${start} = ${cursor};`)
            buf.push(`while (${cursor} < ${size} && ${mappedFile}[${cursor}] != '${delim}') {`)
            if (typing.isInteger(columns[i][1])) {
              buf.push(`${colname} *= 10`)
              buf.push(`${colname} += Number(${mappedFile}[${cursor}])`)
            }
            buf.push(`${cursor}++;`)
            buf.push("}")
            buf.push(`let ${end} = ${cursor};`)
            buf.push(`${cursor}++;`)
          }

          closing = "}\n"+closing
        } else {
          if (!seen[v1]) {
            buf.push("for (let ["+quoteVar(v1)+", gen"+i+"] of Object.entries("+codegen(g1,scopeg1)+"??{})) {")
          //   buf.push("for (let "+quoteVar(v1)+" in "+codegen(g1,scopeg1)+") {")
          //   buf.push("let gen"+i+" = "+codegen(f,scopef))
          } else {
            buf.push("if ("+quoteVar(v1)+" in ("+codegen(g1,scopeg1)+"??[])) {")
          }
          seen[v1] = true
          closing = "}\n"+closing
        }
      }
    // }
  }

  if (pending.length > 0) {
    let problem = pending.map(i => pretty(filters[i])).join(", ")
    console.warn("unsolved filter ordering problem: couldn't emit "+problem)
    for (let i of pending) {
      buf.push("// ERROR: unsolved filter ordering problem: "+i+" := "+pretty(filters[i]))
    }
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
}

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
}*/

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

        return "rt_pure_"+q.op+"("+es.join(",")+")"
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
    if(ty === undefined)
        throw new Error("Unknown undefined type.");
    if(ty === null)
        throw new Error("Unknown null type.");
    if(ty.__rh_type === typeSyms.union)
        return "rh";
    if(ty.__rh_type === typeSyms.tagged_type) {
        if(ty.__rh_type_tag === "dense") {
            return "std::vector<" + quoteTypeCPP(typing.removeTag(ty)[0][1]) + ">";
        }
        if(ty.__rh_type_tag === "sparse") {
            if(ty.__rh_type_data.dim == 1) {
                return "CSVector<" + quoteTypeCPP(typing.removeTag(ty)[0][1]) + ", " + quoteTypeCPP(typing.removeTag(ty)[0][0]) + ">";
            } else if(ty.__rh_type_data.dim == 2) {
                return "CSRMatrix<" + quoteTypeCPP(typing.removeTag(typing.removeTag(ty)[0][1])[0][1]) + ", " + quoteTypeCPP(typing.removeTag(ty)[0][0]) + ">";
            }
            throw new Error("Unknown sparse item with data: " + ty.__rh_type_data);
        }
        throw new Error("Unknown tag: " + ty.__rh_type_tag);
    }
    if(ty.__rh_type === typeSyms.dynkey) {
        return quoteTypeCPP(ty.__rh_type_supertype);
    }
    if(Object.values(types).includes(ty)) {
        if(ty === types.u8)
            return "uint8_t";
        if(ty === types.u16)
            return "uint16_t";
        if(ty === types.u32)
            return "uint32_t";
        if(ty === types.u64)
            return "uint64_t";
        if(ty === types.i8)
            return "int8_t";
        if(ty === types.i16)
            return "int16_t";
        if(ty === types.i32)
            return "int";
        if(ty === types.i64)
            return "int64_t";
        if(ty === types.nothing)
            return "rh";
        throw new Error("Unknown CPP type of: " + typing.prettyPrintType(ty));
    }
    if(Array.isArray(ty))
        return "rh";
    throw new Error("Unknown type: " + JSON.stringify(ty));
}

let quoteFileReadCPP = ty => {
  if(ty.__rh_type === typeSyms.tagged_type) {
    if(ty.__rh_type_tag === "dense") {
        if(ty.__rh_type_data.dim == 1) {
            return "read_1D_dense_tensor<" + quoteTypeCPP(typing.removeTag(ty)[0][1]) + ">";
        } else if(ty.__rh_type_data.dim == 2) {
            return "read_2D_dense_tensor<" + quoteTypeCPP(typing.removeTag(typing.removeTag(ty)[0][1])[0][1]) + ">";
        }
        throw new Error("Unknown dense item with data: " + ty.__rh_type_data);
    }
    if(ty.__rh_type_tag === "sparse") {
        if(ty.__rh_type_data.dim == 1) {
            return "read_1D_sparse_tensor<" + quoteTypeCPP(typing.removeTag(ty)[0][1]) + ", " + quoteTypeCPP(typing.removeTag(ty)[0][0]) + ">";
        } else if(ty.__rh_type_data.dim == 2) {
            return "read_2D_sparse_tensor<" + quoteTypeCPP(typing.removeTag(typing.removeTag(ty)[0][1])[0][1]) + ", " + quoteTypeCPP(typing.removeTag(ty)[0][0]) + ">";
        }
        throw new Error("Unknown sparse item with data: " + ty.__rh_type_data);
    }
    throw new Error("Unknown tag: " + ty.__rh_type_tag);
  } else {
    if(Array.isArray(ty)) {
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
    let ty = q.schema
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
    let ty = e1.schema
    let source = codegenCPP(e1)
    let sym = codegenCPP(e2)
    if(ty.__rh_type === typeSyms.tagged_type) {
        if(ty.__rh_type_tag == "dense") {
            let sym = quoteExpr(e2)
            return `for (int ${sym}=0; ${sym}<${source}.size(); ${sym}++) {`
        } else if (ty.__rh_type_tag == "sparse") {
            return `for (const auto& [${sym}, ${sym}_val] : ${source}) {`
        }
    }
    if(Array.isArray(ty)) {
        return `for (const auto& [${sym}, ${sym}_val] : ${source}.items()) {`
    }
    throw new Error("Unknown loop type: " + typing.prettyPrintType(ty));
  }
  function selectGenFilter(e1, e2) {
    let a = transExpr(e1)
    let b = transExpr(e2)
    let b1 = b.deps[0]
    let e = expr("FOR", ...a.deps) // "for " + b1 + " <- " + a.txt
    e.sym = b1
    e.rhs = a.txt
    e.loopTxt = quoteLoop(e1, e2)
    // if (generatorStms.every(e1 => e1.txt != e.txt)) // generator CSE
    generatorStms.push(e)
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
    if(ty.__rh_type === typeSyms.tagged_type && (ty.__rh_type_tag === "sparse") || Array.isArray(ty)) {
        return gen+"_val"
    }
  }

  for (let i in filters) {
    let q = filters[i]
    let [e1,e2] = q.arg.map(quoteExpr)
    q.arg.forEach(collectObj)
    let ty1 = q.arg[0].schema
    let expr = quoteGet(e1, e2)
    let scopedName = getScopedName(ty1, e2)
    if (scopedName) {
      nameEnv[expr] = scopedName
    }
  }

  for (let i in assignments) {
    let q = assignments[i]
    collectObj(q)
  }
  collectObj(q)
  let resTy = q.schema
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
          assign(quoteTypeCPP(q.schema)+" "+sym+" "+emitStmInitCPP(q), sym, q.fre, [])
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
  for (let i in filters) {
    let q = filters[i]
    let [a,b] = q.arg
    selectGenFilter(a, b)
  }

  // map final result

  let res = transExpr(q)

  let prolog = []
  prolog.push("#include \"rhyme.hpp\"")
  prolog.push("int main() {")
  for (let obj in objs) {
    let expr = objs[obj]
    let ty = expr.schema
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



let compile = (q,userSettings={}) => {

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

  // 10. Pretty print (debug out)
  let pseudo = emitPseudo(q)

  // 11. Codegen

  if (settings.newCodegen)
    return translateToNewCodegen(q)


  if (settings.backend == "c" || settings.backend == "cpp") {
    const fs = require('node:fs/promises')
    const os = require('node:child_process')

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
      flags = "-std=c++17"
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
    return generateCSqlNew(q, ir)
  }

  let code = emitCode(q,order)

  code = fixIndent(code)

  trace.log(pseudo)
  trace.log(code)


  // ---- link / eval ----

  let rt = runtime // make available in scope for generated code
  let fs = require('fs')
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



