// Logical IR for the c-new backend.
//
// The existing C backend renders C text during the tree walk, so by the time
// new-codegen schedules a statement its payload is already a string. These
// nodes are what c-new carries instead: the statement keeps its structure
// through scheduling, and emit.js turns the scheduled program into C.
//
// Deliberately close to the shape of src/simple-runtime.js, because the JS
// backend is the reference semantics and every node here lowers to a call into
// the matching rh_* function in runtime/rhyme_rt.h.

// ----- expressions -----

let e = {}

e.const = (v) => ({ k: "const", v })

// A JSON file named by the query, as in the "c" backend: the generated program
// opens it itself rather than having data marshalled in from the caller.
e.load = (fmt, path) => ({ k: "load", fmt, path })
e.var = (name) => ({ k: "var", name })

// tmp<sym> indexed by the free variables it is grouped under
e.ref = (sym, path) => ({ k: "ref", sym, path })

e.get = (obj, key) => ({ k: "get", obj, key })
e.pure = (op, args) => ({ k: "pure", op, args })
e.mkset = (arg) => ({ k: "mkset", arg })

// ----- statements -----
//
// One of these is the payload of an assignment statement, in place of the
// string the other backends put there.

let s = {}

// tmp<sym>[path...] = <op>_init(), if not already set
s.init = (sym, path, op, schema) => ({ k: "init", sym, path, op, schema })

// tmp<sym>[path...] = <init>, a fresh copy for group/update assignments
s.initCopy = (sym, path, expr) => ({ k: "initCopy", sym, path, expr })

// tmp<sym>[path...] = <op>(previous, arg)
s.update = (sym, path, op, arg, schema) => ({ k: "update", sym, path, op, arg, schema })

// tmp<sym>[path...][keys...] = value  -- the group/update fold
s.groupUpdate = (sym, path, keys, value) =>
  ({ k: "groupUpdate", sym, path, keys, value })

// ----- generators -----
//
// A loop over the entries of `src`.
//
// Two names, deliberately: `sym` is the query's own variable (*A), which
// new-codegen matches dependencies on, and `cvar` is the same name quoted into
// a C identifier (xA). Collapsing them emits `rh_val *A`, which C reads as a
// pointer declaration.
let gen = (sym, cvar, src) => ({ k: "gen", sym, cvar, src })

let isExpr = (x) => x && typeof x === "object" && typeof x.k === "string"

module.exports = { e, s, gen, isExpr }
