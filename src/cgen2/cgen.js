// Driver for the c-new backend. Replaces index.js.
//
// The difference is where the loop nest comes from. index.js lowers to its own
// statement IR and hands that to new-codegen, which re-derives the scheduling
// problem from writeSym/deps/writeRank. This driver schedules with opt-loopgen,
// which takes the problem directly as two arguments:
//
//   gens  = buildGenerators()         from filters
//   stmts = buildStatements(gens)     from assignments
//   { root, left } = schedule(gens, stmts)
//
// All three are reused as they are. Nothing in them is specific to a target
// language: buildGenerators only groups filters by variable and drops
// maybe-mode ones that are shadowed, and buildStatements only forwards
// analysis simple-eval already did -- q.fre, q.bnd, q.ext, q.extInit, q.tmps.
// Its one predicate that looked backend-ish, initRequired, is character for
// character what lower.js already computes as needsInit.
//
// So the split is: gens and stmts describe the *scheduling problem* and are
// shared; the tree schedule() returns describes *emitted code* and is ours to
// shape (see below).
//
// What this buys over new-codegen: PROJECT/TRAVERSE for statements whose
// iteration domain is wider than their output, maybe-mode filters for outer
// joins, and loops that can name the element they bind.
//
// Status: skeleton. Not wired into simple-eval -- backend "c-new" still goes
// through index.js.

const { buildGenerators, buildStatements, schedule } = require('../opt-loopgen')
const { symbol } = require('./symbol')

// NOTE: simple-eval calls setOptLoopgenState(backendIR) at simple-eval.js:970,
// before it dispatches on settings.backend at :985, so `settings`, `vars`,
// `filters` and `assignments` are already live inside opt-loopgen by the time
// this driver runs. Nothing to set up here.


// ----- the low-level tree -----
//
// Shaped for C, not borrowed from simple-loopgen. The scheduler only needs to
// know which loops a statement sits inside; what the nodes carry past that is
// ours to choose, and emitStmListLowLevel's shapes answer to JS instead:
//
//   - it nests a guard as its own `if` node with a body, because JS emits
//     `if (...) {` and closes it. C wants `if (...) continue;` at the top of
//     the body, so guards belong *on* the loop, flat, the way index.js already
//     keeps them in `gens`
//   - it has no place for the element a loop binds. yyjson_arr_foreach,
//     yyjson_obj_iter and rh_iter_next all hand one back, and using it is the
//     difference between walking the array once and walking it per row -- so
//     the loop node names it and the body reads it instead of re-indexing
//   - its init/update carry the raw assignment and re-derive at emit time.
//     cgen2 already has a statement IR built for this (ir.js), so keep it
//
//   { k: "loop", v, cvar, src, elem, guards, body }
//     v       the query's variable (*A) -- what the scheduler matches on
//     cvar    the same name as a C identifier (xA); collapsing the two emits
//             `rh_val *A`, which C reads as a pointer declaration
//     src     expression being iterated; its schema picks the loop form
//     elem    C symbol bound to the current element, or null when the loop
//             form does not expose one
//     guards  [src, ...] that must also have an entry at v, emitted as
//             `if (rh_is_undef(...)) continue;` at the top of the body
//
//   { k: "bind", cvar, src }      one-element source: a declaration, no loop.
//                                index.js emits these as a full rh_iter over
//                                rh_singleton, which allocates a map to walk
//                                one entry, several times per program
//   { k: "stmt", stmt }           ir.js's s.init / s.initCopy / s.update /
//                                s.groupUpdate, unchanged
//   { k: "result", expr }         what to print; emitted natively when the
//                                value is a cScalar, via rh_print_val otherwise
//
// Open question: how a projected statement arrives. opt-loopgen emits its own
// project-then-traverse nest and only at the top level. The projection temp
// has to be declared and filled, which is a statement, so this may need a
// `project` node rather than falling out of `loop` + `stmt`.

// schedule()'s output -> the tree above. This is where opt-loopgen's node
// shapes are translated into cgen2's, and where each loop decides its form
// (array / object / dynamic) and so what element it can bind.
let buildTree = (root, gens, stmts) => {
  throw new Error("cgen2: buildTree not implemented")
}


// ----- emission -----

let emitTree = (nodes, buf, ctx) => {
  throw new Error("cgen2: emitTree not implemented")
}

// Declarations, prolog, body, result. Keeps index.js's retry: a tmp that turns
// out not to be able to stay native is dropped to boxed and the body re-emitted.
let emitProgram = (tree, res, ctx) => {
  throw new Error("cgen2: emitProgram not implemented")
}


// ----- entry point -----

// Same contract as index.js's generateCNew: returns a promise of an async
// function that runs the compiled program and parses its stdout.
let generateCNew = (q, ir, settings) => {
  symbol.reset()

  let gens = buildGenerators()
  let stmts = buildStatements(gens)
  let { root, left } = schedule(gens, stmts)

  // The js driver only warns about statements it could not place, and returns
  // a partial program. A C program that silently drops a statement compiles
  // and runs, so this has to be fatal here.
  if (left.length)
    throw new Error("c-new: opt-loopgen could not place " + left.length +
      " statement(s)")

  throw new Error("cgen2: generateCNew (cgen.js) not implemented")
}

module.exports = { generateCNew, buildTree, emitTree, emitProgram }
