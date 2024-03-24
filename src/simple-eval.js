const { api } = require('./rhyme')
const { parse } = require('./parser')
const { scc } = require('./scc')
const { runtime } = require('./simple-runtime')

// DONE
//
// Features
//
// - objects with multiple entries (merge)
// - array constructor (collect into array)
// - other primitives -> abstract over path/stateful op
// - udfs
//
// Optimizations
//
// - path decorrelation
//
// Tests
//
// - nested grouping, partial sums at multiple levels,
//   aggregates as keys, generators as filters
// 
// TODO
//
// Features
//
// - &&, ??, non-unifying get -> sufficient to model 
//    failure, filters, left outer joins, etc?
// - recursion: structural (tree traversal), 
//    fixpoint (datalog, incremental), inf. streams
//
// Optimizations
//
// - cse, including expr computed as path
// - loop fusion
//
// Tests
//
// - more corner cases involving var->tmp->var->... closure
//
// Questions
// 
// - is current way of dealing with transitive closure
//   of var->tmp->var->... precise enough?
// - what to do with cycles between assignments?
// - how do semantics justify smarter code generation:
//    - cse (a bit tricky b/c of context semantics)
//    - destination passing style (accumulate directly
//      into mutable targets)
//    - loop fusion: horizontal (independent results)
//      and vertical (producer/consumer)


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


// ----- auxiliary state -----

let prefixes      // canonicalize * for every prefix, e.g., data.* (preproc)
let path          // current grouping path variables (extract)
let pathAux       // grouping key expressions for those variables

let vars          // deps var->var, var->tmp
let filters
let assignments

let reset = () => {
  prefixes = []
  path = []
  pathAux = []

  vars = {}
  filters = []
  pathkeys = []
  assignments = []
}


// ----- front end -----

//
// 1. Preprocess: convert from Rhyme AST to our slightly stratified version
//
// We currently support: input, const, var, get, plus, times, sum, group
//

let isVar = s => s.startsWith("*")

let preproc = q => {
  if (q === true || q === false)
    return { key: "const", op: Boolean(q) }
  if (typeof (q) === "number" || !Number.isNaN(Number(q)))  // number?
    return { key: "const", op: Number(q) }
  if (typeof q === "string") {
    if (q == "-" || q == "$display")
      return { key: "const", op: q }
    else
      return preproc(parse(q))
  }

  if (q === undefined) {
    console.error("why undefined?")
    return q
  }

  if (q.xxpath == "raw") {
    if (q.xxparam == "inp") return { key: "input" }
    else if (!Number.isNaN(Number(q.xxparam))) return { key: "const", op: Number(q.xxparam) }
    else return { key: "const", op: q.xxparam }
  } else if (q.xxpath == "ident") {
    if (isVar(q.xxparam)) return { key: "var", op: q.xxparam }
    else return { key: "const", op: q.xxparam }
  } else if (q.xxpath == "get") {
    let e1 = preproc(q.xxparam[0]) 
    // special case for literal "*": moved from here to extract
    let e2
    if (q.xxparam[1] === undefined) {
      e2 = e1
      e1 = { key: "input" }
    } else
      e2 = preproc(q.xxparam[1])
    return { key: "get", arg: [e1,e2] }
  } else if (q.xxpath == "apply") {
    let [q1,...qs2] = q.xxparam
    let e1 = preproc(q1)
    if (e1.key == "const") // built-in op
      return preproc({...q, xxpath:e1.op, xxparam:qs2})
    else // udf apply
      return { key: "pure", op: "apply", arg: [e1,...qs2.map(preproc)] }
  } else if (q.xxkey == "array") {
    return preproc(q.xxparam)
  } else if (q instanceof Array) {
    if (q.length == 1)
      return { key: "stateful", op: "array", arg: q.map(preproc) }
    else
      return { key: "pure", op: "flatten", arg: q.map(x => preproc([x])) }
  } else if (typeof(q) === "object" && !q.xxpath && !q.xxkey) {
    let res
    for (let k of Object.keys(q)) {
      let v = q[k]
      let e1 = preproc(k)
      let e2 = preproc(v)
      if (e2.key == "merge" || e2.key == "keyval") { // TODO: support 'flatten'
        e1 = e2.arg[0]
        e2 = e2.arg[1]
      }
      if (!res) res = { key: "group", arg: [e1,e2] }
      else res = { key: "update", arg: [res,e1,e2] }
    }
    // return { key: "group", arg: [e1,{key:"stateful", op: "last", mode: "reluctant", arg:[e2]}] }
    if (!res) // empty?
      res = { key: "const", op: {} }
    return res
  } else if (q.xxpath || q.xxkey) {
    // if 'update .. ident ..', convert ident to input ref?
    let op = q.xxpath || q.xxkey
    let array = q.xxpath || op == "merge" || op == "keyval" || op == "flatten" || op == "array"
    let es2 = array ? q.xxparam.map(preproc) : [preproc(q.xxparam)]
    if (op in runtime.special)
      return { key: op, arg: es2 }
    else if (op in runtime.pure)
      return { key: "pure", op: op, arg: es2 }
    else if (op in runtime.stateful)
      return { key: "stateful", op: op, arg: es2 }
    console.error("unknown op", q)
  } else {
    console.error("malformed op", q)
  }
}



//
// 2. Extract: 
//    - all data.*A operations into 'filters'
//    - sum, group operations into 'assignments'
//
//    Metadata added:
//    - get: .filter --> unique filter id
//    - stateful, group, update: .path, .pathAux --> grouping path
//    - group, update: .vK, .aux --> new group var and grouping expression
//
//    Convert 'group e1 e2' to '(mkset e1).K && group K e2' for
//    nontrivial e1 (not a variable).
//

let extractFlex = q => {
  if (q.key == "stateful" || q.key == "group" || q.key == "update")
    return extract(q)
  else
    return extract({ key:"stateful", op: "single", mode: "reluctant", arg:[q] })
}

let extract = q => {
  // XXX investigate: cse if the exact same expression is computed in the path?
  let str = pretty(q)
  let pp = pathAux.map(x => pretty(x)) // can't use JSON.stringify - q has less info
  let ix = pp.indexOf(str)
  if (ix >= 0 && q.key != "var" && q.key != "const") {
    // q.inpath = true
    // console.log("CSE",str)     // TODO!
    // return path[ix]
    // XXXX breaks advanced.nestedIterators!
    // return { key: "pathref", op: path[ix] } // XXX not quite working yet
  }

  if (q.key == "input") {
    return q
  } else if (q.key == "const") {
    return q
  } else if (q.key == "var") {
    if (q.op == "*") throw console.error("cannot support free-standing *")
    vars[q.op] ??= { vars: [], tmps: [] }
    return q
  } else if (q.key == "get") {
    let [e1,e2] = q.arg

    if (e2.key == "var") {
      // canonicalize '*' in 'data.*' to a unique variable
      // NOTE: we use e1 _before_ extract as key
      if (e2.op == "*") {
        let str = JSON.stringify(e1)
        let key = prefixes.indexOf(str)
        if (key < 0) { key = prefixes.length; prefixes.push(str) }
        let name = e1.key == "mkset" ? "K" : "D"
        e2 = {...e2, op: name+key }
      }
      e1 = extract(e1)
      e2 = extract(e2)
      // extract filter -- this is subject to cse
      // NOTE: we use e1,e2 _after_ extract as key
      let str = JSON.stringify({ ...q, arg: [e1,e2] })
      let ix = filters.map(x => JSON.stringify(x)).indexOf(str)
      if (true || ix < 0) { // XXX is it ok to do CSE? concern inferBwd
        ix = filters.length
        let q1 = JSON.parse(str)
        filters.push(q1) // deep copy...
      }
      q.filter = ix
    } else {
      e1 = extract(e1)
      e2 = extract(e2)
    }
    return { ...q, arg: [e1,e2]}
  } else if (q.key == "pure") {
    let es = q.arg.map(extract)
    return { ...q, arg: es }
  } else if (q.key == "mkset") {
    //let myPath = JSON.parse(JSON.stringify(path))
    let es = q.arg.map(extract)
    return { ...q, arg: es} // could add path? path: myPath, pathAux 
  } else if (q.key == "stateful") {
    let myPath = JSON.parse(JSON.stringify(path))
    let es = q.arg.map(extract)
    let x = assignments.length
    assignments.push({ ...q, arg: es, path: myPath, pathAux, /*vars:[], dims:[], tmps: []*/ }) // cycles?
    return { key: "ref", op: x }
  } else if (q.key == "group") {
    let e1 = q.arg[0]

    if (e1.key == "var") { // optimize const case?
      q.vK = extract(e1)
    } else {
      q.aux = extract({key:"get", arg: [
        {key:"mkset", arg:[e1]},
        {key:"var", op:"*", arg:[]}]})
      q.vK = {...q.aux.arg[1]} // the variable after canonicalization
      e1 = q.aux.arg[0].arg[0] // extract(e1), don't call twice
    }

    let save = {path,pathAux}
    path = [...path,q.vK]
    pathAux = [...pathAux,e1]
    let e2 = extractFlex(q.arg[1])
    path = save.path
    pathAux = save.pathAux
    let myPath = JSON.parse(JSON.stringify(path))
    let x = assignments.length
    e1 = {key:"const", op:777} // dummy, real e1 moved into aux
    assignments.push({ ...q, arg: [e1, e2], path:myPath, pathAux, /*vars:[], dims:[], tmps: []*/ })
    return { key: "ref", op: x }
  } else if (q.key == "update") {
    let e0 = extract(q.arg[0])
    let e1 = q.arg[1]

    if (e1.key == "var") { // optimize const case?
      q.vK = extract(e1)
    } else {
      q.aux = extract({key:"get", arg: [
        {key:"mkset", arg:[e1]},
        {key:"var", op:"*", arg:[]}]})
      q.vK = {...q.aux.arg[1]} // the variable after canonicalization
      e1 = q.aux.arg[0].arg[0] // extract(e1), don't call twice
    }

    let save = {path,pathAux}
    path = [...path,q.vK]
    pathAux = [...pathAux,e1]
    let e2 = extractFlex(q.arg[2])
    path = save.path
    pathAux = save.pathAux
    let myPath = JSON.parse(JSON.stringify(path))
    let x = assignments.length
    e1 = {key:"const", op:777} // dummy, real e1 moved into aux
    assignments.push({ ...q, arg: [e0, e1, e2], path:myPath, pathAux, /*vars:[], dims:[], tmps: []*/ })
    return { key: "ref", op: x }
  } else {
    console.error("unknown op", q)
  }
}

// extract0: only
// - canonicalize *
// - insert 'single' in nested stateful positions

let extractFlex0 = q => {
  if (q.key == "stateful" || q.key == "group" || q.key == "update")
    return extract0(q)
  else
    return extract0({ key:"stateful", op: "single", mode: "reluctant", arg:[q] })
}

let canonicalVarName = e1 => {
  let str = JSON.stringify(e1)
  let key = prefixes.indexOf(str)
  if (key < 0) { key = prefixes.length; prefixes.push(str) }
  let name = e1.key == "mkset" ? "K" : "D"
  return name+key
}

let extract0 = q => {
  if (q.key == "var") {
    if (q.op == "*") throw console.error("cannot support free-standing *")
    return q
  } else if (q.key == "get") {
    let [e1,e2] = q.arg
    if (e2.key == "var") {
      // canonicalize '*' in 'data.*' to a unique variable
      // NOTE: we use e1 _before_ extract as key
      if (e2.op == "*")
        e2 = {...e2, op: canonicalVarName(e1) }
    }
    e1 = extract0(e1)
    e2 = extract0(e2)
    return { ...q, arg: [e1,e2]}
  } else if (q.key == "stateful") {
    let es = q.arg.map(extract0)
    return { ...q, arg: es }
  } else if (q.key == "group") {
    return extract0({...q, key:"update",
      arg: [{key:"const",op:{}}, ...q.arg]})
  } else if (q.key == "update") {
    let e0 = extract0(q.arg[0])
    let e1 = extract0(q.arg[1])
    let e2 = extractFlex0(q.arg[2])
    if (e1.key != "var") {
      let prefix = { key:"mkset", arg:[e1] }
      let v1 = { key: "var", op: canonicalVarName(prefix) }
      let v2 = { key: "var", op: canonicalVarName(prefix) }
      return { ...q, arg: [e0, v1, e2, { key: "get", arg: [prefix, v2] }] }
      // return { ...q, arg: [v1,
      //   { key:"stateful", op: "single", mode: "reluctant", arg:[
      //     { key: "pure", op: "and", arg:[
      //       { key: "get", arg: [prefix, v2] }, e2]}]} ]}
    } else
      return { ...q, arg: [e0,e1,e2] }
  // } else if (q.key == "update") {
  //   let e0 = extract0(q.arg[0])
  //   let e1 = extract0(q.arg[1])
  //   let e2 = extractFlex0(q.arg[2])
  //   return { ...q, arg: [e0,e1,e2] }
  } else if (q.arg) {
    let es = q.arg.map(extract0)
    return { ...q, arg: es }
  } else {
    return q
  }
}



let extract2 = q => {
  if (q.arg) q.arg.map(extract2)
  if (q.key == "var") {
    vars[q.op] ??= { vars:[], tmps: [] }
  } else if (q.key == "get") {
    let [e1,e2] = q.arg
    if (e2.key == "var") {
      let str = JSON.stringify(q)
      if (filters.map(x => JSON.stringify(x)).indexOf(str) < 0) {
      let ix = filters.length
      let q1 = JSON.parse(str)
      filters.push(q1) // deep copy...
      }
    }
  }
}


let extract3 = q => {
  if (q.key == "stateful" || q.key == "update") {
    let es = q.arg.map(extract3)
    let tmps = unique(es.flatMap(x => x.tmps))
    let ix = assignments.length
    assignments.push({ ...q, arg: es, tmps })
    return { ...q, key: "ref", op: ix, arg: [],
      tmps:[ix]
    }
/*  } else if (q.key == "group") {
    let es = q.arg.map(extract3)
    let tmps = unique(es.flatMap(x => x.tmps))
    let ix = assignments.length
    assignments.push({ ...q, arg: es, tmps })
    return { ...q,  key: "ref", op: ix, arg: [],
      tmps:[ix]// real: q.real
    }
  } else if (q.key == "update") {
    let es = q.arg.map(extract3)
    let tmps = unique(es.flatMap(x => x.tmps))
    let ix = assignments.length
    assignments.push({ ...q, arg: es, tmps })
    return { ...q, key: "ref", op: ix, arg: [],
      tmps:[ix] // real: q.real
    }*/
  } else if (q.arg) {
    let es = q.arg.map(extract3)
    let tmps = unique(es.flatMap(x => x.tmps))
    return { ...q, arg: es, tmps }
  } else {
    return { ...q, tmps:[] }
  }
}




// ----- middle-tier -----

//
// 3. Infer dependencies bottom up: 
//    - vars: variables used
//    - mind: minimum set of variables in output (not removed through reductions)
//    - dims: desired set of variables in output
//
//    - tmps: assignments used
//

let infer = q => {
  if (q.key == "input") {
    q.tmps = []
    q.vars = []
    q.mind = [] 
    q.dims = []
  } else if (q.key == "const") {
    q.tmps = []
    q.vars = []
    q.mind = []
    q.dims = []
  } else if (q.key == "var") {
    q.tmps = []
    q.vars = [q.op]
    q.mind = [q.op]
    q.dims = [q.op]
  } else if (q.key == "ref") {
    let e1 = assignments[q.op]
    infer(e1)
    q.tmps = unique([...e1.tmps,q.op])
    q.vars = [...e1.vars]
    q.mind = [...e1.mind]
    q.dims = [...e1.dims]
  } else if (q.key == "get") {
    let [e1,e2] = q.arg.map(infer)
    // if (q.filter === undefined && e2.key == "var") { // filter itself
    //   q.tmps = [...e1.tmps]
    //   q.vars = [...e1.vars]
    //   q.mind = [...e1.mind]
    //   q.dims = [...e1.dims]
    // } else {
      q.tmps = unique([...e1.tmps, ...e2.tmps])
      q.vars = unique([...e1.vars, ...e2.vars])
      q.mind = unique([...e1.mind, ...e2.mind])
      q.dims = unique([...e1.dims, ...e2.dims])
    // }
  } else if (q.key == "pure" || q.key == "mkset") {
    // if (q.path) q.path = q.path.map(infer)
    let es = q.arg.map(infer)
    q.tmps = unique(es.flatMap(x => x.tmps))
    q.vars = unique(es.flatMap(x => x.vars))
    q.mind = unique(es.flatMap(x => x.mind))
    q.dims = unique(es.flatMap(x => x.dims))
  } else if (q.key == "stateful") {
    //q.path = q.path.map(infer)
    let [e1] = q.arg.map(infer)

    // NOTE: wo do not include vars/tmps/dims information from path,
    // only from e1. What is the rationale for this?

    // In short: we want to decorrelate paths but we don't have enough
    // information yet. Specifically, transitive var dependencies are
    // only available after infer.

    q.tmps = [...e1.tmps]
    q.vars = [...e1.vars]

    q.mind = [] // can always reduce to one elem
    if (q.mode == "reluctant") {
      q.dims = [...e1.dims] // but prefer not to
    } else {
      q.dims = []
    }
  } else if (q.key == "group") {
    //q.path = q.path.map(infer)
    let [e1,e2] = q.arg.map(infer)
    // q.vK = infer(q.vK)
    // if (q.aux) q.aux = infer(q.aux)
    // NOTE: e1 has been set to a dummy val by extract
    q.vK = e1
    q.tmps = unique([...e1.tmps, ...e2.tmps])
    q.vars = unique([...e1.vars, ...e2.vars, q.vK.op])
    q.mind = diff(unique([/*...e1.mind,*/ ...e2.mind]), e1.vars)
    q.dims = diff(unique([/*...e1.dims,*/ ...e2.dims]), e1.vars)
  } else if (q.key == "update") {
    // q.path = q.path.map(infer)
    let [e0,e1,e2] = q.arg.map(infer)
    // q.vK = infer(q.vK)
    // if (q.aux) q.aux = infer(q.aux)
    // XXX NOTE previous: e1 has been set to a dummy val by extract
    // XXX NOTE: ignoring e3 here!!!
    q.vK = e1
    q.tmps = unique([...e0.tmps, ...e1.tmps, ...e2.tmps])
    q.vars = unique([...e0.vars, ...e1.vars, ...e2.vars, q.vK.op])
    q.mind = diff(unique([...e0.mind, /*...e1.mind,*/ ...e2.mind]), e1.vars)
    q.dims = diff(unique([...e0.dims, /*...e1.dims,*/ ...e2.dims]), e1.vars)
  } else {
    console.error("unknown op", q)
  }
  console.assert(subset(q.mind, q.dims))
  console.assert(subset(q.dims, q.vars))
  return q
}

//
// 5. Infer dependencies top down: 
//    - out:  maximum allowed set of variables in output (provided as input arg)
//    - real: variables actually in output
//    - free: free variables used to compute result
//      (iteration space for stms)
//
//    Decorrelate paths and eliminate trivial recursion
//

let trans = ps => unique([...ps,...ps.flatMap(x => vars[x].vars)])

let inferBwd = out => q => {
  if (q.out !== undefined) {
    if (!same(q.out,out))
      throw console.warn("calling inferBwd twice on "+pretty(q)+"\nout: "+q.out+" -> "+out)
  }

  if (q.key == "input") {
    q.out = out
    q.free = []
    q.real = []
  } else if (q.key == "const") {
    q.out = out
    q.free = []
    q.real = []
  } else if (q.key == "pathref") {
    q.out = out
    q.free = []
    q.real = []
  } else if (q.key == "var") {
    q.out = out
    // we have transitive information now -- include 
    // vars[q.op] if visible in out
    let syms = unique([q.op, ...vars[q.op].vars])
    q.real = intersect(syms, q.out)
    q.free = [q.op]
  } else if (q.key == "ref") {
    q.out = out
    let e1 = assignments[q.op]

    // eliminate recursive path deps -- these
    // typically arise from eta expansion
    e1.path = e1.path.filter(p =>
      p.key != "var" || vars[p.op].tmps.indexOf(q.op) < 0)

    inferBwd(out)(e1)
    q.real = e1.real
    q.free = e1.real // to access e1, we need to provide e1.real
  } else if (q.key == "get") {
    q.out = out
    if (q.filter !== undefined) { // ref to a filter! lookup deps there?
      inferBwd(out)(filters[q.filter])
      // XXXX now doing CSE -- problem??
    }
    let [e1,e2] = q.arg.map(inferBwd(out))
    q.real = union(e1.real, e2.real)
    q.free = union(e1.free, e2.free)
  } else if (q.key == "pure" || q.key == "mkset") {
    q.out = out
    let es = q.arg.map(inferBwd(out))
    q.real = unique(es.flatMap(x => x.real))
    q.free = unique(es.flatMap(x => x.free))
  } else if (q.key == "stateful") {
    q.out = out
    let out1
    console.log(out, q)
    // XXX distinction not necessary?
    if (q.mode == "reluctant")
      out1 = union(out,q.arg[0].mind) // mind vs dim?
    else
      out1 = union(out,q.arg[0].dims) // mind vs dim?
    let [e1] = q.arg.map(inferBwd(out1))

    // decorrelate path
    q.path.map(inferBwd(out))
    q.path = q.path.filter(p => 
      intersect(trans(p.vars), trans(q.vars)).length > 0)

    let pathVs = q.path.flatMap(x => x.real)
    // pathVs = trans(q.path.flatMap(x => x.vars)) wrong res

    q.free = unique([...e1.real, ...pathVs])
    q.real = intersect(out, q.free)
  } else if (q.key == "group") {
    q.out = out

    // decorrelate path
    q.path.map(inferBwd(out))
    q.path = q.path.filter(p => 
      intersect(trans(p.vars), trans(q.vars)).length > 0)

    let pathVs = q.path.flatMap(x => x.real)
    // pathVs = trans(q.path.flatMap(x => x.vars))

// generatorAsFilter --- need to include F
// aggregateAsKey --- do not include *

    inferBwd(out)(q.vK)
    let vks1
    let vksAll = trans(q.vK.vars)
    if (intersect(vksAll, q.arg[1].vars).length > 0) {
      vks1 = unique([q.vK.op, ...diff(vksAll, q.arg[1].vars)])
    } else {
      vks1 = unique([q.vK.op])
    }

    let e1 = inferBwd(union(out, q.arg[0].mind))(q.arg[0]) // (this is a dummy)
    let e2 = inferBwd(union(out, vks1))(q.arg[1])

    q.free = unique([...e2.real, ...pathVs, ...vksAll])
    q.real = intersect(q.free, q.out)

    if (q.aux) {
      // trigger processing of the filter expression
      inferBwd(union(out, q.aux.mind))(q.aux) // union e1.mind e2.dims?
      // inferBwd([q.vK])(q.vK)
    }
  } else if (q.key == "update") {
    q.out = out

    let trans = ps => unique([...ps,...ps.flatMap(x => vars[x].vars)])

    // decorrelate path
    q.path.map(inferBwd(out))
    q.path = q.path.filter(p => 
      intersect(trans(p.vars), trans(q.vars)).length > 0)

    let pathVs = q.path.flatMap(x => x.real)
    // pathVs = trans(q.path.flatMap(x => x.vars))

    inferBwd(out)(q.vK)
    let vks1
    let vksAll = trans(q.vK.vars)
    if (intersect(vksAll, q.arg[2].vars).length > 0) {
      vks1 = unique([q.vK.op, ...diff(vksAll, q.arg[2].vars)])
    } else {
      vks1 = unique([q.vK.op])
    }

    let e0 = inferBwd(out)(q.arg[0])
    let e1 = inferBwd(union(out, q.arg[1].mind))(q.arg[1]) // (this is a dummy)
    let e2 = inferBwd(union(out, vks1))(q.arg[2])

    q.free = unique([...e0.real, ...e2.real, ...pathVs, ...vksAll])
    q.real = intersect(q.free, q.out)

    if (q.aux) {
      // trigger processing of the filter expression
      inferBwd(union(out, q.aux.mind))(q.aux) // union e1.mind e2.dims?
      // inferBwd([q.vK])(q.vK)
    }
  } else {
    console.error("unknown op", q)
  }

  console.assert(subset(q.mind, q.dims))
  console.assert(subset(q.dims, q.vars))
  if (q.key != "var") 
    console.assert(subset(q.mind, q.real), "mind !< real: "+q.mind+" / "+q.real+" at "+pretty(q))

  if (q.mode && q.mode != "reluctant")
    console.assert(subset(q.dims, q.real)) // can happen for lazy 'last'
  if (q.key == "stateful" || q.key =="group" || q.key == "update") {
    console.assert(subset(q.real, q.free), q.real+ "/"+ q.free)
  }

  return q
}

let inferBwd2 = out => q => {
  if (q.out !== undefined) {
    if (!same(q.out,out))
      throw console.warn("calling inferBwd twice on "+pretty(q)+"\nout: "+q.out+" -> "+out)
  }

  if (q.key == "input") {
    // q.out = out
    q.free = []
    q.real = []
  } else if (q.key == "const") {
    // q.out = out
    q.free = []
    q.real = []
  } else if (q.key == "var") {
    // q.out = out
    // we have transitive information now -- include 
    // vars[q.op] if visible in out
    let syms = unique([q.op, ...vars[q.op].vars])
    q.real = intersect(syms, out)
    q.free = [q.op]
  } else if (q.key == "get") {
    // q.out = out
    let [e1,e2] = q.arg.map(inferBwd2(out))
    q.real = union(e1.real, e2.real)
    q.free = union(e1.free, e2.free)
  } else if (q.key == "pure" || q.key == "mkset") {
    // q.out = out
    let es = q.arg.map(inferBwd2(out))
    q.real = unique(es.flatMap(x => x.real))
    q.free = unique(es.flatMap(x => x.free))
  } else if (q.key == "stateful") {
    q.out = out
    let out1

    // console.log("XXX STATEFUL " + pretty(q) +"\nout: " + out)

    // XXX distinction not necessary?
    if (q.mode == "reluctant")
      out1 = union(out,q.arg[0].mind) // mind vs dim?
    else
      out1 = union(out,q.arg[0].dims) // mind vs dim?
    let [e1] = q.arg.map(inferBwd2(out1))

    // // decorrelate path
    // q.path.map(inferBwd(out))
    // q.path = q.path.filter(p => 
    //   intersect(trans(p.vars), trans(q.vars)).length > 0)

    path.map(inferBwd2(out))
    let ps = path.filter(p => 
      intersect(trans(p.vars), trans(q.vars)).length > 0)

    // let pathVs = q.path.flatMap(x => x.real)
    // pathVs = trans(q.path.flatMap(x => x.vars)) wrong res
    let pathVs = ps.flatMap(x => x.real)
    // let pathVs = ps.map(x => x.op)

    // console.log("XXX1 " + path.map(pretty) + " / " + pretty(q))
    // console.log("XXX2 " + path.map(x => trans(x.vars)) + " / "+trans(q.vars))
    // console.log("XXX3 " + path.map(x => x.real))

    q.free = unique([...e1.real, ...pathVs])
    q.real = intersect(out, q.free)
  } else if (q.key == "update") {
    q.out = out

    let e0 = inferBwd2(out)(q.arg[0]) // what are we extending

    if (q.arg[3]) {
      let e3 = inferBwd2(union(out, q.arg[3].mind))(q.arg[3]) // filter expr
    }

    // let e1 = inferBwd2(union(out, q.arg[1].mind))(q.arg[1]) // key variable
    let e1 = inferBwd2(out)(q.arg[1]) // key variable

    path.map(inferBwd2(out)) // needed here?
    let ps = path.filter(p => 
      intersect(trans(p.vars), trans(q.vars)).length > 0)

    // XXX REC: solves arrayTest6Flatten?
    // ps = ps.filter(x => vars[x.op].vars.indexOf(""+e1.op) < 0)

    let pathVs = ps.flatMap(x => x.real)
    // let pathVs = ps.map(x => x.op)

// generatorAsFilter --- need to include F
// aggregateAsKey --- do not include *

    let vks1
    let vksAll = trans(e1.vars)
    if (intersect(vksAll, q.arg[2].vars).length > 0) {
      vks1 = unique([e1.op, ...diff(vksAll, q.arg[2].vars)])
    } else {
      vks1 = unique([e1.op])
    }

    // console.log("YYY " + path.map(pretty) + " / " + pretty(q))
    // console.log("YYY " + vks1)


    // console.log("XXX UPDATE " + pretty(q) + "\nvks1: "+vks1)




    let save = path

    // let drop = path.filter(x => vars[x.op].vars.includes(e1.op))

    // XXX REC: solves filter ordering issues, but
    // not enough to remove tmp2tmp fix below!!!
    path = path.filter(x => vars[x.op].vars.indexOf(""+e1.op) < 0)

    // console.log("XXX "+pretty(q)+"\n"+
    //   trans(path.flatMap(x => x.vars))+"\n"+
    //   drop.map(pretty)+"\n"+
    //   e1.op+"\n"+
    //   vksAll
    //   )

    // if (!trans(path.flatMap(x => x.vars)).includes(e1.op))
      path = [...path, e1]

    let e2 = inferBwd2(union(out, vks1))(q.arg[2])

    path = save

    q.free = unique([...e2.real, ...pathVs, ...vksAll])
    q.real = intersect(q.free, out)




  } else {
    console.error("unknown op", q)
  }

  console.assert(subset(q.mind, q.dims))
  console.assert(subset(q.dims, q.vars))
  if (q.key != "var") 
    console.assert(subset(q.mind, q.real), "mind !< real: "+q.mind+" / "+q.real+" at "+pretty(q))

  if (q.mode && q.mode != "reluctant")
    console.assert(subset(q.dims, q.real)) // can happen for lazy 'last'
  if (q.key == "stateful" || q.key =="group" || q.key == "update") {
    console.assert(subset(q.real, q.free), q.real+ "/"+ q.free)
  }

  return q
}





// XXX. alternative "denotational" formulation: 
//    - try to make "infer" compositional!
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
// 4: Compute dependencies between vars and tmps
//    - fill in vars[i].vars and vars[i].tmps
//    - based on q.vars
//
//    This runs between infer and inferBwd
//

let computeDependencies = () => {
  // calculate one-step dependencies between vars/tmps

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
    for (let v of q.vars) deps.tmp2var[i][v] = true
    for (let j of q.tmps) deps.tmp2tmp[i][j] = true
  }

  for (let i in filters) {
    let f = filters[i]
    let v = f.arg[1].op // var name

    f = f.arg[0] // XXX skip dep on var itself!

    for (let w of f.vars) deps.var2var[v][w] = true
    for (let j of f.tmps) deps.var2tmp[v][j] = true
  }


  // calculate explicit transitive closure

  let transdeps = {
    var2var: {},
    var2tmp: {},
    tmp2var: {},
    tmp2tmp: {}
  }

  let followVarVar = (i,j) => {
    if (transdeps.var2var[i][j]) return
    transdeps.var2var[i][j] = true
    for (let k in deps.var2var[j]) followVarVar(i,k)
    for (let k in deps.var2tmp[j]) followVarTmp(i,k)
  }
  let followVarTmp = (i,j) => {
    if (transdeps.var2tmp[i][j]) return
    transdeps.var2tmp[i][j] = true
    for (let k in deps.tmp2var[j]) followVarVar(i,k)
    for (let k in deps.tmp2tmp[j]) followVarTmp(i,k)
  }
  let followTmpVar = (i,j) => {
    if (transdeps.tmp2var[i][j]) return
    transdeps.tmp2var[i][j] = true
    for (let k in deps.var2var[j]) followTmpVar(i,k)
    for (let k in deps.var2tmp[j]) followTmpTmp(i,k)
  }
  let followTmpTmp = (i,j) => {
    if (transdeps.tmp2tmp[i][j]) return
    transdeps.tmp2tmp[i][j] = true
    for (let k in deps.tmp2var[j]) followTmpVar(i,k)
    for (let k in deps.tmp2tmp[j]) followTmpTmp(i,k)
  }

  for (let i in deps.var2var) {
    transdeps.var2var[i] ??= {}
    transdeps.var2tmp[i] ??= {}
    for (let j in deps.var2var[i]) followVarVar(i,j)
    for (let j in deps.var2tmp[i]) followVarTmp(i,j)
  }

  for (let i in deps.tmp2var) {
    transdeps.tmp2var[i] ??= {}
    transdeps.tmp2tmp[i] ??= {}
    for (let j in deps.tmp2var[i]) followTmpVar(i,j)
    for (let j in deps.tmp2tmp[i]) followTmpTmp(i,j)
  }


  // inject transitive closure info so "inferBwd" will pick it up

  for (let i in deps.var2var) {
    vars[i].vars = Object.keys(transdeps.var2var[i])
    vars[i].tmps = Object.keys(transdeps.var2tmp[i]).map(Number)
  }
}


//
// 6: Compute legal order of assignments
//    - topological sort based on q.free
//

let computeOrder = q => {
  // after inferBwd, schedule based on q.free

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
    for (let v of q.free) deps.tmp2var[i][v] = true
    for (let j of q.tmps) deps.tmp2tmp[i][j] = true
  }

  for (let i in filters) {
    let f = filters[i]
    let v = f.arg[1].op // var name
    f = f.arg[0] // XXX

    // if (f.free.includes(v)) continue

    // XXX free or real??
    for (let w of f.free) deps.var2var[v][w] = true
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
// 5a. Pretty print
//

let prettyPath = es => {
  if (es === undefined) return "[?]"
  let sub = x => typeof(x) === "string" ? x : pretty(x)
  return "[" + es.map(sub).join(",") + "]"
}

let pretty = q => {
  if (q.key == "input") {
    return "inp"
  } else if (q.key == "const") {
    if (typeof q.op === "object" && Object.keys(q.op).length == 0) return "{}"
    else return ""+q.op
  } else if (q.key == "var") {
    return q.op
  } else if (q.key == "ref") {
    let e1 = assignments[q.op]
    return "tmp"+q.op+prettyPath(e1.real)
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
  } else if (q.key == "mkset") {
    let [e1] = q.arg.map(pretty)
    return "mkset("+e1+")"
  } else if (q.key == "stateful") {
    let [e1] = q.arg.map(pretty)
    return q.op+"("+e1+")"
  } else if (q.key == "group") {
    let [e1,e2] = q.arg.map(pretty)
    return "{ "+ (q.vK?.op) + "=" + e1 + ": " + e2 + " }"
  } else if (q.key == "update") {
    let [e0,e1,e2,e3] = q.arg.map(pretty)
    if (e3) return e0+ "{ "+ /*(q.vK?.op) + "=" +*/ e1 + ": " + e2 + " } / " + e3
    return e0+ "{ "+ (q.vK?.op) + "=" + e1 + ": " + e2 + " }"
  } else {
    console.error("unknown op", q)
  }
}


let emitPseudo = (q) => {
  let buf = []
  for (let i in filters) {
    let q = filters[i]
    buf.push("gen"+i + ": " + pretty(q))
    if (q.vars.length)
      buf.push("  " + q.vars + " / " + q.real + " / " + q.free)
  }
  buf.push("")
  let hi = buf.length
  for (let v in vars) {
    if (vars[v].vars.length > 0 || vars[v].tmps.length > 0)
      buf.push(v + " -> " + vars[v].vars +"  "+ vars[v].tmps)
  }
  if (buf.length > hi)
    buf.push("")
  for (let i in assignments) {
    let q = assignments[i]
    buf.push("tmp"+i + prettyPath(q.real) + " = " + pretty(q))
    // if (q.real?.length > 0)
    //   buf.push("  rel: " + q.real)
    if (q.path?.length > 0) 
      buf.push("  pth: " + q.path.map(pretty))
    // buf.push("  = " + pretty(q))
    if (q.vars.length > 0) 
      buf.push("  var: " + q.vars)
    if (q.tmps.length > 0) 
      buf.push("  tmp: " + q.tmps)
    if (q.mind.length > 0)  
      buf.push("  min: " + q.mind)
    if (q.dims.length > 0)  
      buf.push("  dim: " + q.dims)
    if (q.out && q.out.length > 0)  
      buf.push("  out: " + q.out)
    if (q.iter?.length > 0) 
      buf.push("  itr: " + q.iter)
    if (q.free?.length > 0) 
      buf.push("  fre: " + q.free)
  }
  buf.push(pretty(q))
  if (q.real?.length > 0)  
    buf.push("  " + q.real)
  return buf.join("\n")
}




//
// 5b. Code generation
//



let quoteVar = s => s.replace("*", "x")

let quoteIndex = s => "?.["+s+"]"

let quoteIndexVars = (s,vs) => s + vs.map(quoteVar).map(quoteIndex).join("")


let codegen = q => {
  if (q.key == "input") {
    return "inp"
  } else if (q.key == "const") {
    if (typeof q.op === "string")
      return "'"+q.op+"'"
    else if (typeof q.op === "object" && Object.keys(q.op).length == 0)
      return "{}"
    else
      return String(q.op)
  } else if (q.key == "var") {
    return quoteVar(q.op)
  } else if (q.key == "pathref") {
    if (path.some(x => x.pathkey == q.op.pathkey))
      return "K"+q.op.pathkey
    else
      return codegen(q.op)
  } else if (q.key == "ref") {
    let q1 = assignments[q.op]
    let xs = [String(q.op),...q1.real]
    return quoteIndexVars("tmp", xs)
  } else if (q.key == "get") {
    let [e1,e2] = q.arg.map(codegen)
    return e1+quoteIndex(e2)
  } else if (q.key == "pure") {
    let es = q.arg.map(codegen)
    return "rt.pure."+q.op+"("+es.join(",")+")"
  } else if (q.key == "mkset") {
    let [e1] = q.arg.map(codegen)
    return "rt.singleton("+e1+")"
  } else {
    console.error("unknown op", pretty(q))
    return "<?"+q.key+"?>"
  }
}


let emitStm = (q) => {
  if (q.key == "stateful") {    
    let [e1] = q.arg.map(codegen)
    let extra = diff(q.arg[0].real, q.real)
    if (extra.length && q.real.length > 0) {
      // console.error("DOUBLE-SUM-PROBLEM "+q.op)
    }
    // return lhs+" += "+e1
    return "rt.stateful."+q.op+"("+e1+","+extra.length+")"
  } else if (q.key == "group") {
    let [e1,e2] = q.arg.map(codegen)
    // return lhs+"["+e1+"] = "+e2
    // return "rt.stateful.single("+e2+")"
    return "rt.stateful.group("+quoteVar(q.vK)+", "+e2+")"
  } else if (q.key == "update") {
    let [e0,e1,e2] = q.arg.map(codegen)
    // return lhs+"["+e1+"] = "+e2
    // return "rt.stateful.single2("+e0+","+e2+")"
   return "rt.stateful.update("+e0+", "+quoteVar(q.vK.op)+", "+e2+")"
  } else {
    console.error("unknown op", q)
  }
}

let emitFilters = (real) => buf => {

  let watermark = buf.length
  let buf0 = buf
  let buf1 = []

  let vars = {}
  let seen = {}
  for (let v of real) vars[v] = true

  let worklist = []
  let skipcount = {}
  for (let i in filters) {
    worklist.push(i)
    skipcount[i] = 0
  }

  // process filters
  while (worklist.length > 0) {
    let i = worklist.shift()
    let f = filters[i]
    let v1 = f.arg[1].op
    let g1 = f.arg[0]
    if (!vars[v1]) continue // not interested in this? skip

    // Do we have an ordering problem? I.e. we depend on a
    // variable that's only introduced later (first filter
    // not seen yet). Try to solve this by postponing current
    // to end of list. Need to be careful about cycles.
    //
    // TODO: would be better to use proper topsort
    let orderingProblem = g1.real.filter(x => x != v1 && !seen[x] && vars[x])
    if (orderingProblem.length != 0) { // ok, just emit current
      if (skipcount[i]++ < 10) {
        worklist.push(i)
        continue
      } else {
        console.warn("unsolved filter ordering problem:"+orderingProblem+" at "+v1)
      }
    }

    // Do we depend on variables that we don't want to iterate
    // over? Then we need to project those out. Run the generator 
    // separately and reify into a data structure. This needs 
    // to happen before the main loop, hence separate output 
    // buffers.
    //
    // TODO: it would be much cleaner to extract this into a 
    // proper assignment statement
    let extra = g1.real.filter(x => !vars[x])
    // XXX NOTE: was g1.free !! <-- previous diff ref/tmp

    if (extra.length != 0) {
      buf0.push("// pre-pre-gen "+extra+" in "+pretty(g1))
      for (let v2 of extra) {
        if (buf0.indexOf("let gen"+i+quoteVar(v2)+" = {}") < 0) {
          buf0.push("// pre-gen "+v2)
          buf0.push("let gen"+i+quoteVar(v2)+" = {}")
          emitFilters(g1.free)(buf0)
          buf0.push("for (let "+quoteVar(v1)+" in "+codegen(g1)+")")
          buf0.push("  gen"+i+quoteVar(v2)+"["+quoteVar(v1)+"] = true //"+codegen(g1)+"?.["+quoteVar(v1)+"]")
          // with the aux data structure in place, we're ready to
          // proceed with the main loop nest:
        } 
        if (!seen[v1])
          buf1.push("for (let "+quoteVar(v1)+" in gen"+i+quoteVar(v2)+")")
        else
          buf1.push("if ("+quoteVar(v1)+" in gen"+i+quoteVar(v2)+")")
        seen[v1] = true
      }
    } else { // ok, just emit current
      if (!seen[v1]) {
        buf1.push("for (let "+quoteVar(v1)+" in "+codegen(g1)+")")
      } else {
        buf1.push("if ("+quoteVar(v1)+" in "+codegen(g1)+")")
      }
      seen[v1] = true
    }
  }

  // combine buffers
  if (buf.length > watermark) buf.push("// main loop")
  buf.push(...buf1)
}


let emitCode = (q, order) => {
  let buf = []
  buf.push("(inp => k => {")
  buf.push("let tmp = {}")


  for (let is of order) {
    if (is.length > 1)
      console.error("cycle "+is)
    let [i] = is
    let q = assignments[i]
    
    // NOTE: it would be preferable to emit initialization up front (so that sum empty = 0)

    buf.push("// --- tmp"+i+" ---")


    let fv = q.free // union(q.path,q.free)

    let buf1 = []
    let buf2 = []
    let buf3 = []

    // XXXX DOUBLE-SUM PROBLEM
    // let pathVars = unique(q.path.flatMap(x => x.free))
    // let seenVars = {}
    // for (let p of q.path) {
    //   let k1 = buf.length
    //   for (let vv of p.free) {
    //     if (q.free.includes(vv)) {
    //       buf2.push("// skip pre-gen key path "+pretty(p)+" to "+quoteVar(vv))
    //       continue 
    //       // seenVars[vv] = true
    //     }

    //     // build temp structure
    //     let k = buf.length
    //     buf.push("// pre-gen key path "+pretty(p)+" to "+quoteVar(vv))
    //     buf.push("let temp"+k+" = {}")
    //     emitFilters(p.free)(buf)
    //     buf.push("{ temp"+k+"["+codegen(p)+"] = {}; temp"+k+"["+codegen(p)+"]["+quoteVar(vv)+"] = true; }")
    //     // XXX note that we only keep a single entry!

    //     let i = p.pathkey

    //     if (k == k1) // first time we see path elem
    //       buf1.push("for (let K"+i+" in temp"+k+") ")
    //     if (!seenVars[vv])
    //       buf1.push("for (let "+quoteVar(vv)+" in temp"+k+"[K"+i+"]) {") // only one entry!!
    //     else
    //       buf2.push("if ("+quoteVar(vv)+" in temp"+k+"[K"+i+"]) {") // only one entry!!
    //     // buf1.push("{")
    //     buf3.push("}")
    //     seenVars[vv] = true
    //   }
    // }

    buf.push(...buf1)
    emitFilters(fv)(buf)
    buf.push(...buf2)

    // no longer an issue with "order"
    // if (q.tmps.some(x => x > i))
    //  console.error("wrong order", i, q)
    if (q.tmps.some(x => x == i))
      console.error("cycle")

    let xs = [i,...q.real.map(quoteVar)]
    let ys = xs.map(x => ","+x).join("")

    buf.push("  rt.update(tmp"+ys+")\n  ("+ emitStm(q) + ")")

    buf.push(...buf3)
  }

  buf.push("// --- res ---")
  emitFilters(q.real)(buf)
    let xs = q.real.map(quoteVar)
    let ys = xs.map(x => ","+x).join("")
  buf.push("k("+codegen(q)+ys+")")
  buf.push("})")

  return buf.join("\n")
}







let compile = (q,{
  altInfer = false, 
  singleResult = true // TODO: elim flag?
}={}) => {

  reset()

  let console = { log: () => {} }

  // ---- front end ----

  // 1. Preprocess (after parse, desugar)
  q = preproc(q)
  let src = q

  if (altInfer) { // alternative analysis implementation
    console.log(q)
    let q0 = JSON.parse(JSON.stringify(q))
    let q1 = deno(q0)(x => {
      let y = { out: x.dims }
      console.log("K:", x, "->", y)
      return y
    })
    console.log("RES:",q1)
  }

  // 2. Extract
  q = extract0(q)


  // ---- middle tier ----

  // 3. Infer dependencies bottom up
  q = infer(q) // goes into assignments but not filters

  extract2(q) // extract filters

  // Pretty print (debug out)
  let pseudo0 = emitPseudo(q)
console.log("---- AFTER INFER, EXTRACT2")
console.log(emitPseudo(q))


  // 4. Calculate dependencies between vars/tmps
  computeDependencies()

  filters = []
  assignments = []

  // q = extract(q)

// console.log(vars)


  // 5. Backward pass to infer output dimensions
  if (singleResult) {
    // console.assert(q.mind.length == 0)
    q = inferBwd2(q.mind)(q)
  } else
    q = inferBwd2(q.dims)(q)

console.log("---- AFTER INFER_BWD")
console.log(emitPseudo(q))

  q = extract3(q) // extract assignments

  extract2(q) // extract filters
  for (let e of assignments)
    extract2(e)

console.log("---- AFTER EXTRACT2/3")
console.log(emitPseudo(q))

// XXX recursion!!
  // console.log(vars)
  computeDependencies() // want var2tmp now
  // console.log(vars)
  for (let ix in assignments) {
    let q = assignments[ix]
    q.real = q.real.filter(x => !vars[x].tmps.includes(Number(ix)))
    q.free = q.free.filter(x => !vars[x].tmps.includes(Number(ix)))
  }

console.log("---- AFTER REC FIXUP")
console.log(emitPseudo(q))



  // 6. Compute legal order of assignments
  let order = computeOrder(q)


  // ---- back end ----


  // Pretty print (debug out)
  let pseudo = emitPseudo(q)

  // 8. Codegen
  let code = emitCode(q,order)

  // console.log(pseudo)
  console.log(code)


  // ---- link / eval ----

  let rt = runtime // make available in scope for generated code
  let func = eval(code)

  let wrap = (input) => {
    let res
    func(input)((x,...path) => res = update(res)(path)(x))
    // alternative: discard path and collect into an array
    return res
  }

  wrap.explain = { 
    src,
    ir: {filters, assignments, vars, order}, 
    pseudo0, pseudo, code 
  }
  return wrap
}


exports.compile = compile

