const { c, utils } = require("./utils")
const { hashmap, array } = require("./collections")
const { TAG, value } = require("./value")
const val = require("./value/value")
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

const { getSettings, resetSettings } = require("./settings")

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

// Stores mapping from vars to their binded values
let vars

// Stores tmp vars
let tmpVars

let visitedAssignments

let currentGroupPath

let preload
let linkedBuckets
let nestedArrays
let usesYYJSON // set when a dynamic (yyjson_val) value is emitted, even without JSON input

// Collection size config
let hashSize
let nestedHashSize
let bucketSize
let arraySize

let backend

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

let addMkset = (e1, e2, val, data) => {
  let a = getDeps(e1)
  let b = getDeps(e2)
  let e = expr("MKSET", ...a)
  e.sym = b[0]
  let info = [`// generator: ${e2.op} <- ${pretty(e1)}`]
  let cond = val.cond ? c.not(val.cond) : "1"
  e.getLoopTxt = () => ({
    info, data, initCursor: [], loopHeader: [`if (${cond}) {`, "// singleton value here"], boundsChecking: [], rowScanning: []
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

  vars = {}

  tmpVars = {}

  visitedAssignments = {}

  backend = settings.backend

  hashSize = settings.hashSize || 256
  nestedHashSize = settings.nestedHashSize || 256
  bucketSize = settings.bucketSize || 64
  arraySize = settings.arraySize || 2048

  preload = settings.preload || false
  linkedBuckets = settings.linkedBuckets || false
  nestedArrays = settings.nestedArrays || false
  usesYYJSON = false
}

let stripConverts = q => {
  while (q.key == "pure" && q.op.startsWith("convert_")) {
    q = q.arg[0]
  }
  return q
}

let initializeProlog = () => {
  if (backend == "cuda") {
    prolog0.push("#include <cuda_runtime.h>")
    prolog0.push("#include <cublas_v2.h>")
    prolog0.push("#include <cusparse_v2.h>")
  }

  prolog0.push(`#include "rhyme-c.h"`)

  prolog0.push(`typedef int (*__compar_fn_t)(const void *, const void *);`)
  prolog1.push("int main() {")

  if (backend == "cuda") {
    c.declareVar(prolog1)("cublasHandle_t", "handle")
    c.stmt(prolog1)(c.call("cublasCreate", "&handle"))
    c.declareVar(prolog1)("cusparseHandle_t", "sparseHandle")
    c.stmt(prolog1)(c.call("cusparseCreate", "&sparseHandle"))
  }
}

// construct the prolog with prolog0 and prolog1
let finalizeProlog = () => {
  let prolog = [...prolog0, ...prolog1]
  if (inputFiles["json"] || inputFiles["ndjson"] || usesYYJSON) {
    // include necessary header if we loaded any JSON file or use dynamic yyjson_val values
    prolog = ["#include \"yyjson.h\"", ...prolog]
  }
  return prolog
}

// Emit the comapre function for qsort
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
  let sym = tmpSym(map.val.sym)
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
  c.stmt(buf)(`for (int i = 0; i < ${count}; i++) ${sym}[i] = i + 1`)

  c.stmt(buf)(c.call("qsort", sym, count, "sizeof(int)", c.cast("__compar_fn_t", compareFunc)))

  map.val.sorted = true
}

let emitStatefulInit = (buf, q, lhs) => {
  if (lhs.dynamic) {
    // dynamic (self-managed yyjson_val) slot: wrap the initial scalar
    let schema = q.schema.type
    if (q.op == "sum" || q.op == "count") {
      json.wrapJSON(buf, lhs.val, value.primitive(schema, "0"))
    } else if (q.op == "product") {
      json.wrapJSON(buf, lhs.val, value.primitive(schema, "1"))
    } else if (q.op == "min") {
      json.wrapJSON(buf, lhs.val, value.primitive(schema, utils.getDataTypeLimits(schema).max))
    } else if (q.op == "max") {
      json.wrapJSON(buf, lhs.val, value.primitive(schema, utils.getDataTypeLimits(schema).min))
    } else if (q.op == "single" || q.op == "first") {
      // value is written on update; nothing to initialize
    } else {
      throw new Error("dynamic stateful init not supported: " + pretty(q))
    }
    return
  }
  if (q.op == "sum" || q.op == "count") {
    c.stmt(buf)(c.assign(lhs.val, "0"))
  } else if (q.op == "product") {
    c.stmt(buf)(c.assign(lhs.val, "1"))
  } else if (q.op == "min") {
    c.stmt(buf)(c.assign(lhs.val, utils.getDataTypeLimits(lhs.schema).max))
  } else if (q.op == "max") {
    c.stmt(buf)(c.assign(lhs.val, utils.getDataTypeLimits(lhs.schema).min))
  } else if (q.op == "array") {
    // lhs passed will be the array object
    if (lhs.tag == TAG.HASHMAP_LINKED_BUCKET) {
      c.stmt(buf)(c.assign(lhs.val.head, "0"))
    } else {
      // nested-array representation: allocate this key's array struct first
      if (lhs.val.nestedAlloc) hashmap.emitNestedArrayAllocation(buf, lhs.val.nestedAlloc)
      c.stmt(buf)(c.assign(lhs.val.count, "0"))
    }
  } else if (q.key == "update") {
    hashmap.emitNestedHashMapAllocation(buf, lhs)
  } else {
    throw new Error("stateful op not supported: " + pretty(q))
  }
}

let emitStatefulUpdate1 = (buf, q, lhs, rhs) => {
  if (rhs.tag == TAG.JSON && !lhs.dynamic) {
    let schema = q.op == "array" ? q.schema.type.objValue : q.schema.type
    rhs = json.convertJSONTo(rhs, schema)
  }
  if (q.mode == "maybe") {
    c.if(buf)(c.not(lhs.defined), (buf1) => {
      c.stmt(buf)(c.assign(lhs.defined, "1"))
      emitStatefulInit(buf1, q, lhs)
    })
  }
  if (lhs.dynamic) {
    // self-managed yyjson_val slot (lhs.val == &arr[keyPos]): read/compute/write
    let schema = q.schema.type
    let slot = value.json(schema, lhs.val)
    if (q.op == "single" || q.op == "first") {
      // rhs may be json-sourced (struct copy) or a concrete scalar
      json.wrapJSON(buf, lhs.val, rhs)
    } else if (q.op == "count") {
      let cur = json.convertJSONTo(slot, schema)
      json.wrapJSON(buf, lhs.val, value.primitive(schema, c.binary(cur.val, "1", "+")))
    } else if (q.op == "sum") {
      let r = rhs.tag == TAG.JSON ? json.convertJSONTo(rhs, schema) : rhs
      let cur = json.convertJSONTo(slot, schema)
      json.wrapJSON(buf, lhs.val, value.primitive(schema, c.binary(cur.val, r.val, "+")))
    } else if (q.op == "min" || q.op == "max") {
      let r = rhs.tag == TAG.JSON ? json.convertJSONTo(rhs, schema) : rhs
      let cur = json.convertJSONTo(slot, schema)
      let op = q.op == "min" ? "<" : ">"
      json.wrapJSON(buf, lhs.val, value.primitive(schema, c.ternary(c.binary(r.val, cur.val, op), r.val, cur.val)))
    } else {
      throw new Error("dynamic stateful update not supported: " + pretty(q))
    }
    return
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
  } else if (q.op == "first") {
    c.if(buf)(c.not(lhs.defined), (buf1) => {
      c.stmt(buf1)(c.assign(lhs.defined, "1"))
      if (typing.isString(q.arg[0].schema.type)) {
        let { str: lhsStr, len: lhsLen } = lhs.val
        let { str: rhsStr, len: rhsLen } = rhs.val
        c.stmt(buf1)(c.assign(lhsStr, rhsStr))
        c.stmt(buf1)(c.assign(lhsLen, rhsLen))
      } else {
        c.stmt(buf1)(c.assign(lhs.val, rhs.val))
      }
    })
  } else if (q.op == "single") {
    c.if(buf)(c.not(lhs.defined), (buf1) => {
      c.stmt(buf1)(c.assign(lhs.defined, "1"))
    })
    if (typing.isString(q.arg[0].schema.type)) {
      let { str: lhsStr, len: lhsLen } = lhs.val
      let { str: rhsStr, len: rhsLen } = rhs.val
      c.stmt(buf)(c.assign(lhsStr, rhsStr))
      c.stmt(buf)(c.assign(lhsLen, rhsLen))
    } else {
      c.stmt(buf)(c.assign(lhs.val, rhs.val))
    }
  } else if (q.op == "array") {
    // lhs passed will be the array object
    array.emitArrayInsert(buf, lhs, rhs)
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
  let e = q.arg[0]
  let rhs = emitPath(buf, e)
  if (rhs.cond) {
    let cond = rhs.cond
    c.if(buf)(c.not(cond), buf1 => {
      emitStatefulUpdate1(buf1, q, lhs, rhs)
    })
  } else {
    emitStatefulUpdate1(buf, q, lhs, rhs)
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

let emitStateful1 = (q, map, insertKeyBuf) => {
  let i = q.op
  q = assignments[q.op]

  if (q.key == "update" && visitedAssignments[i]) return
  visitedAssignments[i] = true

  let sym = tmpSym(i)

  if (q.key == "update") {
    let [e0, e1, e2, e3] = q.arg
    if (e0.key != "const") {
      emitStateful1(e0, map)
    }
    if (q.fre.length == 0) {
      // Top level
      let map = tmpVars[i]
      let save = currentGroupPath
      currentGroupPath = { root: i, path: [e1] }

      if (e2.key == "pure" && e2.op == "mkTuple") {
        let buf = []

        assign(buf, sym, [e1.op], [])
        hashmap.emitHashLookUpOrUpdate(buf, map, vars[e1.op].val, (buf1) => {
          for (let i = 0; i < e2.arg.length; i += 2) {
            let key = e2.arg[i]
            let val = e2.arg[i + 1]

            currentGroupPath.path.push(key)
            val = stripConverts(val)
            emitStateful1(val, map, buf1)
            currentGroupPath.path.pop()
          }
        })

      } else {
        e2 = stripConverts(e2)
        emitStateful1(e2, map)
      }

      currentGroupPath = save
    } else {
      // nested hashmap
      if (currentGroupPath.path.every((e) => e.key == "const" || q.fre.indexOf(e.op) >= 0)) {
        // console.log("correlated")
      } else {
        // throw new Error("Not correlated")
      }
      let rootSym = tmpSym(currentGroupPath.root)
      if (!map) {console.log(pretty(q)); throw new Error("Something went wrong")}

      let getLhs = (buf, map) => {
        let curr = map
        let insertKey
        for (let k of currentGroupPath.path) {
          if (k.key == "const") {
            curr = curr.val[k.op]
            insertKey = undefined
          } else {
            let key = vars[k.op].val
            let [pos, keyPos] = hashmap.emitHashLookUp(buf, curr, key)
            insertKey = { key, map: curr, pos, keyPos }
            curr = hashmap.getHashMapValueEntry(curr, pos, keyPos)
          }
        }
        return { lhs: curr, insertKey }
      }

      let init = []
      let { lhs, insertKey } = getLhs(init, map)
      if (insertKey) {
        let { key, map: insertMap, pos, keyPos } = insertKey
        hashmap.emitHashMapUpdate(init, insertMap, key, pos, keyPos, (buf1) => {
          // c.stmt(buf1)(c.assign(lhs.defined, "1"))
          emitStatefulInit(buf1, q, lhs)
        }, () => { }, true)

        assign(init, rootSym, q.fre, [])
      } else {
        insertKeyBuf.push(...init)
        // c.stmt(insertKeyBuf)(c.assign(lhs.defined, "1"))
        emitStatefulInit(insertKeyBuf, q, lhs)
      }

      let [e0, e1, e2, e3] = q.arg
      currentGroupPath.path.push(e1)
      if (e2.key == "pure" && e2.op == "mkTuple") {
        let buf = []

        assign(buf, sym, [...q.fre, e1.op], [])
        hashmap.emitHashLookUpOrUpdate(buf, lhs, vars[e1.op].val, (buf1) => {
          for (let i = 0; i < e2.arg.length; i += 2) {
            let key = e2.arg[i]
            let val = e2.arg[i + 1]

            currentGroupPath.path.push(key)
            val = stripConverts(val)
            emitStateful1(val, map, buf1)
            currentGroupPath.path.pop()
          }
        })
        // throw new Error("Not supported yet")
      } else {
        e2 = stripConverts(e2)
        emitStateful1(e2, map)
      }
      currentGroupPath.path.pop()
    }
  } else {
    let getLhs = (buf, map, ignoreConsts) => {
      let curr = map
      let insertKey
      for (let k of currentGroupPath.path) {
        if (k.key == "const") {
          if (!ignoreConsts) curr = curr.val[k.op]
          insertKey = undefined
        } else {
          let key = vars[k.op].val
          let [pos, keyPos] = hashmap.emitHashLookUp(buf, curr, key)
          insertKey = { key, map: curr, pos, keyPos }
          curr = hashmap.getHashMapValueEntry(curr, pos, keyPos)
        }
      }
      return { lhs: curr, insertKey }
    }
    if (q.fre.length == 0) {
      emitStatefulInPath(i)
      if (map) {
        let buf = []
        let { lhs, insertKey } = getLhs(buf, map, false)
        if (insertKey) {
          let { key, map: insertMap, pos, keyPos } = insertKey
          hashmap.emitHashMapUpdate(buf, insertMap, key, pos, keyPos, () => { }, () => { }, true)
        }
        throw new Error("Need to assign, not fully implemented")
      }
    } else {
      if (currentGroupPath.path.every((e) => e.key == "const" || q.fre.indexOf(e.op) >= 0)) {
        // console.log("correlated")
      } else {
        // throw new Error("Not correlated")
      }
      let rootSym = tmpSym(currentGroupPath.root)

      let ignoreConsts = false
      if (!map) {
        map = tmpVars[i]
        ignoreConsts = true
      }
      if (!map) throw new Error("Something went wrong")

      if (initRequired(q)) {
        let init = []
        let { lhs, insertKey } = getLhs(init, map, ignoreConsts)
        if (insertKey) {
          let { key, map: insertMap, pos, keyPos } = insertKey
          hashmap.emitHashMapUpdate(init, insertMap, key, pos, keyPos, () => {
            // c.stmt(init)(c.assign(lhs.defined, "1"))
            emitStatefulInit(init, q, lhs)
          }, () => { }, true)

          assign(init, rootSym, q.fre, [])
        } else {
          if (ignoreConsts) {
            // insertKeyBuf.push(...init)
            c.if(init)(c.not(lhs.defined), (buf) => {
              c.stmt(init)(c.assign(lhs.defined, "1"))
              emitStatefulInit(init, q, lhs)
            })
            assign(init, rootSym, q.fre, [])
          } else {
            insertKeyBuf.push(...init)
            emitStatefulInit(insertKeyBuf, q, lhs)
          }
        }
      }

      let getRoot = tmp => assignmentToSym[tmp] ? getRoot(assignmentToSym[tmp]) : tmp
      let deps = [...union(q.fre, q.bnd), ...q.tmps.map(getRoot).map(tmpSym)]

      let update = []
      let { lhs, insertKey } = getLhs(update, map, ignoreConsts)
      if (!initRequired(q) && insertKey) {
        let { key, map: insertMap, pos, keyPos } = insertKey
        hashmap.emitHashMapUpdate(update, insertMap, key, pos, keyPos, () => { }, () => { }, true)
      }
      emitStatefulUpdate(update, q, lhs)
      assign(update, rootSym, q.fre, deps)
    }
  }
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
    inputFiles[q.op] ??= {}
    let filenameStr = emitFilenameStr(buf1, file)

    if (q.op == "json") {
      let jsonVal = json.emitLoadJSON(buf1, filenameStr)
      inputFiles[q.op][filename] = json.convertJSONTo(value.json(q.schema.type, jsonVal), q.schema.type)
    } else if (q.op == "ndjson") {
      let { mappedFile, size } = json.emitLoadNDJSON(buf1, filenameStr)

      if (preload) {
        if (!isConstStr) throw new Error("File preloading not supported on non-constant file names")
        let sym = symbol.getSymbol("preloaded")

        let cursor = symbol.getSymbol("i")
        c.declareSize(prolog1)(cursor, "0")
        let count = array.emitArrayInit(prolog1, sym)
        c.stmt(prolog1)(c.assign(count, "0"))
        let arr = value.array(q.schema.type, sym, count)
        let doc = symbol.getSymbol("tmp_doc")
        let name = "_DEFAULT_"
        arr.val.values ??= {}
        arr.val.values[name] = { val: `${sym}_${name}`, schema: q.schema.type.objValue, tag: TAG.JSON }

        array.allocateYYJSONBuffer(prolog1, `${sym}_${name}`)
        prolog1.push(`while (${cursor} < ${size}) {`)
        c.declarePtr(prolog1)("yyjson_doc", doc, c.call("yyjson_read_opts", c.add(mappedFile, cursor), c.sub(size, cursor), "YYJSON_READ_INSITU | YYJSON_READ_STOP_WHEN_DONE", "NULL", "NULL"))

        c.if(prolog1)(c.not(doc), buf2 => {
          c.break(buf2)()
        })

        c.stmt(prolog1)(c.assign(`${sym}_${name}[${count}]`, c.call("yyjson_doc_get_root", doc)))
        c.stmt(prolog1)(c.inc(count))

        c.stmt(prolog1)(c.assign(cursor, c.add(cursor, c.call("yyjson_doc_get_read_size", doc))))

        prolog1.push("}")
        inputFiles[q.op][filename] = arr
      } else {
        inputFiles[q.op][filename] = value.primitive(q.schema.type, { mappedFile, size }, TAG.NDJSON)
      }

    } else if (q.op == "csv" || q.op == "tbl") {
      let { mappedFile, size } = csv.emitLoadCSV(buf1, filenameStr, q.op)
      let fileValue = value.primitive(q.schema.type, { mappedFile, size, format: q.op }, TAG.CSV)
      if (preload) {
        // emit array
        if (!isConstStr) throw new Error("File preloading not supported on non-constant file names")
        let sym = symbol.getSymbol("preloaded")

        let filter = { key: "get", arg: [q, { key: "var", op: "preload_iter" }], schema: { type: q.schema.type.objValue } }
        let getLoopTxtFunc = csv.getCSVLoopTxt(filter, fileValue, [], usedCols)
        let loopTxt = getLoopTxtFunc()
        let count = array.emitArrayInit(prolog1, sym)
        c.stmt(prolog1)(c.assign(count, "0"))
        let arr = value.array(q.schema.type, sym, count)
        let prefix = pretty(q)
        let val = {}
        for (let field of utils.convertToArrayOfSchema(q.schema.type.objValue)) {
          let { name, schema } = field
          if (usedCols[prefix]["preload_iter"][name]) {
            array.emitArrayValueInit(prolog1, arr, name, schema)
            let valName = mappedFile + "_preload_iter_" + name
            if (typing.isString(schema)) {
              let start = valName + "_start"
              let end = valName + "_end"
              val[name] = { schema: schema, val: { str: c.add(mappedFile, start), len: c.sub(end, start) } }
            } else {
              val[name] = { schema: schema, val: valName }
            }
          }
        }
        prolog1.push(...loopTxt.info, ...loopTxt.initCursor, ...loopTxt.loopHeader, ...loopTxt.rowScanning)
        array.emitArrayInsert(prolog1, arr, { schema: q.schema.type.objValue, val, tag: TAG.OBJECT })
        prolog1.push("}")
        inputFiles[q.op][filename] = arr
      } else {
        inputFiles[q.op][filename] = fileValue
      }

    } else {
      throw new Error("Unknown file ext: " + q.op)
    }
  }

  return inputFiles[q.op][filename]
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

    if (g1.tag == TAG.CSV) {
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
    } else if (g1.tag == TAG.NDJSON) {
      return vars[e2.op].gen[pretty(e1)]
    } else if (g1.tag == TAG.JSON) {
      if (pretty(e1) == Object.keys(vars[e2.op].lhs)[0]) {
        // It's better if we do not perform generic get since we should have the iterator ready for the loop,
        // use yyjson_obj_iter_get_val
        // Only one possible lhs of this generator, use the iterator
        if (vars[e2.op].gen) {
          return JSON.parse(JSON.stringify(vars[e2.op].gen))
        }
        return { schema: q.schema.type, val: c.call("yyjson_obj_iter_get_val", quoteVar(e2.op)), tag: TAG.JSON }
      } else {
        // Slow path, use yyjson_obj_getn
        if (typing.isNumber(typing.getObjectKeys(e1.schema.type)))
          return { schema: q.schema.type, val: c.call("yyjson_arr_get", g1.val, quoteVar(e2.op)), tag: TAG.JSON }
        return { schema: q.schema.type, val: c.call("yyjson_obj_getn", g1.val, c.call("yyjson_get_str", quoteVar(e2.op)), c.call("yyjson_get_len", quoteVar(e2.op))), tag: TAG.JSON }
      }
    } else if (g1.tag == TAG.ARRAY || g1.tag == TAG.HASHMAP_LINKED_BUCKET) {
      // If we are iterating over a hashMap,
      // get the entry directly using the var
      return array.getValueAtIdx(g1, quoteVar(e2.op))
    } else if (g1.tag == TAG.HASHMAP || g1.tag == TAG.NESTED_HASHMAP) {
      // If we are iterating over a hashMap,
      // get the entry directly using the var
      return hashmap.getHashMapValueEntry(g1, undefined, quoteVar(e2.op))
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
    if (v1.cond) res.cond = c.or(v1.cond, res.cond)
    return json.convertJSONTo(res, q.schema.type)
  }

  if (v1.tag == TAG.HASHMAP || v1.tag == TAG.NESTED_HASHMAP) {
    // HashMap lookup (also supports looking up a constant field key in a nested
    // hashmap, e.g. nation1.(key).n_name when the value object is itself a map)
    let key = emitPath(buf, e2)
    let [pos, keyPos] = hashmap.emitHashLookUp(buf, v1, key)
    // The value is undefined if keyPos == 0
    // emitPath will not handle undefined values
    // It is up to the top-level caller of emitPath how undefined is handled
    let value = hashmap.getHashMapValueEntry(v1, pos, keyPos)
    // value.cond = c.eq(keyPos, "-1")
    // A dynamic (yyjson_val) slot is schema-less by construction; stamp the concrete
    // field type known from this access so downstream convertJSONTo/wrapJSON work.
    if (value.dynamic && !value.schema) value.schema = q.schema.type
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
    console.log(v1)
    throw new Error("Cannot perform get on non-object values")
  }

  if (!(e2.key == "const" && typeof e2.op == "string")) {
    throw new Error("Cannot get non-constant string field from objects")
  }

  let cond = v1.cond
  if (!v1.val[e2.op]) cond = "1"
  return { ...v1.val[e2.op], cond }
}

let emitOrElse = (buf, q) => {
  let [e1, e2] = q.arg.map(e => emitPath(buf, e))

  let emitSelect = (cond, e1, e2, res) => {
    if (typing.isString(e1.schema)) {
      if (!typing.isString(e2.schema)) throw new Error("Expect both side to be string")
      let tmpStr = symbol.getSymbol("tmp_or_str")
      let tmpLen = symbol.getSymbol("tmp_or_len")
      c.declareConstCharPtr(buf)(tmpStr, c.ternary(cond, e2.val.str, e1.val.str))
      c.declareInt(buf)(tmpLen, c.ternary(cond, e2.val.len, e1.val.len))
      res.val = { str: tmpStr, len: tmpLen }
    } else if (e2.schema.typeSym == typeSyms.boolean) {
      res.val = "1"
    } else {
      let tmp = symbol.getSymbol("tmp_or")
      let cType = utils.convertToCType(e2.schema)
      c.declareVar(buf)(cType, tmp, c.ternary(cond, e2.val, e1.val))
      res.val = tmp
    }
  }

  res = { schema: q.schema.type }
  if (e1.tag == TAG.ARRAY) {
    if (e2.tag != TAG.ARRAY) throw new Error("Expect both side to be array")
    let tmpCount = symbol.getSymbol("tmp_or_count")
    c.declareInt(buf)(tmpCount, c.ternary(e1.cond, e2.val.count, e1.val.count))
    res.val = { count: tmpCount, values: {} }
    for (let name in e1.val.values) {
      let value1 = e1.val.values[name]
      let value2 = e2.val.values[name]

      res.val.values[name] = { schema: value1.schema }

      if (typing.isString(value1.schema)) {
        if (!typing.isString(value2.schema)) throw new Error("Expect both side to be string")
        let tmpStr = symbol.getSymbol("tmp_or_str")
        let tmpLen = symbol.getSymbol("tmp_or_len")
        c.declareCharPtrPtr(buf)(tmpStr, c.ternary(e1.cond, value2.val.str, value1.val.str))
        c.declareIntPtr(buf)(tmpLen, c.ternary(e1.cond, value2.val.len, value1.val.len))
        res.val.values[name].val = { str: tmpStr, len: tmpLen }
      } else {
        let tmp = symbol.getSymbol("tmp_or")
        let cType = utils.convertToCType(value1.schema)
        c.declarePtr(buf)(cType, tmp, c.ternary(e1.cond, value2.val, value1.val))
        res.val.values[name].val = tmp
      }
    }
    res.tag = TAG.ARRAY
  } else {
    emitSelect(e1.cond, e1, e2, res)
  }

  if (e1.cond && e2.cond) {
    res.cond = c.and(e1.cond, e2.cond)
  } else if (e1.cond) {
    res.cond = c.and(e1.cond, "0")
  } else {
    res.cond = e2.cond
  }
  return res
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
    let [e1, e2] = q.arg.map(e => emitPath(buf, e))
    if (e1.cond && e2.cond) {
      e2.cond = c.or(e1.cond, e2.cond)
    } else if (e1.cond) {
      e2.cond = e1.cond
    } else {
      e2.cond = e2.cond
    }
    return e2
  } else if (q.op == "andAlso") {
    let [e1, e2] = q.arg.map(e => emitPath(buf, e))
    if (e1.cond && e2.cond) {
      e2.cond = c.or(e1.cond, e2.cond)
    } else if (e1.cond) {
      e2.cond = e1.cond
    } else {
      e2.cond = e2.cond
    }
    return e2
  } else if (q.op == "orElse") {
    return emitOrElse(buf, q)
  } else if (q.op.startsWith("convert_")) {
    let e = emitPath(buf, q.arg[0])
    return value.primitive(q.schema.type, c.cast(utils.cTypes[q.op.substring("convert_".length)], e.val), undefined, e.cond)
  } else if (q.op == "year") {
    let e = emitPath(buf, q.arg[0])
    return value.primitive(q.schema.type, c.div(e.val, "10000"), undefined, e.cond)
  } else if (q.op == "hour") {
    let e = emitPath(buf, q.arg[0])
    let time = symbol.getSymbol("tmp_time")
    c.declareVar(buf)("time_t", time, c.div(e.val, 1000000))
    return value.primitive(q.schema.type, c.call("gmtime", "&" + time) + "->tm_hour", undefined, e.cond)
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
    return value.primitive(q.schema.type, "1", undefined, c.not(name))
  } else if (q.op == "isUndef") {
    let e = emitPath(buf, q.arg[0])
    if (e.cond) {
      return value.primitive(q.schema.type, "1", undefined, c.not(e.cond))
    } else {
      // Cannot be undefined, return the value
      return e
    }
  } else if (q.op == "length") {
    let e = emitPath(buf, q.arg[0])
    if (e.tag == TAG.JSON) {
      return value.primitive(q.schema.type, c.call("yyjson_get_len", e.val), undefined, e.cond)
    } else if (e.tag == TAG.HASHMAP) {
      return value.primitive(q.schema.type, e.val.count, undefined, e.cond)
    } else if (e.tag == TAG.NESTED_HASHMAP) {
      return value.primitive(q.schema.type, e.val.count, undefined, e.cond)
    } else {
      throw new Error("not implemented yet")
    }
  } else if (q.op == "combine") {
    let keys = q.arg.map(e => emitPath(buf, e))
    let schema = keys.map(key => key.schema)
    let cond
    for (let key of keys) {
      if (key.cond) {
        if (cond)
          cond = c.or(cond, key.cond)
        else
          cond = key.cond
      }
    }
    return value.combinedKey(schema, keys, cond)
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
        if ((q.op == "equal" || q.op == "notEqual") && ((q.arg[0].key == "const" && q.arg[0].op.length <= 8) || (q.arg[1].key == "const" && q.arg[1].op.length <= 8))) {
          let lhs
          let rhs
          if (q.arg[0].key == "const") {
            lhs = utils.stringToHexBytes(q.arg[0].op)
            rhs = "(*(" + c.cast("uint64_t *", str1) + ") & 0x" + "00".repeat(8 - q.arg[0].op.length) + "FF".repeat(q.arg[0].op.length) + ")"
          } else {
            lhs = "(*(" + c.cast("uint64_t *", str1) + ") & 0x" + "00".repeat(8 - q.arg[1].op.length) + "FF".repeat(q.arg[1].op.length) + ")"
            rhs = utils.stringToHexBytes(q.arg[1].op)
          }
          if (q.op == "equal") {
            res = value.primitive(q.schema.type, c.ternary(c.eq(len1, len2), c.eq(lhs, rhs), "0"))
          } else {
            res = value.primitive(q.schema.type, c.ternary(c.ne(len1, len2), "1", c.ne(lhs, rhs)))
          }
        } else {
          let name = symbol.getSymbol("tmp_cmpstr")
          // let curr = symbol.getSymbol("tmp_cursor")
          // let minLen = symbol.getSymbol("min_len")

          c.declareInt(buf)(name, c.call("strncmp", str1, str2, c.ternary(c.lt(len1, len2), len1, len2)))
          c.stmt(buf)(c.assign(name, c.ternary(c.eq(name, "0"), c.sub(len1, len2), name)))

          res = value.primitive(q.schema.type, c.binary(name, "0", op))
        }

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
    if (q.op == "equal" || q.op == "notEqual" || q.op == "lessThan" || q.op == "greaterThan" || q.op == "lessThanOrEqual" || q.op == "greaterThanOrEqual") {
      if (res.cond)
        res.cond = c.or(res.cond, c.not(res.val))
      else
        res.cond = c.not(res.val)
      res.val = "1"
    }

    return res
  } else if (q.op == "dot") {
    let [e1, e2] = q.arg.map(e => emitPath(buf, e))
    let cType = "float"

    let moveToDevice = (e) => {
      let mem = symbol.getSymbol("h_vec")
      let idx = symbol.getSymbol("idx")
      let max = symbol.getSymbol("max")
      let iter = symbol.getSymbol("iter")
      let len = symbol.getSymbol("N")
      c.declareSize(buf)(len, c.call("yyjson_arr_size", e.val)) // used to be e1 -> should just be e
      c.declarePtr(buf)(cType, mem, c.cast(cType + " *", c.malloc(cType, len)))
      c.declareSize(buf)(idx)
      c.declareSize(buf)(max)
      c.declarePtr(buf)("yyjson_val", iter)
      buf.push(`yyjson_arr_foreach(${e.val}, ${idx}, ${max}, ${iter}) {`)
      buf.push(`${mem}[${idx}] = (float)yyjson_get_int(${iter});`)
      buf.push(`}`)

      let cuMem = symbol.getSymbol("d_vec")
      c.declarePtr(buf)(cType, cuMem)
      c.stmt(buf)(c.call("cudaMalloc", `&${cuMem}`, `${len} * sizeof(${cType})`))
      c.stmt(buf)(c.call("cudaMemcpy", cuMem, mem, `${len} * sizeof(${cType})`, "cudaMemcpyHostToDevice"))

      return { size: len, cuMem }
    }

    if (e1.tag != TAG.JSON || e2.tag != TAG.JSON) {
      throw new Error("Expect json data on two sides for now")
    }

    let { size: size1, cuMem: cuMem1 } = moveToDevice(e1)
    let { size: size2, cuMem: cuMem2 } = moveToDevice(e2)

    let res = symbol.getSymbol("res")
    c.declareVar(buf)(cType, res, 0)

    c.stmt(buf)(c.call("cublasSdot", "handle", size1, cuMem1, "1", cuMem2, "1", "&" + res))

    return value.primitive(types.f32, res)
  } else if (q.op == "matmul") {
    // console.log(pretty(q))
    // throw new Error("Not implemented yet")
    // cublasSgemm(handle, CUBLAS_OP_N, CUBLAS_OP_N, n, m, k, &alpha, B, n, A, k, &beta, C, n)

    let [A, B] = q.arg.map(e => emitPath(buf, e))
    let alphaNode = q.arg[2] ? emitPath(buf, q.arg[2]) : null
    let CNode = q.arg[3] ? emitPath(buf, q.arg[3]) : null
    let betaNode = q.arg[4] ? emitPath(buf, q.arg[4]) : null
    let cType = "float"
    

    // C = alpha * A@B + beta * C_in
    let moveToDevice = (e) => {
      if (e.tag == TAG.GPU_TENSOR) {
        return { rows: e.val.rows, cols: e.val.cols, cuMem: e.val.cuMem }
      }

      if (typing.isSparse(e.schema)) {
        let rows = symbol.getSymbol("rows")
        let rowsField = symbol.getSymbol("rowsField")
        let rowPtrArr = symbol.getSymbol("rowPtrArr")
        let rowPtrLen = symbol.getSymbol("rowPtrLen")
        let h_rowPtr = symbol.getSymbol("h_rowPtr")
        let rp_idx = symbol.getSymbol("rp_idx")
        let rp_max = symbol.getSymbol("rp_max")
        let rp_iter = symbol.getSymbol("rp_iter")
        
        let cols = symbol.getSymbol("cols")
        let colsField = symbol.getSymbol("colsField")
        let colIdxArr = symbol.getSymbol("colIdxArr")
        let colIdxLen = symbol.getSymbol("colIdxLen")
        let h_colIdx = symbol.getSymbol("h_colIdx")
        let ci_idx = symbol.getSymbol("ci_idx")
        let ci_max = symbol.getSymbol("ci_max")
        let ci_iter = symbol.getSymbol("ci_iter")

        let valuesArr = symbol.getSymbol("valuesArr")
        let valuesLen = symbol.getSymbol("valuesLen")
        let h_values = symbol.getSymbol("h_values")
        let v_idx = symbol.getSymbol("v_idx")
        let v_max = symbol.getSymbol("v_max")
        let v_iter = symbol.getSymbol("v_iter")

        c.declarePtr(buf)("yyjson_val", rowsField, c.call("yyjson_obj_get", e.val, `"rows"`))
        c.declareSize(buf)(rows, c.call("yyjson_get_int", rowsField))
        c.declarePtr(buf)("yyjson_val", colsField, c.call("yyjson_obj_get", e.val, `"cols"`))
        c.declareSize(buf)(cols, c.call("yyjson_get_int", colsField))


        c.declarePtr(buf)("yyjson_val", rowPtrArr, c.call("yyjson_obj_get", e.val, `"rowPtr"`))
        c.declareSize(buf)(rowPtrLen, c.call("yyjson_arr_size", rowPtrArr))
        c.declarePtr(buf)("int", h_rowPtr, c.cast("int *", c.malloc("int", rowPtrLen)))
        c.declarePtr(buf)("yyjson_val", colIdxArr, c.call("yyjson_obj_get", e.val, `"colIdx"`))
        c.declareSize(buf)(colIdxLen, c.call("yyjson_arr_size", colIdxArr))
        c.declarePtr(buf)("int", h_colIdx, c.cast("int *", c.malloc("int", colIdxLen)))
        c.declarePtr(buf)("yyjson_val", valuesArr, c.call("yyjson_obj_get", e.val, `"values"`))
        c.declareSize(buf)(valuesLen, c.call("yyjson_arr_size", valuesArr))
        c.declarePtr(buf)("float", h_values, c.cast("float *", c.malloc("float", valuesLen)))



        c.declareSize(buf)(rp_idx)
        c.declareSize(buf)(rp_max)
        c.declarePtr(buf)("yyjson_val", rp_iter)
        buf.push(`yyjson_arr_foreach(${rowPtrArr}, ${rp_idx}, ${rp_max}, ${rp_iter}) {`)
        buf.push(`${h_rowPtr}[${rp_idx}] = yyjson_get_int(${rp_iter});`)
        buf.push(`}`)

        c.declareSize(buf)(ci_idx)
        c.declareSize(buf)(ci_max)
        c.declarePtr(buf)("yyjson_val", ci_iter)
        buf.push(`yyjson_arr_foreach(${colIdxArr}, ${ci_idx}, ${ci_max}, ${ci_iter}) {`)
        buf.push(`${h_colIdx}[${ci_idx}] = yyjson_get_int(${ci_iter});`)
        buf.push(`}`)

        c.declareSize(buf)(v_idx)
        c.declareSize(buf)(v_max)
        c.declarePtr(buf)("yyjson_val", v_iter)
        buf.push(`yyjson_arr_foreach(${valuesArr}, ${v_idx}, ${v_max}, ${v_iter}) {`)
        buf.push(`${h_values}[${v_idx}] = (float)yyjson_get_int(${v_iter});`)
        buf.push(`}`)

        let d_rowPtr = symbol.getSymbol("d_rowPtr")
        let d_colIdx = symbol.getSymbol("d_colIdx")
        let d_values = symbol.getSymbol("d_values")

        c.declarePtr(buf)("int", d_rowPtr)
        c.declarePtr(buf)("int", d_colIdx)
        c.declarePtr(buf)("float", d_values)

        c.stmt(buf)(c.call("cudaMalloc", `&${d_rowPtr}`, `${rowPtrLen} * sizeof(int)`))
        c.stmt(buf)(c.call("cudaMemcpy", d_rowPtr, h_rowPtr, `${rowPtrLen} * sizeof(int)`, "cudaMemcpyHostToDevice"))

        c.stmt(buf)(c.call("cudaMalloc", `&${d_colIdx}`, `${colIdxLen} * sizeof(int)`))
        c.stmt(buf)(c.call("cudaMemcpy", d_colIdx, h_colIdx, `${colIdxLen} * sizeof(int)`, "cudaMemcpyHostToDevice"))

        c.stmt(buf)(c.call("cudaMalloc", `&${d_values}`, `${valuesLen} * sizeof(float)`))
        c.stmt(buf)(c.call("cudaMemcpy", d_values, h_values, `${valuesLen} * sizeof(float)`, "cudaMemcpyHostToDevice"))

        return { rows, cols, nnz: valuesLen, rowPtr: d_rowPtr, colIdx: d_colIdx, values: d_values }
      }

      let mem = symbol.getSymbol("h_mat")
      let r_idx = symbol.getSymbol("row_idx")
      let r_max = symbol.getSymbol("row_max")
      let r_iter = symbol.getSymbol("row_iter")
      let c_idx = symbol.getSymbol("col_idx")
      let c_max = symbol.getSymbol("col_max")
      let c_iter = symbol.getSymbol("col_iter")
      let rows = symbol.getSymbol("rows")
      let cols = symbol.getSymbol("cols")
      
      c.declareSize(buf)(rows, c.call("yyjson_arr_size", e.val))
      
      let firstRow = symbol.getSymbol("firstRow")
      c.declarePtr(buf)("yyjson_val", firstRow, c.call("yyjson_arr_get", e.val, "0"))
      c.declareSize(buf)(cols, c.call("yyjson_arr_size", firstRow))

      c.declarePtr(buf)(cType, mem, c.cast(cType + " *", c.malloc(cType, `${rows} * ${cols}`)))
      c.declareSize(buf)(r_idx)
      c.declareSize(buf)(r_max)
      c.declarePtr(buf)("yyjson_val", r_iter)
      c.declareSize(buf)(c_idx)
      c.declareSize(buf)(c_max)
      c.declarePtr(buf)("yyjson_val", c_iter)

      buf.push(`yyjson_arr_foreach(${e.val}, ${r_idx}, ${r_max}, ${r_iter}) {`)
      buf.push(`yyjson_arr_foreach(${r_iter}, ${c_idx}, ${c_max}, ${c_iter}) {`)
      buf.push(`${mem}[${r_idx} * ${cols} + ${c_idx}] = (float)yyjson_get_int(${c_iter});`)
      buf.push(`}`)
      buf.push(`}`)


      let cuMem = symbol.getSymbol("d_mat")
      c.declarePtr(buf)(cType, cuMem)
      c.stmt(buf)(c.call("cudaMalloc", `&${cuMem}`, `${rows} * ${cols} * sizeof(${cType})`))
      c.stmt(buf)(c.call("cudaMemcpy", cuMem, mem, `${rows} * ${cols} * sizeof(${cType})`, "cudaMemcpyHostToDevice"))

      return { rows, cols, cuMem }
    }

    // if (A.tag != TAG.JSON || B.tag != TAG.JSON) {
    //   throw new Error("Expect json data on two sides for now")
    // }

    let devA = moveToDevice(A)
    let devB = moveToDevice(B)
    let m = devA.rows, k_a = devA.cols
    let k_b = devB.rows, n = devB.cols

    // if (k_a != k_b) {
    //   throw new Error("Num of cols for A should match num of rows for B")
    // }

    let aSparse = devA.rowPtr !== undefined
    let bSparse = devB.rowPtr !== undefined

    let C
    if (CNode) {
      ;({ cuMem: C } = moveToDevice(CNode))
    } else {
      C = symbol.getSymbol("C")
      c.declarePtr(buf)(cType, C)
      c.stmt(buf)(c.call("cudaMalloc", `&${C}`, `${m} * ${n} * sizeof(${cType})`))
    }

    let alphaVar = symbol.getSymbol("alpha")
    let alphaVal = alphaNode ? alphaNode.val : "1.0f"
    let betaVar = symbol.getSymbol("beta")
    let betaVal = betaNode ? betaNode.val : "0.0f"
    c.declareVar(buf)(cType, alphaVar, alphaVal)
    c.declareVar(buf)(cType, betaVar, betaVal)

    let resultTransposed = false

    if (aSparse && bSparse) {
      throw new Error("sparse x sparse matmul (SpGEMM) not implemented yet")
    } else if (bSparse && !aSparse) {
      // A is dense, B is sparse
      // Returning C.T = B.T * A.T -- result is TRANSPOSED
      resultTransposed = true

      let matA = symbol.getSymbol("matA")
      c.declareVar(buf)("cusparseSpMatDescr_t", matA)
      c.stmt(buf)(c.call("cusparseCreateCsr", `&${matA}`, devB.rows, devB.cols, devB.nnz,
        devB.rowPtr, devB.colIdx, devB.values,
        "CUSPARSE_INDEX_32I", "CUSPARSE_INDEX_32I", "CUSPARSE_INDEX_BASE_ZERO", "CUDA_R_32F"))

      let matB = symbol.getSymbol("matB")
      c.declareVar(buf)("cusparseDnMatDescr_t", matB)
      c.stmt(buf)(c.call("cusparseCreateDnMat", `&${matB}`, m, k_a, k_a, devA.cuMem, "CUDA_R_32F", "CUSPARSE_ORDER_ROW"))

      let matC = symbol.getSymbol("matC")
      c.declareVar(buf)("cusparseDnMatDescr_t", matC)
      c.stmt(buf)(c.call("cusparseCreateDnMat", `&${matC}`, n, m, m, C, "CUDA_R_32F", "CUSPARSE_ORDER_ROW"))

      let bufferSize = symbol.getSymbol("bufferSize")
      c.declareSize(buf)(bufferSize)
      c.stmt(buf)(c.call("cusparseSpMM_bufferSize", "sparseHandle",
        "CUSPARSE_OPERATION_TRANSPOSE", "CUSPARSE_OPERATION_TRANSPOSE",
        "&" + alphaVar, matA, matB, "&" + betaVar, matC,
        "CUDA_R_32F", "CUSPARSE_SPMM_ALG_DEFAULT", "&" + bufferSize))

      let dBuffer = symbol.getSymbol("dBuffer")
      c.declarePtr(buf)("void", dBuffer)
      c.stmt(buf)(c.call("cudaMalloc", `&${dBuffer}`, bufferSize))

      c.stmt(buf)(c.call("cusparseSpMM", "sparseHandle",
        "CUSPARSE_OPERATION_TRANSPOSE", "CUSPARSE_OPERATION_TRANSPOSE",
        "&" + alphaVar, matA, matB, "&" + betaVar, matC,
        "CUDA_R_32F", "CUSPARSE_SPMM_ALG_DEFAULT", dBuffer))
    } else if (aSparse) {
      // A is sparse, B is dense

      let matA = symbol.getSymbol("matA")
      c.declareVar(buf)("cusparseSpMatDescr_t", matA)
      c.stmt(buf)(c.call("cusparseCreateCsr", `&${matA}`, devA.rows, devA.cols, devA.nnz,
        devA.rowPtr, devA.colIdx, devA.values,
        "CUSPARSE_INDEX_32I", "CUSPARSE_INDEX_32I", "CUSPARSE_INDEX_BASE_ZERO", "CUDA_R_32F"))

      let matB = symbol.getSymbol("matB")
      c.declareVar(buf)("cusparseDnMatDescr_t", matB)
      c.stmt(buf)(c.call("cusparseCreateDnMat", `&${matB}`, k_b, n, n, devB.cuMem, "CUDA_R_32F", "CUSPARSE_ORDER_ROW"))

      let matC = symbol.getSymbol("matC")
      c.declareVar(buf)("cusparseDnMatDescr_t", matC)
      c.stmt(buf)(c.call("cusparseCreateDnMat", `&${matC}`, m, n, n, C, "CUDA_R_32F", "CUSPARSE_ORDER_ROW"))

      let bufferSize = symbol.getSymbol("bufferSize")
      c.declareSize(buf)(bufferSize)
      c.stmt(buf)(c.call("cusparseSpMM_bufferSize", "sparseHandle",
        "CUSPARSE_OPERATION_NON_TRANSPOSE", "CUSPARSE_OPERATION_NON_TRANSPOSE",
        "&" + alphaVar, matA, matB, "&" + betaVar, matC,
        "CUDA_R_32F", "CUSPARSE_SPMM_ALG_DEFAULT", "&" + bufferSize))

      let dBuffer = symbol.getSymbol("dBuffer")
      c.declarePtr(buf)("void", dBuffer)
      c.stmt(buf)(c.call("cudaMalloc", `&${dBuffer}`, bufferSize))

      c.stmt(buf)(c.call("cusparseSpMM", "sparseHandle",
        "CUSPARSE_OPERATION_NON_TRANSPOSE", "CUSPARSE_OPERATION_NON_TRANSPOSE",
        "&" + alphaVar, matA, matB, "&" + betaVar, matC,
        "CUDA_R_32F", "CUSPARSE_SPMM_ALG_DEFAULT", dBuffer))
    } else {
      // both dense -> existing cublasSgemm path
      c.stmt(buf)(c.call("cublasSgemm", "handle", "CUBLAS_OP_N", "CUBLAS_OP_N", n, m, k_a, "&" + alphaVar, devB.cuMem, n, devA.cuMem, k_a, "&" + betaVar, C, n))
    }

    // copy back to host
    // let hC = symbol.getSymbol("h_C")
    // c.declarePtr(buf)(cType, hC, c.cast(cType + " *", c.malloc(cType, `${m} * ${n}`)))
    // c.stmt(buf)(c.call("cudaMemcpy", hC, C, `${m} * ${n} * sizeof(${cType})`, "cudaMemcpyDeviceToHost"))

    // buf.push(`printf("{");`)
    // buf.push(`for (int i = 0; i < ${m}; i++) {`)
    // buf.push(`  if (i > 0) printf(", ");`)
    // buf.push(`  printf("\\"%d\\": {", i);`)
    // buf.push(`  for (int j = 0; j < ${n}; j++) {`)
    // buf.push(`    if (j > 0) printf(", ");`)
    // buf.push(`    printf("\\"%d\\": %.0f", j, ${hC}[i * ${n} + j]);`)
    // buf.push(`  }`)
    // buf.push(`  printf("}");`)
    // buf.push(`}`)
    // buf.push(`printf("}");`)

    return resultTransposed
      ? value.gpuTensor(q.schema, C, n, m, undefined, 'float')
      : value.gpuTensor(q.schema, C, m, n, undefined, 'float')
    // return { schema: { typeSym: typeSyms.never } }

    // return value.primitive(types.f32, C)




  } else if (q.op == "batched-matmul") {
    /*
    [[1 2], [5 6]]
    [[3 4], [7 8]]  
    */

    // library call for batched-matmul
    // console.log(pretty(q))

    let [A, B] = q.arg.map(e => emitPath(buf, e))
    let cType = "float"

    let moveToDevice = (e) => {
      if (e.tag == TAG.GPU_TENSOR) {
        return { batches: e.val.batches, rows: e.val.rows, cols: e.val.cols, cuMem: e.val.cuMem }
      }
      let mem = symbol.getSymbol("h_batch")
      let b_idx = symbol.getSymbol("batch_idx")
      let b_max = symbol.getSymbol("batch_max")
      let b_iter = symbol.getSymbol("batch_iter")
      let r_idx = symbol.getSymbol("row_idx")
      let r_max = symbol.getSymbol("row_max")
      let r_iter = symbol.getSymbol("row_iter")
      let c_idx = symbol.getSymbol("col_idx")
      let c_max = symbol.getSymbol("col_max")
      let c_iter = symbol.getSymbol("col_iter")
      let batches = symbol.getSymbol("batches")
      let rows = symbol.getSymbol("rows")
      let cols = symbol.getSymbol("cols")

      c.declareSize(buf)(batches, c.call("yyjson_arr_size", e.val))
      let firstMatrix = symbol.getSymbol("firstMatrix")
      c.declarePtr(buf)("yyjson_val", firstMatrix, c.call("yyjson_arr_get", e.val, "0"))
      
      c.declareSize(buf)(rows, c.call("yyjson_arr_size", firstMatrix))
      let firstRow = symbol.getSymbol("firstRow")
      c.declarePtr(buf)("yyjson_val", firstRow, c.call("yyjson_arr_get", firstMatrix, "0"))

      c.declareSize(buf)(cols, c.call("yyjson_arr_size", firstRow))

      c.declarePtr(buf)(cType, mem, c.cast(cType + " *", c.malloc(cType, `${batches} * ${rows} * ${cols}`)))
      
      c.declareSize(buf)(b_idx)
      c.declareSize(buf)(b_max)
      c.declarePtr(buf)("yyjson_val", b_iter)
      c.declareSize(buf)(r_idx)
      c.declareSize(buf)(r_max)
      c.declarePtr(buf)("yyjson_val", r_iter)
      c.declareSize(buf)(c_idx)
      c.declareSize(buf)(c_max)
      c.declarePtr(buf)("yyjson_val", c_iter)

      buf.push(`yyjson_arr_foreach(${e.val}, ${b_idx}, ${b_max}, ${b_iter}) {`)
      buf.push(`yyjson_arr_foreach(${b_iter}, ${r_idx}, ${r_max}, ${r_iter}) {`)
      buf.push(`yyjson_arr_foreach(${r_iter}, ${c_idx}, ${c_max}, ${c_iter}) {`)
      buf.push(`${mem}[(${b_idx} * ${rows} + ${r_idx}) * ${cols} + ${c_idx}] = (float)yyjson_get_int(${c_iter});`)
      buf.push(`}`)
      buf.push(`}`)
      buf.push(`}`)

      let cuMem = symbol.getSymbol("d_batch")
      c.declarePtr(buf)(cType, cuMem)
      c.stmt(buf)(c.call("cudaMalloc", `&${cuMem}`, `${batches} * ${rows} * ${cols} * sizeof(${cType})`))
      c.stmt(buf)(c.call("cudaMemcpy", cuMem, mem, `${batches} * ${rows} * ${cols} * sizeof(${cType})`, "cudaMemcpyHostToDevice"))


      return { batches, rows, cols, cuMem}
    }
  
 
    let { batches: batches_a, rows: m, cols: k_a, cuMem: cuMemA } = moveToDevice(A)
    let { batches: batches_b, rows: k_b, cols: n, cuMem: cuMemB } = moveToDevice(B)


    let C_batch = symbol.getSymbol("C_batch")

    c.declarePtr(buf)(cType, C_batch)
    c.stmt(buf)(c.call("cudaMalloc", `&${C_batch}`, `${batches_a} * ${m} * ${n} * sizeof(${cType})`))

    let alpha = symbol.getSymbol("alpha")
    let beta = symbol.getSymbol("beta")
    c.declareVar(buf)(cType,alpha, "1.0f")
    c.declareVar(buf)(cType, beta, "0.0f")

    c.stmt(buf)(c.call("cublasSgemmStridedBatched", "handle", "CUBLAS_OP_N", "CUBLAS_OP_N", n, m, k_a, "&" + alpha, cuMemB, n, `${k_b} * ${n}`, cuMemA, k_a, `${m} * ${k_a}`, "&" + beta, C_batch, n, `${m} * ${n}`, batches_a))
    
    // let hC = symbol.getSymbol("h_C")
    // c.declarePtr(buf)(cType, hC, c.cast(cType + " *", c.malloc(cType, `${batches_a} * ${m} * ${n}`)))
    // c.stmt(buf)(c.call("cudaMemcpy", hC, C_batch, `${batches_a} * ${m} * ${n} * sizeof(${cType})`, "cudaMemcpyDeviceToHost"))

    // buf.push(`printf("{");`)
    // buf.push(`for (int b = 0; b < ${batches_a}; b++) {`)
    // buf.push(`  if (b > 0) printf(", ");`)
    // buf.push(`  printf("\\"%d\\": {", b);`)
    // buf.push(`  for (int i = 0; i < ${m}; i++) {`)
    // buf.push(`    if (i > 0) printf(", ");`)
    // buf.push(`    printf("\\"%d\\": {", i);`)
    // buf.push(`    for (int j = 0; j < ${n}; j++) {`)
    // buf.push(`      if (j > 0) printf(", ");`)
    // buf.push(`      printf("\\"%d\\": %.0f", j, ${hC}[b * ${m} * ${n} + i * ${n} + j]);`)
    // buf.push(`    }`)
    // buf.push(`    printf("}");`)
    // buf.push(`  }`)
    // buf.push(`  printf("}");`)
    // buf.push(`}`)
    // buf.push(`printf("}");`)
    // return { schema: { typeSym: typeSyms.never } }

    return value.gpuTensor(q.schema, C_batch, m, n, batches_a, 'float')

  } else {
    throw new Error("Pure operation not supported: " + pretty(q))
  }
}

/*
cublasStatus_t cublasSgemmStridedBatched(cublasHandle_t handle,
                                  cublasOperation_t transa,
                                  cublasOperation_t transb,
                                  int m, int n, int k,
                                  const float           *alpha,
                                  const float           *A, int lda,
                                  long long int          strideA,
                                  const float           *B, int ldb,
                                  long long int          strideB,
                                  const float           *beta,
                                  float                 *C, int ldc,
                                  long long int          strideC,
                                  int batchCount)

*/

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
    // emitStateful(assignments[q.op], q.op)
    emitStateful1(q)
    let q1 = assignments[q.op]
    let tmpVar = tmpVars[q.op]

    if (q1.fre.length > 0) {
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


/**
 * 
 * Performs pattern matching to find matrix multiplications.
 * 
 */
let findMatmuls = q => {
  let isGroupByVar = q => {
    let [e0, e1, e2, e3] = q.arg
    let e0EmpObj = e0.key == "const" && JSON.stringify(e0.op) == "{}"
    let e1Var = e1.key == "var"
    let e2Stateful = e2.key == "update" || e2.key == "stateful"
    let noMkSet = e3 === undefined

    return e0EmpObj && e1Var && e2Stateful && noMkSet
  }

  let extractGetPath = (q) => {
    if (q.key == "get" && q.arg[1].key == "var") {
      let [root, path] = extractGetPath(q.arg[0])
      path.push(q.arg[1].op)
      return [root, path]
    } else {
      return [q, []]
    }
  }

  let checkMACOp = (q, v1, v2) => {
    if (!same(q.fre, [v1, v2])) {
      return false
    }

    let q1 = q.arg[0]
    if (q1.key != "pure" || q1.op != "times") {
      return false
    }

    let [e0, e1] = q1.arg
    let [root0, path0] = extractGetPath(e0)
    let [root1, path1] = extractGetPath(e1)

    root0 = findMatmuls(root0)
    root1 = findMatmuls(root1)

    if (path0.length != 2 || path1.length != 2) {
      return false
    }

    if (path0[1] == path1[0] && path0[0] == v1 && path1[1] == v2) {
      return [root0, root1]
    }
    if (path1[1] == path0[0] && path1[0] == v1 && path0[1] == v2) {
      // return [root0, root1] wrong order
      return [root1, root0]
    }

    return false
  }

  if (q.key == "update") {
    // Try to see if we can find a matmul here
    // console.log("trying to find matmul")
    let qGroupByVar = isGroupByVar(q)
    if (!qGroupByVar) {
      q.arg = q.arg.map(findMatmuls)
      return q
    }
    let inner = q.arg[2]
    if (inner.key != "update") {
      q.arg = q.arg.map(findMatmuls)
      return q
    }

    let innerGroupByVar = isGroupByVar(inner)
    if (!innerGroupByVar) {
      q.arg = q.arg.map(findMatmuls)
      return q
    }
    let aggr = inner.arg[2]
    if (aggr.key != "stateful" || aggr.op != "sum") {
      q.arg = q.arg.map(findMatmuls)
      return q
    }

    let outerVar = q.arg[1].op
    let innerVar = inner.arg[1].op
    let res = checkMACOp(aggr, outerVar, innerVar)
    if (!res) {
      q.arg = q.arg.map(findMatmuls)
      return q
    }

    // console.log("matmul???")

    return { key: "pure", op: "matmul", arg: res }
  } else if (q.arg) {
    q.arg = q.arg.map(findMatmuls)
  }

  return q
}

let findBatchedMatmuls = q => {
  // rh`{*i: {*j: {*l: sum(${batchedMatA}.*i.*j.*k * ${batchedMatB}.*i.*k.*l)}}}`
  // from findMatmuls
  let isGroupByVar = q => {
    let [e0, e1, e2, e3] = q.arg
    let e0EmpObj = e0.key == "const" && JSON.stringify(e0.op) == "{}"
    let e1Var = e1.key == "var"
    let e2Stateful = e2.key == "update" || e2.key == "stateful"
    let noMkSet = e3 === undefined

    return e0EmpObj && e1Var && e2Stateful && noMkSet
  }
  
  // from findMatmuls
  let extractGetPath = (q) => {
    /*
    batchedMatA.*i.*j.*k
    get(get(get(batchedMatA, *i), *j), *k)
    path = [*i, *j, *k]
    root = batchedMatA

    batchedMatB.*i.*k.*l
    get(get(get(batchedMatB, *i), *k), *l)
    path = [*i, *k, *l]
    root = batchedMatB

    */
    if (q.key == "get" && q.arg[1].key == "var") {
      let [root, path] = extractGetPath(q.arg[0])
      path.push(q.arg[1].op)
      return [root, path]
    } else {
      return [q, []]
    }
  }

  let checkMACOp = (q, vbatch, v1, v2) => {
    if (!same(q.fre, [vbatch, v1, v2])) {
      return false
    }
    
    let q1 = q.arg[0]
    if (q1.key != "pure" || q1.op != "times") {
      return false
    }
    
    let [e0, e1] = q1.arg
    let [root0, path0] = extractGetPath(e0)
    let [root1, path1] = extractGetPath(e1)
    
    root0 = findBatchedMatmuls(root0)
    root1 = findBatchedMatmuls(root1)
    
    // modified from findMatmuls
    if (path0.length != 3 || path1.length != 3) {
      return false
    }

    // case 1: A[i][j][k] * B[i][k][l]
    if (path0[0] == vbatch && path1[0] == vbatch && path0[1] == v1 && path0[2] == path1[1] && path1[2] == v2) {
      return [root0, root1]
    }

    // case 2: B[i][k][l] * A[i][j][k]
    if (path0[0] == vbatch && path1[0] == vbatch && path0[1] == path1[2] && path0[2] == v2 && path1[1] == v1) {
      return [root1, root0]
    }
    return false
  }

  // modified from findMatmuls
  if (q.key == "update") {
    let qGroupByVar = isGroupByVar(q)
    if (!qGroupByVar) {
      q.arg = q.arg.map(findBatchedMatmuls)
      return q
    }

    let inner = q.arg[2]
    if (inner.key != "update") {
      q.arg = q.arg.map(findBatchedMatmuls)
      return q
    } else {
      if (!isGroupByVar(inner)) {
        q.arg = q.arg.map(findBatchedMatmuls)
        return q
      }
    }

    let innerMost = inner.arg[2]
    if (innerMost.key != "update") {
      q.arg = q.arg.map(findBatchedMatmuls)
      return q
    } else {
      if (!isGroupByVar(innerMost)) {
        q.arg = q.arg.map(findBatchedMatmuls)
        return q
      }
    }

    let aggr = innerMost.arg[2]
    if (aggr.key != "stateful" || aggr.op != "sum") {
      q.arg = q.arg.map(findBatchedMatmuls)
      return q
    }

    let outerVar = q.arg[1].op
    let innerVar = inner.arg[1].op
    let innerMostVar = innerMost.arg[1].op
    let res = checkMACOp(aggr, outerVar, innerVar, innerMostVar)
    if (!res) {
      q.arg = q.arg.map(findBatchedMatmuls)
      return q
    }

    // console.log("Batched matmul?")

    return { key: "pure", op: "batched-matmul", arg: res}

  } else if (q.arg) {
    q.arg = q.arg.map(findBatchedMatmuls)
  }

  return q


}

let findScaledMatmuls = q => {
  let isGroupByVar = q => {
    let [e0, e1, e2, e3] = q.arg
    let e0EmpObj = e0.key == "const" && JSON.stringify(e0.op) == "{}"
    let e1Var = e1.key == "var"
    let e2Stateful = e2.key == "update" || e2.key == "stateful"
    let noMkSet = e3 === undefined

    return e0EmpObj && e1Var && e2Stateful && noMkSet
  }

  let extractGetPath = (q) => {
    if (q.key == "get" && q.arg[1].key == "var") {
      let [root, path] = extractGetPath(q.arg[0])
      path.push(q.arg[1].op)
      return [root, path]
    } else {
      return [q, []]
    }
  }

  let checkMACOp = (q, v1, v2) => {
    if (!same(q.fre, [v1, v2])) {
      return false
    }

    let q1 = q.arg[0]
    if (q1.key != "pure" || q1.op != "times") {
      return false
    }

    let [e0, e1] = q1.arg
    let [root0, path0] = extractGetPath(e0)
    let [root1, path1] = extractGetPath(e1)

    root0 = findMatmuls(root0)
    root1 = findMatmuls(root1)

    if (path0.length != 2 || path1.length != 2) {
      return false
    }

    if (path0[1] == path1[0] && path0[0] == v1 && path1[1] == v2) {
      return [root0, root1]
    }
    if (path1[1] == path0[0] && path1[0] == v1 && path0[1] == v2) {
      // return [root0, root1] wrong order
      return [root1, root0]
    }

    return false
  }


  if (q.key == "update") {
    let qGroupByVar = isGroupByVar(q)
    if (!qGroupByVar) {
      q.arg = q.arg.map(findScaledMatmuls)
      return q
    }
    let inner = q.arg[2]
    if (inner.key != "update") {
      q.arg = q.arg.map(findScaledMatmuls)
      return q
    }
    let aggr = inner.arg[2]
    let timesNode
    if (aggr.key == "pure" && aggr.op == "times") {
      timesNode = aggr
    } else if (aggr.key == "stateful" && aggr.op == "single" && aggr.arg[0].key == "pure" && aggr.arg[0].op == "times") {
      timesNode = aggr.arg[0]
    } else {
      q.arg = q.arg.map(findScaledMatmuls)
      return q
    }

    let alpha, statefulSum
    if (timesNode.arg[1].key == "stateful" && timesNode.arg[1].op == "sum") {
      alpha = timesNode.arg[0]
      statefulSum = timesNode.arg[1]
    } else if (timesNode.arg[0].key == "stateful" && timesNode.arg[0].op == "sum") {
      alpha = timesNode.arg[1]
      statefulSum = timesNode.arg[0]
    } else {
      q.arg = q.arg.map(findScaledMatmuls)
      return q
    }

    let outerVar = q.arg[1].op
    let innerVar = inner.arg[1].op
    let res = checkMACOp(statefulSum, outerVar, innerVar)
    if (!res) {
      q.arg = q.arg.map(findScaledMatmuls)
      return q
    }



    return { key: "pure", op: "matmul", arg: [...res, alpha]}
  } else if (q.arg) {
    q.arg = q.arg.map(findScaledMatmuls)
  }

  return q
}

// Full GEMM: {*i: {*j: alpha * sum(A.*i.*k * B.*k.*j) + beta * C.*i.*j}}
// -> { key: "pure", op: "matmul", arg: [A, B, alpha, C, beta] }
let findFullGemm = q => {
  let isGroupByVar = q => {
    let [e0, e1, e2, e3] = q.arg
    let e0EmpObj = e0.key == "const" && JSON.stringify(e0.op) == "{}"
    let e1Var = e1.key == "var"
    let e2Stateful = e2.key == "update" || e2.key == "stateful"
    let noMkSet = e3 === undefined

    return e0EmpObj && e1Var && e2Stateful && noMkSet
  }

  let extractGetPath = (q) => {
    if (q.key == "get" && q.arg[1].key == "var") {
      let [root, path] = extractGetPath(q.arg[0])
      path.push(q.arg[1].op)
      return [root, path]
    } else {
      return [q, []]
    }
  }

  // same MAC check as findMatmuls/findScaledMatmuls
  let checkMACOp = (q, v1, v2) => {
    if (!same(q.fre, [v1, v2])) {
      return false
    }

    let q1 = q.arg[0]
    if (q1.key != "pure" || q1.op != "times") {
      return false
    }

    let [e0, e1] = q1.arg
    let [root0, path0] = extractGetPath(e0)
    let [root1, path1] = extractGetPath(e1)

    root0 = findFullGemm(root0)
    root1 = findFullGemm(root1)

    if (path0.length != 2 || path1.length != 2) {
      return false
    }

    if (path0[1] == path1[0] && path0[0] == v1 && path1[1] == v2) {
      return [root0, root1]
    }
    if (path1[1] == path0[0] && path1[0] == v1 && path0[1] == v2) {
      return [root1, root0]
    }

    return false
  }

  let classifyTerm = (t) => {
    if (t.key != "pure" || t.op != "times") return null

    let [a, b] = t.arg
    if (b.key == "stateful" && b.op == "sum") return { kind: "ab", scalar: a, node: b }
    if (a.key == "stateful" && a.op == "sum") return { kind: "ab", scalar: b, node: a }
    if (a.key == "get") return { kind: "c", scalar: b, node: a }
    if (b.key == "get") return { kind: "c", scalar: a, node: b }

    return null
  }

  
  if (q.key == "update") {
    let qGroupByVar = isGroupByVar(q)
    if (!qGroupByVar) {
      q.arg = q.arg.map(findFullGemm)
      return q
    }
    let inner = q.arg[2]
    if (inner.key != "update" || !isGroupByVar(inner)) {
      q.arg = q.arg.map(findFullGemm)
      return q
    }

    let body = inner.arg[2]
    if (body.key != "stateful" || body.op != "single") {
      q.arg = q.arg.map(findFullGemm)
      return q
    }
    let plusNode = body.arg[0]
    if (plusNode.key != "pure" || plusNode.op != "plus") {
      q.arg = q.arg.map(findFullGemm)
      return q
    }

    let [t1, t2] = plusNode.arg.map(classifyTerm)
    if (!t1 || !t2 || t1.kind == t2.kind) {
      q.arg = q.arg.map(findFullGemm)
      return q
    }

    let abTerm = t1.kind == "ab" ? t1 : t2
    let cTerm = t1.kind == "c" ? t1 : t2

    let outerVar = q.arg[1].op
    let innerVar = inner.arg[1].op

    let res = checkMACOp(abTerm.node, outerVar, innerVar)
    if (!res) {
      q.arg = q.arg.map(findFullGemm)
      return q
    }

    let [root, path] = extractGetPath(cTerm.node)
    if (path.length != 2 || path[0] != outerVar || path[1] != innerVar) {
      q.arg = q.arg.map(findFullGemm)
      return q
    }

    return { key: "pure", op: "matmul", arg: [...res, abTerm.scalar, findFullGemm(root), cTerm.scalar] }
  } else if (q.arg) {
    q.arg = q.arg.map(findFullGemm)
  }

  return q
}

let findDotProducts = q => {
   
  if (q.key == "stateful" && q.op == "sum") {
    if (q.arg[0].key == "pure" && q.arg[0].op == "times") {
      let [e1, e2] = q.arg[0].arg;
      if (e1.key == "get" && e2.key == "get") {
        if (e1.arg[1].op == e2.arg[1].op) {
          return { key: "pure", op: "dot", arg: [e1.arg[0], e2.arg[0]] }
        }
      }
    }
  }

  if (q.arg) {
    q.arg = q.arg.map(findDotProducts);
  }
  return q;


}

// TODO: general function for any dot product, matmul, scaling and translation, or batched
let findMAC = q => {
  // collect output index vars,
  let peelGroupByVars = (q) => {
    let outVars = []
    while (q.key == "update" && isGroupByVar(q)) {
      outVars.push(q.arg[1].op)
      q = q.arg[2]
    }
    return { outVars, body: q }
  }

  let isGroupByVar = q => {
    let [e0, e1, e2, e3] = q.arg
    return e0.key == "const" && JSON.stringify(e0.op) == "{}" &&
      e1.key == "var" &&
      (e2.key == "update" || e2.key == "stateful") &&
      e3 === undefined
  }

  let extractGetPath = (q) => {
    if (q.key == "get" && q.arg[1].key == "var") {
      let [root, path] = extractGetPath(q.arg[0])
      path.push(q.arg[1].op)
      return [root, path]
    }
    return [q, []]
  }


  // figure out which index var is summed away, which are shared batch dims, and which are per-operand output dims
  let unifyPaths = (pathA, pathB, outVars) => {

  }

  // TODO: peel off a scale factor (single(times, [alpha, sum])) and/or a beta*C accumulator 
  // TODO: once A/B are matched, look at their .schema to pick the emitter
  // this match is shape-only and deliberately doesn't know about storage format.

  let outVars = [], body = q
  if (q.key == "update") {
    ;({ outVars, body } = peelGroupByVars(q))
  }
  if (body.key == "stateful" && body.op == "sum") {
    let res = checkMAC(body, outVars)
    if (res) {
      return { key: "pure", op: "mac", arg: [res.A, res.B], meta: { outVars, ...res.shape } }
    }
  }

  if (q.arg) q.arg = q.arg.map(findMAC)
  return q
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

    let prefix = pretty(e1.arg[0]) // does this always work?
    let v = e1.arg[1].op
    usedCols[prefix] ??= {}
    usedCols[prefix][v] ??= {}
    usedCols[prefix][v][e2.op] = true
    if (preload) {
      usedCols[prefix]["preload_iter"] ??= {}
      usedCols[prefix]["preload_iter"][e2.op] = true
    }
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
          // throw new Error("Stateful op expected to have the same set of free variables as the current group path but got: " + q.fre + " and " + currentGroupPath.path)
        }

        assignmentToSym[i] = currentGroupPath.sym

        let dummy = { schema: { objValue: q.schema.type }, val: { ...tmpVars[currentGroupPath.sym].val, sym: i, values: {} } }
        hashmap.emitHashMapValueInit(prolog1, dummy, `_DEFAULT_`, q.schema.type, false)
        dummy.val.sym = currentGroupPath.sym
        tmpVars[i] = dummy
      }
    }
  }

  if (q.arg) {
    q.arg.map(x => collectRelevantStatefulInPath(x, currentGroupPath))
  }
}

let addHashMapBucket = (map, q, name, currentGroupPath) => {
  // group-by-array representation: nested array, linked buckets, or buckets (default)
  let initF, valueInitF
  if (nestedArrays) {
    initF = hashmap.emitHashMapNestedArrayInit
    valueInitF = hashmap.emitHashMapNestedArrayValuesInit
  } else if (linkedBuckets) {
    initF = hashmap.emitHashMapLinkedBucketsInit
    valueInitF = hashmap.emitHashMapLinkedBucketValuesInit
  } else {
    initF = hashmap.emitHashMapBucketsInit
    valueInitF = hashmap.emitHashMapBucketValuesInit
  }
  initF(prolog1, map, name, q.schema.type, initRequired(q))

  let bucket = map.val.values[name]
  let e = q.arg[0]
  if (typing.isUnknown(e.schema.type)) {
    valueInitF(prolog1, map, bucket, "_DEFAULT_", e.schema.type)
  } else if (typing.isObject(e.schema.type) && utils.isSimpleObject(e.schema.type)) {
    let values = utils.convertToArrayOfSchema(e.schema.type)
    for (let i in values) {
      let { name, schema } = values[i]
      valueInitF(prolog1, map, bucket, name, schema)
    }
  } else {
    valueInitF(prolog1, map, bucket, "_DEFAULT_", e.schema.type)
  }

  // the per-key array struct must be declared after its value fields are added
  if (nestedArrays) c.declareStruct(prolog0)(bucket.val.struct)
}

let addHashMapValue = (map, q, name, currentGroupPath) => {
  q = stripConverts(q)
  if (q.key != "ref") {
    throw new Error("stateful op expected but got " + pretty(q))
  }
  let q1 = assignments[q.op]
  if (q1.key == "update") {
    assignmentToSym[q.op] = currentGroupPath.sym
    updateOps[currentGroupPath.sym].push(q.op)
    q1.root = currentGroupPath.sym
    collectNestedHashMap(q, map, name, currentGroupPath)
  } else if (q1.key == "stateful" && q1.fre.length != 0) {
    if (!same(q1.fre, currentGroupPath.path)) {
      // throw new Error(`Stateful op expected to have the same set of free variables as the current group path but got: ${q1.fre} and ${currentGroupPath.path}`)
    }
    assignmentToSym[q.op] = currentGroupPath.sym
    updateOps[currentGroupPath.sym].push(q.op)
    q1.root = currentGroupPath.sym

    let sym = tmpSym(map.val.sym)
    if (q1.op == "array") {
      addHashMapBucket(map, q1, name, currentGroupPath)
    } else {
      hashmap.emitHashMapValueInit(prolog1, map, name, q.schema.type, initRequired(q1), sortedCols?.[sym]?.[name], prolog0)
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
  hashmap.emitNestedHashMapInit(prolog1, i, map, name, q.schema.type, keySchema)
  let nestedMap = map.val.values[name]
  let struct = nestedMap.val.struct

  let keyList = [e1]
  let valList = [e2]
  let curr = e0
  let dynamic = false
  while (curr.key != "const") {
    if (curr.key != "ref" && assignments[curr.op].key != "update")
      throw new Error("Can only extend result of another group op")
    let q1 = assignments[curr.op]
    // tmpVars[curr.op] = tmpVar
    keyList.push(q1.arg[1])
    valList.push(q1.arg[2])
    if (!typing.sameType(q1.arg[2].schema.type, e2.schema.type)) {
      console.log("hererererere", typing.prettyPrintType(q1.arg[2].schema.type), typing.prettyPrintType(e2.schema.type))
      dynamic = true
    }
    if (q1.arg[3]) {
      collectHashMapsInPath(q1.arg[3])
    }
    assignmentToSym[curr.op] = currentGroupPath.sym
    updateOps[currentGroupPath.sym].push(curr.op)
    q1.root = currentGroupPath.sym

    curr = q1.arg[0]
  }

  updateOps[i] = []

  if (dynamic) {
    usesYYJSON = true // dynamic values are self-managed yyjson_val; need the header + lib
    hashmap.emitHashMapDynamicValueInit(prolog1, nestedMap, "_DEFAULT_", undefined, true, false, prolog0)
    c.declareStruct(prolog0)(struct)
    return
  }

  currentGroupPath.path.push(e1.op)
  if (e2.key == "pure" && e2.op == "mkTuple") {
    for (let j = 0; j < e2.arg.length; j += 2) {
      let key = e2.arg[j]
      let val = e2.arg[j + 1]
      addHashMapValue(nestedMap, val, key.op, currentGroupPath)
    }
  } else {
    addHashMapValue(nestedMap, e2, "_DEFAULT_", currentGroupPath)
  }
  currentGroupPath.path.pop()
  // addHashMapValue(nestedMap, e2, "_DEFAULT_", currentGroupPath)

  c.declareStruct(prolog0)(struct)
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

  // Create hashmap
  let { htable, count, keys } = hashmap.emitHashMapInit(prolog1, i, keySchema)
  let tmpVar = value.hashmap(q.schema.type, i, htable, count, keys)
  tmpVars[i] = tmpVar

  let keyList = [e1]
  let valList = [e2]
  let curr = e0
  while (curr.key != "const") {
    if (curr.key != "ref" && assignments[curr.op].key != "update")
      throw new Error("Can only extend result of another group op")
    let q1 = assignments[curr.op]
    tmpVars[curr.op] = tmpVar
    keyList.push(q1.arg[1])
    valList.push(q1.arg[2])
    if (typing.sameType(q1.arg[2].schema.type, e2.schema.type)) {
      console.log("hererererere")
    }
    if (q1.arg[3]) {
      collectHashMapsInPath(q1.arg[3])
    }

    curr = q1.arg[0]
  }

  updateOps[i] = []

  {
  // for (let j in keyList) {
    let e1 = keyList[0]
    let e2 = valList[0]
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
  // }
  }

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

  if (!typing.isUnknown(e.schema.type) && typing.isObject(e.schema.type) && utils.isSimpleObject(e.schema.type)) {
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
    tmpVars[i].defined = `${sym}_defined`
    c.declareVar(prolog1)("uint8_t", `${sym}_defined`, "0")
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
      addMkset(f.arg[0], f.arg[1], val, data)
    } else {
      let data = []
      let lhs = emitPath(data, g1)
      let firstSeen = !vars[v1]
      vars[v1] ??= {}
      vars[v1].lhs ??= {}
      vars[v1].lhs[pretty(g1)] = lhs
      // Generate loops based on different types of left hand side values
      let schema = typing.removeTag(g1.schema.type)
      if (typing.isUnknown(schema)) {
        throw new Error("Cannot generate loop")
      }
      if (firstSeen) {
        vars[v1].val = value.primitive(schema.objKey || types.unknown, quoteVar(v1))
      }
      if (lhs.tag == TAG.CSV) {
        let getLoopTxtFunc = csv.getCSVLoopTxt(f, lhs, data, usedCols)
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
      } else if (lhs.tag == TAG.NDJSON) {
        let getLoopTxtFunc = json.getNDJSONLoopTxt(f, lhs, data)
        vars[v1].gen ??= {}
        vars[v1].gen[pretty(g1)] = value.json(schema.objValue, quoteVar(v1) + "_gen")
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
      } else if (lhs.tag == TAG.JSON) {
        if (typing.isNumber(schema.objKey)) {
          let getLoopTxtFunc = json.getJSONArrayLoopTxt(f, lhs, data)
          if (firstSeen) vars[v1].gen = value.json(schema.objValue, quoteVar(v1) + "_gen")
          addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
        } else {
          let getLoopTxtFunc = json.getJSONObjLoopTxt(f, lhs, data)
          if (firstSeen) vars[v1].val.tag = TAG.JSON
          addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
        }
      } else if (lhs.tag == TAG.ARRAY) {
        let getLoopTxtFunc = array.getArrayLoopTxt(f, lhs, data)
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
      } else if (lhs.tag == TAG.HASHMAP_LINKED_BUCKET) {
        let getLoopTxtFunc = hashmap.getHashMapLinkedBucketLoopTxt(f, lhs, data)
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
      } else if (lhs.tag == TAG.HASHMAP) {
        let key = hashmap.getHashMapKeyEntry(lhs, quoteVar(v1))
        if (firstSeen) {
          vars[v1].val = key
        }
        let getLoopTxtFunc = hashmap.getHashMapLoopTxt(f, lhs, [])
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
      } else if (lhs.tag == TAG.NESTED_HASHMAP) {
        let getLoopTxtFunc = hashmap.getHashMapLoopTxt(f, lhs, data)
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
      } else {
        throw new Error("Cannot have generator on non-iterable objects: " + lhs.tag)
      }

    }
  }
}

// Emit code that gets the current time
let emitGetTime = (buf) => {
  let timeval = symbol.getSymbol("timeval")
  c.stmt(buf)(`struct timeval ${timeval}`)

  c.stmt(buf)(c.call("gettimeofday", `&${timeval}`, "NULL"))

  let time = symbol.getSymbol("t")
  c.declareLong(buf)(time, c.add(c.mul(`${timeval}.tv_sec`, "1000000L"), `${timeval}.tv_usec`))

  return time
}

let emitCode = (q, ir, settings) => {
  reset(settings)

  filters = ir.filters
  assignments = ir.assignments

  // Fill with default prolog
  initializeProlog()

  // Get the used filters to optimize CSV reading
  collectUsedAndSortedCols(q)

  let t0 = emitGetTime(prolog1)

  // Collect hashmaps needed for the query and relevant stateful ops
  // collectHashMaps()
  collectHashMapsInPath(q)

  // Before we process the filters, we need to collect the arrays
  // We can also collect other stateful ops here
  collectOtherStatefulOps()

  // Process filters
  processFilters()

  let epilog = []

  let res = emitPath(epilog, q)

  if (res.cond) {
    c.if(epilog)(res.cond, buf1 => {
      c.printf(buf1)("undefined")
      c.return(buf1)("0")
    })
  }

  if (res.schema.typeSym != typeSyms.never)
    printEmitter.emitValPrint(epilog, res, settings)

  let t1 = emitGetTime(prolog1)
  // Return and close the main function
  c.stmt(epilog)(c.call("fflush", "stdout"))
  let t2 = emitGetTime(epilog)

  c.printErr(epilog)(`\\n\\nTiming:\\n\\tInitializaton:\\t%ld μs\\n\\tRuntime:\\t%ld μs\\n\\tTotal:\\t\\t%ld μs\\n`, c.sub(t1, t0), c.sub(t2, t1), c.sub(t2, t0))

  if (backend == "cuda") {
    c.stmt(epilog)(c.call("cublasDestroy", "handle"))
    c.stmt(epilog)(c.call("cusparseDestroy", "sparseHandle"))
  }
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
  resetSettings(settings)

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
      os.exec(cmd, (err, stdout, stderr) => {
        if (err) {
          reject(err)
        } else {
          resolve(stdout)
        }
      })
    })
  }

  let ext = settings.backend == "c" ? ".c" : ".cu"

  let cFile = joinPaths(outDir, outFile + ext)
  let out = joinPaths(outDir, outFile)
  let code = emitCode(q, ir, settings)

  let compiler = settings.backend == "c" ? (settings.compiler || "gcc") : "nvcc"
  let cFlags = settings.cFlags || "-Icgen-sql -O3"

  async function func() {
    let stdout = await sh(`./${out} `)
    return stdout
  }

  func.explain = {}

  let writeAndCompile = async () => {
    await fs.writeFile(cFile, code)
    if (inputFiles["json"] || inputFiles["ndjson"] || usesYYJSON) cFlags += " -Ithird-party/yyjson -Lthird-party/yyjson/out -lyyjson"
    if (backend == "cuda") cFlags += " -lcublas -lcusparse"
    let cmd = `${compiler} ${cFile} -o ${out} ${cFlags}`
    console.log("Executing: " + cmd)
    let time1 = performance.now()
    await sh(cmd)
    func.explain.time = time1
    return func
  }

  return writeAndCompile()
}

module.exports = { generateC, findMatmuls, findScaledMatmuls, findFullGemm, findDotProducts, findBatchedMatmuls, findMAC }





