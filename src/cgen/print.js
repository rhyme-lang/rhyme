const { c, utils } = require("./utils")
const { TAG, value } = require("./value")
const { hashmap } = require("./data-structs")

const { typing } = require("../typing")

let emitStringPrint = (buf, val, settings) => {
  if (settings.printFormat == "json")
    c.printf(buf)(`\\"%.*s\\"`, val.val.len, val.val.str)
  else
    c.printf(buf)(`%.*s`, val.val.len, val.val.str)
}

let emitObjectPrintJSON = (buf, val, settings) => {
  c.printf(buf)("{");
  for (let i in Object.keys(val.val)) {
    let k = Object.keys(val.val)[i]
    let v = val.val[k]
    cgen.printf(buf)(`\\"${k}: \\"`)
    emitValPrint(buf, v, settings)
    if (i != Object.keys(val.val).length - 1) {
      cgen.printf(buf)(", ")
    }
  }
  c.printf(buf)("}");
}

let emitObjectPrint = (buf, obj, settings) => {
  if (settings.printFormat == "json") {
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
let emitHashMapPrint = (buf, map, settings) => {
  if (settings.printFormat == "json") {
    emitHashMapPrintJSON(buf, sym, settings)
    return
  }
  let sym = map.val.sym
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

let emitValPrint = (buf, val, settings) => {
  if (val.tag == TAG.HASHMAP) {
    c.comment(buf)("print hashmap")
    emitHashMapPrint(buf, val, settings)
  } else if (val.tag == TAG.ARRAY) {
    c.comment(buf)("print array")
    emitArrayPrint(buf, val.val.sym, settings)
  } else if (val.tag == TAG.JSON) {
    c.comment(buf)("print json object")
    c.printf(buf)("%s", c.call("yyjson_val_write", val.val, "0", "NULL"))
  } else if (val.tag == TAG.OBJECT) {
    c.comment(buf)("print object")
    emitObjectPrint(buf, val, settings)
  } else if (typing.isString(val.schema)) {
    emitStringPrint(buf, val, settings)
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
