// Logical IR -> C, for the c-new backend.
//
// Runs after new-codegen has scheduled the program, over the tree its sink
// built, so the loop structure is still present rather than flattened into
// indented text. Every node lowers to a call into runtime/rhyme_rt.h, whose
// operations mirror src/simple-runtime.js one for one.

const { symbol } = require('./symbol')
const { c } = require('./cutils')
const { v, isBoxed, condOf } = require('./value')
const { typing } = require('../typing')
const { pretty } = require('../prettyprint')
const ctypes = require('./ctypes')

// tmp-3 is not a C identifier
let cSym = i => "tmp" + String(i).replace(/-/g, "_")

// ----- reading simple-eval's expression nodes -----
//
// Statements carry those nodes unchanged (see lower.js), so the three places
// where their shape differs from what emission wants go through these.

// the type the checker gave an expression; statement nodes store it flattened
// already, so this is for expressions only
let schemaOf = (q) => q.schema?.type

// *A as a C identifier
let quoteVar = (s) => s.replaceAll("*", "x")

// a `ref` names an assignment by index; the free variables it is grouped under
// live on that assignment, not on the reference
let refPath = (q, assignments) => assignments[q.op].fre.map(quoteVar)

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
    c.declarePtr(ctx.prolog)("yyjson_doc", `${sym}_doc`, c.call("rh_load_json", `"${path}"`))
    c.declarePtr(ctx.prolog)("yyjson_val", sym, c.call("yyjson_doc_get_root", `${sym}_doc`))
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

let binOps = {
  plus: "+", minus: "-", times: "*", fdiv: "/", div: "/", mod: "%",
}

// Arithmetic and conversion stay in C when every operand already is.
let nativePure = (x, vals) => {
  if (x.op.startsWith("convert_")) {
    let a = vals[0]
    let sc = schemaOf(x)
    if (a.repr !== "cScalar" || !sc || !ctypes.isCType(sc)) return null
    let ctype = ctypes.convertToCType(typing.removeTag(sc))
    return v.cScalar(ctype, c.cast(ctype, a.expr), a.cond)
  }
  let op = binOps[x.op]
  if (!op || vals.length !== 2) return null
  if (!vals.every(a => a.repr === "cScalar")) return null
  let sc = schemaOf(x)
  if (!sc || !ctypes.isCType(sc)) return null
  let ctype = ctypes.convertToCType(typing.removeTag(sc))
  // undefined in either operand propagates, so the conds merge
  let cond = [vals[0].cond, vals[1].cond].filter(Boolean).join(" || ") || null
  let expr = x.op === "fdiv"
    ? c.div(c.cast("double", vals[0].expr), c.cast("double", vals[1].expr))
    : c.binary(vals[0].expr, vals[1].expr, op)
  return v.cScalar(ctype, expr, cond)
}

// Lower an expression node to a value object (see ./value.js), choosing its
// representation from the type the checker gave it: a type that maps through
// cTypes becomes a native C value, anything else stays boxed. Expressions are
// pure, so nothing here needs a statement buffer.
let emitValue = (x, ctx) => {
  switch (x.key) {
    case "const":
      return v.boxed(emitConst(x.op))
    case "hint":
      return v.boxed("rh_mapv(rh_map_new())") // no-op, as in the JS backend
    case "loadInput": {
      // Opened on first sight and reused thereafter -- the same first-seen
      // memoization that makes a repeated subexpression emit once. A separate
      // collection pass would only rediscover what walking the IR here already
      // knows.
      let sym = loadOnce(ctx, x.arg[0].op)
      // Keep it as a yyjson value when the schema lets us walk it; otherwise
      // hand back an rh_val expression. rh_jsonv only stores the pointer, so
      // there is nothing to hoist into a variable.
      return jsonWalkable(schemaOf(x)) ? v.json(sym, null) : v.boxed(`rh_jsonv(${sym})`)
    }
    case "var": {
      // however the loop that binds it decided to represent it
      let name = quoteVar(x.op)
      return ctx.vars[name] || v.boxed(name)
    }
    case "ref": {
      let base = cSym(x.op)
      let path = refPath(x, ctx.assignments)
      if (path.length === 0 && ctx.nativeTmps[base])
        return v.cScalar(ctx.nativeTmps[base], base, null)
      if (path.length === 0) return v.boxed(base)
      // grouped tmp: index it back out by the free variables
      return v.boxed(path.reduce((acc, p) => `rh_get(${acc}, ${varRef(p, ctx)})`, base))
    }
    case "get": {
      let obj = emitValue(x.arg[0], ctx)
      if (obj.repr === "json") {
        let key = emitValue(x.arg[1], ctx)
        let acc = jsonAccess(obj, key, schemaOf(x.arg[0]))
        if (acc) return acc
      }
      return v.boxed(`rh_get(${asBoxed(obj)}, ${cOf(x.arg[1], ctx)})`)
    }
    case "input":
      throw new Error(
        "c-new: queries must name their input with loadJSON; " +
        "there is no `inp` object")
    case "pure": {
      // Deliberately unsupported. `apply` calls a user-defined function, which
      // reaches a query as a JavaScript closure through the input object --
      // `udf.inc data.A.value` is apply(udf[inc], ...). There is nothing to
      // generate: the callee is js, not data, so a C program cannot run it
      // short of embedding an interpreter. Queries using udfs belong on the js
      // backend.
      if (x.op === "apply")
        throw new Error("c-new: udfs are not supported -- " + pretty(x))
      let vals = x.arg.map(a => emitValue(a, ctx))
      let native = nativePure(x, vals)
      if (native) return native
      let args = vals.map(asBoxed)
      // rt.pure.flatten takes a rest parameter, so its C counterpart is
      // variadic and needs the argument count up front.
      if (x.op === "flatten") args.unshift(String(args.length))
      return v.boxed(`rh_pure_${x.op}(${args.join(", ")})`)
    }
    case "mkset":
      // rt.pure.singleton: a one-entry object keyed by the value
      return v.boxed(`rh_singleton(${cOf(x.arg[0], ctx)})`)
    default:
      throw new Error("c-new: unsupported expression " + x.key + " in " + pretty(x))
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

// Shorthand for "lower this node and give me the rh_val C text".
let cOf = (x, ctx) => asBoxed(emitValue(x, ctx))

// Kept as the name the rest of the backend calls; still yields C text.
let emitExpr = (x, ctx) => cOf(x, ctx)

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
  c.declareArr(buf)("rh_val", arr, "", `{ ${path.map(p => varRef(p, ctx)).join(", ")} }`)
  let ptr = symbol.getSymbol("slot")
  c.declarePtr(buf)("rh_val", ptr, c.call("rh_slot", c.addr(cSym(sym)), arr, path.length))
  return { lv: `*${ptr}`, guard: ptr }
}

// `if (guard) stmt` when the path walk could have bailed, plain stmt otherwise
let guarded = (buf, slot, stmt) => {
  buf.push(slot.guard ? c.if1(slot.guard, stmt) : stmt)
}

// An ungrouped accumulator whose result type is a C scalar becomes a plain
// local of that type -- no tag, no rh_stateful_* call.
//
// This has to be decided for the tmp as a whole, before anything is emitted.
// Deciding per statement gets it wrong in exactly the case that matters: over
// an unknown schema the checker still declares sum's *result* f64, so the init
// looks specializable while the update, whose argument is untyped, is not --
// and the accumulator ends up a double being passed to rh_stateful_sum.
// A C-typed schema on the argument is not enough: it says what the value *is*,
// not how it will be represented. `sum(sum(x))` over an unknown input types the
// inner sum f64, so the outer one looks specializable, but its argument is a
// ref to a tmp that stayed boxed -- and a boxed value cannot feed a native
// fold. So a ref argument is only acceptable if the tmp it names is itself
// native, which is why this takes the decisions made so far.
let argIsNative = (arg, decided, assignments) => {
  let sc = arg && schemaOf(arg)
  if (!sc || !ctypes.isCType(sc)) return false
  if (arg.key === "ref")
    return assignments[arg.op].fre.length === 0 && !!decided[cSym(arg.op)]
  return true
}

let canBeNative = (x, decided, assignments) => {
  if (x.path.length !== 0) return false
  if (!x.schema || !ctypes.isCType(x.schema)) return false
  if (typing.isString(typing.removeTag(x.schema))) return false
  if (x.k === "init") return nativeSeed(x.op, x.schema) !== null
  if (x.k === "update")
    return !!nativeFold[x.op] &&
           (x.op === "count" || argIsNative(x.arg, decided, assignments))
  return false // initCopy / groupUpdate are never a plain scalar
}

// tmp symbol -> C type, for every accumulator that can shed its tag. A tmp is
// native only if *every* statement writing it can be.
let decideNativeTmps = (stms, assignments) => {
  let bySym = {}
  let out = {}
  // In statement order, so that a tmp reading an earlier one sees the decision
  // already made for it. References always point backwards.
  for (let stm of stms) {
    let x = stm.txt
    let sym = cSym(x.sym)
    if (!(sym in bySym)) bySym[sym] = { ok: true, schema: x.schema }
    if (!canBeNative(x, out, assignments)) bySym[sym].ok = false
    out[sym] = bySym[sym].ok
      ? ctypes.convertToCType(typing.removeTag(bySym[sym].schema))
      : undefined
    if (!out[sym]) delete out[sym]
  }
  return out
}

// The C fold for a stateful op on native scalars.
let nativeFold = {
  sum: (acc, val) => c.stmt1(c.assign(acc, c.add(acc, val))),
  product: (acc, val) => c.stmt1(c.assign(acc, c.mul(acc, val))),
  count: (acc, val) => c.stmt1(c.assign(acc, c.add(acc, "1"))),
  min: (acc, val) => c.if1(c.lt(val, acc), c.stmt1(c.assign(acc, val))),
  max: (acc, val) => c.if1(c.gt(val, acc), c.stmt1(c.assign(acc, val))),
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
      c.stmt(buf)(c.assign(acc, nativeSeed(x.op, x.schema)))
      return
    }
    // update: unbox the argument to the accumulator's type, guard on its cond
    //
    // Emitted in place. A json argument's accessor chain therefore appears
    // once in the type check and again in the value, which compounds with
    // nesting depth -- deliberate for now, since binding it to a local here
    // would be one ad-hoc case of a CSE that belongs across the whole emitter.
    let arg = emitValue(x.arg, ctx)

    // count never looks at the value, only at whether it is there -- so it
    // stays native even when the argument itself is boxed
    if (x.op === "count") {
      let cond = condOf(arg)
      let bump = nativeFold.count(acc)
      buf.push(cond ? c.if1(negate(cond), bump) : bump)
      return
    }

    let native = arg.repr === "json" ? unboxJson(arg, x.schema) : arg
    if (native && native.repr === "cScalar") {
      let stmt = nativeFold[x.op](acc, native.expr)
      buf.push(native.cond ? c.if1(negate(native.cond), stmt) : stmt)
      return
    }
    // The decision was wrong: the argument's schema is a C type but its
    // representation is not. index.js catches this, marks the tmp boxed and
    // re-emits -- see emitBody there for why that is preferable to predicting.
    let err = new Error("c-new: tmp " + acc + " cannot stay native")
    err.notNative = acc
    throw err
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
      // rt.stateful.update_init copies ({...x0}) unless the source is already
      // fresh, and the copy matters: the same source seeds this slot for every
      // value of the keys not in its own path, so installing it directly would
      // leave them all sharing one map.
      let slot = emitSlot(buf, x.sym, x.path, ctx)
      let init = emitExpr(x.expr, ctx)
      if (!x.fresh) init = `rh_map_copy(${init})`
      guarded(buf, slot, `if (rh_is_undef(${slot.lv})) ${slot.lv} = ${init};`)
      break
    }
    case "update": {
      let slot = emitSlot(buf, x.sym, x.path, ctx)
      guarded(buf, slot,
        `${slot.lv} = rh_stateful_${x.op}(${slot.lv}, ${emitExpr(x.arg, ctx)});`)
      break
    }
    case "groupUpdate": {
      let slot = emitSlot(buf, x.sym, x.path, ctx)
      guarded(buf, slot,
        `if (rh_is_undef(${slot.lv})) ${slot.lv} = rh_mapv(rh_map_new());`)
      let arr = symbol.getSymbol("gkeys")
      c.declareArr(buf)("rh_val", arr, "", `{ ${x.keys.map(k => varRef(k, ctx)).join(", ")} }`)
      let dst = symbol.getSymbol("gslot")
      let base = slot.guard ? slot.guard : `&${slot.lv}`
      buf.push(slot.guard
        ? `rh_val *${dst} = ${slot.guard} ? rh_slot(${base}, ${arr}, ${x.keys.length}) : NULL;`
        : `rh_val *${dst} = rh_slot(${base}, ${arr}, ${x.keys.length});`)
      buf.push(c.if1(dst, c.stmt1(c.assign(c.deref(dst), emitExpr(x.value, ctx)))))
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
  let src = emitValue(g.src, ctx)
  let t = schemaOf(g.src) ? typing.removeTag(schemaOf(g.src)) : null
  let keyType = t && t.objKey

  if (src.repr === "json" && keyType && typing.isNumber(typing.removeTag(keyType))) {
    // array: iterate by index
    let idx = symbol.getSymbol("i"), max = symbol.getSymbol("n"), row = symbol.getSymbol("e")
    let ctype = ctypes.convertToCType(typing.removeTag(keyType))
    c.declareVar(buf)("size_t", `${idx}, ${max}`)
    c.declarePtr(buf)("yyjson_val", row)
    buf.push(c.call("yyjson_arr_foreach", src.expr, idx, max, row) + " {")
    ctx.vars[g.cvar] = v.cScalar(ctype, `(${ctype})${idx}`, null)
    return
  }

  if (src.repr === "json" && keyType) {
    // object: iterate key/value pairs, key borrowed straight from the document
    let it = symbol.getSymbol("oit"), k = symbol.getSymbol("k")
    c.declareVar(buf)("yyjson_obj_iter", it)
    c.stmt(buf)(c.call("yyjson_obj_iter_init", src.expr, c.addr(it)))
    c.declarePtr(buf)("yyjson_val", k)
    buf.push(`while ((${c.assign(k, c.call("yyjson_obj_iter_next", c.addr(it)))})) {`)
    ctx.vars[g.cvar] = v.cStr(`yyjson_get_str(${k})`, `(int)yyjson_get_len(${k})`, null)
    return
  }

  // dynamic: the generic iterator over an rh_val
  let it = symbol.getSymbol("it")
  let valSym = symbol.getSymbol("v")
  c.declareVar(buf)("rh_iter", it, c.call("rh_iter_begin", asBoxed(src)))
  c.declareVar(buf)("rh_val", valSym)
  buf.push(`while (${c.call("rh_iter_next", c.addr(it), c.addr(g.cvar), c.addr(valSym))}) {`)
  ctx.vars[g.cvar] = v.boxed(g.cvar)
}

module.exports = {
  schemaOf, quoteVar, refPath, emitExpr, emitValue, asBoxed, emitStatement, emitLoopHeader, loadOnce,
                   decideNativeTmps, cSym, strVal, emitConst }
