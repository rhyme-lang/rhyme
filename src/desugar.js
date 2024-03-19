exports.desugar = (p) => {

  let argProvided = { xxpath: "raw", xxparam: "inp" }
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
      if (e1.xxpath == "ident")
        e1 = { xxpath: "get", xxparam: [{ xxpath: "raw", xxparam: "inp"}, e1] }
      return { xxpath: "get", xxparam: [e1,...e2s] }
    } else {
      return { xxpath: p, xxparam: args }
    }
  }

  // contract: args are already desugared
  function transStateful(p, arg) {
    return { xxkey: p, xxparam: arg }
  }


  let primStateful = {
    "sum":   true,
    "product": true,
    "count": true,
    "max":   true,
    "min":   true,
    "first": true,
    "last":  true,
  }

  // contract: args are already desugared, p is an ident
  function transPrimitiveApply(p, args) {
    if (p == "get") { // XXX others? plus, minus, etc?
      return transPath("get", args)
    } else if (primStateful[p]) {
      return transStateful(p, args[0]) // unpack!
    } else if (p == "group" && args.length < 2) {
      // partial application -- this will later turn into a keyval object
      return { xxpath: "group", xxparam: args[0] }
    } else {
      return { xxpath: "apply", xxparam: [{ xxpath: "ident", xxparam: p }, ...args] }
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
    if (p instanceof Function)
      return p(...args)

    // is the argument used? i.e. syntax '.foo' --> we have 'arg.foo', just return
    if (h)
      return p // XXX apply to remaining args, if any?

    // argument not used yet: i.e. syntax 'udf.fun' --> apply to arg, return 'udf.fun(arg)'
    if (p.xxpath == "ident") {
      return transPrimitiveApply(p.xxparam, args)
    } else if (p.xxpath == "get" && p.xxparam.length == 1) { // partially applied, i.e. 'get(*line)'
      return { xxpath: "get", xxparam: [args[0],p.xxparam[0]] }
    } else if (p.xxpath == "group") { // partially applied, i.e. 'group(*line)'
      // return { [p.xxparam]: args[0] }
      return { "_IGNORE_": { xxkey: "keyval" , xxparam: [p.xxparam, args[0]]}}
    } else if (p.xxpath == "closure") {
      console.assert(args.length >= 1)
      let [e1, ...args1] = args
      let [env1, x, body] = p.xxparam
      let save = env
      env = {...env1}
      env[x.xxparam] = args[0]
      let res = trans(body)
      env = save
      if (args1.length > 0)
        return transFuncApply(res, args1)
      else
        return res
    }

    return { xxpath: "apply", xxparam: [p,...args] }
  }

  function transApply(p, args) {
    // special non-cbv forms can be added here
    if (p.xxpath == "ident" && p.xxparam == "let") { // let x rhs body
      // contract: rhs gets evaluated here
      console.assert(args.length >= 3)
      console.assert(args[0].xxpath == "ident")
      let [e1,e2,e3,...args1] = args
      e2 = trans(e2)
      let save = env
      env = {...env}
      env[e1.xxparam] = e2
      let res = trans(e3)
      env = save
      if (args1.length > 0)
        return transApply(res, args1)
      else
        return res
    } else if (p.xxpath == "ident" && p.xxparam == "fn") { // fn x body
      console.assert(args.length >= 2)
      console.assert(args[0].xxpath == "ident")
      let [e1, e2, ...args1] = args
      let res = { xxpath: "closure", xxparam: [env, e1, e2] }
      if (args1.length > 0)
        return transApply(res, args1)
      else
        return res
    } else if (p.xxpath == "apply") { // collect all arguments for curried apply
      let [p1,...args1] = p.xxparam
      return transApply(p1, [...args1,...args])
    }
    return transFuncApply(p, args.map(trans))
  }

  function transPipe(p, args) {
    // special non-cbv pipe forms can be added here
    // (args[0] is the arg the left of the pipe, rest currently empty)
    console.assert(args.length == 1)
    return transFuncApply(p, args.map(trans))
  }

  function trans(p) {
    if (p == undefined) {
      return p
    } else if (p.xxpath == "ident") {
      if (p.xxparam in env)
        return env[p.xxparam]
      return p
    } else if (p.xxpath == "raw") {
      if (p.xxparam == "_ARG_") {
        argUsed = true
        return argProvided
      }
      return p
    } else if (p.xxpath == "hole") {
      return p.xxparam // do not recurse, already desugared
    } else if (p.xxpath == "pipe") {
      let [e1,e2,...e3s] = p.xxparam
      return transPipe(e2,[e1,...e3s])
    } else if (p.xxpath == "apply") {
      let [e1,...e2s] = p.xxparam
      return transApply(e1, e2s)
    } else if (p.xxpath) {
      return transPath(p.xxpath, p.xxparam.map(trans))
    } else if (p.xxkey) {
      return transStateful(p.xxkey, trans(p.xxparam))
    }
    return p
  }

  return trans(p)
}