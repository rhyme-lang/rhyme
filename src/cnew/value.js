// Value representations for the c-new backend (src/c-codegen.js).
//
// A value describes *where a C expression lives and how to read it*, not a
// runtime object: everything here is compile-time metadata. Expression
// emitters return values; statements consume them through the accessors at
// the bottom, never by reading `expr` directly. That keeps the choice of
// representation local to this file and the emitters that produce it.
//
// Fields common to every representation:
//
//   repr     which representation (REPR below)
//   schema   the type checker's annotation of the IR node it came from
//            ({ type, props }), or undefined. Carried for later
//            specialization; nothing reads it yet.
//
// ----- representations -----
//
//   boxed    expr is a C rvalue of type rh_val -- the tagged union of
//            runtime/rhyme_rt.h. Handles any value, including absence
//            (RH_UNDEF), so it needs no separate optionality flag.
//
// Planned, as the backend specializes on schemas (cf. cgen/value.js and the
// ran/cgen branch's cgen2/value.js):
//
//   scalar   a C rvalue of a concrete type (uint32_t, double, ...)
//   str      const char* + length, borrowed from the input or a literal
//   json     yyjson_val*, borrowed from the input document
//
// Unboxed representations have no spare state for "missing", so they will
// carry it beside the value as `cond`: a C boolean expression that is true
// when the value is absent. condOf/presentOf already answer for any repr, so
// call sites written against them will not change when those arrive.

const REPR = {
  BOXED: "boxed",
}

let value = {}

value.boxed = (expr, schema) => ({ repr: REPR.BOXED, expr, schema })

let isBoxed = x => x.repr === REPR.BOXED

let unknownRepr = x => {
  throw new Error("c-new: unknown value representation " + JSON.stringify(x))
}

// The value in boxed representation: itself if already boxed, otherwise a
// conversion to rh_val. The single boundary where a value becomes boxed;
// every rh_* runtime call takes its arguments through here, as .expr.
let asBoxed = x => {
  if (isBoxed(x)) return x
  return unknownRepr(x)
}

// C predicate that is true when the value is missing, or null when it
// statically cannot be.
let guard = x => {
  if (isBoxed(x)) return `rh_is_undef(${x.expr})`
  return unknownRepr(x)
}

// C predicate that is true when the value is present ("true" if always).
let presentOf = x => {
  let c = guard(x)
  if (c === null) return "true"
  if (isBoxed(x)) return "!" + c // a call: no parentheses needed
  return `!(${c})`
}

module.exports = { REPR, value, isBoxed, asBoxed, guard, presentOf }
