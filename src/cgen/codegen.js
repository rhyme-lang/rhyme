const { c, utils } = require("./utils")
const { hashmap, array } = require("./collections")
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

// Stores mapping from vars to their binded values
let vars

// Stores tmp vars
let tmpVars

let visitedAssignments

let currentGroupPath

let preload
let linkedBuckets

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

  preload = settings.preload || false
  linkedBuckets = settings.linkedBuckets || false
}

let initializeProlog = () => {
  prolog0.push(`#include "rhyme-c.h"`)
  prolog0.push(`typedef int (*__compar_fn_t)(const void *, const void *);`)
  prolog1.push("int main() {")
}

// construct the prolog with prolog0 and prolog1
let finalizeProlog = () => {
  let prolog = [...prolog0, ...prolog1]
  if (inputFiles["json"] || inputFiles["ndjson"]) {
    // include necessary header if we loaded in any JSON file
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
      c.stmt(buf)(c.assign(lhs.val.count, "0"))
    }
  } else if (q.key == "update") {
    hashmap.emitNestedHashMapAllocation(buf, lhs)
  } else {
    throw new Error("stateful op not supported: " + pretty(q))
  }
}

let emitStatefulUpdate1 = (buf, q, lhs, rhs) => {
  if (rhs.tag == TAG.JSON) {
    let schema = q.op == "array" ? q.schema.type.objValue : q.schema.type
    rhs = json.convertJSONTo(rhs, schema)
  }
  if (q.mode == "maybe") {
    c.if(buf)(c.not(lhs.defined), (buf1) => {
      c.stmt(buf)(c.assign(lhs.defined, "1"))
      emitStatefulInit(buf1, q, lhs)
    })
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
            while (val.key == "pure" && val.op.startsWith("convert_")) {
              val = val.arg[0]
            }
            emitStateful1(val, map, buf1)
            currentGroupPath.path.pop()
          }
        })

      } else {
        while (e2.key == "pure" && e2.op.startsWith("convert_")) {
          e2 = e2.arg[0]
        }
        emitStateful1(e2, map)
      }

      currentGroupPath = save
    } else {
      // nested hashmap
      if (currentGroupPath.path.every((e) => e.key == "const" || q.fre.indexOf(e.op) >= 0)) {
        // console.log("correlated")
      } else {
        throw new Error("Not correlated")
      }
      let rootSym = tmpSym(currentGroupPath.root)
      if (!map) throw new Error("Something went wrong")

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
            while (val.key == "pure" && val.op.startsWith("convert_")) {
              val = val.arg[0]
            }
            emitStateful1(val, map, buf1)
            currentGroupPath.path.pop()
          }
        })
        // throw new Error("Not supported yet")
      } else {
        while (e2.key == "pure" && e2.op.startsWith("convert_")) {
          e2 = e2.arg[0]
        }
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
        throw new Error("Not correlated")
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
        let v = "preload_iter"
        let count = array.emitArrayInit(prolog1, sym)
        let arr = value.array(q.schema.type, sym, count)
        let doc = symbol.getSymbol("tmp_doc")
        let name = "_DEFAULT_"
        arr.val.values ??= {}
        arr.val.values[name] = { val: `${sym}_${name}`, schema: q.schema.type.objValue, tag: TAG.JSON }

        array.allocateYYJSONBuffer(prolog1, `${sym}_${name}`)
        prolog1.push(`for (int ${v} = 0; ${cursor} < ${size}; ${v}++) {`)
        c.declarePtr(prolog1)("yyjson_doc", doc, c.call("yyjson_read_opts", c.add(mappedFile, cursor), c.sub(size, cursor), "YYJSON_READ_INSITU | YYJSON_READ_STOP_WHEN_DONE", "NULL", "NULL"))

        c.if(prolog1)(c.not(doc), buf2 => {
          c.break(buf2)()
        })

        c.stmt(prolog1)(c.assign(`${sym}_${name}[preload_iter]`, c.call("yyjson_doc_get_root", doc)))
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
        if (typing.isNumber(e1.schema.type.objKey))
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

  if (v1.tag == TAG.HASHMAP) {
    // HashMap lookup
    let key = emitPath(buf, e2)
    let [pos, keyPos] = hashmap.emitHashLookUp(buf, v1, key)
    // The value is undefined if keyPos == 0
    // emitPath will not handle undefined values
    // It is up to the top-level caller of emitPath how undefined is handled
    let value = hashmap.getHashMapValueEntry(v1, pos, keyPos)
    // value.cond = c.eq(keyPos, "-1")
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
          throw new Error("Stateful op expected to have the same set of free variables as the current group path but got: " + q.fre + " and " + currentGroupPath.path)
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
  let initF = linkedBuckets ? hashmap.emitHashMapLinkedBucketsInit : hashmap.emitHashMapBucketsInit
  let valueInitF = linkedBuckets ? hashmap.emitHashMapLinkedBucketValuesInit : hashmap.emitHashMapBucketValuesInit
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
    assignmentToSym[q.op] = currentGroupPath.sym
    updateOps[map.val.sym].push(q.op)
    q1.root = currentGroupPath.sym
    collectNestedHashMap(q, map, name, currentGroupPath)
  } else if (q1.key == "stateful" && q1.fre.length != 0) {
    if (!same(q1.fre, currentGroupPath.path)) {
      throw new Error("Stateful op expected to have the same set of free variables as the current group path but got: " + q1.fre + " and " + currentGroupPath.path)
    }
    assignmentToSym[q.op] = currentGroupPath.sym
    updateOps[map.val.sym].push(q.op)
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

  updateOps[i] = []

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
    if (q1.arg[3])
      collectHashMapsInPath(q1.arg[3])

    curr = q1.arg[0]
  }

  updateOps[i] = []

  for (let j in keyList) {
    let e1 = keyList[j]
    let e2 = valList[j]
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
      if (typing.isUnknown(g1.schema.type)) {
        throw new Error("Cannot generate loop")
      }
      if (firstSeen) {
        vars[v1].val = value.primitive(g1.schema.type.objKey || types.unknown, quoteVar(v1))
      }
      if (lhs.tag == TAG.CSV) {
        let getLoopTxtFunc = csv.getCSVLoopTxt(f, lhs, data, usedCols)
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
      } else if (lhs.tag == TAG.NDJSON) {
        let getLoopTxtFunc = json.getNDJSONLoopTxt(f, lhs, data)
        vars[v1].gen ??= {}
        vars[v1].gen[pretty(g1)] = value.json(g1.schema.type.objValue, quoteVar(v1) + "_gen")
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
      } else if (lhs.tag == TAG.JSON) {
        if (typing.isNumber(g1.schema.type.objKey)) {
          let getLoopTxtFunc = json.getJSONArrayLoopTxt(f, lhs, data)
          if (firstSeen) vars[v1].gen = value.json(g1.schema.type.objValue, quoteVar(v1) + "_gen")
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
      os.exec(cmd, (err, stdout, stderr) => {
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

  func.explain = {}

  let writeAndCompile = async () => {
    await fs.writeFile(cFile, codeNew)
    if (inputFiles["json"] || inputFiles["ndjson"]) cFlags += " -Ithird-party/yyjson -Lthird-party/yyjson/out -lyyjson"
    let cmd = `gcc ${cFile} -o ${out} ${cFlags}`
    console.log("Executing: " + cmd)
    let time1 = performance.now()
    await sh(cmd)
    func.explain.time = time1
    return func
  }

  return writeAndCompile()
}

module.exports = { generateC }
