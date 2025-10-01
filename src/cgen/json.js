const { c, utils } = require("./utils")
const { symbol } = require("./symbol")
const { value } = require('./value')
const { typing, types, typeSyms } = require('../typing')

const { pretty } = require('../prettyprint')
const { quoteVar } = utils

// Convert JSON value to concrete typed value
// If schema is known, will try to do conversion based on that
// It will otherwise try to convert to the expected type
// Returns the original value if no schema is provided
let convertJSONTo = (json, schema) => {
  if (typing.isString(schema)) {
    let str = c.call("yyjson_get_str", json.val)
    let len = c.call("yyjson_get_len", json.val)
    let cond = c.not(c.call("yyjson_is_str", json.val))
    return value.string(schema, str, len, undefined, cond)
  } else if (typing.isNumber(schema)) {
    // Assume number
    let func1 = "yyjson_get_num"
    let func2 = "yyjson_is_num"
    if (schema.typeSym == typeSyms.u8 || schema.typeSym == typeSyms.u16 ||
      schema.typeSym == typeSyms.u32 || schema.typeSym == typeSyms.u64) {
      func1 = "yyjson_get_uint"
      func2 = "yyjson_is_uint"
    } else if (schema.typeSym == typeSyms.i8 || schema.typeSym == typeSyms.i16 ||
      schema.typeSym == typeSyms.i32 || schema.typeSym == typeSyms.i64) {
      func1 = "yyjson_get_sint"
      func2 = "yyjson_is_sint"
    }
    let val = c.call(func1, json.val)
    let cond = c.not(c.call(func2, json.val))
    return value.primitive(schema, val, undefined, cond)
  } else {
    throw new Error("Cannot convert JSON val to type: ", typing.prettyPrintType(schema))
  }
}

let emitLoadJSON = (buf, filename) => {
  let err = symbol.getSymbol("err")
  c.declareVar(buf)("yyjson_read_err", err)
  let doc = symbol.getSymbol("tmp_doc")
  c.declarePtr(buf)("yyjson_doc", doc, c.call("yyjson_read_file", filename, "0", "NULL", `&${err}`))
  c.if(buf)(c.not(doc), buf1 => {
    c.printErr(buf1)("read error: %s, code: %u at byte position: %lu\\n", `${err}.msg`, `${err}.code`, `${err}.pos`)
    c.return(buf1)("1")
  })
  let jsonVal = symbol.getSymbol("json_val")
  c.declarePtr(buf)("yyjson_val", jsonVal, c.call("yyjson_doc_get_root", doc))
  return jsonVal
}

let getJSONArrayLoopTxt = (f, json, data) => () => {
  let v = f.arg[1].op
  let info = [`// generator: ${v} <- ${pretty(f.arg[0])}`]

  v = quoteVar(v)
  let gen = v + "_gen"
  let initCursor = []
  let iter = symbol.getSymbol("iter")
  c.declareVar(initCursor)("yyjson_arr_iter", iter, c.call("yyjson_arr_iter_with", json.val));

  let loopHeader = []
  loopHeader.push(`for (int ${v} = 0; ; ${v}++) {`)
  c.declarePtr(loopHeader)("yyjson_val", gen, `yyjson_arr_iter_next(&${iter})`)
  loopHeader.push(`if (!${gen}) break;`)

  let boundsChecking = [`if (${v} < yyjson_get_len(${json.val})) continue;`]

  return {
    info, data, initCursor, loopHeader, boundsChecking, rowScanning: []
  }
}

let getJSONObjLoopTxt = (f, json, data) => () => {
  let v = f.arg[1].op
  let info = [`// generator: ${v} <- ${pretty(f.arg[0])}`]

  v = quoteVar(v)
  let initCursor = []
  let iter = symbol.getSymbol("iter")
  c.declareVar(initCursor)("yyjson_obj_iter", iter, c.call("yyjson_obj_iter_with", json.val));

  let loopHeader = []
  loopHeader.push(`for (yyjson_val *${v} = yyjson_obj_iter_next(&${iter}); ${v} != NULL; ${v} = yyjson_obj_iter_next(&${iter})) {`)

  let boundsChecking = [`if (yyjson_obj_getn(${json.val}, yyjson_get_str(${v}), yyjson_get_len(${v})) == NULL) continue;`]

  return {
    info, data, initCursor, loopHeader, boundsChecking, rowScanning: []
  }
}

let json = {
  convertJSONTo,
  emitLoadJSON,
  getJSONObjLoopTxt,
  getJSONArrayLoopTxt
}

module.exports = {
  json
}
