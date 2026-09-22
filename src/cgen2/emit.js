// Logical IR -> C, for the c-new backend.
//
// Runs after new-codegen has scheduled the program, over the tree its sink
// built, so the loop structure is still present rather than flattened into
// indented text. Every node lowers to a call into runtime/rhyme_rt.h, whose
// operations mirror src/simple-runtime.js one for one.

const { symbol } = require('../cgen/symbol')
const { v, isBoxed, condOf } = require('./value')
const { typing } = require('../typing')
const ctypes = require('./ctypes')

// tmp-3 is not a C identifier
let cSym = i => "tmp" + String(i).replace(/-/g, "_")

let cStr = (str) => {
  let out = ""
  for (let ch of String(str)) {
    if (ch === '"' || ch === "\\") out += "\\" + ch
    else if (ch === "\n") out += "\\n"
    else if (ch === "\t") out += "\\t"
    else if (ch === "\r") out += "\\r"
    else out += ch
  }
  return out
}

// A string literal reaching the runtime as an rh_val
let strVal = (s) => `rh_strv("${cStr(s)}", ${Buffer.byteLength(String(s))})`

let emitConst = (v) => {
  if (v === undefined) return "rh_undef"
  if (typeof v === "boolean") return `rh_bool(${v})`
  if (typeof v === "number")
    return Number.isInteger(v) ? `rh_i64(${v})` : `rh_f64(${v})`
  if (typeof v === "string") return strVal(v)
  if (typeof v === "object" && v !== null && Object.keys(v).length === 0)
    return "rh_mapv(rh_map_new())"
  throw new Error("c-new: unsupported constant " + JSON.stringify(v))
}

// Open an input the first time it is referenced, and reuse the symbol after.
// Returns the C name of its yyjson root.
let loadOnce = (ctx, path) => {
  let sym = ctx.loads.get(path)
  if (!sym) {
    sym = "in" + ctx.loads.size
    ctx.loads.set(path, sym)
    ctx.prolog.push(`yyjson_doc *${sym}_doc = rh_load_json("${path}");`)
    ctx.prolog.push(`yyjson_val *${sym} = yyjson_doc_get_root(${sym}_doc);`)
  }
  return sym
}

// Can this schema be walked with yyjson accessors rather than the generic
// rh_get? Only if we know it is an object or array, so we know which accessor.
let jsonWalkable = (schema) => {
  if (!schema) return false
  let t = typing.removeTag(schema)
  return !typing.isUnknown(t) && typing.isObject(t)
}

// A JSON value at a known scalar type unboxes into a native C value plus a
// cond that *is* the type check -- the same shape as cgen's json.convertJSONTo.
let getters = {
  u8: "yyjson_get_uint", u16: "yyjson_get_uint", u32: "yyjson_get_uint",
  u64: "yyjson_get_uint", char: "yyjson_get_uint",
  i8: "yyjson_get_int", i16: "yyjson_get_int", i32: "yyjson_get_int",
  i64: "yyjson_get_int", date: "yyjson_get_int",
  f32: "yyjson_get_num", f64: "yyjson_get_num",
  boolean: "yyjson_get_bool",
}

let unboxJson = (val, schema) => {
  let t = typing.removeTag(schema)
  if (typing.isString(t))
    return v.cStr(`yyjson_get_str(${val.expr})`, `(int)yyjson_get_len(${val.expr})`,
                  `!yyjson_is_str(${val.expr})`)
  let sym = t.typeSym === "dynkey" ? typing.removeTag(t.keySupertype).typeSym : t.typeSym
  let get = getters[sym]
  if (!get) return null
  let ctype = ctypes.convertToCType(t)
  let check = get === "yyjson_get_num" ? "yyjson_is_num"
            : get === "yyjson_get_bool" ? "yyjson_is_bool"
            : get === "yyjson_get_uint" ? "yyjson_is_uint" : "yyjson_is_int"
  return v.cScalar(ctype, `(${ctype})${get}(${val.expr})`, `!${check}(${val.expr})`)
}

// `!cond` without the double negation when cond is already negated.
let negate = (cond) =>
  /^!/.test(cond) && !/[|&]/.test(cond) ? cond.slice(1) : `!(${cond})`

// Bind a json value to a local. Without this the accessor chain is emitted
// once in the type check and again in the value, which squares with nesting
// depth -- two yyjson_obj_getn chains become four.
let materializeJson = (buf, val) => {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(val.expr)) return val // already a name
  let t = symbol.getSymbol("j")
  buf.push(`yyjson_val *${t} = ${val.expr};`)
  return v.json(t, val.cond)
}

let binOps = {
  plus: "+", minus: "-", times: "*", fdiv: "/", div: "/", mod: "%",
}

// Arithmetic and conversion stay in C when every operand already is.
let nativePure = (x, vals) => {
  if (x.op.startsWith("convert_")) {
    let a = vals[0]
    if (a.repr !== "cScalar" || !x.schema || !ctypes.isCType(x.schema)) return null
    let ctype = ctypes.convertToCType(typing.removeTag(x.schema))
    return v.cScalar(ctype, `(${ctype})${a.expr}`, a.cond)
  }
  let op = binOps[x.op]
  if (!op || vals.length !== 2) return null
  if (!vals.every(a => a.repr === "cScalar")) return null
  if (!x.schema || !ctypes.isCType(x.schema)) return null
  let ctype = ctypes.convertToCType(typing.removeTag(x.schema))
  // undefined in either operand propagates, so the conds merge
  let cond = [vals[0].cond, vals[1].cond].filter(Boolean).join(" || ") || null
  let expr = x.op === "fdiv"
    ? `((double)${vals[0].expr} / (double)${vals[1].expr})`
    : `(${vals[0].expr} ${op} ${vals[1].expr})`
  return v.cScalar(ctype, expr, cond)
}

// Lower an expression node to a value object (see ./value.js), choosing its
// representation from the type the checker gave it: a type that maps through
// cTypes becomes a native C value, anything else stays boxed.
//
// `buf` is the statement buffer of the scope the expression is being lowered
// into. Almost every node here is a pure C expression and ignores it; a device
// operation (see emitDot) has to emit transfers and a library call before it
// has a value at all, and that is what the buffer is for.
let emitValue = (x, ctx, buf) => {
  switch (x.k) {
    case "const":
      return v.boxed(emitConst(x.v))
    case "load": {
      // Opened on first sight and reused thereafter -- the same first-seen
      // memoization that makes a repeated subexpression emit once. A separate
      // collection pass would only rediscover what walking the IR here already
      // knows.
      let sym = loadOnce(ctx, x.path)
      // Keep it as a yyjson value when the schema lets us walk it; otherwise
      // hand back an rh_val expression. rh_jsonv only stores the pointer, so
      // there is nothing to hoist into a variable.
      return jsonWalkable(x.schema) ? v.json(sym, null) : v.boxed(`rh_jsonv(${sym})`)
    }
    case "var":
      // however the loop that binds it decided to represent it
      return ctx.vars[x.name] || v.boxed(x.name)
    case "ref": {
      let base = cSym(x.sym)
      if (x.path.length === 0 && ctx.nativeTmps[base])
        return v.cScalar(ctx.nativeTmps[base], base, null)
      if (x.path.length === 0) return v.boxed(base)
      // grouped tmp: index it back out by the free variables
      return v.boxed(x.path.reduce((acc, p) => `rh_get(${acc}, ${varRef(p, ctx)})`, base))
    }
    case "get": {
      let obj = emitValue(x.obj, ctx, buf)
      if (obj.repr === "json") {
        let key = emitValue(x.key, ctx, buf)
        let acc = jsonAccess(obj, key, x.obj.schema)
        if (acc) return acc
      }
      return v.boxed(`rh_get(${asBoxed(obj)}, ${cOf(x.key, ctx, buf)})`)
    }
    case "pure": {
      if (x.op === "dot") return emitDot(x, ctx, buf)
      // An operand that is still on the device comes back first: a pure
      // operation is host arithmetic, and cuBLAS has no kernel for it.
      let vals = x.args.map(a => toHost(emitValue(a, ctx, buf), buf))
      let native = nativePure(x, vals)
      if (native) return native
      return v.boxed(`rh_pure_${x.op}(${vals.map(asBoxed).join(", ")})`)
    }
    case "mkset":
      // rt.pure.singleton: a one-entry object keyed by the value
      return v.boxed(`rh_singleton(${cOf(x.arg, ctx, buf)})`)
    default:
      throw new Error("c-new: unsupported expression node " + x.k)
  }
}

// The value as an rh_val C expression -- the one boundary every consumer that
// still needs a tag goes through. A json value boxes for free (rh_jsonv just
// stores the pointer); a native scalar has to be wrapped, and its cond becomes
// the undefined case.
let asBoxed = (val) => {
  if (isBoxed(val)) return val.expr
  if (val.repr === "json") {
    let e = `rh_jsonv(${val.expr})`
    return val.cond ? `(${val.cond} ? rh_undef : ${e})` : e
  }
  if (val.repr === "cStr") {
    let e = `rh_strv(${val.str}, ${val.len})`
    return val.cond ? `(${val.cond} ? rh_undef : ${e})` : e
  }
  if (val.repr === "cScalar") {
    let e = /double|float/.test(val.ctype) ? `rh_f64(${val.expr})` : `rh_i64(${val.expr})`
    return val.cond ? `(${val.cond} ? rh_undef : ${e})` : e
  }
  // A device value has to come back across the bus before it can be boxed, and
  // that copy is a statement -- which this boundary, handed an expression and
  // no buffer, cannot emit. Reaching here means a consumer skipped toHost.
  if (val.repr === "cuVec" || val.repr === "cuScalar")
    throw new Error("c-new: a " + val.repr + " reached the boxing boundary " +
                    "without being copied back -- consume device values " +
                    "through toHost, which has a statement buffer")
  throw new Error("c-new: cannot box a " + val.repr)
}

// obj[key] where obj is a yyjson value of a known object/array type.
let jsonAccess = (obj, key, objSchema) => {
  let t = typing.removeTag(objSchema)
  let keyType = t.objKey
  // an array is keyed by number, an object by string
  if (keyType && typing.isNumber(typing.removeTag(keyType))) {
    if (key.repr === "cScalar")
      return v.json(`yyjson_arr_get(${obj.expr}, ${key.expr})`, null)
    return null
  }
  if (key.repr === "cStr")
    return v.json(`yyjson_obj_getn(${obj.expr}, ${key.str}, ${key.len})`, null)
  if (key.repr === "boxed" && /^rh_strv\("/.test(key.expr)) {
    // a constant string key, e.g. .value
    let m = key.expr.match(/^rh_strv\((".*"), (\d+)\)$/)
    if (m) return v.json(`yyjson_obj_getn(${obj.expr}, ${m[1]}, ${m[2]})`, null)
  }
  return null
}

// ----- device operations -----
//
// `dot` is not an elementwise operation the scheduler can place inside a loop:
// it consumes two whole vectors at once, and cuBLAS does the reduction itself.
// So it lowers where it stands, emitting its transfers and its library call
// into the enclosing statement buffer.
//
// The result is a device scalar, not a host float. cuBLAS runs in device
// pointer mode (runtime/rhyme_cuda.h), so the value stays where it was
// computed, and what happens next decides whether it ever moves: printing
// reads it back inside the runtime call, and host code that needs its value
// gets one copy at the point of use (toHost). Returning a host float here
// would pay for that copy whether or not anyone wanted it.
let emitDot = (x, ctx, buf) => {
  if (!buf)
    throw new Error("c-new: dot cannot be lowered here -- it needs a statement " +
                    "buffer to emit its transfers into")
  ctx.usesCuda = true

  let [a, b] = x.args.map(arg => toDeviceVec(emitValue(arg, ctx, buf), arg, buf))

  let res = symbol.getSymbol("d_dot")
  buf.push(`float *${res} = rh_cuda_alloc(1);`)
  // cublasSdot reads n elements from both sides, so a mismatch is an
  // out-of-bounds device read rather than a wrong answer. The lengths are
  // runtime values (yyjson_arr_size), so this is a runtime check.
  buf.push(`if ((size_t)${a.len} != (size_t)${b.len}) ` +
           `{ fprintf(stderr, "rhyme: dot on vectors of length %zu and %zu\\n", ` +
           `(size_t)${a.len}, (size_t)${b.len}); exit(1); }`)
  buf.push(`RH_CUBLAS_CHECK(cublasSdot(rh_cublas_handle, (int)${a.len}, ` +
           `${a.dev}, 1, ${b.dev}, 1, ${res}));`)

  // A scalar, not a one-element vector: see the two representations in
  // ./value.js. The storage is the same float* either way.
  return v.cuScalar(res)
}

// Whatever the operand lowered to, as a device vector.
//
// A typed JSON array is staged into a host buffer and copied up (one runtime
// call, rh_cuda_from_json). A vector that is already on the device passes
// through, which is what will make a chain of device operations cost one
// transfer rather than one per step. Nothing else can become one: an rh_val is
// a tagged host value, and pulling a hash map apart one entry at a time is not
// a transfer, it is a different operation -- so say so rather than emit C that
// will not compile.
let toDeviceVec = (val, node, buf) => {
  if (val.repr === "cuVec") return val
  // A device scalar occupies one float of device memory, so it would pass for
  // a length-1 vector here. Rejected deliberately: the two are different kinds
  // of value (./value.js), and a dot of two scalars is a product.
  if (val.repr === "cuScalar")
    throw new Error("c-new: dot expects vectors, but one operand is a device " +
                    "scalar -- multiplying two scalars is `*`, not `dot`")
  if (val.repr === "json") {
    let n = symbol.getSymbol("n_vec")
    let dev = symbol.getSymbol("d_vec")
    buf.push(`size_t ${n};`)
    buf.push(`float *${dev} = rh_cuda_from_json(${val.expr}, &${n});`)
    return v.cuVec(dev, n)
  }
  throw new Error("c-new: dot expects a dense vector on both sides, but one " +
                  "operand lowered to " + val.repr +
                  (node.schema ? " (type " + typing.prettyPrintType(node.schema) + ")" : "") +
                  " -- declare the input's schema with typing.createVec")
}

// The inverse of toDeviceVec: a value host code can actually read.
//
// A device scalar is copied back -- four bytes -- and becomes an ordinary C
// float, so the arithmetic around it lowers exactly as it would over any other
// scalar. This is where the device boundary is crossed, and it is a statement,
// which is why it happens at the points that hold a buffer rather than inside
// asBoxed.
//
// A device vector has no scalar host form: turning one into a host value means
// building an rh_map or an array out of it, which is a different operation than
// reading a number, so it is not done implicitly.
//
// Everything else passes through untouched, so callers can apply this to any
// operand without asking what it is.
let toHost = (val, buf) => {
  if (val.repr === "cuScalar") {
    // memoized on the value, so a device scalar consumed twice in one
    // expression is copied back once
    if (!val.hostCopy) {
      let h = symbol.getSymbol("h_dev")
      buf.push(`float ${h} = rh_cuda_to_host_scalar(${val.dev});`)
      val.hostCopy = v.cScalar("float", h, null)
    }
    return val.hostCopy
  }
  if (val.repr === "cuVec")
    throw new Error("c-new: a device vector cannot be read as a host value -- " +
                    "materializing one as an object is a separate operation")
  return val
}

// Shorthand for "lower this node and give me the rh_val C text".
let cOf = (x, ctx, buf) => asBoxed(toHost(emitValue(x, ctx, buf), buf))

// Kept as the name the rest of the backend calls; still yields C text.
let emitExpr = (x, ctx, buf) => cOf(x, ctx, buf)

// Resolve tmp<sym>[path...] to somewhere assignable.
//
// An ungrouped tmp is a plain local, so it needs no walk and no guard -- worth
// the special case, because it is the common one and `&x && ...` both reads
// badly and warns (the address of a local is never null).
// A loop variable named in a path or a group key, as an rh_val. The name is
// only a C identifier when the loop stayed generic; a specialized loop binds
// it as a borrowed string or a native index instead, so go through ctx.vars.
let varRef = (name, ctx) =>
  asBoxed(ctx.vars[name] || v.boxed(name))

let emitSlot = (buf, sym, path, ctx) => {
  if (path.length === 0) return { lv: cSym(sym), guard: null }
  let arr = symbol.getSymbol("keys")
  buf.push(`rh_val ${arr}[] = { ${path.map(p => varRef(p, ctx)).join(", ")} };`)
  let ptr = symbol.getSymbol("slot")
  buf.push(`rh_val *${ptr} = rh_slot(&${cSym(sym)}, ${arr}, ${path.length});`)
  return { lv: `*${ptr}`, guard: ptr }
}

// `if (guard) stmt` when the path walk could have bailed, plain stmt otherwise
let guarded = (buf, slot, stmt) => {
  buf.push(slot.guard ? `if (${slot.guard}) ${stmt}` : stmt)
}

// An ungrouped accumulator whose result type is a C scalar becomes a plain
// local of that type -- no tag, no rh_stateful_* call.
//
// This has to be decided for the tmp as a whole, before anything is emitted.
// Deciding per statement gets it wrong in exactly the case that matters: over
// an unknown schema the checker still declares sum's *result* f64, so the init
// looks specializable while the update, whose argument is untyped, is not --
// and the accumulator ends up a double being passed to rh_stateful_sum.
let canBeNative = (x) => {
  if (x.path.length !== 0) return false
  if (!x.schema || !ctypes.isCType(x.schema)) return false
  if (typing.isString(typing.removeTag(x.schema))) return false
  if (x.k === "init") return nativeSeed(x.op, x.schema) !== null
  if (x.k === "update")
    return !!nativeFold[x.op] &&
           // the argument must be unboxable too, or the fold cannot stay in C
           (x.op === "count" || (x.arg && x.arg.schema && ctypes.isCType(x.arg.schema)))
  return false // initCopy / groupUpdate are never a plain scalar
}

// tmp symbol -> C type, for every accumulator that can shed its tag. A tmp is
// native only if *every* statement writing it can be.
let decideNativeTmps = (stms) => {
  let bySym = {}
  for (let stm of stms) {
    let x = stm.txt
    let sym = cSym(x.sym)
    if (!(sym in bySym)) bySym[sym] = { ok: true, schema: x.schema }
    if (!canBeNative(x)) bySym[sym].ok = false
  }
  let out = {}
  for (let sym in bySym)
    if (bySym[sym].ok)
      out[sym] = ctypes.convertToCType(typing.removeTag(bySym[sym].schema))
  return out
}

// The C fold for a stateful op on native scalars.
let nativeFold = {
  sum: (acc, val) => `${acc} = ${acc} + ${val};`,
  product: (acc, val) => `${acc} = ${acc} * ${val};`,
  count: (acc, val) => `${acc} = ${acc} + 1;`,
  min: (acc, val) => `if (${val} < ${acc}) ${acc} = ${val};`,
  max: (acc, val) => `if (${val} > ${acc}) ${acc} = ${val};`,
}

// The identity each fold starts from, in the accumulator's own C type.
let nativeSeed = (op, schema) => {
  let lim = () => ctypes.getDataTypeLimits(typing.removeTag(schema))
  switch (op) {
    case "sum": case "count": return "0"
    case "product": return "1"
    case "min": return lim().max
    case "max": return lim().min
    default: return null
  }
}

let emitStatement = (stm, buf, ctx) => {
  let x = stm.txt

  if ((x.k === "init" || x.k === "update") && ctx.nativeTmps[cSym(x.sym)]) {
    let acc = cSym(x.sym)
    if (x.k === "init") {
      buf.push(`${acc} = ${nativeSeed(x.op, x.schema)};`)
      return
    }
    // update: unbox the argument to the accumulator's type, guard on its cond
    let arg = toHost(emitValue(x.arg, ctx, buf), buf)
    if (arg.repr === "json") arg = materializeJson(buf, arg)

    // count never looks at the value, only at whether it is there -- so it
    // stays native even when the argument itself is boxed
    if (x.op === "count") {
      let cond = condOf(arg)
      buf.push(cond ? `if (${negate(cond)}) ${acc} = ${acc} + 1;`
                    : `${acc} = ${acc} + 1;`)
      return
    }

    let native = arg.repr === "json" ? unboxJson(arg, x.schema) : arg
    if (native && native.repr === "cScalar") {
      let stmt = nativeFold[x.op](acc, native.expr)
      buf.push(native.cond ? `if (${negate(native.cond)}) ${stmt}` : stmt)
      return
    }
    throw new Error("c-new: tmp " + acc + " was marked native but its " +
                    x.op + " update could not be lowered natively")
  }

  switch (x.k) {
    case "init": {
      let slot = emitSlot(buf, x.sym, x.path, ctx)
      // only seed a slot that has not been written yet, matching rt.init
      guarded(buf, slot,
        `if (rh_is_undef(${slot.lv})) ${slot.lv} = rh_stateful_${x.op}_init();`)
      break
    }
    case "initCopy": {
      let slot = emitSlot(buf, x.sym, x.path, ctx)
      guarded(buf, slot,
        `if (rh_is_undef(${slot.lv})) ${slot.lv} = ${emitExpr(x.expr, ctx, buf)};`)
      break
    }
    case "update": {
      let slot = emitSlot(buf, x.sym, x.path, ctx)
      guarded(buf, slot,
        `${slot.lv} = rh_stateful_${x.op}(${slot.lv}, ${emitExpr(x.arg, ctx, buf)});`)
      break
    }
    case "groupUpdate": {
      let slot = emitSlot(buf, x.sym, x.path, ctx)
      guarded(buf, slot,
        `if (rh_is_undef(${slot.lv})) ${slot.lv} = rh_mapv(rh_map_new());`)
      let arr = symbol.getSymbol("gkeys")
      buf.push(`rh_val ${arr}[] = { ${x.keys.map(k => varRef(k, ctx)).join(", ")} };`)
      let dst = symbol.getSymbol("gslot")
      let base = slot.guard ? slot.guard : `&${slot.lv}`
      buf.push(slot.guard
        ? `rh_val *${dst} = ${slot.guard} ? rh_slot(${base}, ${arr}, ${x.keys.length}) : NULL;`
        : `rh_val *${dst} = rh_slot(${base}, ${arr}, ${x.keys.length});`)
      buf.push(`if (${dst}) *${dst} = ${emitExpr(x.value, ctx, buf)};`)
      break
    }
    default:
      throw new Error("c-new: unsupported statement node " + x.k)
  }
}

// A loop over the entries of an expression, binding the key to g.cvar.
//
// The variable's representation follows what is being iterated: a typed JSON
// object yields a borrowed (const char*, int) key, a typed JSON array yields a
// native index, and anything unknown falls back to the generic rh_iter and an
// rh_val key. emitValue reads the choice back out of ctx.vars.
//
// The rh_val loop variable is declared once in the prolog rather than here,
// because the scheduler may close a loop and reopen it later over the same
// variable. The specialized bindings are per-loop and declared inline, which is
// safe: each reopening re-derives them from the source.
let emitLoopHeader = (g, buf, ctx) => {
  let src = emitValue(g.src, ctx, buf)
  let t = g.src.schema ? typing.removeTag(g.src.schema) : null
  let keyType = t && t.objKey

  if (src.repr === "json" && keyType && typing.isNumber(typing.removeTag(keyType))) {
    // array: iterate by index
    let idx = symbol.getSymbol("i"), max = symbol.getSymbol("n"), row = symbol.getSymbol("e")
    let ctype = ctypes.convertToCType(typing.removeTag(keyType))
    buf.push(`size_t ${idx}, ${max};`)
    buf.push(`yyjson_val *${row};`)
    buf.push(`yyjson_arr_foreach(${src.expr}, ${idx}, ${max}, ${row}) {`)
    ctx.vars[g.cvar] = v.cScalar(ctype, `(${ctype})${idx}`, null)
    return
  }

  if (src.repr === "json" && keyType) {
    // object: iterate key/value pairs, key borrowed straight from the document
    let it = symbol.getSymbol("oit"), k = symbol.getSymbol("k")
    buf.push(`yyjson_obj_iter ${it};`)
    buf.push(`yyjson_obj_iter_init(${src.expr}, &${it});`)
    buf.push(`yyjson_val *${k};`)
    buf.push(`while ((${k} = yyjson_obj_iter_next(&${it}))) {`)
    ctx.vars[g.cvar] = v.cStr(`yyjson_get_str(${k})`, `(int)yyjson_get_len(${k})`, null)
    return
  }

  // dynamic: the generic iterator over an rh_val
  let it = symbol.getSymbol("it")
  let valSym = symbol.getSymbol("v")
  buf.push(`rh_iter ${it} = rh_iter_begin(${asBoxed(src)});`)
  buf.push(`rh_val ${valSym};`)
  buf.push(`while (rh_iter_next(&${it}, &${g.cvar}, &${valSym})) {`)
  ctx.vars[g.cvar] = v.boxed(g.cvar)
}

module.exports = { emitExpr, emitValue, asBoxed, emitStatement, emitLoopHeader, loadOnce,
                   decideNativeTmps, cSym, strVal, emitConst }
