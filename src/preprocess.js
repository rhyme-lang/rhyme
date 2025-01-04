const { api } = require('./rhyme')
const { parse } = require('./parser')
const { runtime } = require('./simple-runtime')

//
// Preprocess: convert Rhyme AST after parser and desugar to a stratified version
//
// Fields of a term:
//
//  - key: one of 
//        const                       -- constant
//        input, var, placeholder     -- references to existing values
//        get, hint, pure, mkset,     -- pure scalar operations
//        stateful, prefix, update    -- stateful collective operations
//
//  - arg: array of subterms (ir passes will process these recursively)
//
//  - op:
//        literal value if key = const
//        variable name if key = var
//        any other plain JS value
//
//  - mode:
//        may be 'reluctant' if key = stateful or prefix
//        may be 'inplace' if key = update
//

let isVar = s => s.startsWith("*")

function ast_unwrap(e) {
  if (typeof e === "object" && "rhyme_ast" in e) return e.rhyme_ast
  if (e.xxkey) console.error("ERROR: double wrapping of ast node " + JSON.stringify(e))
  return { xxkey: "hole", xxop: e }
}
function resolveHole(p) {
    if (p === true || p === false) {
      return { xxkey: "const", xxop: Boolean(p) }
    } else if (p instanceof Array && p.length == 0) {
      return { xxkey: "const", xxop: [] }
    } else if (typeof p == "number" /*|| !Number.isNaN(Number(p))*/) { // number?
        return { xxkey: "const", xxop: Number(p) }
    } else if (typeof p == "string") {
        if (p == "-" || p == "$display")
          return { xxkey: "const", xxop: p }
        return parse(p).rhyme_ast // includes desugaring, i.e., no internal holes left
    } else if (typeof p == "object" || typeof (p) == "function") { // treat fct as obj
        if ("rhyme_ast" in p) {
            return p.rhyme_ast
        } else if (p instanceof Array) {
            return { xxkey: "array", xxparam: p.map(ast_unwrap) }
        } else {
            if (p.xxkey)
              console.error("ERROR: double wrapping of ast node " + JSON.stringify(e))
            return { xxkey: "object", xxparam: Object.entries(p).flat().map(ast_unwrap) }
        }
    } else {
        console.error("ERROR: unknown obect in query hole: " + JSON.stringify(p))  // user-facing error
    }
}



let preproc = q => {
  if (q === true || q === false)
    return { key: "const", op: Boolean(q) }
  if (q instanceof Array && q.length == 0)
    return { key: "const", op: [] }
  if (typeof (q) === "number" || !Number.isNaN(Number(q)))  // number?
    return { key: "const", op: Number(q) }
  if (typeof q === "string") {
    if (q == "-" || q == "$display")
      return { key: "const", op: q }
    else
      return preproc(parse(q).rhyme_ast)
  }

  if (q === undefined) {
    console.error("why undefined?")
    return q
  }

  if (q.xxkey == "raw") {
    if (q.xxop == "inp") return { key: "input" }
    else if (!Number.isNaN(Number(q.xxop))) return { key: "const", op: Number(q.xxop) }
    else return { key: "const", op: q.xxop }
  } if (q.xxkey == "const") {
    return { key: "const", op: q.xxop }
  } else if (q.xxkey == "loadCSV") {
    // Only process the first argument which is the filename
    // We want to get the type info from xxextra instead of evaluating it as a Rhyme query
    let e1 = preproc(q.xxparam[0])
    if (q.xxparam[1] === undefined || q.xxparam[1].xxkey != "hole") {
      console.error("csv schema expected")
    }
    return { key: "loadInput", op: "csv", arg: [e1], schema: q.xxparam[1].xxop }
  } else if (q.xxkey == "ident") {
    if (isVar(q.xxop)) return { key: "var", op: q.xxop }
    else return { key: "const", op: q.xxop }
  } else if (q.xxkey == "get") {
    let e1 = preproc(q.xxparam[0])
    // special case for literal "*": moved from here to extract
    let e2
    if (q.xxparam[1] === undefined) {
      e2 = e1
      e1 = { key: "input" }
    } else
      e2 = preproc(q.xxparam[1])
    return { key: "get", arg: [e1,e2] }
  } else if (q.xxkey == "apply") {
    let [q1,...qs2] = q.xxparam
    let e1 = preproc(q1)
    if (e1.key == "const") // built-in op
      return preproc({...q, xxkey:e1.op, xxparam:qs2})
    else // udf apply
      return { key: "pure", op: "apply", arg: [e1,...qs2.map(preproc)] }
  } else if (q.xxkey == "hint") {
    let [q1,...qs2] = q.xxparam
    let e1 = preproc(q1)
    if (e1.key == "const")
      return { key: "hint", op: e1.op, arg: [...qs2.map(preproc)] }
    else
      return { key: "hint", op: "generic", arg: [e1,...qs2.map(preproc)] }
  } else if (q.xxkey == "array") {
    let p = q.xxparam
    if (p.length == 1)
      return { key: "stateful", op: "array", arg: p.map(preproc) }
    else
      return { key: "pure", op: "flatten", 
        arg: p.map(x => preproc({ xxkey: "array", xxparam: [x]})) }
  /*} else if (q instanceof Array) {
    console.log("ERROR: NO GOOD preproc array", q)
    if (q.length == 1)
      return { key: "stateful", op: "array", arg: q.map(preproc) }
    else
      return { key: "pure", op: "flatten", arg: q.map(x => preproc([x])) } */
  } else if (q.xxkey == "hole") {
    return preproc(resolveHole(q.xxop))
  } else if (q.xxkey == "object") {
    let res
    for (let i = 0; i < q.xxparam.length; i += 2) {
      let k = q.xxparam[i]
      let v = q.xxparam[i+1]
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
  } else if (typeof(q) === "object" && !q.xxkey) {
    console.log("ERROR: NO GOOD preproc array", q)
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
  } else if (q.xxkey) {
    // if 'update .. ident ..', convert ident to input ref?
    let op = q.xxkey
    console.assert(typeof op === "string", op)
    let es2 = q.xxparam?.map(preproc)
    if (op in runtime.special)
      return { key: op, arg: es2 }
    else if (op in runtime.pure)
      return { key: "pure", op: op, arg: es2 }
    else if (op in runtime.stateful || op == "print")
      return { key: "stateful", op: op, arg: es2 }
    else if (op.startsWith && op.startsWith("prefix_") && op.substring(7) in runtime.stateful)
      return { key: "prefix", op: op.substring(7), arg: es2 }
    console.error("unknown op", q)
  } else {
    console.error("malformed op", q)
  }
}


exports.preproc = preproc