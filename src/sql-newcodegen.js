const { generate } = require('./new-codegen')
const { typing, typeSyms, types } = require('./typing')
const { pretty } = require('./prettyprint')
const { sets } = require('./shared')

const { unique, union } = sets

// C value representation:
// Primitive value: { schema, val }
// String: { schema, val: { str, len } }
// Array: { schema, val: { dataCount, arr }, tag: "array" }
// HashMap: { schema, val, tag: "hashMap" }
// HashMap value (can be either primitive or string): { schema, val, tag: "hashMapValue" }
// HashMap bucket: { schema, val: { dataCount, bucketCount, buckets, valArray, valSchema }, tag: "hashMapBucket" }
// Object: { schema: [...], val: { <key>: <val>, ... }, tag: "object" }
// File input: { schema, val: mappedFile, tag: "inputFile" }
// C values will have a keyPos property if it is a result from hash lookup

const KEY_SIZE = 16777216
const HASH_SIZE = KEY_SIZE

const BUCKET_SIZE = 8
const DATA_SIZE = KEY_SIZE * BUCKET_SIZE

const HASH_MASK = HASH_SIZE - 1

const ARRAY_SIZE = 2048

let filters
let assignments
let inputFilesEnv
let usedCols
let sortedCols
let mksetVarEnv
let mksetVarDeps
let hashMapEnv
let arrayEnv

let assignmentStms
let generatorStms
let tmpVarWriteRank

let emittedStateful

let currentGroupKey

let assignmentToSym
let updateOps
let updateOpsExtra

let loopInfo

// generator ir api: mirroring necessary bits from ir.js
let expr = (txt, ...args) => ({ txt, deps: args })

let trans = ps => unique([...ps, ...ps.flatMap(x => mksetVarDeps[x])])

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

let addGenerator = (e1, e2, getLoopTxtFunc) => {
  let a = getDeps(e1)
  let b = getDeps(e2)
  let e = expr("FOR", ...a)
  e.sym = b[0]
  e.getLoopTxt = getLoopTxtFunc
  generatorStms.push(e)
}

let addMkset = (e1, e2, data) => {
  let a = getDeps(e1)
  let b = getDeps(e2)
  let e = expr("MKSET", ...a)
  e.sym = b[0]
  mksetVarDeps[e.sym] = a
  let info = [`// generator: ${e2.op} <- ${pretty(e1)}`]
  e.getLoopTxt = () => ({
    info, data, initCursor: [], loopHeader: ["{", "// singleton value here"], boundsChecking: [], rowScanning: []
  })
  generatorStms.push(e)
}

let getDeps = q => [...q.fre, ...q.tmps.map(tmpSym)]

let tmpSym = i => "tmp" + i

let quoteVar = s => s.replaceAll("*", "x")

let nameIdMap = {}
let getNewName = (prefix) => {
  nameIdMap[prefix] ??= 0
  let name = prefix + nameIdMap[prefix]
  nameIdMap[prefix] += 1
  return name
}

let initRequired = {
  "sum": true,
  "prodcut": true,
  "min": true,
  "max": true,
  "count": true,
  "array": true,
}


let ctypeMap = {
  // any:  "rh",
  // never:"rh",
  // boolean:  "rh",
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
  date: "d"
}

let convertToCType = (type) => {
  if (type.typeSym === "dynkey")
    return convertToCType(type.keySuperkey)
  if (type.typeSym === "union")
    throw new Error("Unable to convert union type to C type currently: " + typing.prettyPrintType(type))
  if (type.typeSym in ctypeMap)
    return ctypeMap[type.typeSym]
  throw new Error("Unknown type: " + typing.prettyPrintType(type))
}

let getFormatSpecifier = (type) => {
  if (type.typeSym === "dynkey")
    return getFormatSpecifier(type.keySuperkey)
  if (type.typeSym === "union")
    throw new Error("Unable to get type specifier for union tpyes currently: " + typing.prettyPrintType(type))
  if (type.typeSym in formatSpecifierMap)
    return formatSpecifierMap[type.typeSym]
  throw new Error("Unknown type: " + typing.prettyPrintType(type))
}

//
// helper functions for generating C code strings
//
let cgen = {
  // expressions
  cast: (type, expr) => `(${type})${expr}`,

  inc: (expr) => expr + "++",

  binary: (lhs, rhs, op) => `${lhs} ${op} ${rhs}`,
  ternary: (cond, tVal, fVal) => `${cond} ? ${tVal} : ${fVal}`,

  assign: (lhs, rhs) => cgen.binary(lhs, rhs, "="),

  plus: (lhs, rhs) => cgen.binary(lhs, rhs, "+"),
  minus: (lhs, rhs) => cgen.binary(lhs, rhs, "-"),

  mul: (lhs, rhs) => cgen.binary(lhs, rhs, "*"),
  div: (lhs, rhs) => cgen.binary(lhs, rhs, "/"),

  and: (lhs, rhs) => cgen.binary(lhs, rhs, "&&"),
  or: (lhs, rhs) => cgen.binary(lhs, rhs, "||"),
  equal: (lhs, rhs) => cgen.binary(lhs, rhs, "=="),
  notEqual: (lhs, rhs) => cgen.binary(lhs, rhs, "!="),

  lt: (lhs, rhs) => cgen.binary(lhs, rhs, "<"),
  gt: (lhs, rhs) => cgen.binary(lhs, rhs, ">"),

  le: (lhs, rhs) => cgen.binary(lhs, rhs, "<="),
  ge: (lhs, rhs) => cgen.binary(lhs, rhs, ">="),

  call: (f, ...args) => `${f}(${args.join(", ")})`,

  malloc: (type, n) => cgen.call("malloc", `sizeof(${type}) * ${n}`),
  calloc: (type, n) => cgen.call("calloc", n, `sizeof(${type})`),
  open: (file) => cgen.call("open", file, 0),
  close: (fd) => cgen.call("close", fd),

  mmap: (fd, size) => cgen.call("mmap", 0, size, "PROT_READ", "MAP_FILE | MAP_SHARED", fd, 0),

  // statements
  comment: (buf) => (s) => buf.push("// " + s),
  stmt: (buf) => (expr) => buf.push(expr + ";"),

  declareVar: (buf) => (type, name, init, constant = false) => buf.push((constant ? "const " : "") + type + " " + name + (init ? ` = ${init};` : ";")),
  declareArr: (buf) => (type, name, len, init, constant = false) => buf.push((constant ? "const " : "") + `${type} ${name}[${len}]` + (init ? ` = ${init};` : ";")),
  declarePtr: (buf) => (type, name, init, constant = false) => buf.push((constant ? "const " : "") + `${type} *${name}` + (init ? ` = ${init};` : ";")),
  declarePtrPtr: (buf) => (type, name, init, constant = false) => buf.push((constant ? "const " : "") + `${type} **${name}` + (init ? ` = ${init};` : ";")),

  declareInt: (buf) => (name, init) => cgen.declareVar(buf)("int", name, init),
  declareLong: (buf) => (name, init) => cgen.declareVar(buf)("long", name, init),
  declareULong: (buf) => (name, init) => cgen.declareVar(buf)("unsigned long", name, init),
  declareCharArr: (buf) => (name, len, init) => cgen.declareArr(buf)("char", name, len, init),
  declareIntPtr: (buf) => (name, init) => cgen.declarePtr(buf)("int", name, init),
  declareCharPtr: (buf) => (name, init) => cgen.declarePtr(buf)("char", name, init),
  declareConstCharPtr: (buf) => (name, init) => cgen.declarePtr(buf)("char", name, init, true),
  declareCharPtrPtr: (buf) => (name, init) => cgen.declarePtrPtr(buf)("char", name, init),

  declareStruct: (buf) => (structName, valSchema) => {
    buf.push(`struct ${structName} {`)
    for (let i in valSchema) {
      let { name, schema } = valSchema[i]
      if (typing.isObject(schema)) {
        continue
      }
      if (name == "_DEFAULT_") name = "value"
      if (typing.isString(schema)) {
        cgen.declareCharPtr(buf)(name + "_str")
        cgen.declareInt(buf)(name + "_len")
      } else {
        cgen.declareVar(buf)(convertToCType(schema), name)
      }
    }
    buf.push(`};`)
  },

  printErr: (buf) => (fmt, ...args) => buf.push(cgen.call("fprintf", "stderr", fmt, ...args) + ";"),

  if: (buf) => (cond, tBranch, fBranch) => {
    buf.push(`if (${cond}) {`)
    tBranch(buf)
    if (fBranch) {
      buf.push("} else {")
      fBranch(buf)
    }
    buf.push("}")
  },

  while: (buf) => (cond, body) => {
    buf.push(`while (${cond}) {`)
    body(buf)
    buf.push("}")
  },

  while1: (buf) => (cond, body) => {
    buf.push(`while (${cond}) ${body};`)
  },

  continue: (buf) => () => buf.push("continue;"),
  break: (buf) => () => buf.push("break;"),
  return: (buf) => (expr) => buf.push(`return ${expr};`)
}

let binaryOperators = {
  equal: "==",
  notEqual: "!=",

  lessThan: "<",
  greaterThan: ">",

  lessThanOrEqual: "<=",
  greaterThanOrEqual: ">=",

  plus: "+",
  minus: "-",
  times: "*",
  fdiv: "/",
  div: "/",
  mod: "%",

  andAlso: "&&",
  orElse: "||"
}

// Extract all the used columns.
// e.g. if an integer column is used, it will be extracted
// while we scan through each row in the csv.
//
// This makes sure that if we want to use the variable,
// it will be available in the scope.
let extractUsedAndSortedCols = (q) => {
  if (q.key == "get") {
    let [e1, e2] = q.arg

    let isCsvColumn = e1.key == "get" && e1.arg[0].key == "loadInput" && e1.arg[1].key == "var" &&
      e2.key == "const" && typeof e2.op == "string"

    if (!isCsvColumn) {
      extractUsedAndSortedCols(e1)
      extractUsedAndSortedCols(e2)
      return
    }

    // extract used columns for the filename
    extractUsedAndSortedCols(e1.arg[0].arg[0])

    let prefix = pretty(e1) // does this always work?
    usedCols[prefix] ??= {}
    usedCols[prefix][e2.op] = true
  } else if (q.key == "ref") {
    let q1 = assignments[q.op]
    extractUsedAndSortedCols(q1)
  } else if (q.key == "update") {
    // only allow a single update without
    // extending result objects of other update ops
    if (q.arg[0].key != "const" || Object.keys(q.arg[0].op).length != 0) {
      throw new Error("Cannot extend non-empty objects " + pretty(q))
    }
    if (q.arg[3] == undefined) {
      throw new Error("Trivial group op not supported for now: " + pretty(q))
    }

    let [_e1, _e2, e3, e4] = q.arg

    extractUsedAndSortedCols(e3)
    extractUsedAndSortedCols(e4.arg[0].arg[0])
  } else if (q.key == "pure" && q.op == "sort") {
    // if a column is used for sorting,
    // we need to define it as a global array
    // so that it is accessbile to the comparison function
    let columns = q.arg.slice(0, -1)
    extractUsedAndSortedCols(q.arg[q.arg.length - 1])
    sortedCols[tmpSym(q.arg[q.arg.length - 1].op)] ??= {}
    for (let i = 0; i < columns.length; i += 2) {
      let column = columns[i]
      let order = columns[i + 1]

      sortedCols[tmpSym(q.arg[q.arg.length - 1].op)][column.op] = true

      if (!(column.key == "const" && typeof column.op == "string")) {
        throw new Error("Invalid column for sorting: " + pretty(column))
      }
      if (!(order.key == "const" && typeof order.op == "number" && (order.op == 0 || order.op == 1))) {
        throw new Error("Invalid order for sorting: " + pretty(order))
      }
    }
  } else if (q.arg) {
    q.arg.map(extractUsedAndSortedCols)
  }
}

// Emit code that gets the current time
let emitGetTime = (buf) => {
  let timeval = getNewName("timeval")
  cgen.stmt(buf)(`struct timeval ${timeval}`)

  cgen.stmt(buf)(cgen.call("gettimeofday", `&${timeval}`, "NULL"))

  let time = getNewName("t")
  cgen.declareLong(buf)(time, cgen.plus(cgen.mul(`${timeval}.tv_sec`, "1000000L"), `${timeval}.tv_usec`))

  return time
}

// Emit code that opens the CSV file and calls mmap
let emitLoadInput = (buf, filename, id) => {
  let fd = "fd" + id
  let mappedFile = "file" + id
  let size = "n" + id
  cgen.declareInt(buf)(fd, cgen.open(filename))
  cgen.if(buf)(cgen.binary(fd, "-1", "=="), buf1 => {
    cgen.printErr(buf1)(`"Unable to open file %s\\n"`, filename)
    cgen.return(buf1)("1")
  })
  cgen.declareInt(buf)(size, cgen.call("fsize", fd))
  cgen.declareCharPtr(buf)(mappedFile, cgen.mmap(fd, size))
  cgen.stmt(buf)(cgen.close(fd))

  return { mappedFile, size }
}

// Calculate the hash value for a set of keys
let hash = (buf, keys, keySchema) => {
  let hashed = getNewName("hash")
  cgen.declareULong(buf)(hashed, "0")

  for (let i in keys) {
    let key = keys[i]
    let schema = keySchema[i]
    let tmpHash = getNewName("tmp_hash")

    if (typing.isString(schema)) {
      cgen.declareULong(buf)(tmpHash, cgen.call("hash", key.val.str, key.val.len))
    } else if (typing.isNumber(schema) || schema.typeSym == typeSyms.date) {
      cgen.declareULong(buf)(tmpHash, cgen.cast("unsigned long", key.val))
    } else {
      throw new Error("Cannot hash key with type " + typing.prettyPrintType(schema))
    }

    cgen.stmt(buf)(cgen.binary(hashed, "8", "<<"))
    cgen.stmt(buf)(cgen.binary(hashed, tmpHash, "+="))
  }

  return hashed
}

// Emit the code that finds the key in the hashmap.
// Linear probing is used for resolving collisions.
// Comparison of keys is based on different key types.
// The actual storage of the values / data does not affect the lookup
let emitHashLookUp = (buf, sym, keys) => {
  let { keySchema } = hashMapEnv[sym]
  let hashed = hash(buf, keys, keySchema)

  let pos = getNewName("pos")
  cgen.declareULong(buf)(pos, cgen.binary(hashed, HASH_MASK, "&"))

  let keyPos = `${sym}_htable[${pos}]`

  let compareKeys = undefined

  for (let i in keys) {
    let key = keys[i]
    let schema = keySchema[i]

    if (typing.isString(schema)) {
      let keyStr = `${sym}_keys_str${i}[${keyPos}]`
      let keyLen = `${sym}_keys_len${i}[${keyPos}]`

      let { str, len } = key.val
      let comparison = cgen.notEqual(cgen.call("compare_str2", keyStr, keyLen, str, len), "0")
      compareKeys = compareKeys ? cgen.or(compareKeys, comparison) : comparison
    } else {
      let comparison = cgen.notEqual(`${sym}_keys${i}[${keyPos}]`, key.val)
      compareKeys = compareKeys ? cgen.or(compareKeys, comparison) : comparison
    }

  }

  // increment the position until we find a match or an empty slot
  cgen.while(buf)(
    cgen.and(cgen.notEqual(keyPos, "-1"), "(" + compareKeys + ")"),
    buf1 => {
      cgen.stmt(buf1)(cgen.assign(pos, cgen.binary("(" + cgen.plus(pos, "1") + ")", HASH_MASK, "&")))
    }
  )

  keyPos = getNewName("key_pos")
  cgen.declareInt(buf)(keyPos, `${sym}_htable[${pos}]`)

  return [pos, keyPos]
}

// Skip the column until the delimiter is found
let scanColumn = (buf, mappedFile, cursor, size, delim) => {
  cgen.while1(buf)(
    cgen.notEqual(`${mappedFile}[${cursor}]`, delim),
    cgen.inc(cursor)
  )
  cgen.stmt(buf)(cgen.inc(cursor))
}

// Scan the column and store the start and end position
let scanString = (buf, mappedFile, cursor, size, delim, start, end) => {
  cgen.declareInt(buf)(start, cursor)
  cgen.while1(buf)(
    cgen.notEqual(`${mappedFile}[${cursor}]`, delim),
    cgen.inc(cursor)
  )
  cgen.declareInt(buf)(end, cursor)
  cgen.stmt(buf)(cgen.inc(cursor))
}

// Scan the column and calculate the integer value
let scanInteger = (buf, mappedFile, cursor, size, delim, name, type) => {
  cgen.declareVar(buf)(convertToCType(type), name, "0")
  cgen.while(buf)(
    cgen.notEqual(`${mappedFile}[${cursor}]`, delim),
    buf1 => {
      cgen.comment(buf1)("extract integer")
      cgen.stmt(buf1)(cgen.assign(name, cgen.plus(cgen.mul(name, "10"), cgen.minus(`${mappedFile}[${cursor}]`, "'0'"), "+")))
      cgen.stmt(buf1)(cgen.inc(cursor))
    }
  )
  cgen.stmt(buf)(cgen.inc(cursor))
}

// Scan the column and calculate the decimal value
let scanDecimal = (buf, mappedFile, cursor, size, delim, name, type) => {
  let number = getNewName("number")
  let scale = getNewName("scale")

  cgen.declareLong(buf)(number, "0")
  cgen.declareLong(buf)(scale, "1")

  // calculate integer part
  cgen.while(buf)(
    cgen.and(
      cgen.notEqual(`${mappedFile}[${cursor}]`, "'.'"),
      cgen.notEqual(`${mappedFile}[${cursor}]`, delim),
    ),
    buf1 => {
      cgen.comment(buf1)("extract integer part")
      cgen.stmt(buf1)(cgen.assign(number, cgen.plus(cgen.mul(number, "10"), cgen.minus(`${mappedFile}[${cursor}]`, "'0'"), "+")))
      cgen.stmt(buf1)(cgen.inc(cursor))
    }
  )

  // check if we have a dot after integer part
  cgen.if(buf)(
    cgen.equal(`${mappedFile}[${cursor}]`, "'.'"),
    buf1 => {
      cgen.stmt(buf1)(cgen.inc(cursor))
      cgen.while(buf1)(
        cgen.notEqual(`${mappedFile}[${cursor}]`, delim),
        buf2 => {
          cgen.comment(buf2)("extract fractional part")
          cgen.stmt(buf1)(cgen.assign(number, cgen.plus(cgen.mul(number, "10"), cgen.minus(`${mappedFile}[${cursor}]`, "'0'"), "+")))
          cgen.stmt(buf1)(cgen.assign(scale, cgen.mul(scale, "10")))
          cgen.stmt(buf2)(cgen.inc(cursor))
        }
      )
    }
  )
  cgen.declareVar(buf)(convertToCType(type), name,
    cgen.div(cgen.cast("double", number), scale)
  )
  cgen.stmt(buf)(cgen.inc(cursor))
}

// Scan the column and calculate the date value
let scanDate = (buf, mappedFile, cursor, size, delim, name) => {
  // unrolled loop
  let digits = [
    `${mappedFile}[${cursor}]`,
    `${mappedFile}[${cursor} + 1]`,
    `${mappedFile}[${cursor} + 2]`,
    `${mappedFile}[${cursor} + 3]`,
    ,
    `${mappedFile}[${cursor} + 5]`,
    `${mappedFile}[${cursor} + 6]`,
    ,
    `${mappedFile}[${cursor} + 8]`,
    `${mappedFile}[${cursor} + 9]`,
  ]
  cgen.declareVar(buf)("int32_t", name,
    `(((((((${digits[0]} * 10 + ${digits[1]}) * 10 + ${digits[2]}) * 10 + ${digits[3]}) * 10 + ${digits[5]}) * 10 + ${digits[6]}) * 10 + ${digits[8]}) * 10 + ${digits[9]}) - 533333328`
  )
  cgen.stmt(buf)(cgen.binary(cursor, "11", "+="))
}

// Emit code that scans through each row in the CSV file.
// Will extract the value of a column if the column is used by the query.
let emitRowScanning = (f, file, cursor, schema, first = true) => {
  let getDelim = (format, first) => {
    if (format == "csv") {
      return first ? "'\\n'" : "','"
    } else if (format == "tbl") {
      return "'|'"
    }
  }

  if (schema.objKey === null)
    return []
  let buf = []
  let v = f.arg[1].op
  let { mappedFile, size, format } = inputFilesEnv[file]

  let colName = schema.objKey
  let type = schema.objValue
  let prefix = pretty(f)
  let used = usedCols[prefix] && usedCols[prefix][colName]

  cgen.comment(buf)(`reading column ${colName}`)

  let name = [mappedFile, quoteVar(v), colName].join("_")
  let start = name + "_start"
  let end = name + "_end"

  let delim = getDelim(format, first)

  if (used) {
    if (typing.isInteger(type)) {
      scanInteger(buf, mappedFile, cursor, size, delim, name, type)
    } else if (type.typeSym === typeSyms.f32 || type.typeSym === typeSyms.f64) {
      scanDecimal(buf, mappedFile, cursor, size, delim, name, type)
    } else if (type.typeSym == typeSyms.date) {
      scanDate(buf, mappedFile, cursor, size, delim, name)
    } else {
      scanString(buf, mappedFile, cursor, size, delim, start, end)
    }
  } else if (type.typeSym == typeSyms.date) {
    cgen.stmt(buf)(cgen.binary(cursor, "11", "+="))
  } else {
    scanColumn(buf, mappedFile, cursor, size, delim)
  }

  // consume the newline character for tbl
  if (first && format == "tbl") cgen.stmt(buf)(cgen.inc(cursor))

  return [...emitRowScanning(f, file, cursor, schema.objParent, false), ...buf]
}

// The getLoopTxt functions return functions that will be invoked during the actual code generation
// It requests a new cursor name every time it is invoked
let getCSVLoopTxt = (f, file, loadInput) => () => {
  let v = f.arg[1].op
  let { mappedFile, size, format } = inputFilesEnv[file]

  let initCursor = []

  let info = [`// generator: ${v} <- ${pretty(f.arg[0])}`]

  let cursor = getNewName("i")
  cgen.declareInt(initCursor)(cursor, "0")

  // for csv files, skip the schema line
  if (format == "csv") {
    cgen.while(initCursor)(
      cgen.and(
        cgen.lt(cursor, size),
        cgen.notEqual(`${mappedFile}[${cursor}]`, "'\\n'")
      ),
      buf1 => cgen.stmt(buf1)(cgen.inc(cursor))
    )
    cgen.stmt(initCursor)(cgen.inc(cursor))
  }

  let loopHeader = []
  // cgen.stmt(loopHeader)(cgen.assign(quoteVar(v), "-1"))
  loopHeader.push("while (1) {")
  // cgen.stmt(loopHeader)(cgen.inc(quoteVar(v)))

  let boundsChecking = [`if (${cursor} >= ${size}) break;`]

  let schema = f.schema.type
  let rowScanning = emitRowScanning(f, file, cursor, schema)

  return {
    info, data: loadInput, initCursor, loopHeader, boundsChecking, rowScanning
  }
}

let getHashMapLoopTxt = (f, sym) => () => {
  let v = f.arg[1].op

  let initCursor = []

  let info = [`// generator: ${v} <- ${pretty(f.arg[0])}`]

  let loopHeader = []

  loopHeader.push(`for (int ${quoteVar(v)} = 0; ; ${quoteVar(v)}++) {`)

  let boundsChecking = []
  boundsChecking.push(`if (${quoteVar(v)} >= ${sym}_key_count) break;`)

  return {
    info, data: [], initCursor, loopHeader, boundsChecking, rowScanning: []
  }
}

let getHashBucketLoopTxt = (f, bucket, dataBuf) => () => {
  let v = f.arg[1].op

  let initCursor = []

  let info = [`// generator: ${v} <- ${pretty(f.arg[0])}`]

  let loopHeader = []

  loopHeader.push(`for (int ${quoteVar(v)} = 0; ; ${quoteVar(v)}++) {`)

  let boundsChecking = []
  boundsChecking.push(`if (${quoteVar(v)} >= ${bucket.val.bucketCount}) break;`)

  return {
    info, data: dataBuf, initCursor, loopHeader, boundsChecking, rowScanning: []
  }
}

let convertToArrayOfSchema = (schema) => {
  if (schema.objKey === null) {
    return []
  }
  return [...convertToArrayOfSchema(schema.objParent), { name: schema.objKey, schema: schema.objValue }]
}

// Get the value representing the tmp variable with name sym
let getTmpVarValue = (q, sym) => {
  if (q.key == "update") {
    console.assert(hashMapEnv[sym] !== undefined)
    return { schema: q.schema, val: { sym }, tag: "hashMap" }
  } else if (q.op == "array") {
    console.assert(arrayEnv[sym] !== undefined)
    let arr
    if (typing.isObject(arrayEnv[sym].valSchema)) {
      arr = {}
      objSchema = convertToArrayOfSchema(arrayEnv[sym].valSchema)
      for (let j in objSchema) {
        let { name, schema } = objSchema[j]

        if (typing.isObject(schema)) {
          throw new Error("Not supported")
        } else if (typing.isString(schema)) {
          arr[name] = { str: `${sym}_${name}_str`, len: `${sym}_${name}_len` }
        } else {
          arr[name] = `${sym}_${name}`
        }
      }
    } else if (typing.isString(arrayEnv[sym].valSchema)) {
      arr = { str: `${sym}_str`, len: `${sym}_len` }
    } else {
      arr = sym
    }

    return {
      schema: q.schema.type, val: { sym, arr, dataCount: `${sym}_count` }, tag: "array"
    }
  } else if (typing.isString(q.schema)) {
    return { schema: q.schema, val: { str: `${sym}_count`, len: `${sym}_len` } }
  } else {
    return { schema: q.schema, val: sym }
  }
}

// Generate code for paths
// returns the value of the path
let emitPath = (buf, q) => {
  if (q.key == "loadInput") {
    let file = q.arg[0]
    let filename
    if (file.key == "const" && typeof file.op == "string") {
      filename = file.op
    } else {
      filename = pretty(file)
    }

    return { schema: q.schema, val: inputFilesEnv[filename], tag: "inputFile" }
  } else if (q.key == "const") {
    if (typeof q.op == "number") {
      return { schema: q.schema, val: String(q.op) }
    } else if (typeof q.op == "string") {
      // const string is represented as a const char pointer
      let name = getNewName("tmp_str")
      cgen.declareConstCharPtr(buf)(name, '"' + q.op + '"')
      return { schema: q.schema, val: { str: name, len: q.op.length } }
    } else {
      throw new Error("Constant not supported: " + pretty(q))
    }
  } else if (q.key == "var") {
    throw new Error("Cannot have stand-alone var")
  } else if (q.key == "ref") {
    let q1 = assignments[q.op]
    let sym = tmpSym(q.op)

    if (q1.fre.length > 0) {
      // For stateful in path with free vars
      // We need the free var to be the same as the current group key
      console.assert(currentGroupKey.key == q1.fre[0])
      // We can directly use the pos and keyPos
      // without doing a hash lookup
      let value = getHashMapValueEntry(sym, currentGroupKey.pos, currentGroupKey.keyPos)
      // must be a simple hash value
      console.assert(value.tag == "hashMapValue")
      return value
    } else {
      // If no free vars, we need to emit the code
      if (q1.key == "stateful" && !emittedStateful[sym]) {
        emitStatefulInPath(q1, sym)
      }
      return getTmpVarValue(q1, sym)
    }
  } else if (q.key == "get") {
    let [e1, e2] = q.arg

    if (e2.key == "var") {
      // We don't want to generate code for getting the data again since we already got the loop info
      let g1 = loopInfo[e2.op][pretty(e1)]
      if (g1 === undefined) {
        throw new Error("The correctponding loop as not been seen")
      }

      if (g1.tag == "inputFile") {
        // If we are getting a var from a file,
        // return the object representing a record in the file
        let schema = convertToArrayOfSchema(g1.schema.type.objValue)
        let val = {}
        schema.map(keyVal => {
          let valName = g1.val.mappedFile + "_" + quoteVar(e2.op) + "_" + keyVal.name
          if (typing.isString(keyVal.schema)) {
            let start = valName + "_start"
            let end = valName + "_end"
            val[keyVal.name] = { schema: keyVal.schema, val: { str: cgen.plus(g1.val.mappedFile, start), len: cgen.minus(end, start) } }
          } else {
            val[keyVal.name] = { schema: keyVal.schema, val: valName }
          }
        })
        return { schema, val, tag: "object" }
      } else if (g1.tag == "hashMap") {
        // If we are iterating over a hashMap,
        // get the entry directly using the var
        return getHashMapValueEntry(g1.val.sym, undefined, quoteVar(e2.op))
      } else if (g1.tag == "hashMapBucket") {
        // If we are iterating over a hashMap bucket,
        // get the stored loop info
        bucket = g1
        let dataPos = `${bucket.val.buckets}[${cgen.plus(cgen.mul(bucket.keyPos, BUCKET_SIZE), quoteVar(e2.op))}]`

        if (typing.isObject(bucket.schema.objValue)) {
          let schema = convertToArrayOfSchema(bucket.schema.objValue)
          let res = { schema, val: {}, tag: "object" }
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
    let v1 = emitPath(buf, e1)

    if (v1.tag == "hashMap") {
      // HashMap lookup
      let sym = tmpSym(e1.op)
      let key = emitPath(buf, e2)
      let [pos, keyPos] = emitHashLookUp(buf, sym, [key])
      let { keySchema, valSchema } = hashMapEnv[sym]
      if (keySchema.length > 1) {
        throw new Error("not supported for now")
      }
      let value = getHashMapValueEntry(sym, pos, keyPos)
      return value
    }

    if (v1.tag == "array") {
      if (!(e2.key == "const" && typeof e2.op == "number")) {
        throw new Error("Cannot get non-constant number idx from arrays")
      }
      // Array element access with constant index
      let idx = e2.op
      return getArrayValueEntry(v1, idx)
    }

    // Then it has to be an object
    if (v1.tag != "object") {
      throw new Error("Cannot perform get on non-object values")
    }

    if (!(e2.key == "const" && typeof e2.op == "string")) {
      throw new Error("Cannot get non-constant string field from objects")
    }

    return v1.val[e2.op]
  } else if (q.key == "pure") {
    if (q.op == "mkTuple") {
      let schema = convertToArrayOfSchema(q.schema.type)
      let res = { schema: q.schema, val: {}, tag: "object" }
      for (let i = 0; i < q.arg.length; i += 2) {
        let k = q.arg[i]
        let v = q.arg[i + 1]
        let { name } = schema[i / 2]
        res.val[name] = emitPath(buf, v)
      }
      return res
    }

    let e1 = emitPath(buf, q.arg[0])
    let op = binaryOperators[q.op]
    if (op) {
      // binary op
      let e2 = emitPath(buf, q.arg[1])
      if (q.op == "equal" || q.op == "notEqual" || q.op == "lessThan" || q.op == "greaterThan" || q.op == "lessThanOrEqual" || q.op == "greaterThanOrEqual") {
        if (typing.isString(q.arg[0].schema.type) && typing.isString(q.arg[1].schema.type)) {
          let { str: str1, len: len1 } = e1.val
          let { str: str2, len: len2 } = e2.val
          let name = getNewName("tmp_cmpstr")
          len1 = `(${len1})`
          len2 = `(${len2})`
          cgen.declareInt(buf)(name, cgen.call("strncmp", str1, str2, cgen.ternary(cgen.lt(len1, len2), len1, len2)))
          cgen.stmt(buf)(cgen.assign(name, cgen.ternary(cgen.equal(name, "0"), cgen.minus(len1, len2), name)))
          return { schema: q.schema, val: "(" + cgen.binary(name, "0", op) + ")" }
        } else {
          return { schema: q.schema, val: "(" + cgen.binary(e1.val, e2.val, op) + ")" }
        }
      } else if (q.op == "fdiv") {
        return { schema: q.schema, val: "(" + cgen.binary(cgen.cast("double", e1.val), cgen.cast("double", e2.val), op) + ")" }
      } else {
        return { schema: q.schema, val: "(" + cgen.binary(e1.val, e2.val, op) + ")" }
      }
    } else if (q.op == "and") {
      throw new Error("Unexpected and op" + pretty(q))
    } else if (q.op == "sort") {
      throw new Error("Unexpected sort op" + pretty(q))
    } else if (q.op.startsWith("convert_")) {
      return { schema: q.schema, val: cgen.cast(ctypeMap[q.op.substring("convert_".length)], e1.val) }
    } else if (q.op == "year") {
      return { schema: q.schema, val: "(" + cgen.div(e1.val, "10000") + ")" }
    } else if (q.op == "substr") {
      console.assert(typing.isString(e1.schema))
      let e2 = emitPath(buf, q.arg[1])
      let e3 = emitPath(buf, q.arg[2])
      let str = cgen.plus(e1.val.str, e2.val)
      let len = cgen.minus(e3.val, e2.val)
      return { schema: typeSyms.string, val: { str, len } }
    } else {
      throw new Error("Pure operation not supported: " + pretty(q))
    }
  } else {
    throw new Error("Unknown op: " + pretty(q))
  }
}

// Emit code that initializes the array
let emitArrayInit = (buf, sym, valSchema) => {
  cgen.comment(buf)(`init array for ${sym}`)

  if (typing.isObject(valSchema)) {
    let objSchema = convertToArrayOfSchema(valSchema)

    for (let j in objSchema) {
      let { name, schema } = objSchema[j]

      if (typing.isObject(schema)) {
        throw new Error("Not supported")
      } else if (typing.isString(schema)) {
        if (sortedCols[sym]?.[name]) {
          cgen.declareCharPtrPtr(prolog0)(`${sym}_${name}_str`)
          cgen.declareIntPtr(prolog0)(`${sym}_${name}_len`)
          cgen.stmt(buf)(cgen.assign(`${sym}_${name}_str`, cgen.cast("char **", cgen.malloc("char *", ARRAY_SIZE))))
          cgen.stmt(buf)(cgen.assign(`${sym}_${name}_len`, cgen.cast("int *", cgen.malloc("int", ARRAY_SIZE))))
        } else {
          cgen.declareCharPtrPtr(buf)(`${sym}_${name}_str`, cgen.cast("char **", cgen.malloc("char *", ARRAY_SIZE)))
          cgen.declareIntPtr(buf)(`${sym}_${name}_len`, cgen.cast("int *", cgen.malloc("int", ARRAY_SIZE)))
        }
      } else {
        let cType = convertToCType(schema)
        if (sortedCols[sym]?.[name]) {
          cgen.declarePtr(prolog0)(cType, `${sym}_${name}`)
          cgen.stmt(buf)(cgen.assign(`${sym}_${name}`, cgen.cast(`${cType} *`, cgen.malloc(cType, ARRAY_SIZE))))
        } else {
          cgen.declarePtr(buf)(cType, `${sym}_${name}`, cgen.cast(`${cType} *`, cgen.malloc(cType, ARRAY_SIZE)))
        }
      }
    }
  } else if (typing.isString(valSchema)) {
    cgen.declareCharPtrPtr(buf)(`${sym}_str`, cgen.cast("char **", cgen.malloc("char *", ARRAY_SIZE)))
    cgen.declareIntPtr(buf)(`${sym}_len`, cgen.cast("int *", cgen.malloc("int", ARRAY_SIZE)))
  } else {
    // let convertToCType report "type not supported" errors
    let cType = convertToCType(valSchema)
    cgen.declarePtr(buf)(cType, sym, cgen.cast(`${cType} *`, cgen.malloc(cType, ARRAY_SIZE)))
  }

  cgen.declareInt(buf)(`${sym}_count`)
}

// Emit code that prints the array
let emitArrayPrint = (buf, sym, limit) => {
  let { valSchema } = arrayEnv[sym]
  limit = limit || `${sym}_count`

  if (!typing.isObject(valSchema)) buf.push(`print("[", 1);`)

  if (sortedCols[sym]) {
    buf.push(`for (int i = 0; i < ${limit}; i++) {`)
    buf.push(`int data_pos = ${sym}[i];`)
  } else {
    buf.push(`for (int data_pos = 0; data_pos < ${limit}; data_pos++) {`)
  }

  if (typing.isObject(valSchema)) {
    let objSchema = convertToArrayOfSchema(valSchema)
    for (let j in objSchema) {
      let { name, schema } = objSchema[j]
      if (typing.isObject(schema)) {
        throw new Error("Not supported")
      } else if (typing.isString(schema)) {
        buf.push(`print(${sym}_${name}_str[data_pos], ${sym}_${name}_len[data_pos]);`)
      } else {
        buf.push(`printf("%${getFormatSpecifier(schema)}", ${sym}_${name}[data_pos]);`)
      }
      buf.push(`print("|", 1);`)
    }
  } else if (typing.isString(valSchema)) {
    buf.push(`print(${sym}_str[data_pos], ${sym}_len[data_pos]);`)
  } else if (valSchema.typeSym == typeSyms.date) {
    buf.push(`print_date(${sym}[data_pos]);`)
  } else {
    buf.push(`printf("%${getFormatSpecifier(valSchema)}", ${sym}[data_pos]);`)
  }

  if (typing.isObject(valSchema)) {
    buf.push(`print("\\n", 1);`)
  } else {
    buf.push(`if (data_pos != ${limit} - 1) {`)
    buf.push(`print(", ", 2);`)
    buf.push(`}`)
  }
  buf.push(`}`)
  if (!typing.isObject(valSchema)) {
    buf.push(`print("]\\n", 2);`)
  }
}

// Emit code that inserts a value into the array
let emitArrayInsert = (buf, array, value) => {
  cgen.if(buf)(cgen.equal(array.val.dataCount, ARRAY_SIZE), (buf2) => {
    cgen.printErr(buf2)(`"array size reached its full capacity\\n"`)
    cgen.return(buf2)("1")
  })

  let dataPos = array.val.dataCount
  if (typing.isObject(array.schema.objValue)) {
    console.assert(value.tag == "object")
    for (let key in value.val) {
      let val = value.val[key]
      let valArray = array.val.arr[key]

      if (typing.isObject(val.schema)) {
        throw new Error("Not supported")
      } else if (typing.isString(val.schema)) {
        cgen.stmt(buf)(cgen.assign(`${valArray.str}[${dataPos}]`, val.val.str))
        cgen.stmt(buf)(cgen.assign(`${valArray.len}[${dataPos}]`, val.val.len))
      } else {
        cgen.stmt(buf)(cgen.assign(`${valArray}[${dataPos}]`, val.val))
      }
    }
  } else if (typing.isString(array.schema.objValue)) {
    cgen.stmt(buf)(cgen.assign(`${array.val.arr.str}[${dataPos}]`, value.val.str))
    cgen.stmt(buf)(cgen.assign(`${array.val.arr.len}[${dataPos}]`, value.val.len))
  } else {
    cgen.stmt(buf)(cgen.assign(`${array.val.arr}[${dataPos}]`, value.val))
  }

  cgen.stmt(buf)(cgen.binary(array.val.dataCount, "1", "+="))
}

// Get the array element at index idx
let getArrayValueEntry = (array, idx) => {
  let { valSchema } = arrayEnv[array.val.sym]

  let res

  if (typing.isObject(valSchema)) {
    let objSchema = convertToArrayOfSchema(valSchema)
    let val = {}
    for (let i in objSchema) {
      let { name, schema } = objSchema[i]
      if (typing.isObject(schema)) {
        throw new Error("Not supported")
      } else if (typing.isString(schema)) {
        val[name] = { schema, val: { str: `${array.val.arr[name].str}[${idx}]`, len: `${array.val.arr[name].len}[${idx}]` } }
      } else {
        val[name] = { schema, val: `${array.val.arr[name]}[${idx}]` }
      }
    }
    res = { schema: valSchema, val, tag: "object" }
  } else if (typing.isString(schema)) {
    res = { schema: valSchema, val: { str: `${array.val.arr.str}[${idx}]`, len: `${array.val.arr.len}[${idx}]` } }
  } else {
    res = { schema: valSchema, val: `${array.val.arr}[${idx}]` }
  }

  return res
}

// Emit the value arrays for a hashMap
let emitHashMapValueInit = (buf, sym, keySchema, valSchema) => {
  cgen.comment(buf)(`values of ${sym}`)

  for (let i in valSchema) {
    let { name, schema } = valSchema[i]

    if (name == "_DEFAULT_") name = "values"

    if (typing.isObject(schema)) {
      if (sortedCols[sym]?.[name]) {
        throw new Error("Sorting by array not supported")
      }
      // stateful "array" op
      if (typing.isObject(schema.objValue)) {
        let objSchema = convertToArrayOfSchema(schema.objValue)
        for (let j in objSchema) {
          let { name: name1, schema: schema1 } = objSchema[j]

          if (typing.isObject(schema1)) {
            throw new Error("Not supported")
          } else if (typing.isString(schema1)) {
            // arrays for the actual data will have size KEY_SIZE * BUCKET_SIZE
            cgen.declareCharPtrPtr(buf)(`${sym}_${name}_${name1}_str`, cgen.cast("char **", cgen.malloc("char *", DATA_SIZE)))
            cgen.declareIntPtr(buf)(`${sym}_${name}_${name1}_len`, cgen.cast("int *", cgen.malloc("int", DATA_SIZE)))
          } else {
            let cType = convertToCType(schema1)
            cgen.declarePtr(buf)(cType, `${sym}_${name}_${name1}`, cgen.cast(`${cType} *`, cgen.malloc(cType, DATA_SIZE)))
          }
        }
      } else if (typing.isString(schema.objValue)) {
        // arrays for the actual data will have size KEY_SIZE * BUCKET_SIZE
        cgen.declareCharPtrPtr(buf)(`${sym}_${name}_str`, cgen.cast("char **", cgen.malloc("char *", DATA_SIZE)))
        cgen.declareIntPtr(buf)(`${sym}_${name}_len`, cgen.cast("int *", cgen.malloc("int", DATA_SIZE)))
      } else {
        let cType = convertToCType(schema.objValue)
        cgen.declarePtr(buf)(cType, `${sym}_${name}`, cgen.cast(`${cType} *`, cgen.malloc(cType, DATA_SIZE)))
      }
      cgen.declareInt(buf)(`${sym}_${name}_count`, "0")

      cgen.declareIntPtr(buf)(`${sym}_${name}_buckets`, cgen.cast("int *", cgen.malloc("int", DATA_SIZE)))
      cgen.declareIntPtr(buf)(`${sym}_${name}_bucket_counts`, cgen.cast("int *", cgen.malloc("int", KEY_SIZE)))
      // throw new Error("hashMap value object not implemented")
    } else if (typing.isString(schema)) {
      if (sortedCols[sym]?.[name]) {
        cgen.declareCharPtrPtr(prolog0)(`${sym}_${name}_str`)
        cgen.declareIntPtr(prolog0)(`${sym}_${name}_len`)
        cgen.stmt(buf)(cgen.assign(`${sym}_${name}_str`, cgen.cast("char **", cgen.malloc("char *", KEY_SIZE))))
        cgen.stmt(buf)(cgen.assign(`${sym}_${name}_len`, cgen.cast("int *", cgen.malloc("int", KEY_SIZE))))
      } else {
        cgen.declareCharPtrPtr(buf)(`${sym}_${name}_str`, cgen.cast("char **", cgen.malloc("char *", KEY_SIZE)))
        cgen.declareIntPtr(buf)(`${sym}_${name}_len`, cgen.cast("int *", cgen.malloc("int", KEY_SIZE)))
      }
    } else {
      // let convertToCType report "type not supported" errors
      let cType = convertToCType(schema)
      if (sortedCols[sym]?.[name]) {
        cgen.declarePtr(prolog0)(cType, `${sym}_${name}`)
        cgen.stmt(buf)(cgen.assign(`${sym}_${name}`, cgen.cast(`${cType} *`, cgen.malloc(cType, KEY_SIZE))))
      } else {
        cgen.declarePtr(buf)(cType, `${sym}_${name}`, cgen.cast(`${cType} *`, cgen.malloc(cType, KEY_SIZE)))
      }
    }
  }
}

// Emit the code that initializes the hashmap
let emitHashMapInit = (buf, sym, keySchema, valSchema) => {
  cgen.comment(buf)(`init hashmap for ${sym}`)
  // keys
  cgen.comment(buf)(`keys of ${sym}`)

  for (let i in keySchema) {
    let schema = keySchema[i]
    if (typing.isString(schema)) {
      cgen.declareCharPtrPtr(buf)(`${sym}_keys_str${i}`, cgen.cast("char **", cgen.malloc("char *", KEY_SIZE)))
      cgen.declareIntPtr(buf)(`${sym}_keys_len${i}`, cgen.cast("int *", cgen.malloc("int", KEY_SIZE)))
    } else {
      let cType = convertToCType(schema)
      cgen.declarePtr(buf)(cType, `${sym}_keys${i}`, cgen.cast(`${cType} *`, cgen.malloc(cType, KEY_SIZE)))
    }
  }

  cgen.comment(buf)(`key count for ${sym}`)
  cgen.declareInt(buf)(`${sym}_key_count`, "0")

  // htable
  cgen.comment(buf)(`hash table for ${sym}`)
  cgen.declareIntPtr(buf)(`${sym}_htable`, cgen.cast("int *", cgen.malloc("int", HASH_SIZE)))

  // init htable entries to -1
  cgen.comment(buf)(`init hash table entries to -1 for ${sym}`)
  cgen.stmt(buf)(cgen.call("memset", `${sym}_htable`, "-1", `sizeof(int) * ${HASH_SIZE}`))

  emitHashMapValueInit(buf, sym, keySchema, valSchema)
}

// Emit the code that performs a lookup of the key in the hashmap, then
// if the key is found:
//   does nothing
// if the key is not found:
//   inserts a new key into the hashmap and initializes it
let emitHashLookUpOrUpdate = (buf, sym, keys, update) => {
  let [pos, keyPos] = emitHashLookUp(buf, sym, keys)

  cgen.if(buf)(cgen.equal(keyPos, "-1"), buf1 => {
    cgen.stmt(buf1)(cgen.assign(keyPos, `${sym}_key_count`))
    cgen.stmt(buf1)(cgen.inc(`${sym}_key_count`))
    cgen.if(buf1)(cgen.equal(`${sym}_key_count`, HASH_SIZE), (buf2) => {
      cgen.printErr(buf2)(`"hashmap size reached its full capacity\\n"`)
      cgen.return(buf2)("1")
    })
    cgen.stmt(buf1)(cgen.assign(`${sym}_htable[${pos}]`, keyPos))
    let { keySchema, valSchema } = hashMapEnv[sym]

    for (let i in keys) {
      let key = keys[i]
      let schema = keySchema[i]

      if (typing.isString(schema)) {
        let keyStr = `${sym}_keys_str${i}[${keyPos}]`
        let keyLen = `${sym}_keys_len${i}[${keyPos}]`

        cgen.stmt(buf1)(cgen.assign(keyStr, key.val.str))
        cgen.stmt(buf1)(cgen.assign(keyLen, key.val.len))
      } else {
        cgen.stmt(buf1)(cgen.assign(`${sym}_keys${i}[${keyPos}]`, key.val))
      }
    }

    emitHashUpdate(buf, sym, pos, keyPos, update)
  })

  return [pos, keyPos]
}

// Emit the code that performs a lookup of the key in the hashmap, then
// if the key is found:
//   updates the value
// if the key is not found:
//   inserts a new key into the hashmap and initializes it
let emitHashLookUpAndUpdate = (buf, sym, keys, update, checkExistance) => {
  let [pos, keyPos] = emitHashLookUp(buf, sym, keys)
  let { keySchema, valSchema } = hashMapEnv[sym]

  if (checkExistance) {
    cgen.if(buf)(cgen.equal(keyPos, "-1"), buf1 => {
      cgen.stmt(buf1)(cgen.assign(keyPos, `${sym}_key_count`))
      cgen.stmt(buf1)(cgen.inc(`${sym}_key_count`))
      cgen.if(buf1)(cgen.equal(`${sym}_key_count`, HASH_SIZE), (buf2) => {
        cgen.printErr(buf2)(`"hashmap size reached its full capacity\\n"`)
        cgen.return(buf2)("1")
      })
      cgen.stmt(buf1)(cgen.assign(`${sym}_htable[${pos}]`, keyPos))

      for (let i in keys) {
        let key = keys[i]
        let schema = keySchema[i]

        if (typing.isString(schema)) {
          let keyStr = `${sym}_keys_str${i}[${keyPos}]`
          let keyLen = `${sym}_keys_len${i}[${keyPos}]`

          cgen.stmt(buf1)(cgen.assign(keyStr, key.val.str))
          cgen.stmt(buf1)(cgen.assign(keyLen, key.val.len))
        } else {
          cgen.stmt(buf1)(cgen.assign(`${sym}_keys${i}[${keyPos}]`, key.val))
        }
      }
    })
  }

  emitHashUpdate(buf, sym, pos, keyPos, update)

  return [pos, keyPos]
}

// Emit the code that gets the hashMap value for the key at keyPos
let getHashMapValueEntry = (sym, pos, keyPos) => {
  let { keySchema, valSchema } = hashMapEnv[sym]

  let res = {}

  res.tag = "object"
  res.schema = valSchema
  res.val = {}

  for (let i in valSchema) {
    let { name, schema } = valSchema[i]

    if (name == "_DEFAULT_") name = "values"

    if (typing.isObject(schema)) {
      let valArray
      if (typing.isObject(schema.objValue)) {
        let objSchema = convertToArrayOfSchema(schema.objValue)
        valArray = {}
        for (let j in objSchema) {
          let { name: name1, schema: schema1 } = objSchema[j]

          if (typing.isObject(schema1)) {
            throw new Error("Not supported")
          } else if (typing.isString(schema1)) {
            valArray[name1] = { str: `${sym}_${name}_${name1}_str`, len: `${sym}_${name}_${name1}_len` }
          } else {
            valArray[name1] = `${sym}_${name}_${name1}`
          }
        }
      } else if (typing.isString(schema.objValue)) {
        valArray = { str: `${sym}_${name}_str`, len: `${sym}_${name}_len` }
      } else {
        valArray = `${sym}_${name}`
      }
      res.val[name] = {
        schema,
        val: {
          dataCount: `${sym}_${name}_count`,
          bucketCount: `${sym}_${name}_bucket_counts[${keyPos}]`,
          buckets: `${sym}_${name}_buckets`,
          valArray
        },
        keyPos,
        tag: "hashMapBucket"
      }
    } else if (typing.isString(schema)) {
      res.val[name] = { schema, val: { str: `${sym}_${name}_str[${keyPos}]`, len: `${sym}_${name}_len[${keyPos}]` }, keyPos, tag: "hashMapValue" }
    } else {
      res.val[name] = { schema, val: `${sym}_${name}[${keyPos}]`, keyPos, tag: "hashMapValue" }
    }
  }

  // If it is just a single value, don't return the object
  // but the value directly
  if (valSchema.length == 1 && valSchema[0].name == "_DEFAULT_") {
    return res.val["values"]
  }

  return res
}

// Emit the code that updates the hashMap value for the key at keyPos
let emitHashUpdate = (buf, sym, pos, keyPos, update) => {
  let lhs = getHashMapValueEntry(sym, pos, keyPos)

  update(buf, lhs, pos, keyPos)
}

// Emit the code that insertes a value into a hashmap bucket
let emitHashBucketInsert = (buf, bucket, value) => {
  cgen.if(buf)(cgen.equal(bucket.val.bucketCount, BUCKET_SIZE), (buf2) => {
    cgen.printErr(buf2)(`"hashmap bucket size reached its full capacity\\n"`)
    cgen.return(buf2)("1")
  })

  let dataPos = getNewName("data_pos")
  cgen.declareInt(buf)(dataPos, bucket.val.dataCount)

  cgen.stmt(buf)(cgen.inc(bucket.val.dataCount))

  let bucketPos = getNewName("bucket_pos")

  cgen.declareInt(buf)(bucketPos, bucket.val.bucketCount)
  cgen.stmt(buf)(cgen.assign(bucket.val.bucketCount, cgen.plus(bucketPos, "1")))

  let idx = cgen.plus(cgen.mul(bucket.keyPos, BUCKET_SIZE), bucketPos)
  cgen.stmt(buf)(cgen.assign(`${bucket.val.buckets}[${idx}]`, dataPos))

  if (typing.isObject(bucket.schema.objValue)) {
    console.assert(value.tag == "object")
    for (let key in value.val) {
      let val = value.val[key]
      let valArray = bucket.val.valArray[key]

      if (typing.isObject(val.schema)) {
        throw new Error("Not supported")
      } else if (typing.isString(val.schema)) {
        cgen.stmt(buf)(cgen.assign(`${valArray.str}[${dataPos}]`, val.val.str))
        cgen.stmt(buf)(cgen.assign(`${valArray.len}[${dataPos}]`, val.val.len))
      } else {
        cgen.stmt(buf)(cgen.assign(`${valArray}[${dataPos}]`, val.val))
      }
    }
  } else if (typing.isString(bucket.schema.objValue)) {
    cgen.stmt(buf)(cgen.assign(`${bucket.val.valArray.str}[${dataPos}]`, value.val.str))
    cgen.stmt(buf)(cgen.assign(`${bucket.val.valArray.len}[${dataPos}]`, value.val.len))
  } else {
    cgen.stmt(buf)(cgen.assign(`${bucket.val.valArray}[${dataPos}]`, value.val))
  }
}

// Emit code that prints the keys and values in a hashmap.
let emitHashMapPrint = (buf, sym, limit) => {
  let { keySchema, valSchema } = hashMapEnv[sym]
  limit = limit || `${sym}_key_count`
  if (sortedCols[sym]) {
    buf.push(`for (int i = 0; i < ${limit}; i++) {`)
    buf.push(`int key_pos = ${sym}[i];`)
  } else {
    buf.push(`for (int key_pos = 0; key_pos < ${limit}; key_pos++) {`)
  }
  // buf.push(`// print key`)

  buf.push(`// print value`)

  for (let i in valSchema) {
    let { name, schema } = valSchema[i]
    if (name == "_DEFAULT_") name = "values"
    if (typing.isObject(schema)) {
      buf.push(`print("[", 1);`)
      buf.push(`for (int j = 0; j < ${sym}_${name}_bucket_counts[key_pos]; j++) {`)
      buf.push(`int data_pos = ${sym}_${name}_buckets[key_pos * ${BUCKET_SIZE} + j];`)

      if (typing.isObject(schema.objValue)) {
        let objSchema = convertToArrayOfSchema(schema.objValue)
        for (let j in objSchema) {
          let { name: name1, schema: schema1 } = objSchema[j]
          if (typing.isObject(schema1)) {
            throw new Error("Not supported")
          } else if (typing.isString(schema1)) {
            buf.push(`print(${sym}_${name}_${name1}_str[data_pos], ${sym}_${name}_${name1}_len[data_pos]);`)
          } else {
            buf.push(`printf("%${getFormatSpecifier(schema1)}", ${sym}_${name}_${name1}[data_pos]);`)
          }
          buf.push(`print("|", 1);`)
        }
      } else if (typing.isString(schema.objValue)) {
        buf.push(`print(${sym}_${name}_str[data_pos], ${sym}_${name}_len[data_pos]);`)
      } else if (schema.objValue.typeSym == typeSyms.date) {
        buf.push(`print_date(${sym}_${name}[data_pos]);`)
      } else {
        buf.push(`printf("%${getFormatSpecifier(schema.objValue)}", ${sym}_${name}[data_pos]);`)
      }

      buf.push(`if (j != ${sym}_${name}_bucket_counts[key_pos] - 1) {`)
      buf.push(`print(", ", 2);`)
      buf.push(`}`)
      buf.push(`}`)
      buf.push(`print("]", 1);`)
    } else if (typing.isString(schema)) {
      buf.push(`print(${sym}_${name}_str[key_pos], ${sym}_${name}_len[key_pos]);`)
    } else if (schema.typeSym == typeSyms.date) {
      buf.push(`print_date(${sym}_${name}[key_pos]);`)
    } else {
      buf.push(`printf("%${getFormatSpecifier(schema)}", ${sym}_${name}[key_pos]);`)
    }
    buf.push(`print("|", 1);`)
  }

  buf.push(`print("\\n", 1);`)
  buf.push(`}`)
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

    let tmp = getNewName("tmp_cmp")

    if (typing.isString(schema)) {
      cgen.declareInt(buf)(tmp, cgen.call("strncmp", aVal.val.str, bVal.val.str, cgen.ternary(cgen.lt(aVal.val.len, bVal.val.len), aVal.val.len, bVal.val.len)))
      cgen.stmt(buf)(cgen.assign(tmp, cgen.ternary(cgen.equal(tmp, "0"), cgen.minus(aVal.val.len, bVal.val.len), tmp)))
    } else {
      cgen.declareInt(buf)(tmp, cgen.minus(aVal.val, bVal.val))
    }

    if (i == valPairs.length - 1) {
      cgen.return(buf)(tmp)
    } else {
      cgen.if(buf)(cgen.notEqual(tmp, "0"), buf1 => {
        cgen.return(buf1)(tmp)
      })
    }
  }
  buf.push(`}`)
}

let emitHashMapSorting = (buf, q, hashMap) => {
  let sym = hashMap.val.sym

  let columns = q.arg.slice(0, -1)

  let vals = []
  let orders = []
  let hashMapEntry1 = getHashMapValueEntry(sym, undefined, "*i")
  let hashMapEntry2 = getHashMapValueEntry(sym, undefined, "*j")
  for (let i = 0; i < columns.length; i += 2) {
    let column = columns[i]
    let order = columns[i + 1]

    vals.push([
      hashMapEntry1.val[column.op],
      hashMapEntry2.val[column.op]
    ])
    orders.push(order.op)
  }

  let compareFunc = getNewName("compare_func")
  emitCompareFunc(prolog0, compareFunc, vals, orders)

  cgen.declareIntPtr(buf)(sym, cgen.cast("int *", cgen.malloc("int", `${sym}_key_count`)))
  cgen.stmt(buf)(`for (int i = 0; i < ${sym}_key_count; i++) ${sym}[i] = i`)

  cgen.stmt(buf)(cgen.call("qsort", sym, `${sym}_key_count`, "sizeof(int)", cgen.cast("__compar_fn_t", compareFunc)))
}

let emitArraySorting = (buf, q, array) => {
  let sym = array.val.sym
  let valSchema = array.schema.objValue

  let columns = q.arg.slice(0, -1)

  let vals = []
  let orders = []

  if (!typing.isObject(valSchema)) throw new Error("Cannot sort arrays with non-object elements")

  let arrayEntry1 = getArrayValueEntry(array, "*i")
  let arrayEntry2 = getArrayValueEntry(array, "*j")

  for (let i = 0; i < columns.length; i += 2) {
    let column = columns[i]
    let order = columns[i + 1]

    vals.push([
      arrayEntry1.val[column.op],
      arrayEntry2.val[column.op]
    ])
    orders.push(order.op)
  }

  let compareFunc = getNewName("compare_func")
  emitCompareFunc(prolog0, compareFunc, vals, orders)

  cgen.declareIntPtr(buf)(sym, cgen.cast("int *", cgen.malloc("int", array.val.dataCount)))
  cgen.stmt(buf)(`for (int i = 0; i < ${array.val.dataCount}; i++) ${sym}[i] = i`)

  cgen.stmt(buf)(cgen.call("qsort", sym, array.val.dataCount, "sizeof(int)", cgen.cast("__compar_fn_t", compareFunc)))
}

let prolog0
let prolog1

let reset = () => {
  // c1 IR
  assignmentStms = []
  generatorStms = []
  tmpVarWriteRank = {}

  usedCols = {}
  sortedCols = {}
  hashMapEnv = {}
  arrayEnv = {}
  mksetVarEnv = {}
  mksetVarDeps = {}
  inputFilesEnv = {}
  assignmentToSym = {}
  updateOps = {}
  updateOpsExtra = {}

  emittedStateful = {}

  nameIdMap = {}

  prolog0 = []
  prolog1 = []

  loopInfo = {}
}

let emitStatefulInit = (buf, q, lhs) => {
  if (q.op == "sum" || q.op == "count") {
    cgen.stmt(buf)(cgen.assign(lhs.val, "0"))
  } else if (q.op == "product") {
    cgen.stmt(buf)(cgen.assign(lhs.val, "1"))
  } else if (q.op == "min") {
    cgen.stmt(buf)(cgen.assign(lhs.val, "INT_MAX"))
  } else if (q.op == "max") {
    cgen.stmt(buf)(cgen.assign(lhs.val, "INT_MIN"))
  } else if (q.op == "array") {
    if (lhs.tag == "hashMapBucket") {
      // lhs passed will be the bucket object
      cgen.stmt(buf)(cgen.assign(lhs.val.bucketCount, "0"))
    } else {
      // lhs passed will be the array object
      cgen.stmt(buf)(cgen.assign(lhs.val.dataCount, "0"))
    }
  } else {
    throw new Error("stateful op not supported: " + pretty(q))
  }
}

let emitStatefulUpdate = (buf, q, lhs) => {
  let e = q.arg[0]
  if (e.key == "pure" && e.op == "and") e = e.arg[1]
  let rhs = emitPath(buf, e)
  if (q.op == "sum") {
    cgen.stmt(buf)(cgen.binary(lhs.val, rhs.val, "+="))
  } else if (q.op == "count") {
    cgen.stmt(buf)(cgen.binary(lhs.val, "1", "+="))
  } else if (q.op == "product") {
    cgen.stmt(buf)(cgen.binary(lhs.val, rhs.val, "*="))
  } else if (q.op == "min") {
    cgen.stmt(buf)(`${lhs.val} = ${rhs.val} < ${lhs.val} ? ${rhs.val} : ${lhs.val}`)
  } else if (q.op == "max") {
    cgen.stmt(buf)(`${lhs.val} = ${rhs.val} > ${lhs.val} ? ${rhs.val} : ${lhs.val}`)
  } else if (q.op == "single") {
    if (typing.isString(e.schema.type)) {
      let { str: lhsStr, len: lhsLen } = lhs.val
      let { str: rhsStr, len: rhsLen } = rhs.val
      cgen.stmt(buf)(cgen.assign(lhsStr, rhsStr))
      cgen.stmt(buf)(cgen.assign(lhsLen, rhsLen))
    } else {
      cgen.stmt(buf)(cgen.assign(lhs.val, rhs.val))
    }
  } else if (q.op == "array") {
    // lhs passed will be the bucket info object
    if (lhs.tag == "hashMapBucket") {
      // lhs passed will be the bucket object
      emitHashBucketInsert(buf, lhs, rhs)
    } else {
      // lhs passed will be the array object
      emitArrayInsert(buf, lhs, rhs)
    }

  } else if (q.op == "print") {
    if (typing.isString(e.schema.type)) {
      let { str, len } = rhs.val
      cgen.stmt(buf)(cgen.call("printf", `"%.*s\\n"`,len, str))
    } else {
      cgen.stmt(buf)(cgen.call("printf", `"%${getFormatSpecifier(q.arg[0].schema.type)}\\n"`, rhs.val))
    }
  } else {
    throw new Error("stateful op not supported: " + pretty(q))
  }
}

let emitStatefulInPath = (q, sym) => {
  if (q.fre.length > 0) throw new Error("unexpected number of free variables for stateful op in path: " + pretty(v))

  let fv = trans(q.fre)
  let lhs = getTmpVarValue(q, sym)

  // Get the lhs of the assignment and emit the code for the stateful op
  if (initRequired[q.op]) {
    let buf = []
    cgen.comment(buf)("init " + sym + " = " + pretty(q))

    emitStatefulInit(buf, q, lhs)
    // init
    assign(buf, sym, fv, [])
  }

  let deps = [...union(fv, q.bnd), ...q.tmps.map(tmp => assignmentToSym[tmp] ? assignmentToSym[tmp] : tmpSym(tmp))] // XXX rhs dims only?

  // update
  let buf = []
  cgen.comment(buf)("update " + sym + " = " + pretty(q))

  let e = q.arg[0]
  if (e.key == "pure" && e.op == "and") {
    let cond = emitPath(buf, e.arg[0])

    cgen.if(buf)(cond.val, buf1 => {
      emitStatefulUpdate(buf1, q, lhs)
    })
  } else {
    emitStatefulUpdate(buf, q, lhs)
  }
  assign(buf, sym, fv, deps)

  emittedStateful[sym] = true

  return lhs
}

let collectRelevantStatefulInPath = (q) => {
  if (q.key == "ref") {
    q1 = assignments[q.op]
    if (q1.key == "update") {
      return
    }
    if (q1.key == "stateful") {
      if (q1.fre.length > 1) throw new Error("unexpected number of free variables for stateful op " + pretty(q1) + " fre: " + q1.fre)

      if (q1.fre.length != 0) {
        console.assert(currentGroupKey.key.op === q1.fre[0])

        assignmentToSym[q.op] = currentGroupKey.sym
        updateOpsExtra[currentGroupKey.sym].push(q.op)

        let keySchema = currentGroupKey.keySchema
        let valSchema = [{ name: "_DEFAULT_", schema: q1.schema.type }]

        if (!hashMapEnv[tmpSym(q.op)])
          emitHashMapValueInit(prolog1, tmpSym(q.op), keySchema, valSchema)

        hashMapEnv[tmpSym(q.op)] = { keySchema, valSchema }
      }
    }
  }

  if (q.arg) {
    q.arg.map(collectRelevantStatefulInPath)
  }
}

let collectHashMaps = () => {
  // Iterate through all update ops to group stateful ops together
  for (let i in assignments) {
    let q = assignments[i]
    let sym = tmpSym(i)

    if (q.key != "update") continue

    let k = q.arg[1]
    let v = q.arg[2]
    let mkset = q.arg[3]

    let keySchema
    // check if the key is a set of keys
    if (mkset.arg[0].arg[0].key == "pure" && mkset.arg[0].arg[0].op == "combine") {
      keySchema = mkset.arg[0].arg[0].arg.map(e => e.schema.type)
    } else {
      keySchema = [mkset.arg[0].arg[0].schema.type]
    }

    if (v.fre.length !== 1 || k.op !== v.fre[0]) {
      throw new Error("unexpected number of free variables for stateful op " + pretty(v))
    }

    if (v.key == "pure" && v.op.startsWith("convert_")) {
      v = v.arg[0]
    }
    let valSchema = []

    updateOps[i] = []
    updateOpsExtra[i] = []
    if (v.key == "pure" && v.op == "mkTuple") {
      for (let j = 0; j < q.arg[2].arg.length; j += 2) {
        let key = q.arg[2].arg[j]
        let val = q.arg[2].arg[j + 1]

        if (val.key == "pure" && val.op.startsWith("convert_")) {
          val = val.arg[0]
        }

        if (val.key != "ref" || assignments[val.op].key == "update") {
          throw new Error("stateful op expected but got " + pretty(val))
        }
        assignmentToSym[val.op] = i
        updateOps[i].push(val.op)
        val.extraGroupPath = [key.op]
        assignments[val.op].extraGroupPath = [key.op]
        valSchema.push({ name: key.op, schema: val.schema.type })

        currentGroupKey = { sym: i, key: k, keySchema }
        collectRelevantStatefulInPath(assignments[val.op].arg[0])
      }
    } else {
      if (v.key != "ref" || assignments[v.op].key == "update") {
        throw new Error("stateful op expected but got " + pretty(v))
      }
      assignmentToSym[v.op] = i
      updateOps[i].push(v.op)
      valSchema.push({ name: "_DEFAULT_", schema: v.schema.type })

      currentGroupKey = { sym: i, key: k, keySchema }
      collectRelevantStatefulInPath(assignments[v.op].arg[0])
    }

    // Create hashmap
    emitHashMapInit(prolog1, sym, keySchema, valSchema)

    hashMapEnv[sym] = { keySchema, valSchema }
  }
}


let emitCode = (q, ir, settings) => {
  filters = ir.filters
  assignments = ir.assignments

  reset()

  extractUsedAndSortedCols(q)
  // analyzeDestination(q)

  prolog0.push(`#include "rhyme-sql.h"`)
  prolog0.push(`typedef int (*__compar_fn_t)(const void *, const void *);`)
  prolog1.push("int main() {")

  let t0 = emitGetTime(prolog1)

  collectHashMaps()

  for (let i in assignments) {
    let q = assignments[i]
    if (q.key == "update" || assignmentToSym[i]) continue
    if (q.op == "print") continue
    let sym = tmpSym(i)
    if (q.op == "array") {
      emitArrayInit(prolog1, sym, q.schema.type.objValue)
      arrayEnv[sym] = { valSchema: q.schema.type.objValue }
    } else {
      cgen.declareVar(prolog1)(convertToCType(q.schema.type), sym)
    }
  }

  // Declare loop counter vars
  // for (let v in ir.vars) {
  //   if (v.startsWith("K")) continue
  //   let counter = `${quoteVar(v)}`
  //   cgen.declareInt(prolog)(counter)
  // }

  for (let i in filters) {
    let f = filters[i]
    let v1 = f.arg[1].op
    let g1 = f.arg[0]

    if (g1.key == "loadInput") {
      let loadInput = []
      let file = pretty(g1.arg[0])
      // constant string filename

      // TODO: might need to have a better way to do CSE
      // should be done when the loop is actually emitted by new-codegen
      // where we have the info about the current scope

      if (inputFilesEnv[file] == undefined) {
        let isConstStr = g1.arg[0].key == "const" && typeof g1.arg[0].op == "string"
        let buf = isConstStr ? prolog1 : loadInput
        cgen.comment(buf)(`loading input file: ${file}`)
        let filename = emitPath(buf, g1.arg[0])
        let filenameStr
        if (!isConstStr) {
          filenameStr = getNewName("tmp_filename")
          cgen.declareCharArr(buf)(filenameStr, `${filename.val.len} + 1`)
          cgen.stmt(buf)(cgen.call("extract_str1", filename.val.str, filename.val.len, filenameStr))
        } else {
          filenameStr = filename.val.str
        }
        let { mappedFile, size } = emitLoadInput(buf, filenameStr, i)
        inputFilesEnv[file] = { mappedFile, size, format: g1.op }
      }

      let getLoopTxtFunc = getCSVLoopTxt(f, file, loadInput)
      addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)

      loopInfo[v1] ??= {}
      loopInfo[v1][pretty(g1)] = { schema: g1.schema, val: inputFilesEnv[file], tag: "inputFile" }
    } else if (g1.key == "mkset") {
      let data = []
      if (g1.arg[0].key == "pure" && g1.arg[0].op == "combine") {
        let vals = g1.arg[0].arg.map(e => emitPath(data, e))
        mksetVarEnv[v1] = vals
      } else {
        let val = emitPath(data, g1.arg[0])
        mksetVarEnv[v1] = [val]
      }
      // let hashed = hash(data, mksetVarEnv[v1].map(e => e.val), mksetVarEnv[v1].map(e => e.schema.type))
      // mksetVarEnv[v1].hash = hash(data, mksetVarEnv[v1].map(e => e.val), mksetVarEnv[v1].map(e => e.schema.type))
      addMkset(f.arg[0], f.arg[1], data)
    } else {
      let data = []
      let lhs = emitPath(data, g1)
      loopInfo[v1] ??= {}
      loopInfo[v1][pretty(g1)] = lhs
      if (lhs.tag == "array") {
        throw new Error("Generator from array not implemented yet")
      } else if (lhs.tag == "hashMap") {
        let getLoopTxtFunc = getHashMapLoopTxt(f, lhs.val.sym)
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
        // throw new Error("Generator from hashmap not implemented yet")
      } else if (lhs.tag == "hashMapBucket") {
        let getLoopTxtFunc = getHashBucketLoopTxt(f, lhs, data)
        addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
      } else {
        throw new Error("Cannot have generator from non-iterable objects")
      }
    }
  }

  // Iterate and emit stateful ops
  for (let i in updateOps) {
    let k = assignments[i].arg[1].op

    let keys = k.startsWith("K") ? mksetVarEnv[k] : [k]

    let sym = tmpSym(i)

    let fv = trans([k])

    let init = []

    cgen.comment(init)("init and update " + sym + " = " + pretty(assignments[i]))
    let shouldInit = updateOps[i].some(j => initRequired[assignments[j].op] && assignments[j].mode !== "maybe") || updateOpsExtra[i].some(j => initRequired[assignments[j].op])

    if (!shouldInit) {
      // let update = []

      for (let j of updateOps[i]) {
        let q = assignments[j]
        let e = q.arg[0]
        let buf = []
        let deps = [...union(fv, q.bnd), ...q.tmps.map(tmp => assignmentToSym[tmp] ? tmpSym(assignmentToSym[tmp]) : tmpSym(tmp))]
        if (e.key == "pure" && e.op == "and") {
          let cond = emitPath(buf, e.arg[0])
          cgen.if(buf)(cond.val, (buf1) => {
            emitHashLookUpAndUpdate(buf1, sym, keys, (buf2, lhs, pos, keyPos) => {
              currentGroupKey = { key: k, pos, keyPos }
              cgen.comment(buf2)("update " + sym + "[" + q.fre[0] + "]" + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))

              if (q.extraGroupPath) {
                console.assert(lhs.tag == "object")
                lhs = lhs.val[q.extraGroupPath[0]]
              } else {
                console.assert(lhs.tag == "hashMapValue" || lhs.tag == "hashMapBucket")
              }

              emitStatefulUpdate(buf2, q, lhs, sym)
            }, true)
          })
        } else {
          emitHashLookUpAndUpdate(buf, sym, keys, (buf1, lhs, pos, keyPos) => {
            currentGroupKey = { key: k, pos, keyPos }
            cgen.comment(buf1)("update " + sym + "[" + q.fre[0] + "]" + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))

            if (q.extraGroupPath) {
              console.assert(lhs.tag == "object")
              lhs = lhs.val[q.extraGroupPath[0]]
            } else {
              console.assert(lhs.tag == "hashMapValue" || lhs.tag == "hashMapBucket")
            }

            emitStatefulUpdate(buf1, q, lhs, sym)
          }, true)
        }
        assign(buf, sym, fv, deps)
      }
      // extra not supported yet
      continue
    }

    let [pos, keyPos] = emitHashLookUpOrUpdate(init, sym, keys, (buf1, lhs, pos, keyPos) => {
      for (let j of updateOps[i]) {
        let q = assignments[j]
        if (!initRequired[q.op]) continue
        cgen.comment(buf1)("init " + sym + "[" + q.fre[0] + "]" + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))
        let lhs1 = lhs
        if (q.extraGroupPath) {
          console.assert(lhs.tag == "object")
          lhs1 = lhs.val[q.extraGroupPath[0]]
        } else {
          console.assert(lhs1.tag == "hashMapValue" || lhs1.tag == "hashMapBucket")
        }
        emitStatefulInit(buf1, q, lhs1)
      }
      for (let j of updateOpsExtra[i]) {
        let q = assignments[j]
        if (!initRequired[q.op]) continue
        cgen.comment(buf1)("init " + tmpSym(j) + "[" + q.fre[0] + "]" + " = " + pretty(q))
        let lhs1 = getHashMapValueEntry(tmpSym(j), pos, keyPos)
        console.assert(lhs1.tag == "hashMapValue" || lhs1.tag == "hashMapBucket")
        emitStatefulInit(buf1, q, lhs1)
      }
    })
    assign(init, sym, fv, [])

    currentGroupKey = { key: k, pos, keyPos }
    for (let j of updateOpsExtra[i]) {
      let update = []
      let q = assignments[j]
      cgen.comment(update)("update " + tmpSym(j) + "[" + q.fre[0] + "]" + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))
      let deps = [...union(fv, q.bnd), ...q.tmps.map(tmp => assignmentToSym[tmp] ? tmpSym(assignmentToSym[tmp]) : tmpSym(tmp))]
      let e = q.arg[0]
      if (e.key == "pure" && e.op == "and") {
        let cond = emitPath(update, e.arg[0])

        cgen.if(update)(cond.val, buf1 => {
          emitHashUpdate(buf1, sym, pos, keyPos, (buf2, lhs) => {
            let lhs1 = getHashMapValueEntry(tmpSym(j), pos, keyPos)
            console.assert(lhs1.tag == "hashMapValue" || lhs1.tag == "hashMapBucket")
            emitStatefulUpdate(buf2, q, lhs1)
          })
        })
      } else {
        emitHashUpdate(update, sym, pos, keyPos, (buf1, lhs) => {
          let lhs1 = getHashMapValueEntry(tmpSym(j), pos, keyPos)
          console.assert(lhs1.tag == "hashMapValue" || lhs1.tag == "hashMapBucket")
          emitStatefulUpdate(buf1, q, lhs1)
        })
      }
      assign(update, sym, fv, deps)
    }
    for (let j of updateOps[i]) {
      let update = []
      let q = assignments[j]
      cgen.comment(update)("update " + sym + "[" + q.fre[0] + "]" + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))
      let deps = [...union(fv, q.bnd), ...q.tmps.map(tmp => assignmentToSym[tmp] ? tmpSym(assignmentToSym[tmp]) : tmpSym(tmp))]
      let e = q.arg[0]
      if (e.key == "pure" && e.op == "and") {
        let cond = emitPath(update, e.arg[0])

        cgen.if(update)(cond.val, buf1 => {
          emitHashUpdate(buf1, sym, pos, keyPos, (buf2, lhs) => {
            if (q.extraGroupPath) {
              console.assert(lhs.tag == "object")
              lhs = lhs.val[q.extraGroupPath[0]]
            } else {
              console.assert(lhs.tag == "hashMapValue" || lhs.tag == "hashMapBucket")
            }
            emitStatefulUpdate(buf2, q, lhs)
          })
        })
      } else {
        emitHashUpdate(update, sym, pos, keyPos, (buf1, lhs) => {
          if (q.extraGroupPath) {
            console.assert(lhs.tag == "object")
            lhs = lhs.val[q.extraGroupPath[0]]
          } else {
            console.assert(lhs.tag == "hashMapValue" || lhs.tag == "hashMapBucket")
          }
          emitStatefulUpdate(buf1, q, lhs)
        })
      }
      assign(update, sym, fv, deps)
    }
  }

  let t1 = emitGetTime(prolog1)

  let epilog = []
  let res
  if (q.key == "pure" && q.op == "sort") {
    res = emitPath(epilog, q.arg[q.arg.length - 1])
    if (res.tag == "hashMap") {
      emitHashMapSorting(epilog, q, res)
    } else if (res.tag == "array") {
      emitArraySorting(epilog, q, res)
    } else throw new Error("Can only sort values of a hashmap")

  } else {
    res = emitPath(epilog, q)
  }

  if (q.schema.type.typeSym !== typeSyms.never) {
    if (res.tag == "hashMap") {
      cgen.comment(epilog)("print hashmap")
      emitHashMapPrint(epilog, res.val.sym, settings.limit)
    } else if (res.tag == "array") {
      cgen.comment(epilog)("print array")
      emitArrayPrint(epilog, res.val.sym, settings.limit)
    } else if (typing.isString(q.schema.type)) {
      cgen.stmt(epilog)(cgen.call("printf", `"%.*s\\n"`, res.val.len, res.val.str))
    } else {
      cgen.stmt(epilog)(cgen.call("printf", `"%${getFormatSpecifier(q.schema.type)}\\n"`, res.val))
    }
  }

  let t2 = emitGetTime(epilog)

  cgen.printErr(epilog)(`"Timing:\\n\\tInitializaton:\\t%ld μs\\n\\tRuntime:\\t%ld μs\\n\\tTotal:\\t\\t%ld μs\\n"`, cgen.minus(t1, t0), cgen.minus(t2, t1), cgen.minus(t2, t0))

  cgen.return(epilog)("0")
  epilog.push("}")

  let newCodegenIR = {
    assignmentStms,
    generatorStms,
    tmpVarWriteRank,
    prolog: [...prolog0, ...prolog1],
    epilog
  }
  return generate(newCodegenIR, "c-sql")
}

let generateCSqlNew = (q, ir, settings) => {
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
    await sh(`gcc ${cFlags} ${cFile} -o ${out} -Icgen-sql`)
    return func
  }

  return writeAndCompile()
}

exports.generateCSqlNew = generateCSqlNew