const { api, pipe } = require('./rhyme')
const { rh, parse } = require('./parser')
const { scc } = require('./scc')
const { runtime } = require('./simple-runtime')

// TODO: missing functionality
//
// - objects with multiple entries (merge)
// - array constructor (collect into array)
// - other primitives -> abstract over path/stateful op
// - udfs
// - &&, ??, non-unifying get -> sufficient to model 
//    failure, filters, left outer joins, etc?
//
// Add tests
//
// - nested grouping, partial sums at multiple levels
// - more corner cases involving var->tmp->var->... closure
//
// Questions
// 
// - is current way of dealing with transitive closure
//   of var->tmp->var->... precise enough?
// - what to do with cycles between assignments?
// - how do semantics justify smarter code generation:
//    - destination passing style (accumulate directly
//      into mutable targets)
//    - loop fusion: horizontal (independent results)
//      and vertical (producer/consumer)



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




let prefixes
let path

let vars
let filters
let assignments

let reset = () => {
  prefixes = []
  path = []

  vars = {}
  filters = []
  assignments = []
}


//
// 1. Preprocess: convert from Rhyme AST to our slightly stratified version
//
// We currently support: input, const, var, get, plus, times, sum, group
//

let isVar = s => s.startsWith("*")

let preproc = q => {
  if (typeof (q) === "number" || !Number.isNaN(Number(q)))  // number?
    return { key: "const", op: Number(q) }
  if (typeof q === "string") {
    if (q == "-" || q == "$display")
      return { key: "const", op: q }
    else
      return preproc(parse(q))
  }

  if (q.xxpath == "raw") {
    if (q.xxparam == "inp") return { key: "input" }
    else return { key: "const", op: q.xxparam }
  } else if (q.xxpath == "ident") {
    if (q.xxparam == "*") console.error("cannot support free-standing *")
    else if (isVar(q.xxparam)) return { key: "var", op: q.xxparam }
    else return { key: "const", op: q.xxparam }
  } else if (q.xxpath == "get") {
    let e1 = preproc(q.xxparam[0]) 
    // XXX special case for literal "*": do this here or better in extract?
    let e2
    if (q.xxparam[1].xxpath == "ident" && q.xxparam[1].xxparam == "*") {
      let str = JSON.stringify(e1)
      let key = prefixes.indexOf(str)
      if (key < 0) { key = prefixes.length; prefixes.push(str) }
      e2 = { key: "var", op: "*_DEFAULT_"+key }
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
  } else if (q instanceof Array) {
    // XXX what about xxkey == "Array" ?
    if (q.length == 1)
      return { key: "stateful", op: "array", arg: q.map(preproc) }
    else
      return { key: "pure", op: "flatten", arg: q.map(x => preproc([x])) }
  } else if (typeof(q) === "object" && !q.xxpath && !q.xxkey) {
    //console.assert(Object.keys(q).length == 1) // TODO
    let res
    for (let k of Object.keys(q)) {
      let v = q[k]
      let e1 = preproc(k)
      let e2 = preproc(v)
      if (e2.key == "merge" || e2.key == "keyval") { // TODO: flatten
        e1 = e2.arg[0]
        e2 = e2.arg[1]
      }
      if (!res) res = { key: "group", arg: [e1,e2] }
      else res = { key: "update", arg: [res,e1,e2] }
    }
    // return { key: "group", arg: [e1,{key:"stateful", op: "last", mode: "reluctant", arg:[e2]}] }
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

let extractFlex = q => {
  if (q.key == "stateful" || q.key == "group" || q.key == "update")
    return extract(q)
  else
    return extract({ key:"stateful", op: "single", mode: "reluctant", arg:[q] })
}

let extract = q => {
  if (q.key == "input") {
    return q
  } else if (q.key == "const") {
    return q
  } else if (q.key == "var") {
    vars[q.op] ??= { vars: [], tmps: [] }
    return q
  } else if (q.key == "get") {
    let [e1,e2] = q.arg.map(extract)
    if (e2.key == "var") {
      let q1 = JSON.parse(JSON.stringify({ ...q, arg: [e1,e2] }))
      let ix = filters.length
      q.filter = ix
      filters.push(q1) // deep copy...
    }
    return { ...q, arg: [e1,e2]}
  } else if (q.key == "pure") {
    let es = q.arg.map(extract)
    return { ...q, arg: es }
  } else if (q.key == "stateful") {
    let es = q.arg.map(extract)
    let x = assignments.length
    assignments.push({ ...q, arg: es, path, vars:[], dims:[], tmps: [] }) // cycles?
    return { key: "ref", op: x }
  } else if (q.key == "group") {
    let e1 = extract(q.arg[0])
    let save = path
    path = [...path,e1]
    let e2 = extractFlex(q.arg[1])
    path = save
    let x = assignments.length
    assignments.push({ ...q, arg: [e1,e2], path, vars:[], dims:[], tmps: [] })
    return { key: "ref", op: x }
  } else if (q.key == "update") {
    let e0 = extract(q.arg[0])
    let e1 = extract(q.arg[1])
    let save = path
    path = [...path,e1]
    let e2 = extractFlex(q.arg[2])
    path = save
    let x = assignments.length
    assignments.push({ ...q, arg: [e0, e1,e2], path, vars:[], dims:[], tmps: [] })
    return { key: "ref", op: x }
  } else {
    console.error("unknown op", q)
  }
}


//
// XXX. Denotational: 
//    - try to make "infer" compositional!
//    - k: dims -> out, i.e. minimum we can produce -> what is observed

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
// 3. Infer dependencies bottom up: 
//    - vars: variables used
//    - mind: minimum set of variables in output (not removed through reductions)
//    - dims: desired set of variables in output
//

let infer = q => {
  //let recurse = q => 
  if (q.key == "input") {
    q.vars = []; //q.gens = []; 
    q.tmps = []
    q.mind = [] 
    q.dims = []
  } else if (q.key == "const") {
    q.vars = []; //q.gens = []; 
    q.tmps = []
    q.mind = []
    q.dims = []
  } else if (q.key == "var") {
    let syms = [q.op] 
    let tmps = [] //vars[q.op].tmps
    q.vars = [...syms]; //q.gens = []; 
    q.tmps = [...tmps]
    q.mind = [...syms]
    q.dims = [...syms]
  } else if (q.key == "ref") {
    // look up from assignments[q.op?]
    let e1 = assignments[q.op]
    infer(e1)
    q.vars = unique([...e1.vars])
    // q.vars = unique([...e1.vars,...e1.path.flatMap(x => x.vars)])
    // q.gens = [...e1.gens]
    q.tmps = unique([...e1.tmps,q.op])
    // q.tmps = unique([...e1.tmps,q.op,...e1.path.flatMap(x => x.tmps)])
    // q.deps = e1.deps
    q.mind = [...e1.mind]
    q.dims = [...e1.dims]
  } else if (q.key == "get") {
    let [e1,e2] = q.arg.map(infer)
    if (q.filter !== undefined) { // ref to a filter! lookup deps there?
      q.vars = unique([...e1.vars, ...e2.vars])
      // q.gens = unique([...e1.gens, ...e2.gens, q.filter])
      q.tmps = unique([...e1.tmps, ...e2.tmps])
      // q.deps = q.vars // ?
      q.mind = unique([...e1.mind, ...e2.mind])
      q.dims = unique([...e1.dims, ...e2.dims])
    } else if (e2.key == "var") { // filter itself
      q.vars = unique([...e1.vars])
      // q.gens = unique([...e1.gens])
      q.tmps = unique([...e1.tmps])
      // q.deps = unique([...e1.deps])
      q.mind = unique([...e1.mind])
      q.dims = unique([...e1.dims])
    } else { // not a var
      q.vars = unique([...e1.vars, ...e2.vars])
      // q.gens = unique([...e1.gens, ...e2.gens])
      q.tmps = unique([...e1.tmps, ...e2.tmps])
      // q.deps = unique([...e1.deps, ...e2.deps])
      q.mind = unique([...e1.mind, ...e2.mind])
      q.dims = unique([...e1.dims, ...e2.dims])
    }
  } else if (q.key == "pure") {
    let es = q.arg.map(infer)
    q.vars = unique(es.flatMap(x => x.vars))
    q.tmps = unique(es.flatMap(x => x.tmps))
    q.mind = unique(es.flatMap(x => x.mind))
    q.dims = unique(es.flatMap(x => x.dims))
  } else if (q.key == "stateful") {
    let [e1] = q.arg.map(infer)
    q.vars = e1.vars
    // q.gens = e1.gens
    q.tmps = e1.tmps
    // q.deps = e1.deps
    //
    // decorrelate -- important for correctness!
    q.path.map(infer)
    q.path = q.path.filter(x => intersect(x.vars,q.vars).length > 0)
    q.tmps = unique([...q.tmps,...q.path.flatMap(x => x.tmps)])
    //
    q.mind = []
    if (q.mode == "reluctant") { //console.log("!!!")
      q.dims = e1.dims
    } else {
      q.dims = [] // can always reduce to one elem
    }
  } else if (q.key == "group") {
    let [e1,e2] = q.arg.map(infer)
    q.vars = unique([...e1.vars, ...e2.vars])
    // q.gens = unique([...e1.gens, ...e2.gens])
    q.tmps = unique([...e1.tmps, ...e2.tmps])
    //
    // decorrelate -- important for correctness!
    q.path.map(infer)
    q.path = q.path.filter(x => intersect(x.vars,q.vars).length > 0)
    q.tmps = unique([...q.tmps,...q.path.flatMap(x => x.tmps)])
    //
    // q.deps = unique([...e1.deps, ...e2.deps])
    q.mind = unique([/*...e1.mind,*/ ...e2.mind])
    q.dims = unique([/*...e1.dims,*/ ...e2.dims])
  } else if (q.key == "update") {
    let [e0,e1,e2] = q.arg.map(infer)
    q.vars = unique([...e0.vars, ...e1.vars, ...e2.vars])
    // q.gens = unique([...e1.gens, ...e2.gens])
    q.tmps = unique([...e0.tmps, ...e1.tmps, ...e2.tmps])
    //
    // decorrelate -- important for correctness!
    q.path.map(infer)
    q.path = q.path.filter(x => intersect(x.vars,q.vars).length > 0)
    q.tmps = unique([...q.tmps,...q.path.flatMap(x => x.tmps)])
    //
    // q.deps = unique([...e1.deps, ...e2.deps])
    q.mind = unique([ /*...e1.mind,*/ ...e2.mind])
    q.dims = unique([ /*...e1.dims,*/ ...e2.dims])
  } else {
    console.error("unknown op", q)
  }
  //console.assert(subset(q.dims, q.deps))
  console.assert(subset(q.mind, q.dims))
  console.assert(subset(q.dims, q.vars))
  return q
}

//
// 4. Infer dependencies top down: 
//    - real: variables actually in output
//    - iter: iteration space to compute results
//      (for stms only)
//

let inferBwd = out => q => {
  if (q.key == "input") {
    // q.out = out; 
    q.real = q.dims
  } else if (q.key == "const") {
    // q.out = out; 
    q.real = q.dims
  } else if (q.key == "var") {
    q.out = out; 
    // we have transitive information -- include 
    // vars[q.op] if visible in out
    let syms = unique([q.op, ...vars[q.op].vars])
    syms = intersect(syms, q.out)
    q.real = syms // q.dims
  } else if (q.key == "ref") {
    let e1 = assignments[q.op]
    inferBwd(out)(e1)
    q.out = out; 
    q.real = e1.real
  } else if (q.key == "get") {
    // q.out = out; 
    // q.real = q.dims
    if (q.filter !== undefined) { // ref to a filter! lookup deps there?
      inferBwd(out)(filters[q.filter])
    }
    let [e1,e2] = q.arg.map(inferBwd(out))
    q.real = union(e1.real, e2.real)
  } else if (q.key == "pure") {
    // q.out = out; 
    let es = q.arg.map(inferBwd(out))
    q.real = unique(es.flatMap(x => x.real))
  } else if (q.key == "stateful") {
    q.out = out
    let out1 = union(out,q.arg[0].dims) // mind vs dim?
    if (q.mode == "reluctant")
      out1 = union(out,q.arg[0].mind) // mind vs dim?
    let [e1] = q.arg.map(inferBwd(out1))
    // q.iter = e1.real // iteration space (enough?)
    q.iter = unique([...e1.real, ...q.path.flatMap(x => x.real)])
    q.real = intersect(out, e1.real)
    // console.log("SUM", q.path, out, q.iter, q.real)
    // q.scope ??= diff(e1.real, q.real)
  } else if (q.key == "group") {
    q.out = out
    let e1 = inferBwd(q.arg[0].dims)(q.arg[0]) // ???
    // let out1 = union(out,q.arg[0].dims)
    let e2 = inferBwd(out)(q.arg[1])
    // q.iter = e1.real // iteration space (enough?)
    q.iter = unique([...e1.real, ...e2.real, ...q.path.flatMap(x => x.real)])
    q.real = e2.real
    // q.scope ??= diff(q.arg[0].real, q.real)
    // console.log("GRP",q.arg[1].real, q.real)
  } else if (q.key == "update") {
    q.out = out
    let e0 = inferBwd(out)(q.arg[0]) // ???  !!!!
    let e1 = inferBwd(q.arg[1].dims)(q.arg[1]) // ???
    let e2 = inferBwd(out)(q.arg[2])
    // q.iter = e1.real // iteration space (enough?)
    q.iter = unique([...e1.real, ...e2.real, ...q.path.flatMap(x => x.real)])
    q.real = e2.real
    // q.scope ??= diff(q.arg[1].real, q.real)
    // console.log("GRP",q.arg[1].real, q.real)
  } else {
    console.error("unknown op", q)
  }
  console.assert(subset(q.dims, q.vars))
  console.assert(subset(q.mind, q.real), "mind < real") // can happen for lazy 'last'
  // if (q.mode != "reluctant")
    // console.assert(subset(q.dims, q.real)) // can happen for lazy 'last'
  if (q.iter)
    console.assert(subset(q.real, q.iter))
  // console.assert(subset(q.dims, q.deps))
  // console.assert(subset(q.dims, q.real))
  // console.assert(subset(q.real, q.out))
  return q
}

//
// 5a. Pretty print
//

let pretty = q => {
  if (q.key == "input") {
    return "inp"
  } else if (q.key == "const") {
    return ""+q.op
  } else if (q.key == "var") {
    return q.op
  } else if (q.key == "ref") {
    let e1 = assignments[q.op]
    return "tmp"+q.op//+e1.path.map(pretty).map(quoteIndex)
  } else if (q.key == "get") {
    let [e1,e2] = q.arg.map(pretty)
    if (e1 == "inp") return e2
    if (q.arg[1].key == "var") {
      if (q.filter === undefined) // def
        return e2 + " <- " + e1
    }
    return e1+"["+e2+"]"
  } else if (q.key == "pure") {
    let es = q.arg.map(pretty)
    return q.op + "(" + es.join(", ") + ")"
  } else if (q.key == "stateful") {
    let [e1] = q.arg.map(pretty)
    return q.op+"("+e1+")"
  } else if (q.key == "group") {
    let [e1,e2] = q.arg.map(pretty)
    return "{ "+ e1 + ": " + e2 + " }"
  } else if (q.key == "update") {
    let [e0,e1,e2] = q.arg.map(pretty)
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
      buf.push("  " + q.vars)
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
    buf.push("tmp"+i + " = " + pretty(q))
    if (q.vars.length > 0) 
      buf.push("  var: " + q.vars)
    if (q.tmps.length > 0) 
      buf.push("  tmp: " + q.tmps)
    if (q.path.length > 0) 
      buf.push("  pth: " + q.path.map(pretty))
    if (q.mind.length > 0)  
      buf.push("  min: " + q.mind)
    if (q.dims.length > 0)  
      buf.push("  dim: " + q.dims)
    if (q.out && q.out.length > 0)  
      buf.push("  out: " + q.out)
    if (q.real?.length > 0)  
      buf.push("  rel: " + q.real)
    if (q.scope?.length > 0) 
      buf.push("  scp: " + q.scope)
    if (q.iter?.length > 0) 
      buf.push("  itr: " + q.iter)
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
    else
      return String(q.op)
  } else if (q.key == "var") {
    return quoteVar(q.op)
  } else if (q.key == "ref") {
    let q1 = assignments[q.op]
    let xs = [String(q.op),...q1.path.map(codegen),...q1.real]
    return quoteIndexVars("tmp", xs)
  } else if (q.key == "get") {
    let [e1,e2] = q.arg.map(codegen)
    return e1+quoteIndex(e2)
  } else if (q.key == "pure") {
    let es = q.arg.map(codegen)
    return "rt.pure."+q.op+"("+es.join(",")+")"
  } else {
    console.error("unknown op", q)
  }
}


let emitStm = (q) => {
  if (q.key == "stateful") {    
    let [e1] = q.arg.map(codegen)
    // return lhs+" += "+e1
    return "rt.stateful."+q.op+"("+e1+")"
  } else if (q.key == "group") {
    let [e1,e2] = q.arg.map(codegen)
    // return lhs+"["+e1+"] = "+e2
    return "rt.stateful.group("+e1+", "+e2+")"
  } else if (q.key == "update") {
    let [e0,e1,e2] = q.arg.map(codegen)
    // return lhs+"["+e1+"] = "+e2
    return "rt.stateful.update("+e0+", "+e1+", "+e2+")"
  } else {
    console.error("unknown op", q)
  }
}

let emitFilters = (real) => buf => {
  let vv = vars 
  {
  let vars = {}
  let seen = {}
  for (let v of real) vars[v] = true
  // filters
  let buf0 = []
  let buf1 = []
  for (let i in filters) {
    let f = filters[i]
    let v1 = f.arg[1].op
    let g1 = f.arg[0]
    if (vars[v1]) {
      let notseen = g1.vars.filter(x => !seen[x]) // unavailable deps?
      if (notseen.length == 0) { // ok, just emit current
        if (!seen[v1]) {
          buf1.push("for (let "+quoteVar(v1)+" in "+codegen(g1)+")")
        } else {
          buf1.push("if ("+quoteVar(v1)+" in "+codegen(g1)+")")
        }
      } else {
        // XXX bit of a hack right now: our generator/filter for v1
        // is dependent on (at least) one other variable v2 that
        // is not part of the current iteration space. Solution:
        // run this generator separately and reify into a
        // datastructure. This needs to happen before the main
        // loop, hence separate output buffers.
        //
        // TODO: it would be much cleaner to extract this into a 
        // proper assignment statement
        //
        console.assert(intersect(notseen, real).length == 0) // We're eliminating
        // iteration over this variable, so gotta make sure we weren't
        // planning to iterate over it later in the sequence.
        // XXX: this is brittle. Much better to start with 'real', and
        // determine iteration order accordingly.

        for (let v2 of notseen) {
          if (buf.indexOf("let gen"+i+quoteVar(v2)+" = {}") < 0) {
            buf0.push("// pre-gen "+v2)
            buf0.push("let gen"+i+quoteVar(v2)+" = {}")
            emitFilters(g1.real)(buf0)
            buf0.push("for (let "+quoteVar(v1)+" in "+codegen(g1)+")")
            buf0.push("  gen"+i+quoteVar(v2)+"["+quoteVar(v1)+"] = true //"+codegen(g1)+"?.["+quoteVar(v1)+"]")
            // with the aux data structure in place, we're ready to
            // proceed with the main loop nest:
          } else
            buf0.push("// skip gen"+i+quoteVar(v2))

          if (!seen[v1])
            buf1.push("for (let "+quoteVar(v1)+" in gen"+i+quoteVar(v2)+")")
          else
            buf1.push("if ("+quoteVar(v1)+" in gen"+i+quoteVar(v2)+")")
          seen[v1] = true
        }
      }
      seen[v1] = true
    }
  }
  buf.push(...buf0)
  if (buf0.length > 0) buf.push("// main loop")
  buf.push(...buf1)}
}


let emitCode = (q, order) => {
  let buf = []
  buf.push("(inp => k => {")
  buf.push("let tmp = {}")


  for (let is of order) {
    if (is.length > 1)
      console.error("cycle")
    let [i] = is
    let q = assignments[i]
    
    // NOTE: it would be preferable to emit initialization up front (so that sum empty = 0)

    buf.push("// --- tmp"+i+" ---")
    // buf.push("{")
    emitFilters(q.iter)(buf)

    // no longer an issue with "order"
    // if (q.tmps.some(x => x > i))
    //  console.error("wrong order", i, q)
    if (q.tmps.some(x => x == i))
      console.error("cycle")

    let xs = [i,...q.path.map(codegen),...q.real.map(quoteVar)]
    let ys = xs.map(x => ","+x).join("")

    buf.push("  rt.update(tmp"+ys+")\n  ("+ emitStm(q) + ")")

    // buf.push("}")
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
  flag = false, 
  singleResult = false
}={}) => {

  reset()

  // 1. Preprocess
  q = preproc(q)
  let src = q

  if (flag) {
    console.log(q)
    let q0 = JSON.parse(JSON.stringify(q))
    let q1 = deno(q0)(x => {
      let y = { out: x.dims }
      console.log("K:", x, "->", y)
      return y
    })
    console.log("RES:",q1)
  }


  // if (singleResult)
    // q = smartlast(q)


  // 2. Extract
  q = extract(q)

  // 3a. Infer dependencies bottom up
  for (let i in filters) {
    infer(filters[i])
  }
  infer(q) // goes into assignments but not filters


  let pseudo0 = emitPseudo(q)


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
    for (let w of f.vars) deps.var2var[v][w] = true
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

  let order = scc(Object.keys(deps2.tmp2tmp), x => Object.keys(deps2.tmp2tmp[x])).reverse()

  // order = [[0],[1],[2],[3],[4]]

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


  // inject transitive closure info so "infer" will pick it up

  for (let i in deps.var2var) {
    // console.log(i, transdeps.var2var[i])
    vars[i].vars = Object.keys(transdeps.var2var[i])
    vars[i].tmps = Object.keys(transdeps.var2tmp[i]).map(Number)
  }


  // 4. Backward pass to infer output dimensions
  if (singleResult) {
    console.assert(q.mind.length == 0)
    inferBwd(q.mind)(q)
  } else
    inferBwd(q.dims)(q)



  // sanity checks
  // for (let i in assignments) {
  //   let q = assignments[i]
  //   let v1 = q.real
  //   let v2 = Object.keys(transdeps.tmp2var[i])
  //   let t1 = q.tmps
  //   let t2 = Object.keys(transdeps.tmp2tmp[i])
  //   if (!same(v1,v2) || !same(t1,t2)) {
  //     console.error("MISMATCH",i,{real:v1,closure:v2, tmp:t1, tmptrans:t2})
  //   }
  //   // console.assert(same(q.real, Object.keys(transdeps.tmp2var[i])), {a1, a2})
  // }

  // 5a. Pretty print (debug out)

  let pseudo = emitPseudo(q)


  // 5b. Codegen

  let code = emitCode(q,order)

  // console.log(code)

  let rt = runtime // make available in scope for generated code
  let func = eval(code)

  let wrap = (input,fullpath) => {
    if (fullpath) {
      let res
      // func(input)((x,...path) => res.push([...path,x]))// update(res)(...path)(x))
      func(input)((x,...path) => res = update(res)(path)(x))
      return res
    } else {
      let res = []
      func(input)((x,...path) => res.push(x))
      return res
    }
  }

  wrap.explain = { 
    src,
    ir: {filters, assignments, vars, deps, transdeps, order}, 
    pseudo0, pseudo, code 
  }
  return wrap
}


exports.compile = compile

