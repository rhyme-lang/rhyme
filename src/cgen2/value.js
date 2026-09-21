// Value representation for the c-new backend.
//
// A value describes *where a C expression lives*, not a runtime object. Like
// cgen/value.js, everything here is compile-time metadata: the representation
// tag, the C type, the buffer names. Only `boxed` survives into the generated
// program as an actual tagged union (rh_val), and only where the schema leaves
// no choice.
//
// ----- cond -----
//
// `cond` is the unboxed encoding of optionality. A boxed rh_val carries absence
// in its tag; a uint32_t has no spare state, so absence has to travel alongside
// as a C boolean that is true when the value is missing. Three states:
//
//   statically present   no cond at all, and no guard is emitted
//   unboxed              cond is carried here, as a C boolean expression
//   boxed                cond is derived -- rh_is_undef(x) -- never stored
//
// So `cond` is a field on unboxed values only, and box/unbox below translate
// between the two encodings.

const REPR = {
  SCALAR: "cScalar",   // a C rvalue of a concrete type
  STR: "cStr",         // const char* + int, borrowed, never copied
  JSON: "json",        // yyjson_val*
  BOXED: "boxed",      // rh_val -- the dynamic case
  HASHMAP: "hashmap",  // struct-of-arrays descriptor
  ARRAY: "array",
}

let v = {}

v.cScalar = (ctype, expr, cond) => ({ repr: REPR.SCALAR, ctype, expr, cond })
v.cStr = (str, len, cond) => ({ repr: REPR.STR, str, len, cond })
v.json = (expr, cond) => ({ repr: REPR.JSON, expr, cond })
v.boxed = (expr) => ({ repr: REPR.BOXED, expr })

// Collections hold the C *names* of their buffers; subscripting one yields a
// cScalar or cStr, the same way cgen's getValueAtIdx turns a base pointer into
// an lvalue by appending an index.
v.hashmap = (desc) => ({ repr: REPR.HASHMAP, ...desc })
v.array = (desc) => ({ repr: REPR.ARRAY, ...desc })

let isBoxed = (x) => x.repr === REPR.BOXED
let isUnboxed = (x) =>
  x.repr === REPR.SCALAR || x.repr === REPR.STR || x.repr === REPR.JSON

// The C predicate for "this value is missing", or null when it cannot be.
let condOf = (x) => isBoxed(x) ? `rh_is_undef(${x.expr})` : (x.cond || null)

module.exports = { REPR, v, isBoxed, isUnboxed, condOf }
