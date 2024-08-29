const { api } = require('./rhyme')
const { parse } = require('./parser')
const { scc } = require('./scc')
const { runtime } = require('./simple-runtime')


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


// ----- auxiliary state -----

let prefixes      // canonicalize * for every prefix, e.g., data.* (preproc)

let filters

let reset = () => {
  prefixes = []
  filters = []
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
    else if (op.startsWith("prefix_") && op.substring(7) in runtime.stateful)
      return { key: "prefix", op: op.substring(7), arg: es2 }
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
  if (q.key == "stateful" || q.key == "group" || q.key == "update") // prefix?
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
  } else if (q.key == "stateful" || q.key == "prefix") {
    let [e1] = q.arg.map(infer)

    // NOTE: wo do not include vars/tmps/dims information from path,
    // only from e1. What is the rationale for this?

    // In short: we want to decorrelate paths but we don't have enough
    // information yet. Specifically, transitive var dependencies are
    // only available after infer.

    q.vars = e1.vars
    q.mind = [] // can always reduce to one elem
    if (q.mode == "reluctant") {
      q.dims = e1.dims // but prefer not to
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
//    - free: free variables, anticipating conversion to loops
//    - bound: bound variables, anticipating conversion to loops (allBound: incl deep in subterms)
//    - (iter: iteration space for stms (= free + bound))
//
//    Decorrelate paths and eliminate trivial recursion
//

let trans = ps => unique([...ps,...ps.flatMap(x => vars[x].vars)])

let intersects = (a,b) => intersect(a,b).length > 0

let overlaps = (a,b) => intersects(trans(a),trans(b))

let assertSame = (a,b,msg) => console.assert(same(a,b), msg+": "+a+" != "+b)


// infer bound vars (simple mode)
let inferBwd0 = out => q => {
  if (q.key == "input" || q.key == "const") {
    q.bnd = []
    q.allBnd = []
  } else if (q.key == "var") {
    q.bnd = []
    q.allBnd = []
  } else if (q.key == "get" || q.key == "pure" || q.key == "mkset") {
    let es = q.arg.map(inferBwd0(out))
    q.bnd = []
    q.allBnd = unique(es.flatMap(x => x.allBnd))
  } else if (q.key == "stateful" || q.key == "prefix") {
    let out1 = union(out,q.arg[0].dims) // need to consider mode?
    let [e1] = q.arg.map(inferBwd0(out1))

    q.bnd = diff(e1.dims, out)
    q.allBnd = union(q.bnd, e1.allBnd)
  } else if (q.key == "update") {
    let e0 = inferBwd0(out)(q.arg[0]) // what are we extending
    let e1 = inferBwd0(out)(q.arg[1]) // key variable

    let e1Body
    if (q.arg[3]) {
      let out3 = union(out, union([e1.op], q.arg[3].dims)) // e3 includes e1.op (union left for clarity)
      let e3 = inferBwd0(out3)(q.arg[3]) // filter expr
      console.assert(e3.key == "get")
      console.assert(e3.arg[0].key == "mkset")
      console.assert(e3.arg[1].key == "var" && e3.arg[1].op == e1.op)
      e1Body = e3.arg[0].arg[0]
    } else {
      e1Body = { key: "const", op: "???", 
        vars: [], mind: [], dims: [], bnd: [], allBnd: [] }
    }

    q.e1BodyBnd = diff(e1Body.dims, out)

    let e2 = inferBwd0(union(out, [e1.op]))(q.arg[2])

    q.bnd = diff(union([e1.op], e1Body.dims), out)
    q.allBnd = unique([...q.bnd, ...e0.allBnd, ...e1.allBnd, ...e2.allBnd, ...e1Body.allBnd])

  } else {
    console.error("unknown op", q)
  }

  console.assert(subset(q.mind, q.dims))
  console.assert(subset(q.dims, q.vars))

  return q
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


let emitPseudo = (q) => {
  let buf = []
  for (let i in filters) {
    let q = filters[i]
    buf.push("gen"+i + ": " + pretty(q))
    if (q.vars.length)
      buf.push("  " + q.vars + " / " + q.dims)
  }
  buf.push("")
  buf.push(pretty(q))
  if (q.fre?.length > 0)  
    buf.push("  " + q.fre)
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




let fixIndent = s => {
  let lines = s.split("\n")
  let out = []
  let indent = 0
  for (let str of lines) {
    if (str.trim() == "") continue
    if (str.indexOf("}") == 0) indent--
    out.push("".padEnd(indent * 4, ' ') + str.trim())
    if (str.indexOf("{") >= 0) indent++
    if (str.indexOf("}") > 0) indent--
  }
  return out.join("\n")
}



// XX TODO: do this more like computeDependencies (precompute bulk)
let transViaFiltersDimsC = iter => {
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
        for (v2 of g1.dims) {
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



let emitFiltersC1 = (iter, scope) => (buf, codegen) => body => {
  // approach: build explicit projection first
  // 1. iterate over transitive iter space to
  //    build projection map
  // 2. iterate over projection map to compute
  //    desired result

  if (iter.length == 0) return body()

  let full = transViaFiltersDimsC(union(scope,iter)) // XX simpler way to compute?

  // Questions: 
  // 1. does trans(iter) do the right thing, or
  //    do we need to use q.free? (XX: had to use .fre)
  // 2. is it OK to take the ordering of iter, or
  //    do we need to compute topological order?

  let closing = "}"
  buf.push("{")
  buf.push("// PROJECT "+full+" -> "+iter)
  buf.push("let proj = {}")

  emitFiltersC2(diff(full,scope), scope)(buf, codegen)(() => {
    // (logic taken from caller)
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

  body()

  buf.push(closing)
}


let emitFiltersC2 = (iter, scope) => (buf, codegen) => body => {

  let watermark = buf.length

  let vars = {}
  let seen = {}

  if (iter.length == 0)
    return body()

  // remember the set of iteration vars
  for (let v of iter) vars[v] = true
  for (let v of scope) vars[v] = true

  // record current scope
  for (let v of scope) seen[v] = true

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

      // XXX dep on .fre here!
      let avail = g1.dims.every(x => seen[x]) 

      if (avail)
        available.push(i)
      else
        pending.push(i)
    }
    return available.length > 0
  }

  let closing = ""


  // XXX SHORTCUT -- known vars & range ...
  for (let v of iter) {
    buf.push("for (let "+quoteVar(v)+" of [0,1,2,3,4,'A','B','C','D','E','F','G','H','U','V','W','X','Y','Z']) {")
    seen[v] = true
    closing = "}\n"+closing
  }

  // process filters
  while (next()) {
    for (let i of available) {
      let f = filters[i]
      let v1 = f.arg[1].op
      let g1 = f.arg[0]

      buf.push("// FILTER "+i+" := "+pretty(filters[i]))

      // XXX use 'available'
      buf.push("if (!("+quoteVar(v1)+" in ("+codegen(g1,union(scope,iter))+"??[]))) continue")

      continue // XXX

      // Contract: input is already transitively closed, so we don't
      // depend on any variables that we don't want to iterate over.
      // (sanity check!)
      let extra = g1.fre.filter(x => !vars[x]) // XXX no needed
      if (extra.length != 0) {
        console.error("extra dependencie: "+extra)
      }

      if (isDeepVarStr(v1)) { // ok, just emit current
        if (!seen[v1]) {
          buf.push("rt.deepForIn("+codegen(g1,available)+", "+quoteVar(v1)+" => {")
        } else {
          buf.push("rt.deepIfIn("+codegen(g1,available)+", "+quoteVar(v1)+", () => {")
        }
        seen[v1] = true
        closing = "})\n"+closing
      } else { // ok, just emit current
        if (!seen[v1]) {
          buf.push("for (let "+quoteVar(v1)+" in "+codegen(g1,available)+") {")
        } else {
          buf.push("if ("+quoteVar(v1)+" in ("+codegen(g1,available)+"??[])) {")
        }
        seen[v1] = true
        closing = "}\n"+closing
      }
    }
  }

  if (pending.length > 0) {
    let problem = pending.map(i => pretty(filters[i])).join(", ")
    console.warn("unsolved filter ordering problem: couldn't emit "+problem)
    for (let i of pending) {
      buf.push("// ERROR: unsolved filter ordering problem: "+i+" := "+pretty(filters[i]))
    }
  }

  body()

  buf.push(closing)
}

let emitCodeDeep = (q) => {
  let buf = []
  buf.push("// "+pretty(q))
  buf.push("(inp => {")

  let stmCount = 0

  let codegen = (q,env) => {
    // recurse and emit in-place (following codegen(q))
    let codegen1 = q => codegen(q,env)

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
      if (env.indexOf(q.op) < 0) {        
        buf.push("// ERROR: var '"+q.op+"' not defined in "+env)
        console.error("// ERROR: var '"+q.op+"' not defined")
      }
      return quoteVar(q.op)
    } else if (q.key == "get" && isDeepVarExp(q.arg[1])) {
      let [e1,e2] = q.arg.map(codegen1)
      return "rt.deepGet("+e1+","+e2+")"
    } else if (q.key == "get") {
      let [e1,e2] = q.arg.map(codegen1)
      return e1+quoteIndex(e2)
    } else if (q.key == "pure") {
      let es = q.arg.map(codegen1)
      return "rt.pure."+q.op+"("+es.join(",")+")"
    } else if (q.key == "mkset") {
      let [e1] = q.arg.map(codegen1)
      return "rt.singleton("+e1+")"      
    } else if (q.key == "stateful" || q.key == "prefix" || q.key == "update") {
 
      let i = stmCount++

      let bound
      if (q.key == "update")
        bound = q.arg[1].vars // explicit var
      else
        bound = diff(q.arg[0].dims, env)

      buf.push("/* --- begin "+q.key+"_"+i+" --- "+pretty(q)+" ---*/")
      buf.push("// env: "+env+" dims: "+q.dims+" bound: "+bound)

      let env1 = union(env, bound)
      let codegen2 = q => codegen(q, env1)

      let emitStmInit = (q) => {
        if (q.key == "stateful") {
          return "rt.stateful."+q.op+"_init"
        } else if (q.key == "update") {
          let e0 = codegen(q.arg[0],env1)
          return "rt.stateful.update_init("+e0+")"
        } else {
          console.error("unknown op", q)
        }
      }

      let emitStm = (q) => {
        if (q.key == "prefix") {
          let [e1] = q.arg.map(codegen2)
          return "rt.stateful.prefix(rt.stateful."+q.op+"("+e1+"))"
        } else if (q.key == "stateful") {
          let [e1] = q.arg.map(codegen2)
          return "rt.stateful."+q.op+"("+e1+")"
        } else if (q.key == "update") {
          let e0 = codegen2(q.arg[0])
          let e2 = codegen2(q.arg[2])
          let e1 = q.arg[1].vars.map(quoteVar)
          return "rt.stateful.update("+e0+", ["+e1+"], "+e2+")" // XXX: init is still needed for tree paths
        } else {
          console.error("unknown op", q)
        }
      }


      // emit initialization
      if (q.key == "stateful" && (q.op+"_init") in runtime.stateful || q.key == "update") {
          buf.push("let tmp"+i+" = "+ emitStmInit(q)+"()")
      } else {
          buf.push("let tmp"+i)
      }

      // emit main computation
      emitFiltersC1(bound,env)(buf, codegen)(() => {
        buf.push("tmp"+i+" = "+emitStm(q) + ".next(tmp"+i+")")
      })

      buf.push("/* --- end "+q.key+"_"+i+" */")

      // return reference
      return "tmp"+i

    } else {
      console.error("unknown op", pretty(q))
      return "<?"+q.key+"?>"
    }
  }

  // buf.push("// --- res ---")
    buf.push("return "+codegen(q,[])+"")
  buf.push("})")

  return buf.join("\n")
}


let compile = (q,{
  // add flags here ...
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


  // 2. Extract
  q = extract0(q) // basic massaging


  // ---- middle tier ----

  // 3. Infer dependencies bottom up
  q = infer(q)

  if (q.dims.length > 0) {
    // wrap as (group (vars q.dims) q)
    q = {
     key: "update",
     arg: [
      { key: "const", op: {}, arg: [], vars: [], dims: [] },
      { key: "pure", op: "vars",
        arg: q.dims.map(x => ({ key: "var", op: x, arg:[] })),
        vars: q.dims, dims: q.dims },
      q],
     vars: q.vars,
     dims: []
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
  let code = emitCodeDeep(q/*,order*/)

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



