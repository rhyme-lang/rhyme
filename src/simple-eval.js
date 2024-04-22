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

let vars          // deps var->var, var->tmp
let filters
let assignments

let reset = () => {
  prefixes = []
  path = []

  vars = {}
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
// 2,4,7,8. Extract: extract key information from program
//  into external data structures
//

// 2: extract0: 
// - canonicalize *
// - insert 'single' in nested stateful positions
// - ensure all grouping is wrt a variable, i.e.,
//   transform { e1: e2 } to {}{ K1: e2 } / mkset(e1).K1

let canonicalVarName = e1 => {
  let str = JSON.stringify(e1)
  let key = prefixes.indexOf(str)
  if (key < 0) { key = prefixes.length; prefixes.push(str) }
  let name = e1.key == "mkset" ? "K" : "D"
  return name+key
}

let extractFlex0 = q => {
  if (q.key == "stateful" || q.key == "group" || q.key == "update")
    return extract0(q)
  else
    return extract0({ key:"stateful", op: "single", mode: "reluctant", arg:[q] })
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
  } else if (q.arg) {
    let es = q.arg.map(extract0)
    return { ...q, arg: es }
  } else {
    return q
  }
}


// 4: extract var -> filter variable deps
//    - runs after infer()
let extract1 = q => {
  if (q.arg) q.arg.map(extract1)
  if (q.key == "var") {
    vars[q.op] ??= { vars:[] }
  } else if (q.key == "get") {
    let [e1,e2] = q.arg
    if (e2.key == "var") {
      vars[e2.op].vars = union(vars[e2.op].vars, e1.vars)
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
  if (q.key == "stateful" || q.key == "update") {
    let q1 = { ...q, arg: es, tmps }
    let str = JSON.stringify(q1) // extract & cse
    let ix = assignments.map(x => JSON.stringify(x)).indexOf(str)
    if (ix < 0) {
      ix = assignments.length
      assignments.push(q1)
    }
    return { ...q, key: "ref", op: ix, arg: [], tmps:[ix] }
  } else {
    return { ...q, arg: es, tmps }
  }
}


// 8: extract filters
//    - runs after inferBwd()
let extract3 = q => {
  if (!q.arg) return
  q.arg.map(extract3)
  if (q.key == "get") {
    let [e1,e2] = q.arg
    if (e2.key == "var") {
      let str = JSON.stringify(q) // extract & cse
      if (filters.map(x => JSON.stringify(x)).indexOf(str) < 0) {
        let ix = filters.length
        let q1 = JSON.parse(str)
        filters.push(q1) // deep copy...
      }
    }
  }
}



// ----- middle-tier -----

//
// 3. Infer dependencies bottom up: 
//    - vars: variables used
//    - mind: minimum set of variables in output (not removed through reductions)
//    - dims: desired set of variables in output
//

let infer = q => {
  if (q.key == "input" || q.key == "const") {
    q.vars = []
    q.mind = [] 
    q.dims = []
  } else if (q.key == "var") {
    q.vars = [q.op]
    q.mind = [q.op]
    q.dims = [q.op]
  } else if (q.key == "get" || q.key == "pure" || q.key == "mkset") {
    let es = q.arg.map(infer)
    q.vars = unique(es.flatMap(x => x.vars))
    q.mind = unique(es.flatMap(x => x.mind))
    q.dims = unique(es.flatMap(x => x.dims))
  } else if (q.key == "stateful") {
    let [e1] = q.arg.map(infer)

    // NOTE: wo do not include vars/tmps/dims information from path,
    // only from e1. What is the rationale for this?

    // In short: we want to decorrelate paths but we don't have enough
    // information yet. Specifically, transitive var dependencies are
    // only available after infer.

    q.vars = [...e1.vars]
    q.mind = [] // can always reduce to one elem
    if (q.mode == "reluctant") {
      q.dims = [...e1.dims] // but prefer not to
    } else {
      q.dims = []
    }
  } else if (q.key == "update") {
    let [e0,e1,e2,e3] = q.arg.map(infer)
    e3 ??= { vars: [], mind: [], dims: [] }
    q.vars = unique([...e0.vars, ...e1.vars, ...e2.vars, ...e3.vars])
    // treat e3 like a reduction: do not propagate it's inner mind/dims
    q.mind = union(e0.mind, diff(e2.mind, e1.vars))
    q.dims = union(e0.dims, diff(e2.dims, e1.vars))
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
//    - real: variables actually in output
//    - iter: iteration space for stms
//    - free: free variables, anticipating conversion to loops
//
//    Decorrelate paths and eliminate trivial recursion
//

let trans = ps => unique([...ps,...ps.flatMap(x => vars[x].vars)])

let intersects = (a,b) => intersect(a,b).length > 0

let overlaps = (a,b) => intersects(trans(a),trans(b))


let inferBwd2 = out => q => {
  if (q.key == "input" || q.key == "const") {
    q.real = []
    q.free = []
  } else if (q.key == "var") {
    // we have transitive information now -- include 
    // vars[q.op] if visible in out
    let syms = unique([q.op, ...vars[q.op].vars])
    // console.assert(out.includes(q.op), q.op) no?
    q.real = intersect(syms, out)
    q.free = [q.op]
  } else if (q.key == "get" || q.key == "pure" || q.key == "mkset") {
    // q.out = out
    let es = q.arg.map(inferBwd2(out))
    q.real = unique(es.flatMap(x => x.real))
    q.free = unique(es.flatMap(x => x.free))
  } else if (q.key == "stateful") {
    // q.out = out // debugging info vs cse
    // q.path = path
    let out1 = union(out,q.arg[0].dims) // need to consider mode?
    let [e1] = q.arg.map(inferBwd2(out1))

    let extra = path.filter(x => 
      intersects(x.yyreal, e1.vars)).flatMap(x => x.xxreal)

    // NOTE: if we decorrelate aggressively here,
    // we need to add some vars to enclosing updates

    q.iterInit = extra // init value is a constant
    q.iter = union(e1.real, extra)
    q.real = intersect(out, q.iter)
    q.free = q.real

    q.iterInit = trans(q.real) // XXX -- more principled way?
    // console.assert(subset(q.iterInit, q.iter)) // not true...

  } else if (q.key == "update") {
    // q.out = out // debugging info vs cse
    // q.path = path

    let e0 = inferBwd2(out)(q.arg[0]) // what are we extending
    let e1 = inferBwd2(out)(q.arg[1]) // key variable

    // constructs such as eta-expansion may introduce
    // recursive dependencies once statements are extracted.
    // rather than using trans(e1.vars), we extract
    // _single-step_ reachable variables from e1 via e3
    // to avoid this

    let e1Body
    if (q.arg[3]) {
      let out3 = union(out,q.arg[3].dims)
      let e3 = inferBwd2(out3)(q.arg[3]) // filter expr
      e1Body = e3.arg[0]
      console.assert(e3.key == "get")
      console.assert(e3.arg[1].key == "var" && e3.arg[1].op == e1.op)
    } else {
      e1Body = { key: "const", op: "???", 
        vars: [], mind: [], dims: [], real: [] }
    }

    // generatorAsFilter vs aggregateAsKey:
    // if the key is correlated with the body, we need
    // to track its transitive vars, too. Otherwise not.

    let save = path

    let e1Real = [e1.op, ...diff(e1Body.real, out)] // diff(.., out) solved day4-part1 recursion?
    let e1RealPre = [e1.op, ...diff(e1Body.real, q.arg[2].vars)]

    e1.yyreal = e1Real // test this for overlap with e.vars of an inner expr e
    e1.xxreal = e1RealPre // add deps that aren't already present

    // TODO: rationale for the two diff ops?

    path = [...path,e1]

    let e2 = inferBwd2(union(out, [e1.op]))(q.arg[2])
    path = save

    // aggregation part of e3: add extra deps for enclosing groupings
    let V2 = unique([e1.op, ...e1Body.vars]) // e3.vars
    let extra2 = path.filter(x => 
      intersects(x.yyreal, V2)).flatMap(x => x.xxreal)

    // q.iterInit = unique([...e0.real, ...extra0])
    q.iter = unique([...e0.real, ...e1.vars, ...e1Body.real, ...e2.real, ...extra2])
    q.real = intersect(out, q.iter)
    q.free = q.real

    q.iterInit = trans(q.real) // XXX -- more principled way?
  } else {
    console.error("unknown op", q)
  }

  console.assert(subset(q.mind, q.dims))
  console.assert(subset(q.dims, q.vars))
  if (q.key != "var") 
    console.assert(subset(q.mind, q.real), "mind !< real: "+q.mind+" / "+q.real+" at "+pretty(q))

  if (q.mode && q.mode != "reluctant")
    console.assert(subset(q.dims, q.real)) // can happen for lazy 'last'
  if (q.key == "stateful" || q.key =="group" || q.key == "update")
    console.assert(subset(q.real, q.iter), q.real+ "/"+ q.iter)
  // console.assert(subset(q.free, q.real), q.free+ "/"+ q.real + " "+pretty(q))  no?

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
//    - fill in vars[i].vars, based onq.vars
//
//    This runs between infer and inferBwd
//

let computeDependencies0 = (q) => {
  // calculate transitive dependencies between vars directly

  let deps = {
    var2var: {},
  }

  let followVarVar = (i,j) => {
    if (deps.var2var[i][j]) return
    deps.var2var[i][j] = true
    for (let k in deps.var2var[j]) followVarVar(i,k)
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


//
// 9: Compute dependencies between vars and tmps
//    - fill in vars[i].vars and vars[i].tmps
//
//    This runs as part of the recursion sanity check
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
    if (q.tmps) for (let j of q.tmps) deps.tmp2tmp[i][j] = true
  }

  for (let i in filters) {
    let f = filters[i]
    let v = f.arg[1].op // var name
    f = f.arg[0] // skip dep on var itself
    for (let w of f.vars) deps.var2var[v][w] = true
    if (f.tmps) for (let j of f.tmps) deps.var2tmp[v][j] = true
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
// 10: Compute legal order of assignments
//    - topological sort based on q.iter/q.real
//

let computeOrder = q => {
  // after inferBwd, schedule based on q.iter

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
    for (let v of q.iter) deps.tmp2var[i][v] = true
    for (let j of q.tmps) deps.tmp2tmp[i][j] = true
  }

  for (let i in filters) {
    let f = filters[i]
    let v = f.arg[1].op // var name
    f = f.arg[0] // skip dep on var itself
    for (let w of f.real) deps.var2var[v][w] = true
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
// 11a. Pretty print
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
    return "{ "+ e1 + ": " + e2 + " }"
  } else if (q.key == "update") {
    let [e0,e1,e2,e3] = q.arg.map(pretty)
    if (e3) return e0+ "{ "+ e1 + ": " + e2 + " } / " + e3
    return e0+ "{ "+ e1 + ": " + e2 + " }"
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
      buf.push("  " + q.vars + " / " + q.real + " / " + q.iter)
  }
  buf.push("")
  let hi = buf.length
  for (let v in vars) {
    if (vars[v].vars.length > 0 || vars[v].tmps && vars[v].tmps.length > 0)
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
      buf.push("  fre: " + q.free)
  }
  buf.push(pretty(q))
  if (q.real?.length > 0)  
    buf.push("  " + q.real)
  return buf.join("\n")
}




//
// 11. Code generation
//


let isDeepVarStr = s => s.startsWith("**")

let isDeepVarExp = s => s.key == "var" && isDeepVarStr(s.op)


let quoteVar = s => s.replaceAll("*", "x")

let quoteIndex = s => "?.["+s+"]"

let quoteIndexVars = (s,vs) => s + vs.map(quoteVar).map(quoteIndex).join("")

// XXX trouble with tmp path vars, see testPathGroup3
let quoteVarXS = s => isDeepVarStr(s) ? quoteVar(s)+".join('-')+'-'" : quoteVar(s)
let quoteIndexVarsXS = (s,vs) => s + vs.map(quoteVarXS).map(quoteIndex).join("")



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
  } else if (q.key == "ref") {
    let q1 = assignments[q.op]
    let xs = [String(q.op),...q1.real]
    return quoteIndexVarsXS("tmp", xs)
  } else if (q.key == "get" && isDeepVarExp(q.arg[1])) {
    let [e1,e2] = q.arg.map(codegen)
    return "rt.deepGet("+e1+","+e2+")"
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


let emitStmInit = (q) => {
  if (q.key == "stateful") {
    return "rt.stateful."+q.op+"_init"
  } else if (q.key == "update") {
    let e0 = codegen(q.arg[0])
    return "rt.stateful.update_init("+e0+")"
  } else {
    console.error("unknown op", q)
  }
}

let emitStm = (q) => {
  if (q.key == "stateful") {
    let [e1] = q.arg.map(codegen)
    return "rt.stateful."+q.op+"("+e1+")"
  } else if (q.key == "update") {
    let [e0,e1,e2] = q.arg.map(codegen)
    return "rt.stateful.update("+e0+", "+e1+", "+e2+")" // XXX: init is still needed for tree paths
    // return "rt.stateful.update("+"null"+", "+e1+", "+e2+")" // see testPathGroup4-2
  } else {
    console.error("unknown op", q)
  }
}

let emitFilters = (real) => buf => body => {

  let watermark = buf.length
  let buf0 = buf
  let buf1 = []

  let vars = {}
  let seen = {}

  // remember the set of iteration vars
  for (let v of real) vars[v] = true

  // only consider filters contributing to iteration vars=
  let pending = []
  for (let i in filters) {
    let f = filters[i]
    let v1 = f.arg[1].op
    let g1 = f.arg[0]
    if (vars[v1]) // not interested in this? skip
      pending.push(i)
  }

  // compute next set of available filters:
  // all dependent iteration vars have been seen (emitted before)
  let available
  let next = () => {
    let p = pending
    available = []
    pending = []
    for (let i of p) {
      let f = filters[i]
      let v1 = f.arg[1].op
      let g1 = f.arg[0]

// NOTE: this is a bit subtle. Consider:
//
// (1) let avail = g1.vars.every(x => !vars[x] || seen[x])
//
// But g1.vars isn't up to date anymore if the path contains
// grouping. After extraction we may have (aggregateAsKey)
//
//    mkset(tmp1[K2])[K1] with mkset(tmp1[K2]).vars = D0 and .real = K2
//
// So it seems like we might want
//
// (2) let avail = g1.real.every(x => !vars[x] || seen[x])
//
// But that also isn't quite right for some terms without
// grouping. For nontrivial variable dependencies as in
//
//    data.*U.*V.*U  and thus  data.*U.real = *U,*V
//
// (because of the second .*U dependency) we need to
// emit data.*U, then data.*U.*V, etc. But data.*U.*V
// fails because *V isn't available yet.
//
// SOLUTION: compute free variables *after* extraction
// of filters, use q1.free

      let avail = g1.free.every(x => !vars[x] || seen[x])

      if (avail)
        available.push(i)
      else
        pending.push(i)
    }
    return available.length > 0
  }

  let nesting = 0


  // XXX DEBUG / remove
  // for (let i in filters) {
  //     let f = filters[i]
  //     let v1 = f.arg[1].op
  //     let g1 = f.arg[0]

  //     // extra: vars not intended to iterate over
  //     let extra = g1.free.filter(x => !vars[x]) // .free vs .real here?

  //     if (extra.length != 0) {
  //       buf0.push("// p1 "+extra+" in "+quoteVar(v1)+" <- "+pretty(g1))
  //     }
  // }



  // process filters
  while (next()) {
    for (let i of available) {
      let f = filters[i]
      let v1 = f.arg[1].op
      let g1 = f.arg[0]

      // Do we depend on variables that we don't want to iterate
      // over? Then we need to project those out. Run the generator 
      // separately and reify into a data structure. This needs 
      // to happen before the main loop, hence separate output 
      // buffers.
      //
      // TODO: it would be much cleaner to extract this into a 
      // proper assignment statement
      let extra = g1.free.filter(x => !vars[x]) // .free vs .real here?

      if (extra.length != 0) {
        buf0.push("// pre-pre-gen "+extra+" in "+pretty(g1))
        for (let v2 of extra) {
          if (buf0.indexOf("let gen"+i+quoteVar(v2)+" = {}") < 0) {
            buf0.push("// pre-gen "+v2)
            buf0.push("let gen"+i+quoteVar(v2)+" = {}")
            emitFilters(g1.free)(buf0)(() => { // .free vs .real here?
              buf0.push("for (let "+quoteVar(v1)+" in "+codegen(g1)+")")
              buf0.push("  gen"+i+quoteVar(v2)+"["+quoteVar(v1)+"] = true //"+codegen(g1)+"?.["+quoteVar(v1)+"]")
            })
            // with the aux data structure in place, we're ready to
            // proceed with the main loop nest:
          } 
          if (!seen[v1])
            buf1.push("for (let "+quoteVar(v1)+" in gen"+i+quoteVar(v2)+")")
          else
            buf1.push("if ("+quoteVar(v1)+" in gen"+i+quoteVar(v2)+")")
          seen[v1] = true
        }
      } else if (isDeepVarStr(v1)) { // ok, just emit current
        if (!seen[v1]) {
          buf1.push("rt.deepForIn("+codegen(g1)+", "+quoteVar(v1)+" => {")
        } else {
          buf1.push("rt.deepIfIn("+codegen(g1)+", "+quoteVar(v1)+", () => {")
        }
        seen[v1] = true
        nesting += 1
      } else { // ok, just emit current
        if (!seen[v1]) {
          buf1.push("for (let "+quoteVar(v1)+" in "+codegen(g1)+")")
        } else {
          buf1.push("if ("+quoteVar(v1)+" in "+codegen(g1)+")")
        }
        seen[v1] = true
      }
    }
  }

  if (pending.length > 0) {
    let problem = pending.map(i => pretty(filters[i])).join(", ")
    console.warn("unsolved filter ordering problem: couldn't emit "+problem)
  }

  // combine buffers
  if (buf.length > watermark) buf.push("// main loop")
  buf.push(...buf1)

  body()

  for (let i = 0; i < nesting; i++)
    buf.push("})")
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
    
    buf.push("// --- tmp"+i+" ---")

    // emit initialization first (so that sum empty = 0)
    if (q.key == "stateful" && (q.op+"_init") in runtime.stateful || q.key == "update") {

      // XXX what is the right iteration space?
      //
      // 1. use fv2 = q.real
      //
      //    most intuitive: want precisely the space of dimensions
      //
      //    4 failing tests -- groupTestNested1, etc
      //
      //    there, we're loosing the correlation via * between *B and K2=data3.*.key
      //
      // 2. use fv2 = trans(q.real)
      //
      //    this seems to work on all tests -- explicitly include
      //    any correlated variables
      //
      //    now done in inferBwd2 (could be refined there)

      let fv = q.iterInit
      emitFilters(fv)(buf)(() => {
        let xs = [i,...q.real.map(quoteVar)] // free = real for assignments
        let ys = xs.map(x => ","+x).join("")

        buf.push("  rt.init(tmp"+ys+")\n  ("+ emitStmInit(q) + ")")
      })
    }

    let fv = q.iter
    emitFilters(fv)(buf)(() => {
      let xs = [i,...q.real.map(quoteVar)] // free = real for assignments
      let ys = xs.map(x => ","+x).join("")

      buf.push("  rt.update(tmp"+ys+")\n  ("+ emitStm(q) + ")")
    })
  }

  buf.push("// --- res ---")
  console.assert(subset(q.free, q.real))
  emitFilters(q.real)(buf)(() => {
    let xs = q.real.map(quoteVar)
    let ys = xs.map(x => ","+x).join("")
    buf.push("k("+codegen(q)+ys+")")
  })
  buf.push("})")

  return buf.join("\n")
}





let compile = (q,{
  altInfer = false, 
  singleResult = true // TODO: elim flag?
}={}) => {

  reset()

  let trace = { 
    log: () => {} 
    // log: console.log
  }

  // ---- front end ----

  // 1. Preprocess (after parse, desugar)
  q = preproc(q)
  let src = q

  if (altInfer) { // alternative analysis implementation
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


  // ---- middle tier ----

  // 3. Infer dependencies bottom up
  q = infer(q)

  // 4. Extract var->var dependencies due to filters
  extract1(q)

  // 5. Calculate transitive var->var dependencies
  computeDependencies0()

  // 6. Backward pass to infer output dimensions
  if (singleResult) {
    // trace.assert(q.mind.length == 0)
    q = inferBwd2(q.mind)(q)
  } else
    q = inferBwd2(q.dims)(q)

// trace.log("---- AFTER INFER_BWD")
// trace.log(emitPseudo(q))

  // ---- middle tier, imperative form ----

  // 7. Extract assignments
  q = extract2(q)

  // 8. Extract filters
  for (let e of assignments)
    extract3(e)
  extract3(q)

// trace.log("---- AFTER EXTRACT2/3")
// trace.log(emitPseudo(q))

  // 9. Statement dependencies, recursion fix

  // Recursion fix: eliminate simple self-recursive
  // assignment deps by breaking the cycle.
  // This should no longer be necessary, but we keep
  // it around to generate a warning when triggered.
  computeDependencies() // want var2tmp now
  for (let ix in assignments) {
    let q = assignments[ix]
    // report a warning when triggered
    let drop = union(q.real, q.iter).filter(x => vars[x].tmps.includes(Number(ix)))
    if (drop.length > 0)
      console.warn("trigger recursion fix (this should no longer be necessary):\n  "+drop+" dropping at\n  "+pretty(q))
    q.real = q.real.filter(x => !vars[x].tmps.includes(Number(ix)))
    q.iter = q.iter.filter(x => !vars[x].tmps.includes(Number(ix)))
  }

trace.log("---- AFTER REC FIXUP")
trace.log(emitPseudo(q))



  // 10. Compute legal order of assignments
  let order = computeOrder(q)


  // ---- back end ----


  // Pretty print (debug out)
  let pseudo = emitPseudo(q)

  // 11. Codegen
  let code = emitCode(q,order)

  // trace.log(pseudo)
  trace.log(code)


  // ---- link / eval ----

  let rt = runtime // make available in scope for generated code
  let func = eval(code)

  let wrap = (input) => {
    let res
    func(input)((x,...path) => res = rt.deepUpdate(res,path,x))
    // alternative: discard path and collect into an array
    return res
  }

  wrap.explain = {
    src,
    ir: {filters, assignments, vars, order}, 
    pseudo, code 
  }
  return wrap
}


exports.compile = compile

