// C type mapping for the c-new backend.
//
// Copied from src/cgen/utils.js so cgen2 stays self-contained. The tables are
// deliberately partial, and what is missing matters:
//
//   - `string` is absent. A string is never one C value; callers must test
//     typing.isString first and take the two-buffer (const char* + int) path.
//   - `unknown` is absent. That is the signal to stay boxed.
//   - `union` throws. The old backend has no representation for one, which is
//     exactly why its dynamic escape hatch exists.
//
// `dynkey` is transparent -- a key type is just its supertype at the C level.

const { typing } = require('../typing')

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

let getDataTypeLimits = (type) => {
  if (type.typeSym === "dynkey")
    return getDataTypeLimits(type.keySupertype)
  if (type.typeSym === "union")
    throw new Error("Unable to get type specifier for union tpyes currently: " + typing.prettyPrintType(type))
  if (type.typeSym in dataTypeLimits)
    return dataTypeLimits[type.typeSym]
  throw new Error("Unknown type: " + typing.prettyPrintType(type))
}

// printf specifier for an already-chosen C type, for printing a native result.
let cTypeFormats = {
  "uint8_t": "hhu", "uint16_t": "hu", "uint32_t": "u", "uint64_t": "lu",
  "int8_t": "hhd", "int16_t": "hd", "int32_t": "d", "int64_t": "ld",
  "float": ".3f", "double": ".17g", "char": "c",
}
let hasFormat = (ctype) => ctype in cTypeFormats
let formatFor = (ctype) => cTypeFormats[ctype]

// Does this type have a direct C representation? The gate for specializing.
let isCType = (type) => {
  if (!type) return false
  try {
    convertToCType(type)
    return true
  } catch (e) {
    return false
  }
}

module.exports = {
  cTypes, formatSpecifierMap, dataTypeLimits,
  convertToCType, getFormatSpecifier, getDataTypeLimits, isCType,
  hasFormat, formatFor,
}
