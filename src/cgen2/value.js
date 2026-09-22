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
  CUVEC: "cuVec",      // a vector in device memory -- (float *, length)
  CUSCALAR: "cuScalar",// a single float in device memory
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

// Values living in device memory. Both are a float* at the C level, and
// neither needs a runtime struct: a vector's length is a C expression the
// emitter already knows, the same way v.cStr carries its length (see
// runtime/rhyme_cuda.h).
//
// They are two representations rather than one with a length of 1, because
// almost nothing treats them alike:
//
//   printing     a scalar is a number, a vector is a JSON array
//   boxing       a device scalar has a host equivalent -- one float, copied
//                back -- while a vector would have to become a whole rh_map
//   operands     cuBLAS takes them in different argument positions: a vector
//                comes with a length and a stride, a scalar is the alpha of a
//                scal/axpy, passed by device pointer
//   the query    `dot` is typed f32 (src/typing.js:1092), a scalar; a vector
//                is a dense object type
//
// A reduction's result is a device scalar. That it happens to occupy one
// element of device memory is a fact about its storage, not about the value,
// and encoding it as a one-element vector made every consumer re-derive which
// one it was holding.
v.cuVec = (dev, len) => ({ repr: REPR.CUVEC, ctype: "float", dev, len })
v.cuScalar = (dev) => ({ repr: REPR.CUSCALAR, ctype: "float", dev })

let isBoxed = (x) => x.repr === REPR.BOXED
// On the device, either way -- the test for "this value cannot simply be read"
let isDevice = (x) => x.repr === REPR.CUVEC || x.repr === REPR.CUSCALAR
let isUnboxed = (x) =>
  x.repr === REPR.SCALAR || x.repr === REPR.STR || x.repr === REPR.JSON

// The C predicate for "this value is missing", or null when it cannot be.
let condOf = (x) => isBoxed(x) ? `rh_is_undef(${x.expr})` : (x.cond || null)

module.exports = { REPR, v, isBoxed, isUnboxed, isDevice, condOf }
