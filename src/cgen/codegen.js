const { c, utils } = require("./utils")
const { hashmap } = require("./data-structs")
const { TAG, value } = require("./value")
const { symbol } = require("./symbol")
const { csv } = require("./csv")
const { printEmitter } = require("./print")

const { generate } = require("../new-codegen")
const { typing, types } = require('../typing')
const { sets } = require('../shared')
const { pretty } = require('../prettyprint')
const { runtime } = require('../simple-runtime')

const { unique, union, intersect, diff, subset, same } = sets
const { tmpSym, quoteVar } = utils

// xxx
let currentGroupKey

// Input simple-eval IR
let filters
let assignments
let irVars

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

// Pool of constant strings used in the C code
let constStrs

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

let reset = () => {
  symbol.reset()
  hashmap.reset()

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

  constStrs = {}

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

let emitHashMapSorting = (buf, q, map) => {
  let sym = map.val.sym

  let columns = q.arg.slice(1)

  let vals = []
  let orders = []
  let hashMapEntry1 = hashmap.getHashMapValueEntry(map, undefined, "*i")
  let hashMapEntry2 = hashmap.getHashMapValueEntry(map, undefined, "*j")
  for (let i = 0; i < columns.length; i += 2) {
    let column = columns[i]
    let order = columns[i + 1]

    if (hashMapEntry1.tag != TAG.OBJECT || hashMapEntry2.tag != TAG.OBJECT) {
      throw new Error("Sroting not supported here")
    }
    vals.push([
      hashMapEntry1.val[column.op],
      hashMapEntry2.val[column.op]
    ])
    orders.push(order.op)
  }

  let compareFunc = symbol.getSymbol("compare_func")
  emitCompareFunc(prolog0, compareFunc, vals, orders)

  c.declareIntPtr(buf)(sym, c.cast("int *", c.malloc("int", `${sym}_key_count`)))
  c.stmt(buf)(`for (int i = 0; i < ${sym}_key_count; i++) ${sym}[i] = i`)

  c.stmt(buf)(c.call("qsort", sym, `${sym}_key_count`, "sizeof(int)", c.cast("__compar_fn_t", compareFunc)))

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
      c.stmt(buf)(c.assign(lhs.val.dataCount, "0"))
    }
  } else {
    throw new Error("stateful op not supported: " + pretty(q))
  }
}

let emitStatefulUpdate1 = (buf, q, lhs, rhs) => {
  if (q.op == "sum") {
    if (rhs.tag == TAG.JSON) {
      rhs.val = c.call("yyjson_get_num", rhs.val)
    }
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
      emitHashBucketInsert(buf, lhs, rhs)
    } else {
      // lhs passed will be the array object
      emitArrayInsert(buf, lhs, rhs)
    }

  } else if (q.op == "print") {
    if (typing.isString(q.arg[0].schema.type)) {
      let { str, len } = rhs.val
      c.stmt(buf)(c.call("printf", `"%.*s\\n"`, len, str))
    } else {
      c.stmt(buf)(c.call("printf", `"%${getFormatSpecifier(q.arg[0].schema.type)}\\n"`, rhs.val))
    }
  } else {
    throw new Error("stateful op not supported: " + pretty(q))
  }
}

let emitStatefulUpdate = (buf, q, lhs) => {
  let e = q.arg[0]
  let rhs = emitPath(buf, e)
  console.log(rhs)
  if (rhs.cond) {
    console.log("here")
    c.if(buf)(c.not(rhs.cond), buf1 => {
      emitStatefulUpdate1(buf1, q, lhs, rhs)
    })
  } else {
    emitStatefulUpdate1(buf, q, lhs, rhs)
  }
}

// Extract the top-level condition for stateful operations
let emitStatefulUpdateOptCond = (buf, q, update) => {
  let e = q.arg[0]
  if (e.key == "pure" && e.op == "and") {
    let cond = emitPath(buf, e.arg[0])
    if (cond.cond) cond.val = c.and(c.not(cond.cond), cond.val)

    c.if(buf)(cond.val, update)
  } else {
    update(buf)
  }
}

let emitStatefulInPath = (i) => {
  let q = assignments[i]
  let sym = tmpSym(i)

  if (q.fre.length > 0) throw new Error("unexpected number of free variables for stateful op in path: " + pretty(v))

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
      c.if(buf)(filenameVal.cond, buf1 => {
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

// Generate code for paths
// returns the value of the path
let emitPath = (buf, q, scope) => {
  if (q.key == "loadInput") {
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
        let jsonVal = emitLoadJSON(buf1, filenameStr)
        inputFiles[q.op][filename] = jsonVal
      } else {
        let { mappedFile, size } = csv.emitLoadCSV(buf1, filenameStr, q.op)
        inputFiles[q.op][filename] = { mappedFile, size, format: q.op }
      }
    }

    let tag = q.op == "json" ? TAG.JSON : TAG.CSV_FILE
    return value.primitive(q.schema.type, inputFiles[q.op][filename], tag)
  } else if (q.key == "const") {
    if (typeof q.op == "number") {
      return value.primitive(q.schema.type, String(q.op))
    } else if (typeof q.op == "string") {
      // const string is represented as a const char pointer
      if (constStrs[q.op]) {
        return value.string(q.schema.type, constStrs[q.op], q.op.length)
      }
      let name = symbol.getSymbol("tmp_str")
      c.declareConstCharPtr(prolog1)(name, '"' + q.op + '"')
      constStrs[q.op] = name
      return value.string(q.schema.type, name, q.op.length)
    } else {
      throw new Error("Constant not supported: " + pretty(q))
    }
  } else if (q.key == "var") {
    // TODO: Usually a number or a string.
    // but need to know whether it is a yyjson val
    return vars[q.op].val
  } else if (q.key == "ref") {
    let q1 = assignments[q.op]
    let tmpVar = tmpVars[q.op]

    if (q1.fre.length > 0) {
      // We can directly use the pos and keyPos
      // without doing a hash lookup
      let value = hashmap.getHashMapValueEntry(tmpVar, currentGroupKey.pos, currentGroupKey.keyPos)
      console.log(value)
      return value
    } else {
      // If no free vars, we need to emit the code
      return tmpVar
    }
  } else if (q.key == "get") {
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
        if (Object.keys(loopInfo[e2.op]).length == 1) {
          // Only one possible lhs of this generator, use the iterator
          return { schema: q.schema.type, val: c.call("yyjson_obj_iter_get_val", quoteVar(e2.op)), tag: TAG.JSON }
        } else {
          // Slow path, use yyjson_obj_getn
          return { schema: q.schema.type, val: c.call("yyjson_obj_getn", g1.val, c.call("yyjson_get_str", quoteVar(e2.op)), c.call("yyjson_get_len", quoteVar(e2.op))), tag: TAG.JSON }
        }
      } else if (g1.tag == TAG.ARRAY) {
        // If we are iterating over a hashMap,
        // get the entry directly using the var
        return getArrayValueEntry(g1, quoteVar(e2.op))
      } else if (g1.tag == TAG.HASHMAP) {
        // If we are iterating over a hashMap,
        // get the entry directly using the var
        return getHashMapValueEntry(g1.val.sym, undefined, quoteVar(e2.op))
      } else if (g1.tag == TAG.HASHMAP_BUCKET) {
        // If we are iterating over a hashMap bucket,
        // get the stored loop info
        // We don't need to check existance of the bucket here
        // since it is checked before the loop executes
        bucket = g1
        let dataPos = `${bucket.val.buckets}[${c.add(c.mul(bucket.keyPos, BUCKET_SIZE), quoteVar(e2.op))}]`

        if (typing.isObject(bucket.schema.objValue)) {
          let schema = convertToArrayOfSchema(bucket.schema.objValue)
          let res = { schema: q.schema.type, val: {}, tag: TAG.OBJECT }
          for (let i in schema) {
            let { name: name1, schema: schema1 } = schema[i]
            if (typing.isObject(schema1)) {
              throw new Error("Not supported")
            } else if (typing.isString(schema1)) {
              res.val[name1] = { schema: schema1, val: { str: `${bucket.val.valArray[name1].str}[${dataPos}]`, len: `${bucket.val.valArray[name1].len}[${dataPos}]` } }
            } else {
              res.val[name1] = { schema: schema1, val: `${bucket.val.valArray[name1]}[${dataPos}]` }
            }
          }
          return res
        } else if (typing.isString(bucket.schema.objValue)) {
          return { schema: bucket.schema.objValue, val: { str: `${bucket.val.valArray.str}[${dataPos}]`, len: `${bucket.val.valArray.len}[${dataPos}]` } }
        } else {
          return { schema: bucket.schema.objValue, val: `${bucket.val.valArray}[${dataPos}]` }
        }
      } else {
        throw new Error("Cannot get var from non-iterable object")
      }
    }

    // If we are not getting a var, get the lhs first
    let v1 = emitPath(buf, e1, scope)

    if (v1.tag == TAG.JSON) {
      let key = emitPath(buf, e2, scope)
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
      let sym = tmpSym(e1.op)
      let key = emitPath(buf, e2, scope)
      let [pos, keyPos] = emitHashLookUp(buf, sym, [key])
      let { keySchema, valSchema } = hashMapEnv[sym]
      if (keySchema.length > 1) {
        throw new Error("not supported for now")
      }
      // The value is undefined if keyPos == -1
      // emitPath will not handle undefined values
      // It is up to the top-level caller of emitPath how undefined is handled
      let value = getHashMapValueEntry(sym, pos, keyPos)
      value.cond = c.eq(keyPos, "-1")
      return value
    }

    if (v1.tag == TAG.ARRAY) {
      // Array element access
      let idx = emitPath(buf, e2, scope)
      let res = getArrayValueEntry(v1, idx.val)
      res.cond = c.ge(idx.val, v1.val.dataCount)
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

    return { ...v1.val[e2.op], cond: v1.cond }
  } else if (q.key == "pure") {
    if (q.op == "sort") {
      let e = emitPath(buf, q.arg[0])
      if (e.tag == TAG.HASHMAP) {
        emitHashMapSorting(buf, q, e)
        return e
      } else
        throw new Error("Sorting is not supported on this object: " + e)
    }

    if (q.op == "mkTuple") {
      let schema = convertToArrayOfSchema(q.schema.type)
      let res = { schema: q.schema.type, val: {}, tag: TAG.OBJECT }
      for (let i = 0; i < q.arg.length; i += 2) {
        let k = q.arg[i]
        let v = q.arg[i + 1]
        let { name } = schema[i / 2]
        res.val[name] = emitPath(buf, v, scope)
      }
      return res
    }

    let e1 = emitPath(buf, q.arg[0], scope)
    let op = utils.binaryOperators[q.op]
    let res
    if (op) {
      // binary op
      let e2 = emitPath(buf, q.arg[1], scope)
      if (q.op == "equal" || q.op == "notEqual" || q.op == "lessThan" || q.op == "greaterThan" || q.op == "lessThanOrEqual" || q.op == "greaterThanOrEqual") {
        if (typing.isString(q.arg[0].schema.type) && typing.isString(q.arg[1].schema.type)) {
          let { str: str1, len: len1 } = e1.val
          let { str: str2, len: len2 } = e2.val

          let name = symbol.getSymbol("tmp_cmpstr")
          // let curr = symbol.getSymbol("tmp_cursor")
          // let minLen = symbol.getSymbol("min_len")

          c.declareInt(buf)(name, c.call("strncmp", str1, str2, c.ternary(c.lt(len1, len2), len1, len2)))
          c.stmt(buf)(c.assign(name, c.ternary(c.eq(name, "0"), c.sub(len1, len2), name)))

          res = { schema: q.schema.type, val: c.binary(name, "0", op) }
        } else {
          res = { schema: q.schema.type, val: c.binary(e1.val, e2.val, op) }
        }
      } else if (q.op == "fdiv") {
        res = { schema: q.schema.type, val: c.binary(c.cast("double", e1.val), c.cast("double", e2.val), op) }
      } else {
        res = { schema: q.schema.type, val: c.binary(e1.val, e2.val, op) }
      }
      if (e1.cond && e2.cond) {
        res.cond = c.and(e1.cond, e2.cond)
      } else if (e1.cond) {
        res.cond = e1.cond
      } else {
        res.cond = e2.cond
      }
      return res
    } else if (q.op == "and") {
      let [cond, res] = q.arg.map(e => emitPath(buf, e))
      res.cond = c.not(cond.val)
      return res
    } else if (q.op.startsWith("convert_")) {
      return { schema: q.schema.type, val: c.cast(utils.cTypes[q.op.substring("convert_".length)], e1.val), cond: e1.cond }
    } else if (q.op == "year") {
      return { schema: q.schema.type, val: c.div(e1.val, "10000"), cond: e1.cond }
    } else if (q.op == "substr") {
      console.assert(typing.isString(e1.schema))
      let e2 = emitPath(buf, q.arg[1], scope)
      let e3 = emitPath(buf, q.arg[2], scope)
      let str = c.add(e1.val.str, e2.val)
      let len = c.sub(e3.val, e2.val)
      return { schema: types.string, val: { str, len }, cond: e1.cond }
    } else if (q.op == "like") {
      console.assert(typing.isString(e1.schema))
      if (q.arg[1].key != "const" || typeof q.arg[1].key != "string") {
        throw new Error("Only support constant string regex")
      }

      let name = symbol.getSymbol("tmp_like")
      emitWildcardMatch(buf, e1, q.arg[1].op, name)

      return { schema: q.schema.type, val: name, cond: e1.cond }
    } else if (q.op == "isUndef") {
      if (e1.cond) {
        return { schema: q.schema.type, val: e1.cond }
      } else {
        // Cannot be undefined, return the value
        return e1
      }
    } else {
      throw new Error("Pure operation not supported: " + pretty(q))
    }
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
    q1 = assignments[q.op]
    if (q1.key == "update") {
      return
    }
    if (q1.key == "stateful" && q1.fre.length != 0) {
      if (!same(q1.fre, currentGroupPath.path)) {
        throw new Error("Stateful op expected to have the same set of free variables as the current group path but got: " + q1.fre + " and " + currentGroupPath.path)
      }

      assignmentToSym[q.op] = currentGroupPath.sym
      updateOpsExtra[currentGroupPath.sym].push(q.op)

      let dummy = { schema: { objValue: q1.schema.type }, val: { sym: tmpSym(q.op) } }
      hashmap.emitHashMapValueInit(prolog1, dummy, `_DEFAULT_`, q1.schema.type)
      tmpVars[q.op] = dummy
    }
  }

  if (q.arg) {
    q.arg.map(x => collectRelevantStatefulInPath(x, currentGroupPath))
  }
}

let addHashMapValue = (map, q, name, currentGroupPath) => {
  if (q.key == "pure" && q.op.startsWith("convert_")) {
    q = q.arg[0]
  }
  if (q.key != "ref") {
    throw new Error("stateful op expected but got " + pretty(q))
  }
  let q1 = assignments[q.op]
  if (q1.key == "update") return

  if (!same(q1.fre, currentGroupPath.path)) {
    throw new Error("Stateful op expected to have the same set of free variables as the current group path but got: " + q1.fre + " and " + currentGroupPath.path)
  }

  assignmentToSym[q.op] = currentGroupPath.sym
  updateOps[currentGroupPath.sym].push(q.op)

  if (name != "_DEFAULT_") q1.extraGroupPath = name

  let sym = tmpSym(currentGroupPath.sym)
  if (q1.op == "array") {
    hashmap.emitHashMapBucketsInit(prolog1, map, name, q.schema.type)
  } else {
    hashmap.emitHashMapValueInit(prolog1, map, name, q.schema.type, sortedCols?.[sym][name], prolog0)
  }
  collectRelevantStatefulInPath(q1.arg[0], currentGroupPath)
}

// Collect hashmaps required for the query
let collectHashMaps = () => {
  // Iterate through all update ops to group stateful ops together
  for (let i in assignments) {
    let q = assignments[i]
    let sym = tmpSym(i)

    if (q.key != "update") continue

    let [e0, e1, e2, e3] = q.arg

    if (e1.vars.length > 1) {
      throw new Error("Not supported for now")
    }

    let keySchema = [types.u32]

    // If there is a mkset
    if (e3) {
      // Check if the key is a set of keys
      let mksetVal = e3.arg[0].arg[0]
      if (mksetVal.key == "pure" && mksetVal.op == "combine") {
        keySchema = mksetVal.arg.map(e => e.schema.type)
      } else {
        keySchema = [mksetVal.schema.type]
      }
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
}

// Process the filters and create generator statements
let processFilters = () => {
  for (let i in filters) {
    let f = filters[i]
    let v1 = f.arg[1].op
    let g1 = f.arg[0]

    if (g1.key == "mkset") {
      let data = []
      if (g1.arg[0].key == "pure" && g1.arg[0].op == "combine") {
        let vals = g1.arg[0].arg.map(e => emitPath(data, e))
        vars[v1] = { val: vals }
      } else {
        let val = emitPath(data, g1.arg[0])
        vars[v1] = { val: [val] }
      }
      addMkset(f.arg[0], f.arg[1], data)
    } else {
      let data = []
      let lhs = emitPath(data, g1)
      let firstSeen = !vars[v1]
      vars[v1] ??= {}
      vars[v1].lhs ??= {}
      vars[v1].lhs[pretty(g1)] = lhs
      // Generate loops based on different types of left hand side values
      if (lhs.tag == TAG.CSV_FILE) {
        let getLoopTxtFunc = csv.getCSVLoopTxt(f, lhs, data, usedCols)
        vars[v1].val = value.primitive(lhs.schema.objKey, v1)
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
      } else if (lhs.tag == TAG.JSON) {
        let getLoopTxtFunc = getJSONLoopTxt(f, lhs, data)
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
      } else if (lhs.tag == TAG.ARRAY) {
        let getLoopTxtFunc = getArrayLoopTxt(f, lhs.val.sym)
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
      } else if (lhs.tag == TAG.HASHMAP) {
        let getLoopTxtFunc = getHashMapLoopTxt(f, lhs.val.sym)
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
        // throw new Error("Generator from hashmap not implemented yet")
      } else if (lhs.tag == TAG.HASHMAP_BUCKET) {
        let getLoopTxtFunc = getHashBucketLoopTxt(f, lhs, data)
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
      } else {
        throw new Error("Cannot have generator on non-iterable objects: " + lhs.tag)
      }

    }
  }
}

let emitCode = (q, ir, settings) => {
  reset()

  filters = ir.filters
  assignments = ir.assignments
  irVars = ir.vars

  // Fill with default prolog
  initializeProlog()

  // Get the used filters to optimize CSV reading
  collectUsedAndSortedCols(q)

  // Collect hashmaps needed for the query and relevant stateful ops
  collectHashMaps()

  // // Collect arrays
  // for (let i in assignments) {
  //   let q = assignments[i]
  //   if (q.key == "update" || assignmentToSym[i]) continue
  //   if (q.op == "print") continue
  //   let sym = tmpSym(i)
  //   if (q.op == "array") {
  //     emitArrayInit(prolog1, sym, q.schema.type.objValue)
  //     arrayEnv[sym] = { valSchema: q.schema.type.objValue }
  //   } else {
  //     cgen.declareVar(prolog1)(convertToCType(q.schema.type), sym)
  //   }
  // }

  // Before we process the filters, we need to collect the arrays
  // We can also collect other stateful ops here
  for (let i in assignments) {
    let q = assignments[i]
    if (q.key == "update" || assignmentToSym[i]) continue
    if (q.op == "print") continue
    let sym = tmpSym(i)
    if (q.op == "array") {
      // emitArrayInit(prolog1, sym, q.schema.type.objValue)
      // arrayEnv[sym] = { valSchema: q.schema.type.objValue }
      throw new Error("Not implemented yet")
    } else if (typing.isString(q.schema.type)) {
      c.declarePtr(prolog1)("char", `${sym}_str`)
      c.declareInt(prolog1)(`${sym}_len`)
      tmpVars[i] = value.string(q.schema.type, `${sym}_str`, `${sym}_len`)
    } else {
      c.declareVar(prolog1)(utils.convertToCType(q.schema.type), sym)
      tmpVars[i] = value.primitive(q.schema.type, sym)
    }
  }

  // Process filters
  processFilters()

  for (let i in assignments) {
    let q = assignments[i]
    let sym = tmpSym(i)

    if (q.key == "update" || assignmentToSym[i]) continue

    emitStatefulInPath(i)
  }

  console.log(assignmentStms)

  for (let i in updateOps) {
    let q = assignments[i]
    let sym = tmpSym(i)

    let k = assignments[i].arg[1].op

    let shouldInit = updateOps[i].some(j => initRequired(assignments[j])) || updateOpsExtra[i].some(j => initRequired(assignments[j]))

    let [e0, e1, e2, e3] = q.arg

    let fv = [...q.fre, e1.op]

    let keys = Array.isArray(vars[e1.op].val) ? vars[e1.op].val : [vars[e1.op].val]

    let init = []
    let map = tmpVars[i]
    //   c.comment(init)("init and update " + sym + " = " + pretty(assignments[i]))
    let [pos, keyPos] = hashmap.emitHashLookUpOrUpdate(init, map, keys, (buf1, lhs, pos, keyPos) => {
      console.log(buf1, lhs, pos, keyPos)
      for (let j of updateOps[i]) {
        let q = assignments[j]
        if (!initRequired(q)) continue
        c.comment(buf1)("init " + sym + "[" + q.fre[0] + "]" + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))
        let lhs1 = lhs
        if (q.extraGroupPath) {
          console.assert(lhs.tag == TAG.OBJECT)
          lhs1 = lhs.val[q.extraGroupPath]
        }
        console.log(q, lhs1)
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

      hashmap.emitHashMapUpdate(update, map, keys, pos, keyPos, () => { }, (buf, lhs) => {
        let lhs1 = hashmap.getHashMapValueEntry(tmpVars[j], pos, keyPos)
        emitStatefulUpdate(buf, q, lhs1)
      }, false)
      assign(update, sym, fv, deps)
    }
    for (let j of updateOps[i]) {
      let update = []
      let q = assignments[j]
      c.comment(update)("update " + sym + "[" + q.fre[0] + "]" + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))
      let deps = [...union(fv, q.bnd), ...q.tmps.map(tmp => assignmentToSym[tmp] ? tmpSym(assignmentToSym[tmp]) : tmpSym(tmp))]

      hashmap.emitHashMapUpdate(update, map, keys, pos, keyPos, () => { }, (buf, lhs) => {
        if (q.extraGroupPath) {
          console.assert(lhs.tag == TAG.OBJECT)
          lhs = lhs.val[q.extraGroupPath]
        }
        emitStatefulUpdate(buf, q, lhs)
      }, false)
      assign(update, sym, fv, deps)
    }
  }

  // // Iterate and emit stateful ops
  // for (let i in updateOps) {
  //   let k = assignments[i].arg[1].op

  //   // TODO: should add if check to see if the keys are undefined
  //   let keys = k.startsWith("K") ? vars[k].val : [vars[k].val]

  //   let sym = tmpSym(i)

  //   let fv = [k]

  //   let init = []

  //   c.comment(init)("init and update " + sym + " = " + pretty(assignments[i]))
  //   let shouldInit = updateOps[i].some(j => initRequired(assignments[j])) ||
  //     updateOpsExtra[i].some(j => initRequired(assignments[j]))

  //   if (!shouldInit) {
  //     let lookup = []
  //     let [pos, keyPos] = hashmap.emitHashLookUp(lookup, sym, keys)
  //     assign(lookup, sym, fv, [])
  //     for (let j of updateOps[i]) {
  //       let q = assignments[j]
  //       let buf = []
  //       let deps = [...union(fv, q.bnd), ...q.tmps.map(tmp => assignmentToSym[tmp] ? tmpSym(assignmentToSym[tmp]) : tmpSym(tmp))]

  //       let update1 = () => { }
  //       if (q.mode === "maybe") {
  //         // We still need to initialize it to some value if it is in maybe mode
  //         update1 = (buf2, lhs) => {
  //           c.comment(buf2)("init " + sym + "[" + q.fre[0] + "]" + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))
  //           if (q.extraGroupPath) {
  //             console.assert(lhs.tag == TAG.OBJECT)
  //             lhs = lhs.val[q.extraGroupPath[0]]
  //           } else {
  //             console.assert(lhs.tag == TAG.HASHMAP_VALUE || lhs.tag == TAG.HASHMAP_BUCKET)
  //           }
  //           emitStatefulInit(buf2, q, lhs)
  //         }
  //       }
  //       c.comment(buf)("update " + sym + "[" + q.fre[0] + "]" + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))
  //       emitStatefulUpdateOptCond(buf, q, buf1 => {
  //         hashmap.emitHashMapUpdate(buf1, sym, keys, pos, keyPos, update1, (buf2, lhs) => {
  //           currentGroupKey = { key: k, pos, keyPos }

  //           if (q.extraGroupPath) {
  //             console.assert(lhs.tag == TAG.OBJECT)
  //             lhs = lhs.val[q.extraGroupPath[0]]
  //           } else {
  //             console.assert(lhs.tag == TAG.HASHMAP_VALUE || lhs.tag == TAG.HASHMAP_BUCKET)
  //           }

  //           emitStatefulUpdate(buf2, q, lhs, sym)
  //         }, true)
  //       })
  //       assign(buf, sym, fv, deps)
  //     }
  //     // extra not supported yet
  //     continue
  //   }

  //   let [pos, keyPos] = hashmap.emitHashLookUpOrUpdate(init, sym, keys, (buf1, lhs, pos, keyPos) => {
  //     for (let j of updateOps[i]) {
  //       let q = assignments[j]
  //       if (!initRequired(q)) continue
  //       c.comment(buf1)("init " + sym + "[" + q.fre[0] + "]" + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))
  //       let lhs1 = lhs
  //       if (q.extraGroupPath) {
  //         console.assert(lhs.tag == TAG.OBJECT)
  //         lhs1 = lhs.val[q.extraGroupPath[0]]
  //       } else {
  //         console.assert(lhs.tag == TAG.HASHMAP_VALUE || lhs.tag == TAG.HASHMAP_BUCKET)
  //       }
  //       emitStatefulInit(buf1, q, lhs1)
  //     }
  //     for (let j of updateOpsExtra[i]) {
  //       let q = assignments[j]
  //       if (!initRequired(q)) continue
  //       c.comment(buf1)("init " + tmpSym(j) + "[" + q.fre[0] + "]" + " = " + pretty(q))
  //       let lhs1 = hashmap.getHashMapValueEntry(tmpSym(j), pos, keyPos)
  //       console.assert(lhs1.tag == TAG.HASHMAP_VALUE || lhs1.tag == TAG.HASHMAP_BUCKET)
  //       emitStatefulInit(buf1, q, lhs1)
  //     }
  //   })
  //   assign(init, sym, fv, [])

  //   currentGroupKey = { key: k, pos, keyPos }
  //   for (let j of updateOpsExtra[i]) {
  //     let update = []
  //     let q = assignments[j]
  //     c.comment(update)("update " + tmpSym(j) + "[" + q.fre[0] + "]" + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))
  //     let deps = [...union(fv, q.bnd), ...q.tmps.map(tmp => assignmentToSym[tmp] ? tmpSym(assignmentToSym[tmp]) : tmpSym(tmp))]

  //     emitStatefulUpdateOptCond(update, q, buf1 => {
  //       hashmap.emitHashMapUpdate(buf1, sym, keys, pos, keyPos, () => { }, (buf2, lhs) => {
  //         let lhs1 = hashmap.getHashMapValueEntry(tmpSym(j), pos, keyPos)
  //         console.assert(lhs1.tag == TAG.HASHMAP_VALUE || lhs1.tag == TAG.HASHMAP_BUCKET)
  //         emitStatefulUpdate(buf2, q, lhs1)
  //       }, false)
  //     })

  //     assign(update, sym, fv, deps)
  //   }
  //   for (let j of updateOps[i]) {
  //     let update = []
  //     let q = assignments[j]
  //     c.comment(update)("update " + sym + "[" + q.fre[0] + "]" + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))
  //     let deps = [...union(fv, q.bnd), ...q.tmps.map(tmp => assignmentToSym[tmp] ? tmpSym(assignmentToSym[tmp]) : tmpSym(tmp))]

  //     emitStatefulUpdateOptCond(update, q, buf1 => {
  //       hashmap.emitHashMapUpdate(buf1, sym, keys, pos, keyPos, () => { }, (buf2, lhs) => {
  //         if (q.extraGroupPath) {
  //           console.assert(lhs.tag == TAG.OBJECT)
  //           lhs = lhs.val[q.extraGroupPath[0]]
  //         } else {
  //           console.assert(lhs.tag == TAG.HASHMAP_VALUE || lhs.tag == TAG.HASHMAP_BUCKET)
  //         }
  //         emitStatefulUpdate(buf2, q, lhs)
  //       }, false)
  //     })

  //     assign(update, sym, fv, deps)
  //   }
  // }

  let epilog = []

  res = emitPath(epilog, q)
  if (res.cond) {
    cgen.if(epilog)(res.cond, buf1 => {
      cgen.stmt(buf1)(cgen.call("printf", `"undefined"`))
      cgen.return(epilog)("0")
    })
  }

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
    if (inputFiles["json"]) cFile += " ./cgen-sql/yyjson.c"
    console.log("Executing:", `gcc ${cFlags} ${cFile} -o ${out} -Icgen-sql`)
    await sh(`gcc ${cFlags} ${cFile} -o ${out} -Icgen-sql`)
    return func
  }

  return writeAndCompile()
}

exports.generateC = generateC
