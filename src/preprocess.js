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
    if (q.xxparam == "csv") {
      // Only process the first argument which is the filename
      // We want to extract the type info from xxparam[1] instead of evaluating it as a Rhyme query
      let e1 = preproc(q.xxextra[0])
      if (e1.key != "const" || typeof e1.op != "string") {
        console.error("const string expected for filename")
      }
      if (q.xxextra[1] === undefined) {
        console.error("csv schema expected")
      }
      return { key: "input", op: "csv", file: e1.op, schema: q.xxextra[1]}
    }
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
  } else if (q.xxpath == "hint") {
    let [q1,...qs2] = q.xxparam
    let e1 = preproc(q1)
    if (e1.key == "const")
      return { key: "hint", op: e1.op, arg: [...qs2.map(preproc)] }
    else
      return { key: "hint", op: "generic", arg: [e1,...qs2.map(preproc)] }
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
    let es2 = q.xxparam instanceof Array ? q.xxparam.map(preproc) : [preproc(q.xxparam)]
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


exports.preproc = preproc