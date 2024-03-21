const { quoteVar, debug, trace, print, inspect, error, warn } = require("./utils")
const { scc } = require('./scc')

function buildDeps(assignmentStms, generatorStms, tmpVarWriteRank) {

  let nodes = []

  let deps = {}

  let assignByTmp = {}

  let assign2Node = {}
  for (let i in assignmentStms) {
    let e = assignmentStms[i]
    assignByTmp[e.writeSym] ??= []
    deps[nodes.length] ??= {}
    assignByTmp[e.writeSym].push(i)
    nodes.push({type: "stmt", val: e})
    assign2Node[i] = nodes.length - 1
  }

  let tmp2Node = {}
  for (let t in assignByTmp) {
    let assigns = assignByTmp[t]
    tmp2Node[t] = assign2Node[assigns.at(-1)]
  }

  let gensBySym = {}
  for (let e of generatorStms) {
    gensBySym[e.sym] ??= []
    gensBySym[e.sym].push(e)
  }

  let gen2Node = {}
  for (let e in gensBySym) {
    deps[nodes.length] ??= {}
    nodes.push({type: "gen", val: e, data: gensBySym[e]})
    gen2Node[e] = nodes.length - 1
  }

  // Build dependencies

  let isloop = s => s.startsWith("*")
  let istmp = s => s.startsWith("tmp")
  // Assign
  for (let i in assignmentStms) {
    let n = assign2Node[i]
    let e = assignmentStms[i]
    for (let v of e.deps) {
        if (isloop(v)) deps[n][gen2Node[v]] = true
        if (istmp(v)) deps[n][tmp2Node[v]] = true
    }
  }

  for (let t in assignByTmp) {
    let assigns = assignByTmp[t]
    for (let i in assigns) {
      if (i > 0) {
        let prev = assign2Node[assigns[i - 1]]
        let curr = assign2Node[assigns[i]]
        deps[curr][prev] = true
      }
    }
  }

  for (let e in gensBySym) {
    let gens = gensBySym[e]
    let n = gen2Node[e]
    for (let gen of gens) {
      for (let v of gen.deps) {
          if (isloop(v)) deps[n][gen2Node[v]] = true
          if (istmp(v)) deps[n][tmp2Node[v]] = true
      }
    }
  }

  let order = scc(Object.keys(deps), x => Object.keys(deps[x])).reverse()

  for (let is of order) {
    if (is.length > 1) console.error('cycle!')
  }

  // All transitive stmtdeps
  let stmtdeps = {}
  let loopdeps = {}

  let dfs = (n, curr, dp, follow) => {
    if (n != curr) {
      if (dp[n][curr]) return
      else dp[n][curr] = true
    }
    for (let pre in deps[curr]) {
      if (deps[curr][pre] && follow(n, curr, pre)) {
        dfs(n, pre, dp, follow)
      }
    }
  }

  let stmtFollow = (root, curr, pre) => true
  let loopFollow = (root, curr, pre) => nodes[pre].type === "gen"
  for (let n in deps) {
    let node = nodes[n]
    if (node.type === "stmt") {
      stmtdeps[n] = {}
      dfs(n, n, stmtdeps, stmtFollow)
      for (let p in stmtdeps[n]) {
        if (nodes[p].type !== "stmt") {
          delete stmtdeps[n][p]
        }
      }
      loopdeps[n] = {}
      dfs(n, n, loopdeps, loopFollow)
      for (let p in loopdeps[n]) {
        delete loopdeps[n][p]
        loopdeps[n][nodes[p].val] = true
      }
    }
  }

  let stmt2stmtByLoop = {}

  for (let t in stmtdeps) {
    stmt2stmtByLoop[t] = {}
    let inLoop = nodes[t].val.deps.filter(x => isloop(x))
    for (let p in stmtdeps[t]) {
      stmt2stmtByLoop[t][p] = {}
      if (nodes[p].val.writeSym != nodes[t].val.writeSym) {
        for (let l of nodes[p].val.deps) {
          if (isloop(l) && !inLoop.includes(l)) {
            stmt2stmtByLoop[t][p][l] = true
          }
        }
      }
    }
  }

  return { nodes, assignByTmp, gensBySym, stmtdeps, loopdeps, stmt2stmtByLoop, assign2Node, tmp2Node, gen2Node }
}

exports.generate = (ir) => {
  let assignmentStms = ir.assignmentStms
  let generatorStms = ir.generatorStms
  let tmpVarWriteRank = ir.tmpVarWriteRank

  let deps = buildDeps(assignmentStms, generatorStms, tmpVarWriteRank)
  let stmtdeps = deps.stmtdeps
  let loopdeps = deps.loopdeps
  let assignByTmp = deps.assignByTmp
  let gensBySym = deps.gensBySym
  let stmt2stmtByLoop = deps.stmt2stmtByLoop

  let res = ir.res
  //
  // debug information
  //
  let explain = {}
  explain.src = ir.query

  //
  // init codegen
  //
  let code = []
  let indent = 0
  function emit(str) {
      if (str.indexOf("}") == 0) indent--
      code.push("".padEnd(indent * 4, ' ') + str)
      //console.log("".padEnd(indent * 4, ' ') + str + "\n")
      if (str.indexOf("{") >= 0) indent++
      if (str.indexOf("}") > 0) indent--
  }
  emit("inp => {")
  emit("let tmp = {}")
  if (debug) {
      print("---- begin code ----")
      for (let e of assignmentStms)
          if (e.txt.indexOf("??=") < 0) // skip init stmts
              print(e.txt + "  // " + e.writeSym + " #" + e.writeRank + " <- " + e.deps)
      print("return " + res.txt)
      print("---- end code ----")
  }
  explain.ir = {}
  explain.ir.assignments = [...assignmentStms]
  explain.ir.generators = [...generatorStms]
  let generatorStmsCopy = [...generatorStms] // TODO(supun): temporary fix

  explain.dependencies = { stmtdeps }
  if (debug) {
      inspect({ stmtdeps })
      print("---- end dependency data ----")
  }
  //
  //
  let openedLoops = [] // currently available in scope (for loops)
  let emittedStmts = {}
  let closedLoopByStmt = {}   // closed loops for each assignment

  for (let s in stmtdeps) {
    closedLoopByStmt[s] ??= {}
  }

  let isloop = s => s.startsWith("*")
  let istmp = s => s.startsWith("tmp")

  let getStmt = i => assignmentStms[i]
  let makeUnique = a => a.filter(function(item, pos) {
    return a.indexOf(item) == pos
  })
  let getLoops = e => makeUnique(e.deps.filter(isloop))
  let isOpened = l => openedLoops.includes(l)

  function stmtClosed(curr, dep) {
    return Object.keys(stmt2stmtByLoop[curr][dep]).every(l => closedLoopByStmt[dep][l])
  }
  let stmtEmitted = e =>  emittedStmts[e]
  function stmtAvailable(curr, dep) {
    return stmtEmitted(dep) && stmtClosed(curr, dep)
  }
  function stmtDepsEmitted(e) {
    return Object.keys(stmtdeps[e]).every(stmtEmitted)
  }
  function stmtDepsAvailable(e) {
    return Object.keys(stmtdeps[e]).every(dep => stmtAvailable(e, dep))
  }
  function inLoops(e) {
    let stmt = getStmt(e)
    return stmt.deps.filter(x => isloop(x)).every(l => isOpened(l))
  }
  function stmtEmittable(e) {
    return inLoops(e) && stmtDepsAvailable(e)
  }
  function filterDepsAvailable(stmts) {
    return stmts.filter(e => stmtDepsAvailable(e))
  }
  function filterEmittable(stmts) {
    return stmts.filter(e => stmtEmittable(e))
  }
  function filterNotEmittable(stmts) {
    return stmts.filter(e => !stmtEmittable(e))
  }
  function loopEmittable(l) {
    return (!isOpened(l)) && gensBySym[l].every(x => getLoops(x).every(l2 => l2 === l || isOpened(l2)))
  }
  function emitStatement(i) {
    let e = getStmt(i)
    emit(e.txt)
    emittedStmts[i] = true
    for (let v of e.deps) {
      if (isloop(v)) closedLoopByStmt[i][v] = false
    }
  }
  function emitLoopProlog(s) {
    let [e, ...es] = gensBySym[s] // just pick first -- could be more clever!
    // loop header
    emit("for (let " + quoteVar(e.sym) + " in " + e.rhs + ") {")
    // filters
    for (let e1 of es) {
        emit("if (" + e1.rhs + "[" + quoteVar(e1.sym) + "] === undefined) continue")
    }

    // recurse!
    openedLoops.push(s)
  }
  function emitLoopEpilog() {
    l = openedLoops.pop()
    emit("}")
    // XXX could be optimized by a two-directional map
    for (let i in closedLoopByStmt) {
      let stmt = getStmt(i)
      if (stmt.deps.includes(l) && closedLoopByStmt[i][l] === false) {
        closedLoopByStmt[i][l] = true
      }
    }
  }
  function emitCode(stmts) {
    while(filterDepsAvailable(stmts).length > 0) {
      let emittableStmts = filterEmittable(stmts)
      stmts = filterNotEmittable(stmts)
      while (emittableStmts.length > 0) {
        emittableStmts.forEach(emitStatement)
        emittableStmts = filterEmittable(stmts)
        stmts = filterNotEmittable(stmts)
      }

      if (stmts.length == 0) return stmts

      let emittableAfterLoop = filterDepsAvailable(stmts)

      if (emittableAfterLoop.length == 0) return stmts

      let loopStmtCount = {}
      for (let i of emittableAfterLoop) {
        let loops = loopdeps[i]
        for (let l in loops) {
          if (loopEmittable(l)) {
            loopStmtCount[l] ??= 0
            loopStmtCount[l] += 1
          }
        }
      }

      if (Object.keys(loopStmtCount).length == 0) {
        throw new Error("No emittable loops")
      }

      let maxGen
      for (let l in loopStmtCount) {
        maxGen ??= l
        if (loopStmtCount[l] > loopStmtCount[maxGen]) maxGen = l
      }

      emitLoopProlog(maxGen)
      let innerStmts = stmts.filter(i => loopdeps[i][maxGen])
      let remainingStmts = emitCode(innerStmts)
      emitLoopEpilog()
      if (innerStmts.length == remainingStmts.length) {
        throw new Error("No progress")
      }
      stmts = stmts.filter(i => !innerStmts.includes(i) || remainingStmts.includes(i))
    }
    return stmts
  }

  // Let's assume we do not have circular dependencies in tmps for now
  let stmts = Object.keys(assignmentStms)
  stmts = emitCode(stmts)

  if (stmts.length > 1) {
    warn("ERROR - couldn't emit the following assignments (most likely due to circular dependencies:")
    for (let i of stmts) {
      let e = getStmt(i)
      warn(e.txt + " ---- " + e.deps)
    }
    console.error("remaining assignments")
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