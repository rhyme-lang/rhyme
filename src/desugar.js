const { ops, ast } = require("./shared")

// NOTE: in general, desugar preserves only xxkey and xxparam fields.
// Field xxop is only preserved for ident, raw, const.

exports.desugar = (p) => {

  let argProvided = { xxkey: "raw", xxop: "inp" }
  let argUsed = false
  let env = {}

  // contract: args are already desugared
  function transPath(p, args) {
    if (p == "get") {
      let [e1, ...e2s] = args
      // incomplete path like .foo? implicit hole, treat as function!
      if (e2s.length == 0 || e2s[0] === undefined) {
        // implicit hole = argument ref
        e2s = [e1]
        e1 = argProvided
        argUsed = true
      }
      // selecting on an ident like input.foo? implicit root field access
      if (e1.xxkey == "ident")
        e1 = { xxkey: "get", xxparam: [{ xxkey: "raw", xxop: "inp"}, e1] }
      return { xxkey: "get", xxparam: [e1,...e2s] }
    } else {
      return { xxkey: p, xxparam: args }
    }
  }

  // contract: args are already desugared
  function transStateful(p, args) {
    return { xxkey: p, xxparam: args }
  }

  // contract: args are already desugared, p is an ident
  function transPrimitiveApply(p, args) {
    if (p == "get") { // XXX others? plus, minus, etc?
      return transPath("get", args)
    } else if (ops.stateful[p]) {
      return transStateful(p, args) // unpack!
    } else if (p == "group" && args.length < 2) {
      // partial application -- this will later turn into a keyval object
      return { xxkey: "group", xxparam: args }
    } else if (p == "loadCSV") {
      return { xxkey: "loadCSV", xxparam: args }
    } else {
      return { xxkey: "apply", xxparam: [{ xxkey: "ident", xxop: p }, ...args] }
    }
  }

  // contract: args are already desugared, p is not
  function transFuncApply(p, args) {
    let save = [argProvided, argUsed]
    argProvided = args[0] // XXX what about the others?
    argUsed = false
    p = trans(p)
    let h = argUsed
    argProvided = save[0]; argUsed = save[1] // [argProvided, argUsed] = save doesn't work??

    // is it a present-stage function, spliced into a hole via ${p} ?
    if (p.xxkey == "hole" && p.xxop instanceof Function)
      return ast.unwrap(p.xxop(...args.map(ast.wrap)))

    // is the argument used? i.e. syntax '.foo' --> we have 'arg.foo', just return
    if (h)
      return p // XXX apply to remaining args, if any?

    // argument not used yet: i.e. syntax 'udf.fun' --> apply to arg, return 'udf.fun(arg)'
    if (p.xxkey == "ident") {
      return transPrimitiveApply(p.xxop, args)
    } else if (p.xxkey == "get" && p.xxparam.length == 1) { // partially applied, i.e. 'get(*line)'
      return { xxkey: "get", xxparam: [args[0],p.xxparam[0]] }
    } else if (p.xxkey == "group") { // partially applied, i.e. 'group(*line)'
      // return { [p.xxparam]: args[0] }
      // return { "_IGNORE_": { xxkey: "keyval" , xxparam: [p.xxparam[0], args[0]]}}
      return { xxkey: "object", xxparam: [p.xxparam[0], args[0]]}
    } else if (p.xxkey == "closure") {
      console.assert(args.length >= 1)
      let [e1, ...args1] = args
      let [{xxop: env1}, x, body] = p.xxparam // need to unwrap env!
      let save = env
      env = {...env1}
      env[x.xxop] = args[0]
      let res = trans(body)
      env = save
      if (args1.length > 0)
        return transFuncApply(res, args1)
      else
        return res
    }

    return { xxkey: "apply", xxparam: [p,...args] }
  }

  function transApply(p, args) {
    // special non-cbv forms can be added here
    if (p.xxkey == "ident" && p.xxop == "let") { // let x rhs body
      // contract: rhs gets evaluated here
      console.assert(args.length >= 3)
      console.assert(args[0].xxkey == "ident")
      let [e1,e2,e3,...args1] = args
      e2 = trans(e2)
      let save = env
      env = {...env}
      env[e1.xxop] = e2
      let res = trans(e3)
      env = save
      if (args1.length > 0)
        return transApply(res, args1)
      else
        return res
    } else if (p.xxkey == "ident" && p.xxop == "fn") { // fn x body
      console.assert(args.length >= 2)
      console.assert(args[0].xxkey == "ident")
      let [e1, e2, ...args1] = args
      let res = { xxkey: "closure", xxparam: [ast.unwrap(env), e1, e2] } // env not an AST!
      if (args1.length > 0)
        return transApply(res, args1)
      else
        return res
    } else if (p.xxkey == "apply") { // collect all arguments for curried apply
      let [p1,...args1] = p.xxparam
      return transApply(p1, [...args1,...args])
    }
    return transFuncApply(p, args.map(trans))
  }

  function transPipe(p, args) {
    // special non-cbv pipe forms can be added here
    // (args[0] is the arg on the left of the pipe, rest currently empty)
    console.assert(args.length == 1)
    return transFuncApply(p, args.map(trans))
  }

  function trans(p) {
    console.assert(p && p.xxkey && !p.rhyme_ast)
    if (p.xxkey == "ident") {
      if (p.xxop in env)
        return env[p.xxop]
      return p
    } else if (p.xxkey == "raw") {
      // if (p.xxop == "_ARG_") {
      //   argUsed = true
      //   return argProvided
      // }
      return p
    } else if (p.xxkey == "const") {
      return p
    } else if (p.xxkey == "hole") {
      return ast.unwrap(p.xxop) // do not recurse, already desugared
    } else if (p.xxkey == "pipe") {
      let [e1,e2,...e3s] = p.xxparam
      return transPipe(e2,[e1,...e3s])
    } else if (p.xxkey == "apply") {
      let [e1,...e2s] = p.xxparam
      return transApply(e1, e2s)
    } else if (p.xxkey) {
      return transPath(p.xxkey, p.xxparam?.map(trans))
    } else if (p.xxkey) {
      return transStateful(p.xxkey, p.xxparam?.map(trans))
    }
    return p
  }

  return trans(p)
}