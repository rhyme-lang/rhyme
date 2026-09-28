// simple-eval IR -> logical statement IR for the c-new backend.
//
// This mirrors translateToNewCodegen (src/simple-codegen.js:1335-1447), not the
// schema-directed walk in src/cgen/. The JS backend is already the general,
// schema-free path -- it emits calls into simple-runtime.js and handles
// arbitrary JSON -- so following its structure is what gets c-new general JSON
// support. The only difference is the payload: where the JS translation builds
// a string of runtime calls, this builds IR nodes that emit.js lowers to C.

const { sets } = require('../shared')
const { runtime } = require('../simple-runtime')
const { pretty } = require('../prettyprint')
const { s, gen } = require('./ir')

const { union } = sets

// new-codegen distinguishes tmp references from loop variables purely by
// prefix: istmp = s => s.startsWith("tmp") (new-codegen.js:78-79). Loop
// variables must therefore never start with "tmp".
let tmpSym = i => "tmp-" + i

let quoteVar = s => s.replaceAll("*", "x")

let lower = (q, assignments, filters) => {
  let assignmentStms = []
  let generatorStms = []
  let tmpVarWriteRank = {}

  let getDeps = q => [...q.fre, ...q.tmps.map(tmpSym)]

  // Same bookkeeping as the JS and C translations: new-codegen schedules on
  // writeSym/deps/writeRank, and only the payload differs.
  let assign = (payload, lhs_root_sym, lhs_deps, rhs_deps) => {
    let stm = {
      txt: payload,
      deps: [...lhs_deps, ...rhs_deps],
      lhs: { txt: "LHS", deps: lhs_deps },
      op: "=?=",
      rhs: { txt: "RHS", deps: rhs_deps },
      writeSym: lhs_root_sym,
    }
    stm.deps = stm.deps.filter(d => d != stm.writeSym) // remove self-cycles
    tmpVarWriteRank[stm.writeSym] ??= 1
    stm.writeRank = tmpVarWriteRank[stm.writeSym]
    tmpVarWriteRank[stm.writeSym] += 1
    assignmentStms.push(stm)
  }

  // ----- expressions -----
  //
  // Statements carry simple-eval's own expression nodes, unchanged. An earlier
  // version renamed them into a parallel set here, which turned out to be
  // almost purely a rename -- emit.js reads them directly instead, through the
  // three accessors at the top of that file, and rejects what it cannot
  // generate as it walks them.

  // ----- assignments -----

  for (let i in assignments) {
    let q = assignments[i]
    let sym = tmpSym(i)
    let path = q.fre.map(quoteVar)

    // initialization -- gated on <op>_init existing in the JS runtime, the
    // same test both existing backends use (cgen/codegen.js:76)
    let needsInit =
      q.key == "stateful" && q.mode != "maybe" && (q.op + "_init") in runtime.stateful ||
      q.key == "update"
    if (needsInit) {
      let init_deps = []
      if (q.key == "update") {
        let init_arg = q.arg[0]
        init_deps = [...init_arg.fre, ...init_arg.tmps.map(tmpSym)]
        assign(s.initCopy(i, path, init_arg), sym, q.fre, init_deps)
      } else {
        assign(s.init(i, path, q.op, q.schema?.type), sym, q.fre, init_deps)
      }
    }

    // update
    {
      let fv = union(q.fre, q.bnd)
      let deps = [...fv, ...q.tmps.map(tmpSym)]

      if (q.key == "stateful") {
        assign(s.update(i, path, q.op, q.arg[0], q.schema?.type), sym, q.fre, deps)
      } else if (q.key == "update") {
        let keys = q.arg[1].vars.map(quoteVar)
        assign(s.groupUpdate(i, path, keys, q.arg[2]), sym, q.fre, deps)
      } else {
        throw new Error("c-new: unsupported assignment " + q.key + " in " + pretty(q))
      }
    }
  }

  // ----- generators -----

  for (let i in filters) {
    let f = filters[i]
    let src = f.arg[0]
    let sym = f.arg[1].op
    let g = gen(sym, quoteVar(sym), src)
    g.txt = "FOR"
    g.deps = getDeps(f.arg[0])
    generatorStms.push(g)
  }

  let res = { txt: q, deps: getDeps(q) }

  return { assignmentStms, generatorStms, tmpVarWriteRank, res }
}

module.exports = { lower, tmpSym }
