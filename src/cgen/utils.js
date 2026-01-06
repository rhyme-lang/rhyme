const { typing } = require('../typing')
const { symbol } = require("./symbol")

let cTypes = {
  // any:  "rh",
  // never:"rh",
  boolean: "int",
  // string:"rh",
  u8: "uint8_t",
  u16: "uint16_t",
  u32: "uint32_t",
  u64: "uint64_t",
  i8: "int8_t",
  i16: "int16_t",
  i32: "int32_t",
  i64: "int64_t",
  f32: "float",
  f64: "double",
  char: "char",
  date: "int32_t",
}

let formatSpecifierMap = {
  // any:  "rh",
  // never:"rh",
  // boolean:  "rh",
  // string:"rh",
  u8: "hhu",
  u16: "hu",
  u32: "u",
  u64: "lu",
  i8: "hhd",
  i16: "hd",
  i32: "d",
  i64: "ld",
  f32: ".3f",
  f64: ".4lf",
  char: "c",
  date: "d"
}

let binaryOperators = {
  equal: "==",
  notEqual: "!=",

  lessThan: "<",
  greaterThan: ">",

  lessThanOrEqual: "<=",
  greaterThanOrEqual: ">=",

  plus: "+",
  minus: "-",
  times: "*",
  fdiv: "/",
  div: "/",
  mod: "%",

  andAlso: "&&",
  orElse: "||"
}

let c = {}

// Expressions
c.cast = (type, expr) => `(${type})${expr}`

c.inc = (expr) => expr + "++"

c.binary = (lhs, rhs, op) => `(${lhs} ${op} ${rhs})`
c.ternary = (cond, tVal, fVal) => `(${cond} ? ${tVal} : ${fVal})`

c.assign = (lhs, rhs) => `${lhs} = ${rhs}`

c.add = (lhs, rhs) => c.binary(lhs, rhs, "+")
c.sub = (lhs, rhs) => c.binary(lhs, rhs, "-")

c.mul = (lhs, rhs) => c.binary(lhs, rhs, "*")
c.div = (lhs, rhs) => c.binary(lhs, rhs, "/")

c.not = (expr) => "!" + expr
c.and = (lhs, rhs) => c.binary(lhs, rhs, "&&")
c.or = (lhs, rhs) => c.binary(lhs, rhs, "||")
c.eq = (lhs, rhs) => c.binary(lhs, rhs, "==")
c.ne = (lhs, rhs) => c.binary(lhs, rhs, "!=")

c.lt = (lhs, rhs) => c.binary(lhs, rhs, "<")
c.gt = (lhs, rhs) => c.binary(lhs, rhs, ">")

c.le = (lhs, rhs) => c.binary(lhs, rhs, "<=")
c.ge = (lhs, rhs) => c.binary(lhs, rhs, ">=")

c.call = (f, ...args) => `${f}(${args.join(", ")})`

c.malloc = (type, n) => c.call("malloc", `sizeof(${type}) * ${n}`)
c.calloc = (type, n) => c.call("calloc", n, `sizeof(${type})`)
c.open = (file) => c.call("open", file, 0)
c.close = (fd) => c.call("close", fd)

c.mmap = (fd, size) => c.call("mmap", 0, size, "PROT_READ", "MAP_FILE | MAP_SHARED", fd, 0)

// Statements
c.comment = (buf) => (s) => buf.push("// " + s)
c.stmt = (buf) => (expr) => buf.push(expr + ";")

c.declareVar = (buf) => (type, name, init, constant = false) => buf.push((constant ? "const " : "") + type + " " + name + (init ? ` = ${init};` : ";"))
c.declareArr = (buf) => (type, name, len, init, constant = false) => buf.push((constant ? "const " : "") + `${type} ${name}[${len}]` + (init ? ` = ${init};` : ";"))
c.declarePtr = (buf) => (type, name, init, constant = false) => buf.push((constant ? "const " : "") + `${type} *${name}` + (init ? ` = ${init};` : ";"))
c.declarePtrPtr = (buf) => (type, name, init, constant = false) => buf.push((constant ? "const " : "") + `${type} **${name}` + (init ? ` = ${init};` : ";"))

c.declareSize = (buf) => (name, init) => c.declareVar(buf)("size_t", name, init)
c.declareInt = (buf) => (name, init) => c.declareVar(buf)("int", name, init)
c.declareLong = (buf) => (name, init) => c.declareVar(buf)("long", name, init)
c.declareULong = (buf) => (name, init) => c.declareVar(buf)("unsigned long", name, init)
c.declareCharArr = (buf) => (name, len, init) => c.declareArr(buf)("char", name, len, init)
c.declareIntPtr = (buf) => (name, init) => c.declarePtr(buf)("int", name, init)
c.declareCharPtr = (buf) => (name, init) => c.declarePtr(buf)("char", name, init)
c.declareConstCharPtr = (buf) => (name, init) => c.declarePtr(buf)("char", name, init, true)
c.declareCharPtrPtr = (buf) => (name, init) => c.declarePtrPtr(buf)("char", name, init, true)

c.declareStruct = (buf) => (struct) => {
  let { name, fields } = struct
  buf.push(`struct ${name} {`)
  for (let i in fields) {
    let { type, name } = fields[i]
    if (type.indexOf("*") >= 0)
      buf.push(`${type}${name};`)
    else
      c.declareVar(buf)(type, name)
  }
  buf.push(`};`)
}

c.struct = (name) => ({
  name, fields: [],
  addField: function (type, name) {
    this.fields.push({ type, name })
  }
})

c.printf = (buf) => (fmt, ...args) => buf.push(c.call("printf", "\"" + fmt + "\"", ...args) + ";")
c.printErr = (buf) => (fmt, ...args) => buf.push(c.call("fprintf", "stderr", "\"" + fmt + "\"", ...args) + ";")

c.if = (buf) => (cond, tBranch, fBranch) => {
  buf.push(`if (${cond}) {`)
  tBranch(buf)
  if (fBranch) {
    buf.push("} else {")
    fBranch(buf)
  }
  buf.push("}")
}

c.while = (buf) => (cond, body) => {
  buf.push(`while (${cond}) {`)
  body(buf)
  buf.push("}")
}

c.while1 = (buf) => (cond, body) => {
  buf.push(`while (${cond}) ${body};`)
}

c.continue = (buf) => () => buf.push("continue;")
c.break = (buf) => () => buf.push("break;")
c.return = (buf) => (expr) => buf.push(`return ${expr};`)

let convertToCType = (type) => {
  if (type.typeSym === "dynkey")
    return convertToCType(type.keySupertype)
  if (type.typeSym === "union")
    throw new Error("Unable to convert union type to C type currently: " + typing.prettyPrintType(type))
  if (type.typeSym in cTypes)
    return cTypes[type.typeSym]
  throw new Error("Unknown type: " + typing.prettyPrintType(type))
}

let getFormatSpecifier = (type) => {
  if (type.typeSym === "dynkey")
    return getFormatSpecifier(type.keySupertype)
  if (type.typeSym === "union")
    throw new Error("Unable to get type specifier for union tpyes currently: " + typing.prettyPrintType(type))
  if (type.typeSym in formatSpecifierMap)
    return formatSpecifierMap[type.typeSym]
  throw new Error("Unknown type: " + typing.prettyPrintType(type))
}

let convertToArrayOfSchema = (schema) => {
  if (schema.objKey === null) {
    return []
  }
  return [...convertToArrayOfSchema(schema.objParent), { name: schema.objKey, schema: schema.objValue }]
}

let isSimpleObject = (schema) => {
  if (schema.objKey === null) {
    return true
  }
  if (typeof schema.objKey == "object") return false
  return isSimpleObject(schema.objParent)
}

let tmpSym = i => "tmp" + i

let quoteVar = s => s.replaceAll("*", "x")

let emitWildcardStrSearch = (buf, str, currIdx, parts, partIdx, strictStart, strictEnd, name) => {
  if (partIdx == parts.length) {
    c.stmt(buf)(c.assign(name, "1"))
    return
  }
  let tmp = symbol.getSymbol("tmp_strstr")
  c.declareInt(buf)(tmp, c.call("strnstr_idx", c.add(str.val.str, currIdx), c.sub(str.val.len, currIdx), "\"" + parts[partIdx] + "\"", parts[partIdx].length))

  let checkStart
  if (partIdx == 0 && strictStart) {
    checkStart = c.eq(tmp, "0")
  } else {
    checkStart = c.ge(tmp, "0")
  }

  let checkEnd
  if (partIdx == parts.length - 1 && strictEnd) {
    checkEnd = c.eq(c.add(tmp, parts[partIdx].length), c.sub(str.val.len, currIdx))
  } else {
    checkEnd = c.le(c.add(tmp, parts[partIdx].length), c.sub(str.val.len, currIdx))
  }

  currIdx = c.add(tmp, parts[partIdx].length)

  c.if(buf)(c.and(checkStart, checkEnd), buf1 => {
    emitWildcardStrSearch(buf1, str, currIdx, parts, partIdx + 1, strictStart, strictEnd, name)
  }, buf2 => {
    c.stmt(buf2)(c.assign(name, "0"))
  })
}

// Only works for regex that have .*
let emitWildcardMatch = (buf, str, regex, name) => {
  // get the constant parts
  let parts = regex.split(".*")
  c.declareInt(buf)(name)

  let strictStart = true
  let strictEnd = true

  if (parts[0] === "") {
    parts = parts.slice(1)
    strictStart = false
  }
  if (parts[parts.length - 1] === "") {
    parts = parts.slice(0, -1)
    strictEnd = false
  }

  emitWildcardStrSearch(buf, str, "0", parts, 0, strictStart, strictEnd, name)
}

const dataTypeLimits = {
  // Floating point
  f32: { min: "-3.402823466e+38F", max: "3.402823466e+38F" },
  f64: { min: "-1.7976931348623157e+308", max: "1.7976931348623157e+308" },

  // Unsigned integers
  u8: { min: "0", max: "255" },
  u16: { min: "0", max: "65535" },
  u32: { min: "0", max: "4294967295U" },
  u64: { min: "0", max: "18446744073709551615ULL" },

  // Signed integers
  i8: { min: "-128", max: "127" },
  i16: { min: "-32768", max: "32767" },
  i32: { min: "-2147483648", max: "2147483647" },
  i64: { min: "-9223372036854775808LL", max: "9223372036854775807LL" }
};

let getDataTypeLimits = (type) => {
  if (type.typeSym === "dynkey")
    return getDataTypeLimits(type.keySupertype)
  if (type.typeSym === "union")
    throw new Error("Unable to get type specifier for union tpyes currently: " + typing.prettyPrintType(type))
  if (type.typeSym in dataTypeLimits)
    return dataTypeLimits[type.typeSym]
  throw new Error("Unknown type: " + typing.prettyPrintType(type))
}

let stringToHexBytes = (str) => {
  let hex = "0x"

  // Convert each character to its hex value in reverse order
  for (let i = str.length - 1; i >= 0; i--) {
    const charCode = str.charCodeAt(i)
    hex += charCode.toString(16).padStart(2, '0').toUpperCase()
  }

  return hex
}


let utils = {
  tmpSym,
  quoteVar,
  cTypes,
  binaryOperators,
  convertToCType,
  getFormatSpecifier,
  convertToArrayOfSchema,
  isSimpleObject,
  emitWildcardMatch,
  getDataTypeLimits,
  stringToHexBytes
}

module.exports = {
  c,
  utils
}
