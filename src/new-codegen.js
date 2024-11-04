const { quoteVar, debug, trace, print, inspect, error, warn } = require("./utils")
const { scc } = require('./scc')
const { runtime } = require('./simple-runtime')

// The new codegen guarantees the following key features:
//    1. statement (assignment) will only be emitted once
//    2. a loop maybe generated multiple times
//    3. a statement will be emitted inside and only inside the loops it depends on,
//       this means we will never emit a statement inside irrelevant loops
//    4. the statements will be emitted while faithfully following the dependencies
//       between them
// We also try to fuse different statements' loops together as mch as possible.


// This function generate the following dependencies:
//   1. stmtdeps: the transitive assignment (statement) to assignment dependencies.
//                As long as we emit assignment following the topological
//                order of these dependencies, the generated code is correct
//   2. loopdeps: all the generators (loops) that an assignment depends on.
//   3. stmt2stmtByLoop: if statement s1 depends on s2, this tracks the
//                       loops of s2 that need to be closed for s1 to be emittable
//                       This is needed for aggregation statements. We need
//                       to wait for all dependent loops to close for the
//                       aggregation to be fully materialized.
//   4. stmt2stmtloopAfterloop: if assignment s1 depends on s2, this tracks the pair of
//                              loops (l1, l2) such that: s1 depends on l1, s2 depends
//                              on l2 and s1's l1 needed to be emitted after s2's l2.
//                              This gives an ordering of loops and will be used in the
//                              heuristic for loop scheduling.
function buildDeps(assignmentStms, generatorStms, tmpVarWriteRank) {

  // stores all the assignment and generator nodes, we use the rank of nodes
  // as id for assignments
  let nodes = []

  let deps = {}

  // First: generate nodes for assignment and generator

  // group assignments by their write sym
  let assignByTmp = {}

  // This records the nodes for each assignment
  let assign2Node = {}
  for (let i in assignmentStms) {
    let e = assignmentStms[i]
    assignByTmp[e.writeSym] ??= []
    deps[nodes.length] ??= {}
    assignByTmp[e.writeSym].push(i)
    nodes.push({type: "stmt", val: e})
    assign2Node[i] = nodes.length - 1
  }

  // This records the last assignment node for each tmp
  let tmp2Node = {}
  for (let t in assignByTmp) {
    let assigns = assignByTmp[t]
    tmp2Node[t] = assign2Node[assigns.at(-1)]
  }

  // group generators by their sym
  let gensBySym = {}
  for (let e of generatorStms) {
    gensBySym[e.sym] ??= []
    gensBySym[e.sym].push(e)
  }

  // This records the nodes for each generator sym
  let gen2Node = {}
  for (let e in gensBySym) {
    deps[nodes.length] ??= {}
    nodes.push({type: "gen", val: e, data: gensBySym[e]})
    gen2Node[e] = nodes.length - 1
  }

  // Second: Build dependencies

  let isloop = s => !istmp(s) // s.startsWith("*")
  let istmp = s => s.startsWith("tmp")

  // assignment dependencies
  for (let i in assignmentStms) {
    let n = assign2Node[i]
    let e = assignmentStms[i]
    for (let v of e.deps) {
      // loop dependencies
      if (isloop(v)) deps[n][gen2Node[v]] = true
      // tmp dependencies, depends on the last assignment to the tmp
      if (istmp(v)) deps[n][tmp2Node[v]] = true
    }
  }

  // For each tmp, the i-th assignment to it should depend on the (i-1)-th
  // assignment.
  // This enforce a strict ordering of assignments to the same tmp
  // XXX: do we need to enforce this? The old codegen does not
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

  // generator dependencies
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

  // check whether we have circular dependencies
  for (let is of order) {
    if (is.length > 1) console.error('cycle!')
  }

  // transitive stmt (assignment) to stmt dependencies
  // if s1 depends on loop l and l depends on s2,
  // s1 transitively depends on s2.
  // if s1 depends on s2 and s2 depends on s3,
  // s1 transitively depends on s3.
  // This computes all the prerequisite stmts for a stmt
  let stmtdeps = {}
  // This records all loops that a stmt transitively depends on
  // if s1 depends on l1 and l1 depends on l2, s1 depends on l2
  // however, if s1 depends on l1, l1 depends on s2 and s2 depends
  // on l2, s1 does not depend on l2
  // We only track stmt -> loop and loop -> loop deps here
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
  let stmt2stmtloopAfterloop = {}

  let stmt2loops = Object.keys(stmtdeps).map(s => nodes[s].val.deps.filter(x => isloop(x)))

  // If s1 depends on s2. s1 depends on l1, l2. And s2 depends on l2, l3
  // Then s1 need to wait for s2's l3 loop to close.
  // s1 does not need to wait for s2's l2 to close because s1 also resides in l2
  // Also, s1's l1 need to be scheduled after s2's l3. Because we do not want to nest
  // s1's l1 and s2's l3. We only emit stmt inside the loops it depends on.
  // XXX: even if s1 and s2 both reside in l2, can they always be put in the same l2 loop?
  //      if not, s1 may also need to wait for s2's l2 to close
  for (let t in stmtdeps) {
    stmt2stmtByLoop[t] = {}
    stmt2stmtloopAfterloop[t] = {}
    let curloops = stmt2loops[t]
    for (let p in stmtdeps[t]) {
      stmt2stmtByLoop[t][p] = {}
      stmt2stmtloopAfterloop[t][p] = {}
      if (nodes[p].val.writeSym != nodes[t].val.writeSym) {
        let preloops = stmt2loops[p]
        for (let l of preloops) {
          if (!curloops.includes(l)) {
            // t need to wait for p's l to close
            stmt2stmtByLoop[t][p][l] = true
            for (let l1 of curloops) {
              if (!preloops.includes(l1)) {
                // t -> l1, p -> l and t -> p
                // if t does not depend on l and p does not depend on l1
                // t's l1 need to be scheduled after p's l
                stmt2stmtloopAfterloop[t][p][l1] ??= {}
                stmt2stmtloopAfterloop[t][p][l1][l] = true
              }
            }
          }
        }
      }
    }
  }

  return { nodes, assignByTmp, gensBySym, stmtdeps, loopdeps, stmt2stmtByLoop, stmt2stmtloopAfterloop, assign2Node, tmp2Node, gen2Node }
}

exports.generate = (ir, backend = "js") => {
  let assignmentStms = ir.assignmentStms
  let generatorStms = ir.generatorStms
  let tmpVarWriteRank = ir.tmpVarWriteRank

  let deps = buildDeps(assignmentStms, generatorStms, tmpVarWriteRank)
  let nodes = deps.nodes
  let stmtdeps = deps.stmtdeps
  let loopdeps = deps.loopdeps
  let assignByTmp = deps.assignByTmp
  let gensBySym = deps.gensBySym
  let stmt2stmtByLoop = deps.stmt2stmtByLoop
  let stmt2stmtloopAfterloop = deps.stmt2stmtloopAfterloop

  let res = ir.res
  let prolog = ir.prolog
  let epilog = ir.epilog
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
  if (backend == "cpp" || backend == "c-sql") {
    prolog.forEach(emit)
  } else if (backend == "js") {
    emit("inp => {")
    emit("let tmp = {}")
  } else {
    console.error(`unsupported backend : ${backend}`)
    return
  }
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

  explain.dependencies = { nodes, stmtdeps, loopdeps, stmt2stmtByLoop }
  if (debug) {
    inspect({ stmtdeps })
    print("---- end dependency data ----")
  }

  let openedLoops = []  // currently opened loops in scope
  let emittedStmts = {} // emitted statements
  let closedLoopByStmt = {}   // closed loops for each statement

  for (let s in stmtdeps) {
    closedLoopByStmt[s] ??= {}
  }

  let isloop = s => !istmp(s) // s.startsWith("*")
  let istmp = s => s.startsWith("tmp")

  let getStmt = i => assignmentStms[i]
  let makeUnique = a => a.filter(function(item, pos) {
    return a.indexOf(item) == pos
  })
  // get the loops that a statement needs to reside in
  let getLoops = e => makeUnique(e.deps.filter(isloop))
  // check whether a loop is opened
  let isOpened = l => openedLoops.includes(l)

  function stmtClosed(curr, dep) {
    return Object.keys(stmt2stmtByLoop[curr][dep]).every(l => closedLoopByStmt[dep][l])
  }
  let stmtEmitted = e =>  emittedStmts[e]
  // check whether dep is fully materialized (available) with respect to curr, it checks:
  //    1. dep is emitted
  //    2. with respect to curr, all the loops of dep that need to be closed is now closed
  function stmtAvailable(curr, dep) {
    return stmtEmitted(dep) && stmtClosed(curr, dep)
  }
  function stmtDepsEmitted(e) {
    return Object.keys(stmtdeps[e]).every(stmtEmitted)
  }
  // check whether all the prerequisite statements of a statement are available
  function stmtDepsAvailable(e) {
    return Object.keys(stmtdeps[e]).every(dep => stmtAvailable(e, dep))
  }
  // check whether a statement's loops are all opened
  function inLoops(e) {
    return getLoops(getStmt(e)).every(isOpened)
  }
  // check whether a statement is emittable
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
  // check whether a loop is emittable
  function loopEmittable(l) {
    return (!isOpened(l)) && gensBySym[l].every(x => getLoops(x).every(l2 => l2 === l || isOpened(l2)))
  }
  function emitStatement(i) {
    let e = getStmt(i)
    if (backend == "c-sql") {
      e.txt.map(emit)
    } else {
      emit(e.txt)
    }
    emittedStmts[i] = true
    // initialize closedLoopByStmt
    // when a statement is emitted, all of its loops are not closed
    for (let v of e.deps) {
      if (isloop(v)) closedLoopByStmt[i][v] = false
    }
  }
  function emitLoopProlog(s) {
    let [e, ...es] = gensBySym[s] // just pick first -- could be more clever!
    // loop header
    if (backend == "cpp") {
      emit(e.loopTxt)
      // TODO: support multiple filters
    } else if (backend == "c-sql") { 
      let loops = gensBySym[s]
      let loopTxts = loops.map(x => x.getLoopTxt())
      for (let loopTxt of loopTxts) {
        loopTxt.loadCSV.map(emit)
      }

      // initialize cursors for all loops
      for (let loopTxt of loopTxts) {
        loopTxt.initCursor.map(emit)
      }
      
      // emit comment line for each generated filter
      for (let loopTxt of loopTxts) {
        loopTxt.info.map(emit)
      }

      // we only want to emit the loop header for the first loop
      loopTxts[0].loopHeader.map(emit)

      // emit bounds checking for all loops
      for (let loopTxt of loopTxts) {
        loopTxt.boundsChecking.map(emit)
      }

      // emit row scanning for all loops
      for (let loopTxt of loopTxts) {
        loopTxt.rowScanning.map(emit)
      }
    } else if (backend == "js") {
      emit("for (let " + quoteVar(e.sym) + " in " + e.rhs + ") {")
      // filters
      for (let e1 of es) {
        emit("if (" + e1.rhs + "[" + quoteVar(e1.sym) + "] === undefined) continue")
      }
    } else {
      console.error(`unsupported backend : ${backend}`)
      return
    }

    openedLoops.push(s)
  }
  function emitLoopEpilog() {
    l = openedLoops.pop()
    emit("}")
    // XXX could be optimized by a two-directional map
    for (let i in closedLoopByStmt) {
      let stmt = getStmt(i)
      // update closedLoopByStmt
      if (stmt.deps.includes(l) && closedLoopByStmt[i][l] === false) {
        closedLoopByStmt[i][l] = true
      }
    }
  }
  // This function chooses the next loop to open using some heuristic
  function nextLoop(stmts, emittableAfterLoop) {
    // for each emittable loop, this records the number of available stmts that depend on it
    let availStmtCnt = {}
    // for each emittable loop, this records the number of stmts that depend on it
    let stmtCnt = {}
    for (let i of stmts) {
      let loops = loopdeps[i]
      for (let l in loops) {
        if (loopEmittable(l)) {
          stmtCnt[l] ??= 0
          stmtCnt[l] += 1
          if (emittableAfterLoop.includes(i)) {
            availStmtCnt[l] ??= 0
            availStmtCnt[l] += 1
          }
        }
      }
    }

    let newloop
    let loops = Object.keys(availStmtCnt)

    if (loops.length === 0) return newloop

    // a local loopAfterloop relation induced by currently in-scoped statements
    // Note: this order does not need to be strictly enforced, it is only
    //       used as a hint for the loop ordering.
    //       As long as we follow stmtdeps and stmt2stmtByLoop, the generated
    //       code is correct. We follow loopAfterloop only because we want to
    //       avoid closing a loop halfway due to stmt2stmtByLoop, and reopen it later!
    let loopAfterloop = {}

    for (let i of stmts) {
      for (let j of stmts) {
        if (j in stmt2stmtloopAfterloop[i]) {
          for (let li in stmt2stmtloopAfterloop[i][j]) {
            for (let lj in stmt2stmtloopAfterloop[i][j][li]) {
              if (!isOpened(li) && !isOpened(lj)) {
                loopAfterloop[li] ??= {}
                loopAfterloop[li][lj] = true
              }
            }
          }
        }
      }
    }

    // we want to schedule the loops that do not need to go after other loops
    let candidates = loops.filter(l => loopAfterloop[l] === undefined || Object.keys(loopAfterloop[l]).length === 0)
    if (candidates.length === 0) candidates = loops
    // heuristic used to select the new loop to open
    let greater = (l1, l2) => {
      if (availStmtCnt[l1] > availStmtCnt[l2]) return true
      else if (availStmtCnt[l1] === availStmtCnt[l2]) return stmtCnt[l1] > stmtCnt[l2]
      else return false
    }
    for (let l of candidates) {
      newloop ??= l
      if (greater(l, newloop)) newloop = l
    }
    return newloop
  }
  function emitCode(stmts) {
    // We re-iterate as long as we have some stmts that have all their prerequisite statements (stmtdeps) available
    while(filterDepsAvailable(stmts).length > 0) {
      let emittableStmts = filterEmittable(stmts)
      stmts = filterNotEmittable(stmts)
      while (emittableStmts.length > 0) {
        emittableStmts.forEach(emitStatement)
        emittableStmts = filterEmittable(stmts)
        stmts = filterNotEmittable(stmts)
      }

      if (stmts.length == 0) return stmts

      // These stmts have all their stmtdeps available, but do not have all their loops opened.
      // Therefore, we need to be smart about choosing which loop to open next -- we want to
      // put stmts into this new loop as much as possible. In another word, we want to fuse
      // the unopened loops of these stmts as much as possible.
      let emittableAfterLoop = filterDepsAvailable(stmts)

      if (emittableAfterLoop.length == 0) return stmts

      // We pick the next loop to open using some heuristic
      let newloop = nextLoop(stmts, emittableAfterLoop)

      if (newloop === undefined) {
        throw new Error("No emittable loops")
      }

      emitLoopProlog(newloop)
      // Note: we want to emit statements only inside the loops they depend on.
      //       So we filter out the stmts that do not depend on the new loop.
      let innerStmts = stmts.filter(i => loopdeps[i][newloop])
      // Recurse!!!
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
  if (backend == "cpp" || backend == "c-sql") {
    epilog.forEach(emit)
    let codeString = code.join("\n")
    return codeString
  } else if (backend == "js") {
    emit("return " + res.txt)
    emit("}")
    if (trace)
        code.forEach(s => print(s))
    let codeString = code.join("\n")
    // console.log(codeString)
    let rt = runtime // make available in scope for generated code
    let queryFunc = eval(codeString)
    queryFunc.explain = explain
    queryFunc.explain.code = code
    queryFunc.explain.codeString = codeString
    //
    // execute
    //
    return queryFunc
  } else {
    console.error(`unsupported backend : ${backend}`)
    return
  }
}