const { c, utils } = require("./utils")
const { TAG } = require("./value")
const { array, hashmap, hashSize, bucketSize } = require("./collections")

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

  buf.push(`for (int i = 0; i < ${limit}; i++) {`)
  if (map.val.sorted) {
    buf.push(`int key_pos = ${sym}[i];`)
  } else {
    buf.push(`int key_pos = i + 1;`)
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

  buf.push(`if (i != ${limit} - 1) {`)
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

  buf.push(`for (int i = 0; i < ${limit}; i++) {`)
  if (map.val.sorted) {
    buf.push(`int key_pos = ${sym}[i];`)
  } else {
    buf.push(`int key_pos = i + 1;`)
  }

  buf.push(`// print value`)

  let value = hashmap.getHashMapValueEntry(map, undefined, "key_pos")
  emitValPrint(buf, value, settings)

  buf.push(`if (i != ${limit} - 1) {`)
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
  buf.push(`for (int ${loopVar} = 1; ${loopVar} <= ${limit}; ${loopVar}++) {`)

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

  buf.push(`if (${loopVar} != ${limit}) {`)
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

  let value = array.getValueAtIdx(arr, "idx")
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

  let value = array.getValueAtIdx(arr, "idx")
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

  let value = array.getValueAtIdx(bucket, "data_pos")
  emitValPrint(buf, value, settings)

  buf.push(`if (j != ${bucketCount} - 1) {`)
  c.printf(buf)(",")
  buf.push(`}`)
  buf.push(`}`)
  c.printf(buf)("]")
}

let emitValPrint = (buf, val, settings) => {
  if (settings.format != "json" && settings.format != "csv") throw new Error("Unknown print format: " + settings.format)
  let f = (buf1) => {
    if (val.tag == TAG.HASHMAP) {
      c.comment(buf1)("print hashmap")
      emitHashMapPrint(buf1, val, settings)
    } else if (val.tag == TAG.ARRAY) {
      c.comment(buf1)("print array")
      emitArrayPrint(buf1, val, settings)
    } else if (val.tag == TAG.JSON) {
      c.comment(buf1)("print json object")
      c.printf(buf1)("%s", c.call("yyjson_val_write", val.val, "0", "NULL"))
    } else if (val.tag == TAG.OBJECT) {
      c.comment(buf1)("print object")
      emitObjectPrint(buf1, val, settings)
    } else if (val.tag == TAG.HASHMAP_BUCKET) {
      c.comment(buf1)("print bucket")
      emitHashMapBucketPrint(buf1, val, settings)
    } else if (val.tag == TAG.NESTED_HASHMAP) {
      c.comment(buf1)("print nested hashmap")
      emitNestedHashMapPrint(buf1, val, settings)
    } else if (typing.isString(val.schema)) {
      emitStringPrint(buf1, val, settings)
    } else if (val.schema.typeSym == typeSyms.date) {
      buf1.push(`print_date(${val.val});`)
    } else if (val.schema.typeSym == typeSyms.boolean) {
      c.printf(buf1)(`%s`, c.ternary(val.val, `"true"`, `"false"`))
    } else {
      c.printf(buf1)(`%${utils.getFormatSpecifier(val.schema)}`, val.val)
    }
  }
  if (val.cond) {
    if (val.cond) {
      c.if(buf)(val.cond, buf1 => {
        c.printf(buf1)("null")
      }, f)
    }
  } else {
    f(buf)
  }

}

let printEmitter = {
  emitValPrint
}

module.exports = {
  printEmitter
}
