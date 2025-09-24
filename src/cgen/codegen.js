const { c, utils } = require("./utils")
const { hashmap, array, bucketSize } = require("./collections")
const { TAG, value } = require("./value")
const { symbol } = require("./symbol")
const { csv } = require("./csv")
const { json } = require("./json")
const { printEmitter } = require("./print")

const { generate } = require("../new-codegen")
const { typing, types, typeSyms } = require('../typing')
const { sets } = require('../shared')
const { pretty } = require('../prettyprint')
const { runtime } = require('../simple-runtime')

const { unique, union, intersect, diff, subset, same } = sets
const { tmpSym, quoteVar } = utils

// Input simple-eval IR
let filters
let assignments

// Converted new-codegen IR
let assignmentStms
let generatorStms
let tmpVarWriteRank

// For convenient access to the prolog if something
// needs to be generated at the very beginning
// e.g., constant strings, hashmap declarations, structs etc.
// prolog0: before main function starts
// prolog1: after main function starts
let prolog0
let prolog1

// Environment of input files, avoiding multiple open's of the same file
let inputFiles

// Used and sorted columns of input CSV files
let usedCols
let sortedCols

// Stores the assignments that are grouped into the same hashmap
let assignmentToSym
let updateOps
let updateOpsExtra

// Stores mapping from vars to their binded values
let vars

// Stores tmp vars
let tmpVars

let getDeps = q => [...q.fre, ...q.tmps.map(tmpSym)]

// generator ir api: mirroring necessary bits from ir.js
let expr = (txt, ...args) => ({ txt, deps: args })

let initRequired = (q) => q.key == "stateful" && q.mode != "maybe" && (q.op + "_init") in runtime.stateful || q.key == "update"

let assign = (txt, lhs_root_sym, lhs_deps, rhs_deps) => {
  let e = expr(txt, ...lhs_deps, ...rhs_deps) // lhs.txt + " " + op + " " + rhs.txt
  e.lhs = expr("LHS", ...lhs_deps)
  e.op = "=?="
  e.rhs = expr("RHS", ...rhs_deps)
  e.writeSym = lhs_root_sym
  e.deps = e.deps.filter(e1 => e1 != e.writeSym) // remove cycles
  // update sym to rank dep map
  tmpVarWriteRank[e.writeSym] ??= 1
  e.writeRank = tmpVarWriteRank[e.writeSym]
  // if (e.op != "+=") // do not increment for idempotent ops? (XX todo opt)
  tmpVarWriteRank[e.writeSym] += 1
  assignmentStms.push(e)
}

let addMkset = (e1, e2, data) => {
  let a = getDeps(e1)
  let b = getDeps(e2)
  let e = expr("MKSET", ...a)
  e.sym = b[0]
  let info = [`// generator: ${e2.op} <- ${pretty(e1)}`]
  e.getLoopTxt = () => ({
    info, data, initCursor: [], loopHeader: ["{", "// singleton value here"], boundsChecking: [], rowScanning: []
  })
  generatorStms.push(e)
}

let addGenerator = (e1, e2, getLoopTxtFunc) => {
  let a = getDeps(e1)
  let b = getDeps(e2)
  let e = expr("FOR", ...a)
  e.sym = b[0]
  e.getLoopTxt = getLoopTxtFunc
  generatorStms.push(e)
}

let reset = (settings) => {
  symbol.reset()
  hashmap.reset(settings)

  assignmentStms = []
  generatorStms = []
  tmpVarWriteRank = {}

  prolog0 = []
  prolog1 = []

  inputFiles = {}

  usedCols = {}
  sortedCols = {}

  assignmentToSym = {}
  updateOps = {}
  updateOpsExtra = {}

  vars = {}

  tmpVars = {}
}

let initializeProlog = () => {
  prolog0.push(`#include "rhyme-sql.h"`)
  prolog0.push(`typedef int (*__compar_fn_t)(const void *, const void *);`)
  prolog1.push("int main() {")
}

// construct the prolog with prolog0 and prolog1
let finalizeProlog = () => {
  let prolog = [...prolog0, ...prolog1]
  if (inputFiles["json"]) {
    prolog = ["#include \"yyjson.h\"", ...prolog]
  }
  return prolog
}

// Emit the comapre function for the qsort
let emitCompareFunc = (buf, name, valPairs, orders) => {
  buf.push(`int ${name}(int *i, int *j) {`)
  for (let i in valPairs) {
    let [aVal, bVal] = valPairs[i]
    let order = orders[i]
    if (order == 1) {
      [aVal, bVal] = [bVal, aVal]
    }

    let schema = aVal.schema

    let tmp = symbol.getSymbol("tmp_cmp")

    if (typing.isString(schema)) {
      c.declareInt(buf)(tmp, c.call("strncmp", aVal.val.str, bVal.val.str, c.ternary(c.lt(aVal.val.len, bVal.val.len), aVal.val.len, bVal.val.len)))
      c.stmt(buf)(c.assign(tmp, c.ternary(c.eq(tmp, "0"), c.sub(aVal.val.len, bVal.val.len), tmp)))
    } else {
      c.declareInt(buf)(tmp, c.ternary(c.lt(aVal.val, bVal.val), "-1", c.ternary(c.gt(aVal.val, bVal.val), "1", "0")))
    }

    if (i == valPairs.length - 1) {
      c.return(buf)(tmp)
    } else {
      c.if(buf)(c.ne(tmp, "0"), buf1 => {
        c.return(buf1)(tmp)
      })
    }
  }
  buf.push(`}`)
}

let emitArraySorting = (buf, q, arr) => {
  let sym = arr.val.sym
  let count = arr.val.count

  let columns = q.arg.slice(1)

  let vals = []
  let orders = []
  let arrayEntry1 = array.getValueAtIdx(arr, "*i")
  let arrayEntry2 = array.getValueAtIdx(arr, "*j")

  for (let i = 0; i < columns.length; i += 2) {
    let column = columns[i]
    let order = columns[i + 1]

    if (arrayEntry1.tag != TAG.OBJECT || arrayEntry2.tag != TAG.OBJECT) {
      throw new Error("Sorting not supported here")
    }
    vals.push([
      arrayEntry1.val[column.op],
      arrayEntry2.val[column.op]
    ])
    orders.push(order.op)
  }

  let compareFunc = symbol.getSymbol("compare_func")
  emitCompareFunc(prolog0, compareFunc, vals, orders)

  c.declareIntPtr(buf)(sym, c.cast("int *", c.malloc("int", count)))
  c.stmt(buf)(`for (int i = 0; i < ${count}; i++) ${sym}[i] = i`)

  c.stmt(buf)(c.call("qsort", sym, count, "sizeof(int)", c.cast("__compar_fn_t", compareFunc)))

  arr.val.sorted = true
}

let emitHashMapSorting = (buf, q, map) => {
  let sym = map.val.sym
  let count = map.val.count

  let columns = q.arg.slice(1)

  let vals = []
  let orders = []
  let hashMapEntry1 = hashmap.getHashMapValueEntry(map, undefined, "*i")
  let hashMapEntry2 = hashmap.getHashMapValueEntry(map, undefined, "*j")
  for (let i = 0; i < columns.length; i += 2) {
    let column = columns[i]
    let order = columns[i + 1]

    if (hashMapEntry1.tag != TAG.OBJECT || hashMapEntry2.tag != TAG.OBJECT) {
      throw new Error("Sorting not supported here")
    }
    vals.push([
      hashMapEntry1.val[column.op],
      hashMapEntry2.val[column.op]
    ])
    orders.push(order.op)
  }

  let compareFunc = symbol.getSymbol("compare_func")
  emitCompareFunc(prolog0, compareFunc, vals, orders)

  c.declareIntPtr(buf)(sym, c.cast("int *", c.malloc("int", count)))
  c.stmt(buf)(`for (int i = 0; i < ${count}; i++) ${sym}[i] = i`)

  c.stmt(buf)(c.call("qsort", sym, count, "sizeof(int)", c.cast("__compar_fn_t", compareFunc)))

  map.val.sorted = true
}

let emitStatefulInit = (buf, q, lhs) => {
  if (q.op == "sum" || q.op == "count") {
    c.stmt(buf)(c.assign(lhs.val, "0"))
  } else if (q.op == "product") {
    c.stmt(buf)(c.assign(lhs.val, "1"))
  } else if (q.op == "min") {
    c.stmt(buf)(c.assign(lhs.val, "INT_MAX"))
  } else if (q.op == "max") {
    c.stmt(buf)(c.assign(lhs.val, "INT_MIN"))
  } else if (q.op == "array") {
    if (lhs.tag == TAG.HASHMAP_BUCKET) {
      // lhs passed will be the bucket object
      c.stmt(buf)(c.assign(lhs.val.bucketCount, "0"))
    } else {
      // lhs passed will be the array object
      c.stmt(buf)(c.assign(lhs.val.count, "0"))
    }
  } else if (q.key == "update") {
    c.stmt(buf)(c.assign(lhs.val.count, "0"))
  } else {
    throw new Error("stateful op not supported: " + pretty(q))
  }
}

let emitStatefulUpdate1 = (buf, q, lhs, rhs) => {
  if (rhs.tag == TAG.JSON) {
    let schema = q.op == "array" ? q.schema.type.objValue : q.schema.type
    rhs = json.convertJSONTo(rhs, schema)
  }
  if (q.op == "sum") {
    c.stmt(buf)(c.assign(lhs.val, c.binary(lhs.val, rhs.val, "+")))
  } else if (q.op == "count") {
    c.stmt(buf)(c.assign(lhs.val, c.binary(lhs.val, "1", "+")))
  } else if (q.op == "product") {
    c.stmt(buf)(c.assign(lhs.val, c.binary(lhs.val, rhs.val, "*")))
  } else if (q.op == "min") {
    c.stmt(buf)(`${lhs.val} = ${rhs.val} < ${lhs.val} ? ${rhs.val} : ${lhs.val}`)
  } else if (q.op == "max") {
    c.stmt(buf)(`${lhs.val} = ${rhs.val} > ${lhs.val} ? ${rhs.val} : ${lhs.val}`)
  } else if (q.op == "single") {
    if (typing.isString(q.arg[0].schema.type)) {
      let { str: lhsStr, len: lhsLen } = lhs.val
      let { str: rhsStr, len: rhsLen } = rhs.val
      c.stmt(buf)(c.assign(lhsStr, rhsStr))
      c.stmt(buf)(c.assign(lhsLen, rhsLen))
    } else {
      c.stmt(buf)(c.assign(lhs.val, rhs.val))
    }
  } else if (q.op == "array") {
    // lhs passed will be the bucket info object
    if (lhs.tag == TAG.HASHMAP_BUCKET) {
      // lhs passed will be the bucket object
      hashmap.emitHashBucketInsert(buf, lhs, rhs)
    } else {
      // lhs passed will be the array object
      array.emitArrayInsert(buf, lhs, rhs)
    }

  } else if (q.op == "print") {
    if (typing.isString(q.arg[0].schema.type)) {
      let { str, len } = rhs.val
      c.stmt(buf)(c.call("printf", `"%.*s\\n"`, len, str))
    } else {
      c.stmt(buf)(c.call("printf", `"%${utils.getFormatSpecifier(q.arg[0].schema.type)}\\n"`, rhs.val))
    }
  } else {
    throw new Error("stateful op not supported: " + pretty(q))
  }
}

let emitStatefulUpdate = (buf, q, lhs) => {
  if (q.key == "update") {

  } else {
    let e = q.arg[0]
    let rhs = emitPath(buf, e)
    if (lhs.cond || rhs.cond) {
      let cond = lhs.cond && rhs.cond ? c.or(lhs.cond, rhs.cond) : (lhs.cond ? lhs.cond : rhs.cond)
      c.if(buf)(c.not(cond), buf1 => {
        emitStatefulUpdate1(buf1, q, lhs, rhs)
      })
    } else {
      emitStatefulUpdate1(buf, q, lhs, rhs)
    }
  }

}

let emitStatefulInPath = (i) => {
  let q = assignments[i]
  let sym = tmpSym(i)

  if (q.fre.length > 0) throw new Error("unexpected number of free variables for stateful op in path: " + pretty(q) + " has free vars: " + q.fre)

  let fv = q.fre
  let tmpVar = tmpVars[i]

  // Get the lhs of the assignment and emit the code for the stateful op
  if (initRequired(q)) {
    let buf = []
    c.comment(buf)("init " + sym + " = " + pretty(q))

    emitStatefulInit(buf, q, tmpVar)
    // init
    assign(buf, sym, fv, [])
  }

  let deps = [...union(fv, q.bnd), ...q.tmps.map(tmp => assignmentToSym[tmp] ? assignmentToSym[tmp] : tmpSym(tmp))] // XXX rhs dims only?

  // update
  let buf = []
  c.comment(buf)("update " + sym + " = " + pretty(q))

  emitStatefulUpdate(buf, q, tmpVar)
  assign(buf, sym, fv, deps)
}

let emitLoadInput = (buf, q) => {
  let emitFilenameStr = (buf, q) => {
    let isConstStr = q.key == "const" && typeof q.op == "string"
    let filename = emitPath(buf, q)
    if (filename.cond) {
      c.if(buf)(filename.cond, buf1 => {
        c.printErr(buf1)("Attempting to open a file with undefined filename\\n")
        c.return(buf1, "1")
      })
    }

    let filenameStr
    if (!isConstStr) {
      if (filename.cond) {
        c.if(buf)(filename.cond, buf1 => {
          c.printErr(buf1)("Attempting to open a file with undefined filename\\n")
          c.return(buf1, "1")
        })
      }
      // If filename is not a constant string, we need to create a null-terminated copy of the string
      filenameStr = symbol.getSymbol("tmp_filename")
      c.declareCharArr(buf)(filenameStr, `${filename.val.len} + 1`)
      c.stmt(buf)(c.call("extract_str1", filename.val.str, filename.val.len, filenameStr))
    } else {
      filenameStr = filename.val.str
    }

    return filenameStr
  }

  let file = q.arg[0]
  let filename

  filename = pretty(file)

  let isConstStr = file.key == "const" && typeof file.op == "string"
  let buf1 = isConstStr ? prolog1 : buf

  // If this is the first time we see this loadInput, load the file
  if (inputFiles[q.op]?.[filename] == undefined) {
    inputFiles[q.op] = {}
    let filenameStr = emitFilenameStr(buf1, file)

    if (q.op == "json") {
      let jsonVal = json.emitLoadJSON(buf1, filenameStr)
      inputFiles[q.op][filename] = jsonVal
    } else {
      let { mappedFile, size } = csv.emitLoadCSV(buf1, filenameStr, q.op)
      inputFiles[q.op][filename] = { mappedFile, size, format: q.op }
    }
  }

  let tag = q.op == "json" ? TAG.JSON : TAG.CSV_FILE
  return value.primitive(q.schema.type, inputFiles[q.op][filename], tag)
}

let emitConst = (q) => {
  if (typeof q.op == "number") {
    return value.primitive(q.schema.type, String(q.op))
  } else if (typeof q.op == "string") {
    return value.string(q.schema.type, "\"" + q.op + "\"", q.op.length)
  } else if (typeof q.op == "boolean") {
    return value.primitive(q.schema.type, q.op ? 1 : 0)
  } else if (typeof q.op == "undefined") {
    return value.primitive(q.schema.type, 0, undefined, "1")
  } else {
    throw new Error("Constant not supported: " + pretty(q))
  }
}

let emitGet = (buf, q) => {
  let [e1, e2] = q.arg

  if (e2.key == "var") {
    // We don't want to generate code for getting the data again since we already got the var info
    let g1 = vars[e2.op].lhs[pretty(e1)]
    if (g1 === undefined) {
      throw new Error("The correctponding loop as not been seen: " + e2.op + ", " + pretty(e1))
    }

    if (g1.tag == TAG.CSV_FILE) {
      // If we are getting a var from a file,
      // return the object representing a record in the file
      let schema = utils.convertToArrayOfSchema(g1.schema.objValue)
      let val = {}
      schema.map(keyVal => {
        let valName = g1.val.mappedFile + "_" + quoteVar(e2.op) + "_" + keyVal.name
        if (typing.isString(keyVal.schema)) {
          let start = valName + "_start"
          let end = valName + "_end"
          val[keyVal.name] = { schema: keyVal.schema, val: { str: c.add(g1.val.mappedFile, start), len: c.sub(end, start) } }
        } else {
          val[keyVal.name] = { schema: keyVal.schema, val: valName }
        }
      })
      return { schema: q.schema.type, val, tag: TAG.OBJECT }
    } else if (g1.tag == TAG.JSON) {
      // It's better if we do not perform generic get since we should have the iterator ready for the loop,
      // use yyjson_obj_iter_get_val
      if (pretty(e1) == Object.keys(vars[e2.op].lhs)[0]) {
        // Only one possible lhs of this generator, use the iterator
        return { schema: q.schema.type, val: c.call("yyjson_obj_iter_get_val", quoteVar(e2.op)), tag: TAG.JSON }
      } else {
        // Slow path, use yyjson_obj_getn
        return { schema: q.schema.type, val: c.call("yyjson_obj_getn", g1.val, c.call("yyjson_get_str", quoteVar(e2.op)), c.call("yyjson_get_len", quoteVar(e2.op))), tag: TAG.JSON }
      }
    } else if (g1.tag == TAG.ARRAY) {
      // If we are iterating over a hashMap,
      // get the entry directly using the var
      return array.getValueAtIdx(g1, quoteVar(e2.op))
    } else if (g1.tag == TAG.HASHMAP) {
      // If we are iterating over a hashMap,
      // get the entry directly using the var
      return hashmap.getHashMapValueEntry(g1, undefined, quoteVar(e2.op))
    } else if (g1.tag == TAG.HASHMAP_BUCKET) {
      // If we are iterating over a hashMap bucket,
      // get the stored loop info
      // We don't need to check existance of the bucket here
      // since it is checked before the loop executes
      let dataPos = `${g1.val.buckets}[${c.add(c.mul(g1.keyPos, bucketSize), quoteVar(e2.op))}]`
      return array.getValueAtIdx(g1, dataPos)
    } else {
      throw new Error("Cannot get var from non-iterable object")
    }
  }

  // If we are not getting a var, get the lhs first
  let v1 = emitPath(buf, e1)

  if (v1.tag == TAG.JSON) {
    let key = emitPath(buf, e2)
    let res = { schema: q.schema.type, tag: TAG.JSON }

    // Assume string key now
    let get = symbol.getSymbol("tmp_get")
    c.declarePtr(buf)("yyjson_val", get, c.call("yyjson_obj_getn", v1.val, key.val.str, key.val.len))
    res.val = get
    res.cond = c.eq(get, "NULL")
    return res
  }

  if (v1.tag == TAG.HASHMAP) {
    // HashMap lookup
    let key = emitPath(buf, e2)
    let [pos, keyPos] = hashmap.emitHashLookUp(buf, v1, key)
    // The value is undefined if keyPos == -1
    // emitPath will not handle undefined values
    // It is up to the top-level caller of emitPath how undefined is handled
    let value = hashmap.getHashMapValueEntry(v1, pos, keyPos)
    value.cond = c.eq(keyPos, "-1")
    return value
  }

  if (v1.tag == TAG.ARRAY) {
    // Array element access
    let idx = emitPath(buf, e2)
    let res = array.getValueAtIdx(v1, idx.val)
    res.cond = c.ge(idx.val, v1.val.count)
    if (idx.cond) res.cond = c.and(idx.cond, res.cond)
    return res
  }

  // Then it has to be an object
  if (v1.tag != TAG.OBJECT) {
    throw new Error("Cannot perform get on non-object values")
  }

  if (!(e2.key == "const" && typeof e2.op == "string")) {
    throw new Error("Cannot get non-constant string field from objects")
  }

  let cond = v1.cond
  if (!v1.val[e2.op]) cond = "1"
  return { ...v1.val[e2.op], cond }
}

let emitPure = (buf, q) => {
  if (q.op == "sort") {
    let e = emitPath(buf, q.arg[0])
    if (e.tag == TAG.HASHMAP) {
      emitHashMapSorting(buf, q, e)
      return e
    } else if (e.tag == TAG.ARRAY) {
      emitArraySorting(buf, q, e)
      return e
    } else
      throw new Error("Sorting is not supported on this object: " + e)
  } else if (q.op == "mkTuple") {
    let schema = utils.convertToArrayOfSchema(q.schema.type)
    let res = { schema: q.schema.type, val: {}, tag: TAG.OBJECT }
    for (let i = 0; i < q.arg.length; i += 2) {
      let k = q.arg[i]
      let v = q.arg[i + 1]
      let { name } = schema[i / 2]
      res.val[name] = emitPath(buf, v)
    }
    return res
  } else if (q.op == "and") {
    let [cond, res] = q.arg.map(e => emitPath(buf, e))
    res.cond = c.not(cond.val)
    return res
  } else if (q.op.startsWith("convert_")) {
    let e = emitPath(buf, q.arg[0])
    return value.primitive(q.schema.type, c.cast(utils.cTypes[q.op.substring("convert_".length)], e.val), undefined, e.cond)
  } else if (q.op == "year") {
    let e = emitPath(buf, q.arg[0])
    return value.primitive(q.schema.type, c.div(e.val, "10000"), undefined, e.cond)
  } else if (q.op == "substr") {
    let [e1, e2, e3] = q.arg.map(e => emitPath(buf, e))
    console.assert(typing.isString(e1.schema))
    let str = c.add(e1.val.str, e2.val)
    let len = c.sub(e3.val, e2.val)
    return value.string(q.schema.type, str, len, undefined, e1.cond)
  } else if (q.op == "like") {
    if (q.arg[1].key != "const" || typeof q.arg[1].key != "string") {
      throw new Error("Only support constant string regex")
    }
    let e = emitPath(buf, q.arg[0])
    console.assert(typing.isString(e.schema))

    let name = symbol.getSymbol("tmp_like")
    utils.emitWildcardMatch(buf, e, q.arg[1].op, name)

    return value.primitive(q.schema.type, name, undefined, e.cond)
  } else if (q.op == "isUndef") {
    let e = emitPath(buf, q.arg[0])
    if (e.cond) {
      return value.primitive(q.schema.type, e.cond)
    } else {
      // Cannot be undefined, return the value
      return e
    }
  } else if (q.op == "combine") {
    let keys = q.arg.map(e => emitPath(buf, e))
    let schema = keys.map(key => key.schema)
    return value.combinedKey(schema, keys)
  } else if (utils.binaryOperators[q.op]) {
    // binary op
    let [e1, e2] = q.arg.map(e => emitPath(buf, e))
    let op = utils.binaryOperators[q.op]
    if (e1.tag == TAG.JSON) e1 = json.convertJSONTo(e1, e1.schema)
    if (e2.tag == TAG.JSON) e2 = json.convertJSONTo(e2, e1.schema)
    if (q.op == "equal" || q.op == "notEqual" || q.op == "lessThan" || q.op == "greaterThan" || q.op == "lessThanOrEqual" || q.op == "greaterThanOrEqual") {
      if (typing.isString(e1.schema) && typing.isString(e2.schema)) {
        let { str: str1, len: len1 } = e1.val
        let { str: str2, len: len2 } = e2.val

        let name = symbol.getSymbol("tmp_cmpstr")
        // let curr = symbol.getSymbol("tmp_cursor")
        // let minLen = symbol.getSymbol("min_len")

        c.declareInt(buf)(name, c.call("strncmp", str1, str2, c.ternary(c.lt(len1, len2), len1, len2)))
        c.stmt(buf)(c.assign(name, c.ternary(c.eq(name, "0"), c.sub(len1, len2), name)))

        res = value.primitive(q.schema.type, c.binary(name, "0", op))
      } else {
        res = value.primitive(q.schema.type, c.binary(e1.val, e2.val, op))
      }
    } else if (q.op == "fdiv") {
      res = value.primitive(q.schema.type, c.binary(c.cast("double", e1.val), c.cast("double", e2.val), op))
    } else {
      res = value.primitive(q.schema.type, c.binary(e1.val, e2.val, op))
    }
    if (e1.cond && e2.cond) {
      res.cond = c.or(e1.cond, e2.cond)
    } else if (e1.cond) {
      res.cond = e1.cond
    } else {
      res.cond = e2.cond
    }
    return res
  } else {
    throw new Error("Pure operation not supported: " + pretty(q))
  }
}

// Generate code for paths
// returns the value of the path
let emitPath = (buf, q) => {
  if (q.key == "loadInput") {
    return emitLoadInput(buf, q)
  } else if (q.key == "const") {
    return emitConst(q)
  } else if (q.key == "var") {
    return vars[q.op].val
  } else if (q.key == "ref") {
    let q1 = assignments[q.op]
    let tmpVar = tmpVars[q.op]

    if (q1.fre.length > 0) {
      // We can directly use the pos and keyPos
      // without doing a hash lookup
      let keys = q1.fre.map(f => vars[f].val)
      if (keys.length > 1) throw new Error("Multi level lookup not supported")
      let rootMap = tmpVars[assignmentToSym[q.op]]
      let [pos, keyPos] = hashmap.emitHashLookUp(buf, rootMap, keys[0])
      let value = hashmap.getHashMapValueEntry(tmpVar, pos, keyPos)
      return value
    } else {
      return tmpVar
    }
  } else if (q.key == "get") {
    return emitGet(buf, q)
  } else if (q.key == "pure") {
    return emitPure(buf, q)
  } else {
    throw new Error("Unknown op: " + pretty(q))
  }
}


// Collect all the used columns.
// e.g. if an integer column is used, it will be extracted
// while we scan through each row in the csv.
//
// This makes sure that if we want to use the variable,
// it will be available in the scope.
let collectUsedAndSortedCols = q => {
  if (q.key == "get") {
    let [e1, e2] = q.arg

    let isCsvColumn = e1.key == "get" && e1.arg[0].key == "loadInput" && e1.arg[1].key == "var" &&
      e2.key == "const" && typeof e2.op == "string"

    if (!isCsvColumn) {
      collectUsedAndSortedCols(e1)
      collectUsedAndSortedCols(e2)
      return
    }

    // extract used columns for the filename
    collectUsedAndSortedCols(e1.arg[0].arg[0])

    let prefix = pretty(e1) // does this always work?
    usedCols[prefix] ??= {}
    usedCols[prefix][e2.op] = true
  } else if (q.key == "ref") {
    let q1 = assignments[q.op]
    collectUsedAndSortedCols(q1)
  } else if (q.key == "pure" && q.op == "sort") {
    // if a column is used for sorting,
    // we need to define it as a global array
    // so that it is accessbile to the comparison function
    let columns = q.arg.slice(1)
    collectUsedAndSortedCols(q.arg[0])
    sortedCols[tmpSym(q.arg[0].op)] ??= {}
    for (let i = 0; i < columns.length; i += 2) {
      let column = columns[i]
      let order = columns[i + 1]

      sortedCols[tmpSym(q.arg[0].op)][column.op] = true

      if (!(column.key == "const" && typeof column.op == "string")) {
        throw new Error("Invalid column for sorting: " + pretty(column))
      }
      if (!(order.key == "const" && typeof order.op == "number" && (order.op == 0 || order.op == 1))) {
        throw new Error("Invalid order for sorting: " + pretty(order))
      }
    }
  } else if (q.arg) {
    q.arg.map(collectUsedAndSortedCols)
  }
}

// Try to find relevant stateful in the arg of another stateful that can be grouped into the same hashmap
let collectRelevantStatefulInPath = (q, currentGroupPath) => {
  if (q.key == "ref") {
    let ref = q
    let i = q.op
    q = assignments[i]
    let sym = tmpSym(i)
    if (q.key == "update") {
      collectHashMap(ref)
      return
    } else {
      if (q.fre.length == 0) {
      } else {
        if (!same(q.fre, currentGroupPath.path)) {
          console.log(q)
          throw new Error("Stateful op expected to have the same set of free variables as the current group path but got: " + q.fre + " and " + currentGroupPath.path)
        }

        assignmentToSym[i] = currentGroupPath.sym
        updateOpsExtra[currentGroupPath.sym].push(i)

        let dummy = { schema: { objValue: q.schema.type }, val: { sym } }
        hashmap.emitHashMapValueInit(prolog1, dummy, `_DEFAULT_`, q.schema.type)
        tmpVars[i] = dummy
      }
    }
  }

  if (q.arg) {
    q.arg.map(x => collectRelevantStatefulInPath(x, currentGroupPath))
  }
}

let addHashMapBucket = (map, q, name, currentGroupPath) => {
  hashmap.emitHashMapBucketsInit(prolog1, map, name, q.schema.type)

  let bucket = map.val.values[name]
  let e = q.arg[0]
  if (typing.isUnknown(e.schema.type)) {
    hashmap.emitHashMapBucketValuesInit(prolog1, map, bucket, "_DEFAULT_", e.schema.type)
  } else if (typing.isObject(e.schema.type) && utils.isSimpleObject(e.schema.type)) {
    let values = utils.convertToArrayOfSchema(e.schema.type)
    for (let i in values) {
      let { name, schema } = values[i]
      hashmap.emitHashMapBucketValuesInit(prolog1, map, bucket, name, schema)
    }
  } else {
    hashmap.emitHashMapBucketValuesInit(prolog1, map, bucket, "_DEFAULT_", e.schema.type)
  }
}

let addHashMapValue = (map, q, name, currentGroupPath) => {
  while (q.key == "pure" && q.op.startsWith("convert_")) {
    q = q.arg[0]
  }
  if (q.key != "ref") {
    throw new Error("stateful op expected but got " + pretty(q))
  }
  let q1 = assignments[q.op]
  if (q1.key == "update") {
    // We cannot sort on a nested hashamp column
    assignmentToSym[q.op] = currentGroupPath.sym
    updateOps[currentGroupPath.sym].push(q.op)
    q1.root = currentGroupPath.sym
    collectNestedHashMap(q, map, name, currentGroupPath)
  } else if (q1.key == "stateful" && q1.fre.length != 0) {
    if (!same(q1.fre, currentGroupPath.path)) {
      throw new Error("Stateful op expected to have the same set of free variables as the current group path but got: " + q1.fre + " and " + currentGroupPath.path)
    }
    assignmentToSym[q.op] = currentGroupPath.sym
    updateOps[currentGroupPath.sym].push(q.op)

    if (name != "_DEFAULT_") q1.extraGroupPath = name

    let sym = tmpSym(currentGroupPath.sym)
    if (q1.op == "array") {
      // We cannot sort on an array column
      addHashMapBucket(map, q1, name, currentGroupPath)
    } else {
      hashmap.emitHashMapValueInit(prolog1, map, name, q.schema.type, sortedCols?.[sym]?.[name], prolog0)
    }
    collectRelevantStatefulInPath(q1.arg[0], currentGroupPath)
  }
}

let collectNestedHashMap = (q, map, name, currentGroupPath) => {
  let i = q.op

  q = assignments[q.op]
  let sym = tmpSym(i)

  let [e0, e1, e2, e3] = q.arg

  if (e1.vars.length > 1) {
    throw new Error("Not supported for now")
  }

  let keySchema = [e1.schema.type]

  // If there is a mkset
  if (e3) {
    // Check if the key is a set of keys
    let mksetVal = e3.arg[0].arg[0]
    if (mksetVal.key == "pure" && mksetVal.op == "combine") {
      keySchema = mksetVal.arg.map(e => e.schema.type)
    } else {
      keySchema = [mksetVal.schema.type]
    }
    collectHashMapsInPath(e3)
  }

  // Create hashmap
  hashmap.emitNestedHashMapInit(prolog1, map, name, q.schema.type, keySchema)
  let nestedMap = map.val.values[name]

  updateOps[i] = []
  updateOpsExtra[i] = []

  let iOld = currentGroupPath.sym
  currentGroupPath.sym = i
  currentGroupPath.path.push(e1.op)
  addHashMapValue(nestedMap, e2, "_DEFAULT_", currentGroupPath)
  currentGroupPath.sym = iOld
  currentGroupPath.path.pop()
}

// Collect hashmaps required for the query
let collectHashMap = (q) => {
  let i = q.op

  if (updateOps[i]) return

  q = assignments[q.op]
  let sym = tmpSym(i)

  let [e0, e1, e2, e3] = q.arg

  if (e1.vars.length > 1) {
    throw new Error("Not supported for now")
  }

  let keySchema = [e1.schema.type]

  // If there is a mkset
  if (e3) {
    // Check if the key is a set of keys
    let mksetVal = e3.arg[0].arg[0]
    if (mksetVal.key == "pure" && mksetVal.op == "combine") {
      keySchema = mksetVal.arg.map(e => e.schema.type)
    } else {
      keySchema = [mksetVal.schema.type]
    }
    collectHashMapsInPath(e3)
  }

  updateOps[i] = []
  updateOpsExtra[i] = []

  // Create hashmap
  let { htable, count, keys } = hashmap.emitHashMapInit(prolog1, sym, keySchema)
  let tmpVar = value.hashmap(q.schema.type, sym, htable, count, keys)

  let currentGroupPath = { sym: i, path: [...q.fre, e1.op], keySchema }
  if (e2.key == "pure" && e2.op == "mkTuple") {
    for (let j = 0; j < e2.arg.length; j += 2) {
      let key = e2.arg[j]
      let val = e2.arg[j + 1]
      addHashMapValue(tmpVar, val, key.op, currentGroupPath)
    }
  } else {
    addHashMapValue(tmpVar, e2, "_DEFAULT_", currentGroupPath)
  }

  tmpVars[i] = tmpVar
}

// Collect hashmaps required for the query
let collectHashMapsInPath = q => {
  if (q.key == "ref" && assignments[q.op].key == "update") {
    collectHashMap(q)
  } else if (q.arg) {
    if (q.key == "ref") q = assignments[q.op]
    q.arg.map(collectHashMapsInPath)
  }
}

let collectArray = (q, i) => {
  let sym = tmpSym(i)
  let count = array.emitArrayInit(prolog1, sym)
  let tmpVar = value.array(q.schema.type, sym, count)
  tmpVars[i] = tmpVar
  let e = q.arg[0]

  if (typing.isObject(e.schema.type) && utils.isSimpleObject(e.schema.type)) {
    let values = utils.convertToArrayOfSchema(e.schema.type)
    for (let i in values) {
      let { name, schema } = values[i]
      array.emitArrayValueInit(prolog1, tmpVar, name, schema, sortedCols?.[sym]?.[name], prolog0)
    }
  } else {
    array.emitArrayValueInit(prolog1, tmpVar, "_DEFAULT_", e.schema.type)
  }
}

let collectOtherStatefulOps = () => {
  for (let i in assignments) {
    let q = assignments[i]
    if (q.key == "update" || assignmentToSym[i]) continue
    if (q.op == "print") {
      tmpVars[i] = { schema: types.never }
      continue
    }
    let sym = tmpSym(i)
    if (q.op == "array") {
      collectArray(q, i)
    } else if (typing.isString(q.schema.type)) {
      c.declarePtr(prolog1)("char", `${sym}_str`)
      c.declareInt(prolog1)(`${sym}_len`)
      tmpVars[i] = value.string(q.schema.type, `${sym}_str`, `${sym}_len`)
    } else {
      c.declareVar(prolog1)(utils.convertToCType(q.schema.type), sym)
      tmpVars[i] = value.primitive(q.schema.type, sym)
    }
  }
}

// Process the filters and create generator statements
let processFilters = () => {
  for (let i in filters) {
    let f = filters[i]
    let v1 = f.arg[1].op
    let g1 = f.arg[0]

    if (g1.key == "mkset") {
      let data = []
      let val = emitPath(data, g1.arg[0])
      vars[v1] = { val }
      addMkset(f.arg[0], f.arg[1], data)
    } else {
      let data = []
      let lhs = emitPath(data, g1)
      let firstSeen = !vars[v1]
      vars[v1] ??= {}
      vars[v1].lhs ??= {}
      vars[v1].lhs[pretty(g1)] = lhs
      // Generate loops based on different types of left hand side values
      if (firstSeen) {
        vars[v1].val = value.primitive(lhs.schema.objKey || types.unknown, quoteVar(v1))
      }
      if (lhs.tag == TAG.CSV_FILE) {
        let getLoopTxtFunc = csv.getCSVLoopTxt(f, lhs, data, usedCols)
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
      } else if (lhs.tag == TAG.JSON) {
        let getLoopTxtFunc = json.getJSONLoopTxt(f, lhs, data)
        if (firstSeen) vars[v1].val.tag = TAG.JSON
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
      } else if (lhs.tag == TAG.ARRAY) {
        let getLoopTxtFunc = array.getArrayLoopTxt(f, lhs)
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
      } else if (lhs.tag == TAG.HASHMAP) {
        let getLoopTxtFunc = hashmap.getHashMapLoopTxt(f, lhs)
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
      } else if (lhs.tag == TAG.HASHMAP_BUCKET) {
        let getLoopTxtFunc = hashmap.getHashBucketLoopTxt(f, lhs, data)
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
      } else {
        throw new Error("Cannot have generator on non-iterable objects: " + lhs.tag)
      }

    }
  }
}

let emitCode = (q, ir, settings) => {
  reset(settings)

  filters = ir.filters
  assignments = ir.assignments
  irVars = ir.vars

  // Fill with default prolog
  initializeProlog()

  // Get the used filters to optimize CSV reading
  collectUsedAndSortedCols(q)

  // Collect hashmaps needed for the query and relevant stateful ops
  // collectHashMaps()
  collectHashMapsInPath(q)

  // Before we process the filters, we need to collect the arrays
  // We can also collect other stateful ops here
  collectOtherStatefulOps()

  // Process filters
  processFilters()

  // Emit the stateful ops that are not captured by update ops
  for (let i in assignments) {
    let q = assignments[i]

    if (q.key == "update" || assignmentToSym[i]) continue

    emitStatefulInPath(i)
  }

  for (let i in updateOps) {
    let q = assignments[i]
    let sym = tmpSym(i)

    let k = assignments[i].arg[1].op

    let shouldInit = updateOps[i].some(j => initRequired(assignments[j])) || updateOpsExtra[i].some(j => initRequired(assignments[j]))

    let [e0, e1, e2, e3] = q.arg

    let fv = [...q.fre, e1.op]

    let key = vars[e1.op].val

    let map
    if (q.fre.length == 0) {
      map = tmpVars[i]
    } else {
      map = tmpVars[q.root]
    }

    if (!shouldInit) {
      let lookup = []
      let [pos, keyPos] = hashmap.emitHashLookUp(lookup, map, key)
      assign(lookup, sym, fv, [])
      for (let j of updateOps[i]) {
        let q = assignments[j]
        let buf = []
        let deps = [...union(fv, q.bnd), ...q.tmps.map(tmp => assignmentToSym[tmp] ? tmpSym(assignmentToSym[tmp]) : tmpSym(tmp))]

        let update1 = () => { }
        if (q.mode === "maybe") {
          // We still need to initialize it to some value if it is in maybe mode
          update1 = (buf2, lhs) => {
            c.comment(buf2)("init " + sym + "[" + q.fre[0] + "]" + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))
            if (q.extraGroupPath) {
              console.assert(lhs.tag == TAG.OBJECT)
              lhs = lhs.val[q.extraGroupPath]
            }
            emitStatefulInit(buf2, q, lhs)
          }
        }
        c.comment(buf)("update " + sym + "[" + q.fre[0] + "]" + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))
        // Extract the top-level condition for stateful operations
        let e = q.arg[0]
        let update = (buf1) => hashmap.emitHashMapUpdate(buf1, map, key, pos, keyPos, update1, (buf2, lhs) => {
          currentGroupKey = { key: k, pos, keyPos }
          let cond = lhs.cond
          if (q.extraGroupPath) {
            console.assert(lhs.tag == TAG.OBJECT)
            lhs = lhs.val[q.extraGroupPath]
          }
          lhs.cond = cond
          emitStatefulUpdate(buf2, q, lhs, sym)
        }, true)
        if (e.key == "pure" && e.op == "and") {
          let cond = emitPath(buf, e.arg[0])
          if (cond.cond) cond.val = c.and(c.not(cond.cond), cond.val)
          c.if(buf)(cond.val, update)
        } else {
          update(buf)
        }

        assign(buf, sym, fv, deps)
      }
      // extra not supported yet
      continue
    }

    let init = []
    if (q.fre.length > 0) {
      for (let k of q.fre) {
        let key = vars[k].val
        let [pos, keyPos] = hashmap.emitHashLookUp(init, map, key)
        map = hashmap.getHashMapValueEntry(map, pos, keyPos)
      }
    }

    //   c.comment(init)("init and update " + sym + " = " + pretty(assignments[i]))
    let [pos, keyPos] = hashmap.emitHashLookUpOrUpdate(init, map, key, (buf1, lhs, pos, keyPos) => {
      for (let j of updateOps[i]) {
        let q = assignments[j]
        if (!initRequired(q)) continue
        c.comment(buf1)("init " + sym + "[" + q.fre[0] + "]" + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))
        let lhs1 = lhs
        if (q.extraGroupPath) {
          console.assert(lhs.tag == TAG.OBJECT)
          lhs1 = lhs.val[q.extraGroupPath]
        }
        emitStatefulInit(buf1, q, lhs1)
      }
      for (let j of updateOpsExtra[i]) {
        let q = assignments[j]
        if (!initRequired(q)) continue
        c.comment(buf1)("init " + tmpSym(j) + "[" + q.fre[0] + "]" + " = " + pretty(q))
        let lhs1 = hashmap.getHashMapValueEntry(tmpVars[j], pos, keyPos)
        emitStatefulInit(buf1, q, lhs1)
      }
    })

    assign(init, sym, fv, [])

    currentGroupKey = { key: k, pos, keyPos }
    for (let j of updateOpsExtra[i]) {
      let update = []
      let q = assignments[j]
      c.comment(update)("update " + tmpSym(j) + "[" + q.fre[0] + "]" + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))
      let deps = [...union(fv, q.bnd), ...q.tmps.map(tmp => assignmentToSym[tmp] ? tmpSym(assignmentToSym[tmp]) : tmpSym(tmp))]

      hashmap.emitHashLookUpAndUpdate(update, map, key, (buf, lhs, pos, keyPos) => {
        let lhs1 = hashmap.getHashMapValueEntry(tmpVars[j], pos, keyPos)
        emitStatefulUpdate(buf, q, lhs1)
      }, false)
      assign(update, sym, fv, deps)
    }
    for (let j of updateOps[i]) {
      let update = []
      let q = assignments[j]
      if (q.key == "update") continue
      c.comment(update)("update " + sym + "[" + q.fre[0] + "]" + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))
      let f = tmp => assignmentToSym[tmp] ? f(assignmentToSym[tmp]) : tmp
      let deps = [...union(fv, q.bnd), ...q.tmps.map(f).map(tmpSym)]

      hashmap.emitHashLookUpAndUpdate(update, map, key, (buf, lhs, pos, keyPos) => {
        if (q.extraGroupPath) {
          console.assert(lhs.tag == TAG.OBJECT)
          lhs = lhs.val[q.extraGroupPath]
        }
        emitStatefulUpdate(buf, q, lhs)
      }, false)
      assign(update, sym, fv, deps)
    }
  }

  let epilog = []

  // // Different take on this backend
  // let res = path(epilog, q)

  let res = emitPath(epilog, q)

  if (res.cond) {
    c.if(epilog)(res.cond, buf1 => {
      c.printf(buf1)("undefined")
      c.return(buf1)("0")
    })
  }

  if (res.schema.typeSym != typeSyms.never)
    printEmitter.emitValPrint(epilog, res, settings)

  // Return and close the main function
  c.return(epilog)("0")
  epilog.push("}")

  // Construct the prolog
  let prolog = finalizeProlog()

  let newCodegenIR = {
    assignmentStms,
    generatorStms,
    tmpVarWriteRank,
    prolog,
    epilog
  }
  return generate(newCodegenIR, "c-sql")
}

let generateC = (q, ir, settings) => {
  let { outDir, outFile } = settings
  const fs = require('fs').promises
  const os = require('child_process')
  // const path = require('path')
  let joinPaths = (...args) => {
    return args.map((part, i) => {
      if (i === 0) {
        return part.trim().replace(/[\/]*$/g, '')
      } else {
        return part.trim().replace(/(^[\/]*|[\/]*$)/g, '')
      }
    }).filter(x => x.length).join('/')
  }

  let sh = (cmd) => {
    return new Promise((resolve, reject) => {
      os.exec(cmd, (err, stdout) => {
        if (err) {
          reject(err)
        } else {
          resolve(stdout)
        }
      })
    })
  }

  let cFile = joinPaths(outDir, outFile + ".c")
  let out = joinPaths(outDir, outFile)
  let codeNew = emitCode(q, ir, settings)

  let cFlags = "-Icgen-sql -O3"

  let func = async () => {
    let stdout = await sh(`./${out} `)
    return stdout
  }

  func.explain = func.explain

  let writeAndCompile = async () => {
    await fs.writeFile(cFile, codeNew)
    if (inputFiles["json"]) cFlags += " -Lcgen-sql -lyyjson"
    let cmd = `gcc ${cFile} -o ${out} ${cFlags}`
    console.log("Executing:", cmd)
    await sh(cmd)
    return func
  }

  return writeAndCompile()
}

module.exports = { generateC }
