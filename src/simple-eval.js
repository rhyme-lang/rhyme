const { api, pipe } = require('./rhyme')
const { rh, parse } = require('./parser')
const { scc } = require('./scc')

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




let path

let vars
let filters
let assignments

let reset = () => {
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
  if (q.xxpath == "raw") {
    if (q.xxparam == "inp") return { key: "input" }
    else return { key: "const", arg: q.xxparam }
  } else if (q.xxpath == "ident") {
    if (isVar(q.xxparam)) return { key: "var", arg: q.xxparam }
    else return { key: "const", arg: q.xxparam }
  } else if (q.xxpath == "get") {
    let [e1,e2] = q.xxparam.map(preproc)
    return { key: "get", arg: [e1,e2] }
  } else if (q.xxpath == "plus") {
    let [e1,e2] = q.xxparam.map(preproc)
    return { key: "plus", arg: [e1,e2] }
  } else if (q.xxpath == "times") {
    let [e1,e2] = q.xxparam.map(preproc)
    return { key: "times", arg: [e1,e2] }
  } else if (q.xxkey == "sum") {
    let e1 = preproc(q.xxparam)
    return { key: "sum", arg: e1 }
  } else if (q.xxpath == "apply") {
    let [e1,...es2] = q.xxparam.map(preproc)
    console.assert(e1.key == "const", e1.key)
    // if 'update .. ident ..', convert ident to input ref?
    return { key: e1.arg, arg: es2 }
  } else if (typeof(q) === "object" && !q.xxpath && !q.xxkey) {
    console.assert(Object.keys(q).length == 1)
    let k = Object.keys(q)[0]
    let v = q[k]
    let e1 = preproc(parse(k))
    let e2 = preproc(v)
    let q1 = { key: "group", arg: [e1,e2] }
    return q1
  } else {
    console.error("unknown op", q)
  }
}


//
// 2. Extract: 
//    - all data.*A operations into 'filters'
//    - sum, group operations into 'assignments'
//

let extract = q => {
  if (q.key == "input") {
    return q
  } else if (q.key == "const") {
    return q
  } else if (q.key == "var") {
    vars[q.arg] ??= { vars: [], tmps: [] }
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
  } else if (q.key == "plus") {
    let [e1,e2] = q.arg.map(extract)
    return { ...q, arg: [e1,e2] }
  } else if (q.key == "times") {
    let [e1,e2] = q.arg.map(extract)
    return { arg: [e1,e2], ...q }
  } else if (q.key == "sum") {
    let e1 = extract(q.arg)
    let x = assignments.length
    assignments.push({ ...q, arg: e1, path, vars:[], dims:[], tmps: [] }) // cycles?
    return { key: "ref", arg: x }
  } else if (q.key == "group") {
    let e1 = extract(q.arg[0])
    let save = path
    path = [...path,e1]
    let e2 = extract(q.arg[1])
    path = save
    let x = assignments.length
    assignments.push({ ...q, arg: [e1,e2], path, vars:[], dims:[], tmps: [] })
    return { key: "ref", arg: x }
  } else if (q.key == "update") {
    let e0 = extract(q.arg[0])
    let e1 = extract(q.arg[1])
    let save = path
    path = [...path,e1]
    let e2 = extract(q.arg[2])
    path = save
    let x = assignments.length
    assignments.push({ ...q, arg: [e0, e1,e2], path, vars:[], dims:[], tmps: [] })
    return { key: "ref", arg: x }
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
    let {out} = k({vars:[q.arg],dims:[q.arg]})
    q.real = [q.arg]
    return pretty(q)
  } else if (q.key == "get") {
    q.filter = 1
    let [e1,e2] = q.arg
    let r1 = deno(e1)(v1 => {
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
  } else if (q.key == "plus") {
    let [e1,e2] = q.arg
    let r1 = deno(e1)(v1 => {
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
/*  } else if (q.key == "times") {
    let [e1,e2] = q.arg.map(extract)
    return { arg: [e1,e2], ...q }*/
  } else if (q.key == "sum") {
    let e1 = q.arg
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
//    - dims: minimum set of variables in output (not removed through reductions)
//
// Run in a fixpoint as var->var dependencies grow
//

let infer = q => {
  //let recurse = q => 
  if (q.key == "input") {
    q.vars = []; //q.gens = []; 
    q.tmps = []
    /*q.deps = [];*/ q.dims = []
  } else if (q.key == "const") {
    q.vars = []; //q.gens = []; 
    q.tmps = []
    /*q.deps = [];*/ q.dims = []
  } else if (q.key == "var") {
    let syms = [q.arg] 
    let tmps = [] //vars[q.arg].tmps
    q.vars = [...syms]; //q.gens = []; 
    q.tmps = [...tmps]
    /*q.deps = [...syms];*/ 
    q.dims = [...syms]
  } else if (q.key == "ref") {
    // look up from assignments[q.arg?]
    let e1 = assignments[q.arg]
    infer(e1)
    q.vars = [...e1.vars]
    // q.gens = [...e1.gens]
    q.tmps = unique([...e1.tmps,q.arg])
    // q.deps = e1.deps
    q.dims = [...e1.dims]
  } else if (q.key == "get") {
    let [e1,e2] = q.arg.map(infer)
    if (q.filter !== undefined) { // ref to a filter! lookup deps there?
      q.vars = unique([...e1.vars, ...e2.vars])
      // q.gens = unique([...e1.gens, ...e2.gens, q.filter])
      q.tmps = unique([...e1.tmps, ...e2.tmps])
      // q.deps = q.vars // ?
      q.dims = unique([...e1.dims, ...e2.dims])
    } else if (e2.key == "var") { // filter itself
      q.vars = unique([...e1.vars])
      // q.gens = unique([...e1.gens])
      q.tmps = unique([...e1.tmps])
      // q.deps = unique([...e1.deps])
      q.dims = unique([...e1.dims])
    } else { // not a var
      q.vars = unique([...e1.vars, ...e2.vars])
      // q.gens = unique([...e1.gens, ...e2.gens])
      q.tmps = unique([...e1.tmps, ...e2.tmps])
      // q.deps = unique([...e1.deps, ...e2.deps])
      q.dims = unique([...e1.dims, ...e2.dims])
    }
  } else if (q.key == "plus") {
    let [e1,e2] = q.arg.map(infer)
    q.vars = unique([...e1.vars, ...e2.vars])
    // q.gens = unique([...e1.gens, ...e2.gens])
    q.tmps = unique([...e1.tmps, ...e2.tmps])
    // q.deps = unique([...e1.deps, ...e2.deps])
    q.dims = unique([...e1.dims, ...e2.dims])
  } else if (q.key == "times") {
    let [e1,e2] = q.arg.map(infer)
    q.vars = unique([...e1.vars, ...e2.vars])
    // q.gens = unique([...e1.gens, ...e2.gens])
    q.tmps = unique([...e1.tmps, ...e2.tmps])
    // q.deps = unique([...e1.deps, ...e2.deps])
    q.dims = unique([...e1.dims, ...e2.dims])
  } else if (q.key == "sum") {
    let e1 = infer(q.arg)
    q.vars = e1.vars
    // q.gens = e1.gens
    q.tmps = e1.tmps
    // q.deps = e1.deps
    q.dims = [] // can always reduce to one elem
  } else if (q.key == "group") {
    let [e1,e2] = q.arg.map(infer)
    q.vars = unique([...e1.vars, ...e2.vars])
    // q.gens = unique([...e1.gens, ...e2.gens])
    q.tmps = unique([...e1.tmps, ...e2.tmps])
    // q.deps = unique([...e1.deps, ...e2.deps])
    q.dims = unique([/*...e1.dims,*/ ...e2.dims])
  } else if (q.key == "update") {
    let [e0,e1,e2] = q.arg.map(infer)
    q.vars = unique([...e0.vars, ...e1.vars, ...e2.vars])
    // q.gens = unique([...e1.gens, ...e2.gens])
    q.tmps = unique([...e0.tmps, ...e1.tmps, ...e2.tmps])
    // q.deps = unique([...e1.deps, ...e2.deps])
    q.dims = unique([ /*...e1.dims,*/ ...e2.dims])
  } else {
    console.error("unknown op", q)
  }
  //console.assert(subset(q.dims, q.deps))
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
    // vars[q.arg] if visible in out
    let syms = unique([q.arg, ...vars[q.arg].vars])
    syms = intersect(syms, q.out)
    q.real = syms // q.dims
  } else if (q.key == "ref") {
    let e1 = assignments[q.arg]
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
  } else if (q.key == "plus") {
    // q.out = out; 
    let [e1,e2] = q.arg.map(inferBwd(out))
    q.real = union(e1.real, e2.real)
  } else if (q.key == "times") {
    // q.out = out; 
    let [e1,e2] = q.arg.map(inferBwd(out))
    q.real = union(e1.real, e2.real)
  } else if (q.key == "sum") {
    q.out = out
    let out1 = out//intersect(out, q.vars) // preserve all vars visible outside
    let out2 = union(out1,q.arg.dims)
    let e1 = inferBwd(out2)(q.arg)
    q.iter = q.arg.real // iteration space (enough?)
    q.real = intersect(out, q.arg.real)
    q.scope ??= diff(q.arg.real, q.real)
  } else if (q.key == "group") {
    q.out = out
    let e1 = inferBwd(q.arg[0].dims)(q.arg[0]) // ???
    let e2 = inferBwd(out)(q.arg[1])
    q.iter = q.arg[0].real // iteration space (enough?)
    q.real = q.arg[1].real
    q.scope ??= diff(q.arg[0].real, q.real)
    // console.log("GRP",q.arg[1].real, q.real)
  } else if (q.key == "update") {
    q.out = out
    let e0 = inferBwd(out)(q.arg[0]) // ???  !!!!
    let e1 = inferBwd(q.arg[1].dims)(q.arg[1]) // ???
    let e2 = inferBwd(out)(q.arg[2])
    q.iter = q.arg[1].real // iteration space (enough?)
    q.real = q.arg[2].real
    q.scope ??= diff(q.arg[1].real, q.real)
    // console.log("GRP",q.arg[1].real, q.real)
  } else {
    console.error("unknown op", q)
  }
  console.assert(subset(q.dims, q.vars))
  console.assert(subset(q.dims, q.real))
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
    return ""+q.arg
  } else if (q.key == "var") {
    return q.arg
  } else if (q.key == "ref") {
    let e1 = assignments[q.arg]
    return "tmp"+q.arg//+e1.path.map(pretty).map(quoteIndex)
  } else if (q.key == "get") {
    let [e1,e2] = q.arg.map(pretty)
    if (e1 == "inp") return e2
    if (q.arg[1].key == "var") {
      if (q.filter === undefined) // def
        return e2 + " <- " + e1
    }
    return e1+"["+e2+"]"
  } else if (q.key == "plus") {
    let [e1,e2] = q.arg.map(pretty)
    return e1 + " + " + e2
  } else if (q.key == "times") {
    let [e1,e2] = q.arg.map(pretty)
    return e1 + " * " + e2
  } else if (q.key == "sum") {
    let e1 = pretty(q.arg)
    return "sum("+e1+")"
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
      buf.push(v + " -> " + vars[v].vars + vars[v].tmps)
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
    if (q.dims.length > 0)  
      buf.push("  dim: " + q.dims)
    if (q.real?.length > 0)  
      buf.push("  rel: " + q.real)
    if (q.scope?.length > 0) 
      buf.push("  scp: " + q.scope)
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
    return "'"+q.arg+"'"
  } else if (q.key == "var") {
    return quoteVar(q.arg)
  } else if (q.key == "ref") {
    let q1 = assignments[q.arg]
    let xs = [String(q.arg),...q1.path.map(codegen),...q1.real]
    return quoteIndexVars("tmp", xs)
  } else if (q.key == "get") {
    let [e1,e2] = q.arg.map(codegen)
    return e1+quoteIndex(e2)
  } else if (q.key == "plus") {
    let [e1,e2] = q.arg.map(codegen)
    return "rt.plus("+e1+", "+e2+")"
  } else if (q.key == "times") {
    let [e1,e2] = q.arg.map(codegen)
    return "rt.times("+e1+", "+e2+")"
  } else {
    console.error("unknown op", q)
  }
}


let emitStm = (q) => {
  if (q.key == "sum") {    
    let e1 = codegen(q.arg)
    // return lhs+" += "+e1
    return "rt.sum("+e1+")"
  } else if (q.key == "group") {
    let [e1,e2] = q.arg.map(codegen)
    // return lhs+"["+e1+"] = "+e2
    return "rt.group("+e1+", "+e2+")"
  } else if (q.key == "update") {
    let [e0,e1,e2] = q.arg.map(codegen)
    // return lhs+"["+e1+"] = "+e2
    return "rt.updateReducer("+e0+", "+e1+", "+e2+")"
  } else {
    console.error("unknown op", q)
  }
}

let emitFilters = (real,out=[]) => buf => {
  let vars = {}
  let seen = {}
  for (let v of real) vars[v] = true
  // filters
  let buf0 = []
  let buf1 = []
  for (let i in filters) {
    let f = filters[i]
    let v1 = f.arg[1].arg
    let g1 = f.arg[0]
    if (vars[v1]) {
      if (!seen[v1]) {
        // TODO: check unavailable deps here as well?
        buf1.push("for (let "+quoteVar(v1)+" in "+codegen(g1)+")")
        seen[v1] = true
      } else {
        let notseen = g1.vars.filter(x => !seen[x])
        if (notseen.length == 0) {
          buf1.push("if ("+quoteVar(v1)+" in "+codegen(g1)+")")
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
          console.assert(notseen.length == 1) // for now only one
          let [v2] = notseen
          buf0.push("// pre-gen "+v2)
          buf0.push("let gen"+i+quoteVar(v2)+" = {}")
          emitFilters([v2])(buf0)
          buf0.push("for (let "+quoteVar(v1)+" in "+codegen(g1)+")")
          buf0.push("  gen"+i+quoteVar(v2)+"["+quoteVar(v1)+"] = true //"+codegen(g1)+"?.["+quoteVar(v1)+"]")
          // with the aux data structure in pace, we're ready to
          // proceed with the main loop nest:
          buf1.push("if ("+quoteVar(v1)+" in gen"+i+quoteVar(v2)+")")
        }
      }
    }
  }
  buf.push(...buf0)
  if (buf0.length > 0) buf.push("// main loop")
  buf.push(...buf1)
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
    emitFilters(q.iter, q.out)(buf)

    // no longer an issue with "order"
    // if (q.tmps.some(x => x > i))
    //  console.error("wrong order", i, q)
    if (q.tmps.some(x => x == i))
      console.error("cycle")

    let xs = [i,...q.path.map(codegen),...q.real.map(quoteVar)]
    let ys = xs.map(x => ","+x).join("")

    buf.push("  rt.update(tmp"+ys+")("+ emitStm(q) + ")")

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






// runtime support

let rt = {}

rt.plus = (x1,x2) => {
  if (x1 === undefined) return undefined
  if (x2 === undefined) return undefined
  return Number(x1) + Number(x2)
}

rt.times = (x1,x2) => {
  if (x1 === undefined) return undefined
  if (x2 === undefined) return undefined
  return Number(x1) * Number(x2)
}

rt.update = (root,...path) => (fold) => {
  let obj = root
  let c = 0
  for (let ix of path.slice(0,path.length-1)) {
    if (ix === undefined) return
    obj[ix] ??= {}
    obj = obj[ix]
  }

  let ix = path[path.length-1]
  obj[ix] ??= fold.init()

  obj[ix] = fold.next(obj[ix])
}

rt.sum = x => ({
  init: () => 0,
  next: s => {
    if (x === undefined) return s
    return s + x
  }
})

rt.group = (x1,x2) => ({
  init: () => ({}),
  next: s => { 
    if (x1 === undefined) return s
    if (x2 === undefined) return s
    s[x1] = x2
    return s
  }
})

rt.updateReducer = (x0,x1,x2) => ({
  init: () => ({...x0}),
  next: s => { 
    if (x1 === undefined) return s
    if (x2 === undefined) return s
    s[x1] = x2
    return s
  }
})



let compile = (q,flag) => {
  reset()

  // 1. Preprocess
  q = preproc(q)

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
    let v = f.arg[1].arg // var name
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

  wrap.explain = { ir: {filters, assignments, vars, deps, transdeps, order}, pseudo0, pseudo, code }
  return wrap
}


exports.compile = compile

