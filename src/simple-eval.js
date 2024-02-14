const { api, pipe } = require('./rhyme')
const { rh, parse } = require('./parser')



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
    let syms = unique([q.arg, ...vars[q.arg].vars])
    let tmps = vars[q.arg].tmps
    q.vars = [...syms]; //q.gens = []; 
    q.tmps = [...tmps]
    /*q.deps = [...syms];*/ 
    q.dims = [...syms]
  } else if (q.key == "ref") {
    // look up from assignments[q.arg?]
    let e1 = assignments[q.arg]
    q.vars = [...e1.vars]
    // q.gens = [...e1.gens]
    q.tmps = unique([...e1.tmps,q.arg])
    // q.deps = e1.deps
    q.dims = e1.dims
  } else if (q.key == "get") {
    let [e1,e2] = q.arg.map(infer)
    if (q.filter !== undefined) { // ref to a filter! lookup deps there?
      q.vars = unique([...e1.vars, ...e2.vars])
      // q.gens = unique([...e1.gens, ...e2.gens, q.filter])
      q.tmps = unique([...e1.tmps, ...e2.tmps])
      // q.deps = q.vars // ?
      q.dims = q.vars // ?
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

let inferOut = out => q => {
  if (q.key == "input") {
    // q.out = out; 
    q.real = q.dims
  } else if (q.key == "const") {
    // q.out = out; 
    q.real = q.dims
  } else if (q.key == "var") {
    // q.out = out; 
    q.real = q.dims
  } else if (q.key == "ref") {
    let i = q.arg
    assignments[i].out = out
    // q.out = out; 
    q.real = q.dims
  } else if (q.key == "get") {
    // q.out = out; 
    q.real = q.dims
    q.arg.map(inferOut(out))
  } else if (q.key == "plus") {
    // q.out = out; 
    q.real = q.dims
    q.arg.map(inferOut(out))
  } else if (q.key == "times") {
    // q.out = out; 
    q.real = q.dims
    q.arg.map(inferOut(out))
  } else if (q.key == "sum") {
    // q.out = out
    q.real = intersect(out, q.vars) // preserve all vars visible outside
    let e1 = inferOut(union(q.real,q.arg.dims))(q.arg)
    q.iter = q.arg.real // iteration space (enough?)
  } else if (q.key == "group") {
    // q.out = out
    q.real = q.dims
    let e1 = inferOut(q.arg[0].dims)(q.arg[0]) // ???
    let e2 = inferOut(out)(q.arg[1])
    q.iter = q.arg[0].real // iteration space (enough?)
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
    if (q.tmps.length > 0) 
      buf.push("  " + q.tmps)
    if (q.path.length > 0) 
      buf.push("  " + q.path.map(pretty))
    if (q.real.length > 0)  
      buf.push("  " + q.real)
  }
  buf.push(pretty(q))
  if (q.real.length > 0)  
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
  } else {
    console.error("unknown op", q)
  }
}

let emitFilters = real => buf => {
  let vars = {}
  let seen = {}
  for (let v of real) vars[v] = true
  // filters
  for (let f of filters) {
    let v1 = f.arg[1].arg
    let g1 = f.arg[0]
    if (vars[v1]) {
      if (!seen[v1]) {
        buf.push("for (let "+quoteVar(v1)+" in "+codegen(g1)+")")
        seen[v1] = true
      } else {
        buf.push("if ("+quoteVar(v1)+" in "+codegen(g1)+")")
      }
    }
  }
}


let emitCode = (q) => {
  let buf = []
  buf.push("(inp => k => {")
  buf.push("let tmp = {}")


  for (let i in assignments) {
    let q = assignments[i]
    
    // NOTE: it would be preferable to emit initialization up front (so that sum empty = 0)

    buf.push("// --- tmp"+i+" ---")
    emitFilters(q.iter)(buf)

    if (q.tmps.some(x => x > i))
      console.error("wrong order", i, q)
    if (q.tmps.some(x => x == i))
      console.error("cycle")

    let xs = [i,...q.path.map(codegen),...q.real.map(quoteVar)]
    let ys = xs.map(x => ","+x).join("")

    buf.push("  rt.update(tmp"+ys+")("+ emitStm(q) + ")")

    // buf.push("}")
  }

  buf.push("// --- res ---")
  emitFilters(q.real)(buf)
  buf.push("k("+codegen(q)+")")
  buf.push("})")

  return buf.join("\n")
}






// runtime support

let rt = {}

rt.plus = (x1,x2) => {
  return Number(x1) + Number(x2)
}

rt.times = (x1,x2) => {
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
    s[x1] = x2
    return s
  }
})




let compile = q => {
  reset()

  // 1. Preprocess
  q = preproc(q)

  // 2. Extract
  q = extract(q)

  // 3a. Infer dependencies bottom up
  for (let i in filters) {
    infer(filters[i])
  }
  for (let i in assignments) {
    infer(assignments[i])
  }
  infer(q)


  // XXX how do we know we're converged???
  // We don't want to update 'filters' based
  // on vars, so a single pass is enough
  // (no new info from filters)

  for (let i in filters) {
    let f = filters[i]
    let v = f.arg[1].arg // var name
    vars[v].vars.push(...f.vars)
    vars[v].tmps.push(...f.tmps)
  }

  // TODO but we want to make sure vars and
  // assignments have full information
  // -- need to iterate on vars[v].vars/tmps?


  // 3b. Run infer again on assignments (XXX convergence?) 

  for (let i in assignments) {
    infer(assignments[i])
  }
  infer(q)


  // 4. Top down dependencies, infer output dimension
  inferOut(q.dims)(q)
  for (let i = assignments.length-1; i >= 0; i--) {
    inferOut(assignments[i].out)(assignments[i])
  }


  // 5a. Pretty print (debug out)

  let pseudo = emitPseudo(q)


  // 5b. Codegen

  let code = emitCode(q)  

  let func = eval(code)

  let wrap = input => {
    let res = []
    func(input)(x => res.push(x))
    return res
  }

  wrap.explain = { ir: {filters, assignments, vars}, pseudo, code }
  return wrap
}


exports.compile = compile



