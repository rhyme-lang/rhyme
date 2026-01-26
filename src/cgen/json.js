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
  if (typing.isObject(schema)) {
    return json
  } else if (typing.isString(schema)) {
    let str = c.call("yyjson_get_str", json.val)
    let len = c.call("yyjson_get_len", json.val)
    let cond = c.not(c.call("yyjson_is_str", json.val))
    if (json.cond) cond = c.or(json.cond, cond)
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
      func1 = "yyjson_get_int"
      func2 = "yyjson_is_int"
    }
    let val = c.call(func1, json.val)
    let cond = c.not(c.call(func2, json.val))
    if (json.cond) cond = c.or(json.cond, cond)
    return value.primitive(schema, val, undefined, cond)
  } else {
    throw new Error("Cannot convert JSON val to type: " + typing.prettyPrintType(schema))
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

let emitLoadNDJSON = (buf, filename) => {
  let mappedFile = symbol.getSymbol(`file_ndjson`)

  let fd = symbol.getSymbol("fd")

  let size = symbol.getSymbol("n")

  c.declareInt(buf)(fd, c.open(filename))
  c.if(buf)(c.binary(fd, "-1", "=="), buf1 => {
    c.printErr(buf1)("Unable to open file %s\\n", filename)
    c.return(buf1)("1")
  })
  // c.declareSize(buf)(size, c.call("fsize", fd))
  // c.declareCharPtr(buf)(mappedFile, c.mmap(fd, size))
  // c.stmt(buf)(c.close(fd))
  c.declareSize(buf)(size, c.call("fsize", fd))
  c.declareCharPtr(buf)(mappedFile, c.malloc("char", c.add(size, "YYJSON_PADDING_SIZE")))
  // c.stmt(buf)(c.call("read", fd, mappedFile, size))

  let off = symbol.getSymbol("off")
  let r = symbol.getSymbol("r")
  c.declareSize(buf)(off, "0")
  c.declareSize(buf)(r)
  c.while(buf)(c.and(c.lt(off, size), c.assign(r, c.call("read", fd, c.add(mappedFile, off), c.sub(size, off)))), buf1 => {
    c.stmt(buf)(c.assign(off, c.add(off, r)))
  })

  c.stmt(buf)(c.call("memset", c.add(mappedFile, size), "0", "YYJSON_PADDING_SIZE"))
  c.stmt(buf)(c.close(fd))

  return { mappedFile, size }
}

let getJSONArrayLoopTxt = (f, json, data) => () => {
  let v = f.arg[1].op
  let info = [`// generator: ${v} <- ${pretty(f.arg[0])}`]

  v = quoteVar(v)
  let gen = v + "_gen"
  let initCursor = []
  let iter = symbol.getSymbol("iter")

  let loopHeader = []

  c.declareVar(loopHeader)("yyjson_arr_iter", iter, c.call("yyjson_arr_iter_with", json.val));
  loopHeader.push(`for (int ${v} = 0; ; ${v}++) {`)

  c.declarePtr(loopHeader)("yyjson_val", gen, `yyjson_arr_iter_next(&${iter})`)
  loopHeader.push(`if (!${gen}) break;`)

  let boundsChecking = [`if (${v} >= yyjson_get_len(${json.val})) continue;`]

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

  let loopHeader = []
  c.declareVar(loopHeader)("yyjson_obj_iter", iter, c.call("yyjson_obj_iter_with", json.val));
  loopHeader.push(`for (yyjson_val *${v} = yyjson_obj_iter_next(&${iter}); ${v} != NULL; ${v} = yyjson_obj_iter_next(&${iter})) {`)

  let boundsChecking = [`if (yyjson_obj_getn(${json.val}, yyjson_get_str(${v}), yyjson_get_len(${v})) == NULL) continue;`]

  return {
    info, data, initCursor, loopHeader, boundsChecking, rowScanning: []
  }
}

let getNDJSONLoopTxt = (f, ndjson, data) => () => {
  let v = f.arg[1].op
  let info = [`// generator: ${v} <- ${pretty(f.arg[0])}`]

  let { mappedFile, size } = ndjson.val

  v = quoteVar(v)

  let initCursor = []

  let cursor = symbol.getSymbol("i")
  c.declareSize(initCursor)(cursor, "0")

  let loopHeader = [`for (int ${v} = 0; ${cursor} < ${size}; ${v}++) {`]
  let rowScanning = []

  let doc = symbol.getSymbol("tmp_doc")
  c.declarePtr(rowScanning)("yyjson_doc", doc, c.call("yyjson_read_opts", c.add(mappedFile, cursor), c.sub(size, cursor), "YYJSON_READ_INSITU | YYJSON_READ_STOP_WHEN_DONE", "NULL", "NULL"))

  c.if(rowScanning)(c.not(doc), buf1 => {
    c.break(buf1)()
  })

  let jsonVal = v + "_gen"
  c.declarePtr(rowScanning)("yyjson_val", jsonVal, c.call("yyjson_doc_get_root", doc))

  c.stmt(rowScanning)(c.assign(cursor, c.add(cursor, c.call("yyjson_doc_get_read_size", doc))))

  let boundsChecking = [`if (${cursor} >= ${size}) break;`]

  return {
    info, data: [], initCursor, loopHeader, boundsChecking, rowScanning
  }
}

let json = {
  convertJSONTo,
  emitLoadJSON,
  emitLoadNDJSON,
  getJSONObjLoopTxt,
  getJSONArrayLoopTxt,
  getNDJSONLoopTxt
}

module.exports = {
  json
}
