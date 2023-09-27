// ---------- API ----------
//
//
let debug = true
let trace = false
export let api = {}

// print is defined in octoediter, logging to console here
function print(...args) {
  if (debug) console.log(...args)
}

function inspect(...args) {
  if (debug) console.dir(...args)
}

{
  //
  // reducer (e.g., sum) expressions
  //
  api["sum"] = (e) => ({
    xxkey: "sum",
    xxparam: e
  })
  api["count"] = (e) => ({
    xxkey: "count",
    xxparam: e
  })
  api["max"] = (e) => ({
    xxkey: "max",
    xxparam: e
  })
  api["join"] = (e) => ({
    xxkey: "join",
    xxparam: e
  })
  api["array"] = (...es) => ({
    xxkey: "array",
    xxparam: es
  })
  api["last"] = (e) => ({
    xxkey: "last",
    xxparam: e
  })
  api["first"] = (e) => ({
    xxkey: "first",
    xxparam: e
  })
  api["keyval"] = (k, v) => ({
    xxkey: "keyval",
    xxparam: [k, v]
  })
  api["flatten"] = (k, v) => ({
    xxkey: "flatten",
    xxparam: [k, v]
  })
  api["merge"] = (k, v) => ({
    xxkey: "merge",
    xxparam: [k, v]
  })
  //
  // path expressions
  //
  api["get"] = (e1, e2) => ({
    xxpath: "get",
    xxparam: [e1, e2]
  })
  api["apply"] = (e1, e2) => ({
    xxpath: "apply",
    xxparam: [e1, e2]
  })
  api["pipe"] = (e1, e2) => ({ // reverse apply
    xxpath: "apply",
    xxparam: [e2, e1]
  })
  api["plus"] = (e1, e2) => ({
    xxpath: "plus",
    xxparam: [e1, e2]
  })
  api["minus"] = (e1, e2) => ({
    xxpath: "minus",
    xxparam: [e1, e2]
  })
  api["times"] = (e1, e2) => ({
    xxpath: "times",
    xxparam: [e1, e2]
  })
  api["fdiv"] = (e1, e2) => ({
    xxpath: "fdiv",
    xxparam: [e1, e2]
  })
  api["div"] = (e1, e2) => ({
    xxpath: "div",
    xxparam: [e1, e2]
  })
  api["mod"] = (e1, e2) => ({
    xxpath: "mod",
    xxparam: [e1, e2]
  })
  // ---------- Fluent API ----------
  let Pipe = {
    sum: function () { return pipe(api.sum(this)) },
    count: function () { return pipe(api.count(this)) },
    max: function () { return pipe(api.max(this)) },
    first: function () { return pipe(api.first(this)) },
    last: function () { return pipe(api.last(this)) },
    group: function (k) { let o = {}; o[k] = this; return pipe(o) },
    map: function (e) { return pipe(api.apply(e, this)) },
    get: function (e) { return pipe(api.get(this, e)) },
  }
  function pipe(e) {
    if (typeof (e) === "string")
      e = api.get(e)
    let res = Object.create(Pipe)
    for (let k in e)
      res[k] = e[k]
    return res
  }
  //
  // ---------- Internals ----------
  //
  // string literal or iterator variable?
  let isVar = s => s.startsWith("*") // || s.startsWith("$") || s.startsWith("%")
  let quoteVar = s => "KEY" + s.replaceAll("*", "_star_") // dollar, percent, ...
  //
  // create an expression with code 'txt' and dependency on symbols 'args'
  let expr = (txt, ...args) => ({ txt, deps: args })
  //
  let ident = s => isVar(s) ? expr(quoteVar(s), s) : expr("'" + s + "'")
  //
  // test if expr is a variable (TODO: optimize. Add a flag?)
  let exprIsVar = e => e.deps.length == 1 && e.txt == quoteVar(e.deps[0])
  //
  // TODO: support vararg in select/call?
  let select = (a, b) => expr(a.txt + "[" + b.txt + "]", ...a.deps, ...b.deps)
  let call = (a, b) => expr("" + a.txt + "(" + b.txt + ")", ...a.deps, ...b.deps)
  let binop = (op, a, b) => expr("(" + a.txt + op + b.txt + ")", ...a.deps, ...b.deps)
  let unop = (op, a) => expr(op + "(" + a.txt + ")", ...a.deps)
  //
  // path: number, identifier, selection
  //    disambiguate
  //      - total +=
  //      - data.foo +=
  //
  //
  // TODO: reset these in main func
  //
  let generatorStms = []
  let assignmentStms = []
  let allsyms = {}
  //
  let currentGroupPath = []
  let tmpVarCount = 0
  let extraLoopDeps = {} // for each loop sym, a list of extra dependencies
  let tmpVarWriteRank = {} // for each writable var sym, the number of consecutive write stms

  let subQueryCache = {}

  function resetState() {
    generatorStms = []
    assignmentStms = []
    allsyms = {}
    currentGroupPath = []
    tmpVarCount = 0
    extraLoopDeps = {}
    tmpVarWriteRank = {}
    subQueryCache = {}
  }
  //
  //
  function assign(lhs, op, rhs) {
    let e = expr(lhs.txt + " " + op + " " + rhs.txt, ...lhs.deps, ...rhs.deps)
    e.lhs = lhs
    e.op = op
    e.rhs = rhs
    e.writeSym = lhs.root
    e.deps = e.deps.filter(e1 => e1 != e.writeSym) // remove cycles
    // update sym to rank dep map
    tmpVarWriteRank[e.writeSym] ??= 1
    e.writeRank = tmpVarWriteRank[e.writeSym]
    // if (e.op != "+=") // do not increment for idempotent ops? (XX todo opt)
    tmpVarWriteRank[e.writeSym] += 1
    assignmentStms.push(e)
  }
  //
  //
  //
  function selectUser(a, b) {
    if (exprIsVar(b)) {
      let b1 = b.deps[0]
      let e = expr("for " + b1 + " <- " + a.txt, ...a.deps)
      e.sym = b1
      e.rhs = a.txt
      if (generatorStms.every(e1 => e1.txt != e.txt)) // generator CSE
        generatorStms.push(e)
      allsyms[b1] = true
    }
    return select(a, b)
  }
  //
  //
  // -- Paths (pure) --
  //
  // base path: number (5), string (foo), selection (foo.bar)
  //
  // TODO: add mode flag -- is string allowed? E.g. not lhs of selection,
  //                           i.e. "foo" in api.get("foo","bar")
  //
  // contract: argument p is a Number or String
  //
  function path0(p) {
    if (typeof (p) == "number" || !Number.isNaN(Number(p)))  // number?
      return expr(p)
    let as = p.split(".")
    if (as.length == 1) return ident(as[0])
    let ret = expr("inp")
    for (let i = 0; i < as.length; i++) {
      if (as[i] == "")
        continue // skip empty
      ret = selectUser(ret, ident(as[i]))
    }
    return ret
  }
  //
  // special path operators: get, apply (TODO!)
  //
  //
  function path1(p) {
    // TODO: assert non null?
    if (typeof (p) == "object" || typeof (p) == "function") { // treat fct as obj
      if (p.xxpath) { // path
        if (p.xxpath == "get") {
          let [e1, e2] = p.xxparam
          // TODO: e1 should never be treated as id!
          // TODO: vararg?
          let subQueryPath = subQueryCache[e1] // cache lookup and update
          if (!subQueryPath) {
            subQueryPath = path1(e1)
            subQueryCache[e1] = subQueryPath
          }
          return (e2 !== undefined) ? selectUser(subQueryPath, path1(e2)) : subQueryPath
        } else if (p.xxpath == "apply") {
          let [e1, e2] = p.xxparam
          // TODO: e1 should never be treated as id!
          return call(path1(e1), path1(e2))
        } else if (p.xxpath == "plus") {
          let [e1, e2] = p.xxparam
          return binop("+", path1(e1), path1(e2))
        } else if (p.xxpath == "minus") {
          let [e1, e2] = p.xxparam
          return binop("-", path1(e1), path1(e2))
        } else if (p.xxpath == "times") {
          let [e1, e2] = p.xxparam
          return binop("*", path1(e1), path1(e2))
        } else if (p.xxpath == "fdiv") {
          let [e1, e2] = p.xxparam
          return binop("/", path1(e1), path1(e2))
        } else if (p.xxpath == "div") {
          let [e1, e2] = p.xxparam
          return unop("Math.trunc", binop("/", path1(e1), path1(e2)))
        } else if (p.xxpath == "mod") {
          let [e1, e2] = p.xxparam
          return unop("Math.trunc", binop("%", path1(e1), path1(e2)))
        } else {
          print("ERROR - unknown path key '" + p.xxpath + "'")
          return expr("undefined")
        }
      } else if (p.xxkey) { // reducer (stateful)
        return transStatefulInPath(p)
      } else { // subquery
        if (p instanceof Array)
          print("ERROR - Array in path expr not supported yet!")
        //print("ERROR - we don't support subqueries right now!")
        //print("TODO: decorrelate and extract")
        //inspect(p)
        //
        // A stateless object literal: we treat individual
        // entries as paths, and build a new object for each
        // series of produced results.
        //
        // We take the combined dependencies of the right-hand
        // side, subtract dependencies of the left-hand side,
        // and use the remaining deps as a key for the resulting
        // object.
        //
        // This means that we'll iterate over all deps(rhs)
        // that aren't also in deps(lhs).
        //
        // Step 1: traverse RHS and gather dependencies
        //
        let entries = {}
        let keydeps = {}
        let rhsdeps = {}
        for (let k of Object.keys(p)) {
          // flatten, merge, etc.
          let k1 = path(k)
          let save = currentGroupPath
          currentGroupPath = [...currentGroupPath, k1]
          let rhs1 = path(p[k])
          currentGroupPath = save
          entries[k] = { key: k1, rhs: rhs1 }
          for (let d of k1.deps) keydeps[d] = true
          for (let d of rhs1.deps) rhsdeps[d] = true
        }
        //
        // Step 2: build new object, aggregating individual
        //         paths and indexed by deps(rhs) - deps(lhs)
        //
        let save = currentGroupPath
        let deps = []
        for (let d in rhsdeps) if (isVar(d) && !(d in keydeps)) deps.push(d)
        let plus = deps.map(ident)
        currentGroupPath = [...currentGroupPath, ...plus]
        let lhs1 = createFreshTempVar(deps)
        assign(lhs1, "??=", expr("{}"))
        for (let k of Object.keys(p)) {
          let { key, rhs } = entries[k]
          let ll1 = select(lhs1, key)
          ll1.root = lhs1.root
          assign(ll1, "=", rhs)
        }
        currentGroupPath = save
        //print("XXX fresh temp var ")
        //inspect({lhs1,entries,deps,plus})
        return lhs1
      }
    } else if (typeof (p) == "number") {
      return path0(p)
    } else {
      // TODO: assert it's a string?
      return path0(String(p))
    }
  }
  function path(p) { return path1(p) }
  //
  //
  // -- Reducers (side effects) --
  //
  //
  function transStatefulInPath(p) {
    return stateful(null, p)
  }
  function transStatefulTopLevel(p) {
    return stateful(null, p)
  }
  //
  //
  function relevantGroupPath(deps) {
    if (!deps)
      return currentGroupPath // no deps given -> not filtering
    //
    let out = []
    for (let e of currentGroupPath) {
      // XXX: we explicitly keep entries with no deps
      // (potential optimization to drop those, but may cause
      // some trouble in scheduling)
      // TODO test this again
      // NOTE tried again, seems to work, except it changes order (e.g. out.total)
      if (!e.deps.length || e.deps.filter(x => deps.indexOf(x) >= 0).length) {
        out.push(e)
      }
    }
    return out
  }
  function entireGroupPathIsRelevant(deps) {
    return currentGroupPath.length == relevantGroupPath(deps).length
  }
  function canDecorrelateGroupPath(deps) {
    return !entireGroupPathIsRelevant(deps)
  }
  function createFreshTempVar(deps) {
    // XXX update loop-to-loop effect dep map
    // when decorrelating, new fresh var should be
    // computed before current loop. Add an extra
    // dependency to loop generator.
    //
    // Example (as done now):
    //
    //  out[data.*A.key] += data.*B.value  (add: *B before *A)
    //
    // Alternative:
    //
    //  tmp += data.*B.value
    //  out[data.*A.key] = tmp (add: tmp before *A)
    //
    // This appears somewhat more desirable, but had the drawback
    // that the entire loop over *A was pulled into loop *B.
    // Hence we currently stick to loop-after-loop dependencies.
    //
    // let allDeps = []
    // for (let e of currentGroupPath) {
    //   for (let x of e.deps)
    //     if (allDeps.indexOf(x) < 0)
    //       allDeps.push(x)
    // }
    // for (let x2 of allDeps) {
    //   for (let x1 of deps) {
    //     if (x1 == x2) continue
    //     if (!extraLoopDeps[x2]) extraLoopDeps[x2] = []
    //     if (extraLoopDeps[x2].indexOf(x1) < 0)
    //       extraLoopDeps[x2].push(x1)
    //   }
    // }
    // if (trace) print("tmp"+tmpVarCount+" ... "+deps+" before "+allDeps)
    // XXX
    //
    let lhs1 = select(expr("tmp"), expr("" + (tmpVarCount++)))
    let root = lhs1.txt
    lhs1.root = root
    lhs1.deps = [root]
    for (let e of relevantGroupPath(deps)) {
      assign(lhs1, "??=", expr("{}"))
      lhs1 = select(lhs1, e)
      lhs1.root = root
    }
    return lhs1
  }
  function openTempVar(lhs, deps) {
    if (lhs && entireGroupPathIsRelevant(deps))
      return lhs
    else
      return createFreshTempVar(deps)
  }
  function closeTempVar(lhs, lhs1) {
    //
    //
    //  let allDeps = []
    //  for (let e of currentGroupPath) {
    //    for (let x of e.deps)
    //      if (allDeps.indexOf(x) < 0)
    //        allDeps.push(x)
    //  }
    //print("alldeps: "+lhs1.deps+" before "+allDeps)
    //
    //
    if (lhs && lhs != lhs1) {
      assign(lhs, "=", lhs1)
      return lhs
    } else {
      return lhs1
    }
  }
  //
  //
  function stateful(lhs, p) {
    //
    // total: api.sum(data.*.value)
    // k:     api.xxkey(xxparam)
    //
    if (p.xxkey == "sum") { // sum
      let rhs = path(p.xxparam)
      let lhs1 = openTempVar(lhs, rhs.deps)
      assign(lhs1, "??=", expr("0"))
      assign(lhs1, "+=", rhs)
      return closeTempVar(lhs, lhs1)
    } else if (p.xxkey == "count") { // count
      let rhs = path(p.xxparam)
      let lhs1 = openTempVar(lhs, rhs.deps)
      assign(lhs1, "??=", expr("0"))
      assign(lhs1, "+=", expr("1", ...rhs.deps))
      return closeTempVar(lhs, lhs1)
    } else if (p.xxkey == "max") { // max
      let rhs = path(p.xxparam)
      let lhs1 = openTempVar(lhs, rhs.deps)
      assign(lhs1, "??=", expr("-Infinity"))
      assign(lhs1, "=", expr("Math.max(" + lhs1.txt + "," + rhs.txt + ")", ...rhs.deps))
      return closeTempVar(lhs, lhs1)
    } else if (p.xxkey == "join") { // string join
      let rhs = path(p.xxparam)
      let lhs1 = openTempVar(lhs, rhs.deps)
      assign(lhs1, "??=", expr("''"))
      assign(lhs1, "+=", rhs)
      return closeTempVar(lhs, lhs1)
    } else if (p.xxkey == "array") { // array
      let rhs = p.xxparam.map(path)
      let lhs1 = openTempVar(lhs, rhs.flatMap(x => x.deps))
      assign(lhs1, "??=", expr("[]"))
      for (let e of rhs)
        assign(lhs1, ".push", expr("(" + e.txt + ")", ...e.deps))
      return closeTempVar(lhs, lhs1)
    } else if (p.xxkey) {
      print("ERROR: unknown reducer key '" + p.xxkey + "'")
      return expr("undefined")
    } else if (p instanceof Array) {
      return stateful(lhs, { xxkey: "array", xxparam: p })
    } else if (p instanceof Array) {
      // XXX not using this anymore
      if (p.length > 1) {
        print("ERROR: currently not dealing correctly with multi-element arrays")
        //return expr("undefined")
      }
      let lhs1 = openTempVar(lhs, null)
      assign(lhs1, "??=", expr("[]"))
      let kCount = 0
      for (let k in p) {
        let o = p[k]
        //kCount = api.plus(kCount,api.count(o))
      }
      //
      // XXX: index for multiple sums isn't the right one yet!!
      //
      for (let k in p) {
        let o = p[k]
        kCount = api.plus(kCount, api.count(o))
        //let k0 = path(api.count(o))
        let k1 = path(api.minus(kCount, 1))
        // TODO: support merge/flatten, too?
        let save = currentGroupPath
        currentGroupPath = [...currentGroupPath, k1]
        let ll1 = select(lhs1, k1)
        ll1.root = lhs1.root
        stateful(ll1, o)
        currentGroupPath = save
      }
      return closeTempVar(lhs, lhs1)
    } else if (typeof (p) == "object" && !p.xxpath) {
      //
      // TODO: we don't have the entire rhs, so how to get rhs.deps?
      //
      //   Right now we have no way to decorrelate ...
      //
      let lhs1 = openTempVar(lhs, null)
      assign(lhs1, "??=", expr("{}"))
      let keys = Object.keys(p)
      for (let k of keys) {
        let o = p[k]
        // NOTE: more expressive merge/flatten could traverse
        //       child object (to support multiple keys)
        if (p[k].xxkey == "keyval" || p[k].xxkey == "merge") { // nesting
          o = p[k].xxparam[1]
          k = p[k].xxparam[0]
        } else if (p[k].xxkey == "flatten") { // same, but include parent key
          o = p[k].xxparam[1]
          k = api.plus(api.plus(k, "-"), p[k].xxparam[0])
        }
        let k1 = path(k)
        let save = currentGroupPath
        currentGroupPath = [...currentGroupPath, k1]
        let ll1 = select(lhs1, k1)
        ll1.root = lhs1.root
        stateful(ll1, o)
        currentGroupPath = save
      }
      return closeTempVar(lhs, lhs1)
    } else {
      // regular path
      let rhs = path(p)
      let lhs1 = openTempVar(lhs, rhs.deps)
      assign(lhs1, "=", rhs)
      return closeTempVar(lhs, lhs1)
    }
  }
  //
  // main entrypoint
  //
  api["show"] = (query, data, explain) => {
    let f = api["query"](query)
    return display(f(data))
  }
  api["exec"] = (query, data) => {
    let f = api["query"](query)
    return f(data)
  }
  api["getIR"] = (query) => {
    resetState()
    transStatefulTopLevel(query)
    return {
      assignments: assignmentStms,
      generators: generatorStms
    }
  }
  api["query"] = api["compile"] = (query) => {
    resetState()
    //
    // process query root
    //
    let res = transStatefulTopLevel(query)
    //
    // debug informationn
    //
    let explain = {}
    explain.src = query
    //
    // init codegen
    //
    let code = []
    let indent = 0
    function emit(str) {
      if (str.indexOf("}") == 0) indent--
      code.push("".padEnd(indent * 4, ' ') + str)
      if (str.indexOf("{") >= 0) indent++
      if (str.indexOf("}") > 0) indent--
    }
    emit("inp => {")
    emit("let tmp = {}")
    if (debug) {
      print("---- begin code ----")
      for (let e of assignmentStms)
        if (e.txt.indexOf("??=") < 0) // skip init stms
          print(e.txt + "  // " + e.writeSym + " #" + e.writeRank + " <- " + e.deps)
      print("return " + res.txt)
      print("---- end code ----")
    }
    explain.ir = {}
    explain.ir.assignments = [...assignmentStms]
    explain.ir.generators = [...generatorStms]
    let generatorStmsCopy = [...generatorStms] // TODO(supun): temporary fix
    //
    // Fix explicit loop ordering (added 11/28):
    //
    //    tmp0 <- *A
    //    tmp1 <- *tmp0, *B
    //
    // means: *A before *B
    //
    // It's not quite sufficient to say "tmp0 before *B" because
    // that might suck the *B loop into the *A loop (right after
    // the write to tmp0).
    //
    // Possible refinement:
    //
    // NOTE: we're currently treating tmp's as atomic (all writes)
    // together. This is probably too coarse when we want to deal
    // with, say, largely independent queries composed into a
    // single object.
    //
    // IDEA: distinguish tmp0#1, tmp0#2, i.e., take write rank
    // into account (proper SSA form).
    //
    let tmpInsideLoop = {}
    let tmpAfterLoop = {}
    let tmpAfterTmp = {}
    let loopAfterLoop = {}
    let loopInsideLoop = {} // todo: "not currently used" -- essentially, anything that's not loopAfterLoop

    //
    // compute tmpInsideLoop and tmpAfterTmp
    //
    for (let e of assignmentStms) {
      //if (e.txt.indexOf("??=") < 0) { // skip init stms (??)
      let isloop = s => s.startsWith("*")
      let istmp = s => s.startsWith("tmp")
      tmpInsideLoop[e.writeSym] ??= {}
      tmpAfterTmp[e.writeSym] ??= {}
      for (let v of e.deps) {
        if (isloop(v)) tmpInsideLoop[e.writeSym][v] = true
        if (istmp(v)) tmpAfterTmp[e.writeSym][v] = true
      }
      //}
    }
    //
    // compute tmpAfterLoop
    //
    for (let t2 in tmpAfterTmp) {
      tmpAfterLoop[t2] ??= {}
      // gather loop prior tmps are in
      for (let t1 in tmpAfterTmp[t2]) {
        for (let l in tmpInsideLoop[t1])
          tmpAfterLoop[t2][l] = true
      }
      // remove own loops
      for (let l in tmpInsideLoop[t2])
        delete tmpAfterLoop[t2][l]
    }
    //
    // compute loopAfterLoop
    //
    for (let t in tmpAfterLoop) {
      for (let l2 in tmpInsideLoop[t]) {
        loopAfterLoop[l2] ??= {}
        for (let l1 in tmpAfterLoop[t]) {
          // loops may be nested or sequenced
          loopInsideLoop[l1] ??= {}
          let nested = false
          for (let tx in tmpInsideLoop)
            if (tmpInsideLoop[tx][l1] && tmpInsideLoop[tx][l2]) { nested = true; break }
          if (nested)
            loopInsideLoop[l1][l2] = true
          else
            loopAfterLoop[l2][l1] = true
        }
      }
      // TODO: do we need loopAfterTmp? seed loopAfterTmp/Loop from generator.deps?
    }
    explain.dependencies = { tmpInsideLoop, tmpAfterTmp, tmpAfterLoop, loopAfterLoop, loopInsideLoop }
    let extraLoopDeps = loopAfterLoop
    if (debug) {
      inspect({ tmpInsideLoop, tmpAfterTmp, tmpAfterLoop, loopAfterLoop, loopInsideLoop })
      print("---- end dependency data ----")
    }
    //
    //
    let availableSyms = {} // currently available in scope (for loops)
    let emittedLoopSyms = {}   // loops that have been fully emitted
    let emittedSymsRank = {}   // number of writes emitted for each sym
    function isAvailable(s) {
      if (s == "inp")
        return true
      if (s.startsWith("*"))
        return availableSyms[s]
      if (s.startsWith("tmp"))
        return emittedSymsRank[s] == tmpVarWriteRank[s] // all writes emitted
      return false
    }
    function depsAvailable(e) {
      return e.deps.every(isAvailable)
    }
    function extraDepsAvailable(depMap) {
      return (Object.keys(depMap)).every(s => emittedLoopSyms[s])
    }
    function loopsFinished(e) {
      return extraDepsAvailable(tmpAfterLoop[e.writeSym])
    }
    function filterAvailable(stms) {
      return stms.filter(e => depsAvailable(e) && loopsFinished(e))
    }
    function filterNotAvailable(stms) {
      return stms.filter(e => !depsAvailable(e) || !loopsFinished(e))
    }
    function emitAssignments() {
      // XXX Note: need to call this multiple times,
      // as emitting stms makes others available
      // TODO: refactor?
      let stms = filterAvailable(assignmentStms)
      assignmentStms = filterNotAvailable(assignmentStms)
      for (let e of stms) {
        emit(e.txt)
        emittedSymsRank[e.writeSym] = e.writeRank + 1
      }
    }
    function emitGenerators(gntrStms) {
      // symbol available <=> all its generators are available
      // symbol available ? emit loop here : schedule in inner scope
      //
      // 1. group generators by symbol
      // 2. emit loops for available symbols here
      // 3. recurse to emit nested loops as they become available
      //
      // Note: this is like LMS scheduling. Go outside in, pick
      // what should live at current level. Assume that each loop
      //
      //    ** EMITTED EXACTLY ONCE **.
      //
      // We have 3 levels of dependencies:
      //
      // - assignment or generator to loop var or temporary (true data dep, raw)
      //    - if dep on temporary, really means the final value (rank), after all writes
      // - assignment on previous assignment (write after write)
      //    - synced by rank per temporary
      // - loop after loop (read after write), e.g. loop *B before loop *A
      //    - without this, we'd fill loops half and then detect order is wrong
      //
      // Note that kind 1 (generator on loop var dep) really only
      // covers dependency of one generator on another -- not of
      // one loop body on another generator!
      //
      // This means we're missing cases such as
      //
      //    data.*A.key -> data.*B.value
      //
      // because there is no dependency between *A and *B. Yet,
      // we have to generate a nested loop to make this work.
      //
      // (Of course only if we don't decorrelate!)
      //
      // Issues:
      //
      //  - We can of course force loops to be nested by
      //    lifting dependencies from assignments to gens.
      //  - But we also may have assignments that should
      //    *not* live in the nested loop!
      //
      //    So a generator may occur both in nested and
      //    top level position.
      //
      //
      // TODO: refinements
      // + uncorrelated loops
      //    - data.*A.key -> sum(data.*B.value)
      //    - XX: done by emitting temp var above
      // + generate 0 sum if no elements
      //    - total: sum(empty.*.value)
      //    - XX: done now, by emitting two assignments above
      // - loop fusion
      //    - same level, two generators with identical rhs
      //        for *A <- in.data ... for *B <- in.data
      // - direct cycles
      //    - data.*.foo.*.bar
      // - indirect cycles
      //    - data.*A.foo.*B.bar ... other.*B.baz.*A.boo
      //
      //
      let gensBySym = {}
      // group generators by symbol
      for (let e of generatorStms) {
        if (!gensBySym[e.sym]) gensBySym[e.sym] = []
        gensBySym[e.sym].push(e)
      }
      function symGensAvailable(s) {
        return gensBySym[s].every(depsAvailable) &&
          extraDepsAvailable(extraLoopDeps[s])
      }
      // compute generators left for inner scope
      generatorStms = []
      let availableGenSyms = {} // to prevent nesting unwanted generators
      for (let s in gensBySym) {
        if (!symGensAvailable(s))
          generatorStms.push(...gensBySym[s])
        else
          availableGenSyms[s] = true
      }
      // emit generators (only available ones)
      for (let s in availableGenSyms) {
        if (!symGensAvailable(s)) continue
        let [e, ...es] = gensBySym[s] // just pick first -- could be more clever!
        // remove gensBySym[s] from generatorStms (we're emitting it now)
        generatorStms = generatorStms.filter(e => e.sym != s)
        // loop header
        emit("for (let " + quoteVar(e.sym) + " in " + e.rhs + ") {")
        // filters
        for (let e1 of es) {
          emit("if (!" + e1.rhs + "[" + quoteVar(e1.sym) + "]) continue")
        }
        // recurse!
        availableSyms[s] = true
        emitConvergence()
        // XX here: nested loops
        // figure out which statements need nested loops
        // XX done
        delete availableSyms[s]
        emit("}")
        emittedLoopSyms[s] = true
        emitAssignments() // any assignments that became available (temp after loop)
      }
    }
    function emitConvergence() {
      // emit assignments + generator as long as we're making progress
      // (assignments may need multiple calls b/c effect deps)
      let codeLength
      do {
        do {
          codeLength = code.length
          emitAssignments()
        } while (codeLength < code.length)
        emitGenerators()
      } while (codeLength < code.length)
    }
    // XXX
    emitConvergence()

    // TODO(supun): hack!! for generators that need to be emitted multiple times
    //              look at test/advanced.js: this is needed when accessing "reified intermediates"
    if (assignmentStms.length > 0) {
      print("WARN - re-emitting generators because assignments remaining")
      emit("// --- repeated generators ---")
      // if assignments remaining, re-generate the generators required and emit the symbols
      let gensBySym = {}
      for (let e of generatorStmsCopy) {
        if (!gensBySym[e.sym]) gensBySym[e.sym] = []
        gensBySym[e.sym].push(e)
      }

      // right not emitting generators required per assignment (very naive!)
      // (i.e., not sharing generators even if possible)
      for (let e of assignmentStms) {
        // emit the corresponding generators
        let neededGens = {}
        e.deps.filter(s => s.startsWith("*")).forEach(s => neededGens[s] = true)
        for (let s in neededGens) {
          emit("for (let " + quoteVar(s) + " in " + gensBySym[s][0].rhs + ") {")
        }
        emit(e.txt)
        for (let s in neededGens) {
          emit("}")
        }
      }
      assignmentStms = [] // we have emitted all remaining assignments
    }

    if (assignmentStms.length) {
      print("ERROR - couldn't emit the following assignments (most likely due to circular dependencies:")
      for (let e of assignmentStms) {
        print(e.txt + " ---- " + e.deps)
      }
    }
    //
    // wrap up codegen
    //
    emit("return " + res.txt)
    emit("}")
    if (trace)
      code.forEach(s => print(s))
    let codeString = code.join("\n")
    let queryFunc = eval(codeString)
    queryFunc.explain = explain
    queryFunc.explain.code = code
    //queryFunc.explain.codeString = codeString
    //
    // execute
    //
    return queryFunc
  }
}