const { c, utils } = require("./utils")
const { TAG } = require("./value")
const { hashmap, hashSize, bucketSize } = require("./collections")

const { tmpSym } = utils

const { typing, typeSyms } = require("../typing")
const { symbol } = require("./symbol")

let emitStringPrint = (buf, val, settings) => {
  if (settings.format == "json")
    c.printf(buf)(`\\"%.*s\\"`, val.val.len, val.val.str)
  else
    c.printf(buf)(`%.*s`, val.val.len, val.val.str)
}

let emitObjectPrintJSON = (buf, val, settings) => {
  c.printf(buf)("{");
  for (let i in Object.keys(val.val)) {
    let k = Object.keys(val.val)[i]
    let v = val.val[k]
    c.printf(buf)(`\\"${k}\\":`)
    emitValPrint(buf, v, settings)
    if (i != Object.keys(val.val).length - 1) {
      c.printf(buf)(",")
    }
  }
  c.printf(buf)("}");
}

let emitObjectPrint = (buf, obj, settings) => {
  if (settings.format == "json") {
    emitObjectPrintJSON(buf, obj, settings)
    return
  }
  for (let k in obj.val) {
    let v = obj.val[k]
    emitValPrint(buf, v, settings)
    c.printf(buf)("|");
  }
}

// Emit code that prints the keys and values in a hashmap.
let emitHashMapPrintJSON = (buf, map, settings) => {
  let sym = tmpSym(map.val.sym)
  let count = map.val.count
  let limit = settings.limit || count

  c.printf(buf)("{")

  if (map.val.sorted) {
    buf.push(`for (int i = 0; i < ${limit}; i++) {`)
    buf.push(`int key_pos = ${sym}[i];`)
  } else {
    buf.push(`for (int key_pos = 0; key_pos < ${limit}; key_pos++) {`)
  }

  let loopVar = map.val.sorted ? "i" : "key_pos"

  buf.push(`// print key`)
  for (let i in map.val.keys) {
    let key = JSON.parse(JSON.stringify(map.val.keys[i]))
    if (key.tag == TAG.JSON) {
      key.val += "[key_pos]"
      emitValPrint(buf, key, settings)
    } else if (typing.isString(key.schema)) {
      key.val.str += "[key_pos]"
      key.val.len += "[key_pos]"
      emitStringPrint(buf, key, settings)
    } else {
      key.val += "[key_pos]"
      // Add quotes around non-string keys
      c.printf(buf)(`\\"%${utils.getFormatSpecifier(key.schema)}\\"`, key.val)
    }
  }

  c.printf(buf)(":")

  buf.push(`// print value`)

  let value = hashmap.getHashMapValueEntry(map, undefined, "key_pos")
  emitValPrint(buf, value, settings)

  buf.push(`if (${loopVar} != ${limit} - 1) {`)
  c.printf(buf)(",")
  buf.push(`}`)

  buf.push(`}`)

  c.printf(buf)("}")
}

// Emit code that prints the keys and values in a hashmap.
let emitHashMapPrint = (buf, map, settings) => {
  if (settings.format == "json") {
    emitHashMapPrintJSON(buf, map, settings)
    return
  }
  let sym = tmpSym(map.val.sym)
  let count = map.val.count
  let limit = settings.limit || count
  if (map.val.sorted) {
    buf.push(`for (int i = 0; i < ${limit}; i++) {`)
    buf.push(`int key_pos = ${sym}[i];`)
  } else {
    buf.push(`for (int key_pos = 0; key_pos < ${limit}; key_pos++) {`)
  }

  let loopVar = map.val.sorted ? "i" : "key_pos"

  buf.push(`// print value`)

  let value = hashmap.getHashMapValueEntry(map, undefined, "key_pos")
  emitValPrint(buf, value, settings)

  buf.push(`if (${loopVar} != ${limit} - 1) {`)
  c.printf(buf)("\\n")
  buf.push(`}`)

  buf.push(`}`)
}

// Emit code that prints the keys and values in a hashmap.
let emitNestedHashMapPrint = (buf, map, settings) => {
  if (settings.format != "json") {
    throw new Error("Nested hashmaps must be printed in json")
  }

  let count = map.val.count
  let limit = settings.limit || count

  c.printf(buf)("{")

  let loopVar = symbol.getSymbol("key_pos")
  buf.push(`for (int ${loopVar} = 0; ${loopVar} < ${limit}; ${loopVar}++) {`)

  buf.push(`// print key`)
  let indexing = `[${loopVar}]`
  for (let i in map.val.keys) {
    let key = JSON.parse(JSON.stringify(map.val.keys[i]))
    if (key.tag == TAG.JSON) {
      key.val += indexing
      emitValPrint(buf, key, settings)
    } else if (typing.isString(key.schema)) {
      key.val.str += indexing
      key.val.len += indexing
      emitStringPrint(buf, key, settings)
    } else {
      key.val += indexing
      // Add quotes around non-string keys
      c.printf(buf)(`\\"%${utils.getFormatSpecifier(key.schema)}\\"`, key.val)
    }
  }

  c.printf(buf)(":")

  buf.push(`// print value`)

  let value = hashmap.getHashMapValueEntry(map, undefined, loopVar)
  emitValPrint(buf, value, settings)

  buf.push(`if (${loopVar} != ${limit} - 1) {`)
  c.printf(buf)(",")
  buf.push(`}`)

  buf.push(`}`)

  c.printf(buf)("}")
}

let emitArrayPrintJSON = (buf, arr, settings) => {
  let sym = arr.val.sym
  let count = arr.val.count
  let limit = settings.limit || count

  c.printf(buf)("[")
  if (arr.val.sorted) {
    buf.push(`for (int i = 0; i < ${limit}; i++) {`)
    buf.push(`int idx = ${sym}[i];`)
  } else {
    buf.push(`for (int idx = 0; idx < ${limit}; idx++) {`)
  }

  let loopVar = arr.val.sorted ? "i" : "idx"

  let value = hashmap.getHashMapValueEntry(arr, undefined, "idx")
  emitValPrint(buf, value, settings)

  buf.push(`if (${loopVar} != ${limit} - 1) {`)
  c.printf(buf)(",")
  buf.push(`}`)
  buf.push(`}`)
  c.printf(buf)("]")
}

let emitArrayPrint = (buf, arr, settings) => {
  if (settings.format == "json") {
    emitArrayPrintJSON(buf, arr, settings)
    return
  }
  let sym = arr.val.sym
  let count = arr.val.count
  let limit = settings.limit || count

  if (arr.val.sorted) {
    buf.push(`for (int i = 0; i < ${limit}; i++) {`)
    buf.push(`int idx = ${sym}[i];`)
  } else {
    buf.push(`for (int idx = 0; idx < ${limit}; idx++) {`)
  }

  let loopVar = arr.val.sorted ? "i" : "idx"

  let value = hashmap.getHashMapValueEntry(arr, undefined, "idx")
  emitValPrint(buf, value, settings)

  buf.push(`if (${loopVar} != ${limit} - 1) {`)
  c.printf(buf)("\\n")
  buf.push(`}`)
  buf.push(`}`)
}

let emitHashMapBucketPrint = (buf, bucket, settings) => {
  let bucketCount = bucket.val.bucketCount
  let buckets = bucket.val.buckets
  c.printf(buf)("[")
  buf.push(`for (int j = 0; j < ${bucketCount}; j++) {`)
  buf.push(`int data_pos = ${buckets}[key_pos * ${bucketSize} + j];`)

  let value = hashmap.getHashMapValueEntry(bucket, undefined, "data_pos")
  emitValPrint(buf, value, settings)

  buf.push(`if (j != ${bucketCount} - 1) {`)
  c.printf(buf)(",")
  buf.push(`}`)
  buf.push(`}`)
  c.printf(buf)("]")
}

let emitValPrint = (buf, val, settings) => {
  if (settings.format != "json" && settings.format != "csv") throw new Error("Unknown print format: " + settings.format)
  if (val.tag == TAG.HASHMAP) {
    c.comment(buf)("print hashmap")
    emitHashMapPrint(buf, val, settings)
  } else if (val.tag == TAG.ARRAY) {
    c.comment(buf)("print array")
    emitArrayPrint(buf, val, settings)
  } else if (val.tag == TAG.JSON) {
    c.comment(buf)("print json object")
    c.printf(buf)("%s", c.call("yyjson_val_write", val.val, "0", "NULL"))
  } else if (val.tag == TAG.OBJECT) {
    c.comment(buf)("print object")
    emitObjectPrint(buf, val, settings)
  } else if (val.tag == TAG.HASHMAP_BUCKET) {
    c.comment(buf)("print bucket")
    emitHashMapBucketPrint(buf, val, settings)
  } else if (val.tag == TAG.NESTED_HASHMAP) {
    c.comment(buf)("print nested hashmap")
    emitNestedHashMapPrint(buf, val, settings)
  } else if (typing.isString(val.schema)) {
    emitStringPrint(buf, val, settings)
  } else if (val.schema.typeSym == typeSyms.date) {
    buf.push(`print_date(${val.val});`)
  } else if (val.schema.typeSym == typeSyms.boolean) {
    c.printf(buf)(`%s`, c.ternary(val.val, `"true"`, `"false"`))
  } else {
    c.printf(buf)(`%${utils.getFormatSpecifier(val.schema)}`, val.val)
  }
}

let printEmitter = {
  emitValPrint
}

module.exports = {
  printEmitter
}
