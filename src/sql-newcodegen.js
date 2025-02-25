const { generate } = require('./new-codegen')
const { typing, typeSyms, types } = require('./typing')
const { pretty } = require('./prettyprint')
const { sets } = require('./shared')

const { unique, union } = sets

const KEY_SIZE = 256
const HASH_SIZE = 256

const BUCKET_SIZE = 256
const DATA_SIZE = KEY_SIZE * BUCKET_SIZE

const HASH_MASK = HASH_SIZE - 1

let filters
let assignments
let inputFilesEnv
let usedCols
let mksetVarEnv
let mksetVarDeps
let hashMapEnv

let assignmentStms
let generatorStms
let tmpVarWriteRank

let emittedStateful

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
  declareULong: (buf) => (name, init) => cgen.declareVar(buf)("unsigned long", name, init),
  declareCharArr: (buf) => (name, len, init) => cgen.declareArr(buf)("char", name, len, init),
  declareIntPtr: (buf) => (name, init) => cgen.declarePtr(buf)("int", name, init),
  declareCharPtr: (buf) => (name, init) => cgen.declarePtr(buf)("char", name, init),
  declareConstCharPtr: (buf) => (name, init) => cgen.declarePtr(buf)("char", name, init, true),
  declareCharPtrPtr: (buf) => (name, init) => cgen.declarePtrPtr(buf)("char", name, init),

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

  andAlso: "&&"
}

// Extract all the used columns.
// e.g. if an integer column is used, it will be extracted
// while we scan through each row in the csv.
//
// This makes sure that if we want to use the variable,
// it will be available in the scope.
// String columns are only extracted (copied to a temporary buffer) when a null-terminated string is needed.
// e.g. the open() system call.
let validateAndExtractUsedCols = (q) => {
  if (q.key == "get") {
    let [e1, e2] = q.arg

    // check if the get is valid

    // get from a tmp var
    if (e1.key == "ref") {
      e1 = assignments[e1.op]
      if (e1.key != "update" && e1.fre.length != 1) {
        throw new Error("cannot get from a tmp that is not a hashmap: " + pretty(q))
      }
      validateAndExtractUsedCols(e1)
      validateAndExtractUsedCols(e2)
      return
    }

    if (!(e1.key == "get" && e2.key == "const")) {
      throw new Error("malformed get: " + pretty(q))
    }
    if (e1.arg[0].key != "loadInput") {
      throw new Error("malformed e1 in get: " + pretty(e1))
    }
    if (typeof e2.op != "string") {
      throw new Error("column name is not a constant string: " + pretty(e2))
    }

    // extract used columns for the filename
    // we need to extract the string (copy to a temp buffer)
    // because we need a null-terminated string for open()
    validateAndExtractUsedCols(e1.arg[0].arg[0])

    let prefix = pretty(e1) // does this always work?
    usedCols[prefix] ??= {}

    if (typing.isString(q.schema.type)) {
      usedCols[prefix][e2.op] = true
      return
    }
    if (typing.isNumber(q.schema.type)) {
      usedCols[prefix][e2.op] = true
    } else {
      throw new Error("column data type not supported: " + pretty(q) + " has type " + typing.prettyPrintTuple(q.schema))
    }
  } else if (q.key == "ref") {
    let q1 = assignments[q.op]
    validateAndExtractUsedCols(q1)
  } else if (q.key == "update") {
    if (q.arg[3] == undefined) {
      throw new Error("trivial group op not supported for now: " + pretty(q))
    }
    let [_e1, _e2, e3, e4] = q.arg

    if (!typing.isString(e4.arg[0].arg[0].schema.type) && !typing.isInteger(e4.arg[0].arg[0].schema.type)) {
      throw new Error(`value of type ${typing.prettyPrintTuple(e4.arg[0].arg[0].schema)} not allowed for mkset`)
    }

    // value
    if (e3.key == "pure" && e3.op == "mkTuple") {
      e3.arg.map(validateAndExtractUsedCols)
    } else {
      validateAndExtractUsedCols(e3)
    }
    // mkset
    validateAndExtractUsedCols(e4.arg[0].arg[0])
  } else if (q.key == "pure" && q.op == "mkTuple") {
    throw new Error("unexpected mkTuple")
  } else if (q.arg) {
    q.arg.map(validateAndExtractUsedCols)
  }
}

// let analyzePath = (q) => {
//   if (q.key == "stateful") {
//     analyzeStateful(undefined, q)
//   } else {
//     analyzePath(q)
//   }
// }

// let analyzeStateful = (lhs, q) => {
//   if (q.key == "stateful") {
//     let sym = lhs || getNewName("tmp")
//     q.destination ??= []
//     q.destination.push(sym)
//   } else if (q.key == "update") {

//   }
// }

// let analyzeDestination = (q) => {
//   analyzeStateful(undefined, q)
// }

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

let hash = (buf, keys, keySchema) => {
  let hashed = getNewName("hash")
  cgen.declareULong(buf)(hashed, "0")

  for (let i in keys) {
    let key = keys[i]
    let schema = keySchema[i]
    let tmpHash = getNewName("tmp_hash")

    if (typing.isString(schema)) {
      cgen.declareULong(buf)(tmpHash, cgen.call("hash", key.str, key.len))
    } else if (typing.isInteger(schema)) {
      cgen.declareULong(buf)(tmpHash, cgen.cast("unsigned long", key))
    } else {
      throw new Error("cannot hash key with type " + typing.prettyPrintType(schema))
    }

    cgen.stmt(buf)(cgen.binary(hashed, "41", "*="))
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

      let { str, len } = key
      let comparison = cgen.notEqual(cgen.call("compare_str2", keyStr, keyLen, str, len), "0")
      compareKeys = compareKeys ? cgen.or(compareKeys, comparison) : comparison
    } else if (typing.isInteger(schema)) {
      let comparison = cgen.notEqual(`${sym}_keys${i}[${keyPos}]`, key)
      compareKeys = compareKeys ? cgen.or(compareKeys, comparison) : comparison
    }
  }

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

let scanColumn = (buf, mappedFile, cursor, size, delim) => {
  cgen.while(buf)(
    cgen.notEqual(`${mappedFile}[${cursor}]`, delim),
    buf1 => {
      cgen.stmt(buf1)(cgen.inc(cursor))
    }
  )
}

let scanInteger = (buf, mappedFile, cursor, size, delim, name) => {
  cgen.while(buf)(
    cgen.notEqual(`${mappedFile}[${cursor}]`, delim),
    buf1 => {
      cgen.comment(buf1)("extract integer")
      cgen.if(buf1)(cgen.and(
        cgen.ge(`${mappedFile}[${cursor}]`, "'0'"), cgen.le(`${mappedFile}[${cursor}]`, "'9'")
      ), buf2 => {
        cgen.stmt(buf2)(cgen.binary(name, "10", "*="))
        cgen.stmt(buf2)(cgen.binary(name, cgen.minus(`${mappedFile}[${cursor}]`, "'0'"), "+="))
      })
      cgen.stmt(buf1)(cgen.inc(cursor))
    }
  )
}

let scanDecimal = (buf, mappedFile, cursor, size, delim, integer, frac, scale) => {
  cgen.while(buf)(
    cgen.and(
      cgen.notEqual(`${mappedFile}[${cursor}]`, delim),
      cgen.notEqual(`${mappedFile}[${cursor}]`, "'.'"),
    ),
    buf1 => {
      cgen.comment(buf1)("extract integer part")
      cgen.stmt(buf1)(cgen.binary(integer, "10", "*="))
      cgen.stmt(buf1)(cgen.binary(integer, cgen.minus(`${mappedFile}[${cursor}]`, "'0'"), "+="))
      cgen.stmt(buf1)(cgen.inc(cursor))
    }
  )

  cgen.if(buf)(
    cgen.equal(`${mappedFile}[${cursor}]`, "'.'"),
    buf1 => {
      cgen.stmt(buf1)(cgen.inc(cursor))
      cgen.while(buf1)(
        cgen.notEqual(`${mappedFile}[${cursor}]`, delim),
        buf2 => {
          cgen.comment(buf2)("extract fractional part")
          cgen.stmt(buf2)(cgen.binary(frac, "10", "*="))
          cgen.stmt(buf2)(cgen.binary(frac, cgen.minus(`${mappedFile}[${cursor}]`, "'0'"), "+="))
          cgen.stmt(buf2)(cgen.binary(scale, "10", "*="))
          cgen.stmt(buf2)(cgen.inc(cursor))
        }
      )
    }
  )
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
  let used = usedCols[prefix][colName]

  cgen.comment(buf)(`reading column ${colName}`)

  let name = [mappedFile, quoteVar(v), colName].join("_")
  let start = name + "_start"
  let end = name + "_end"

  let delim = getDelim(format, first)

  if (used) {
    if (typing.isInteger(type)) {
      cgen.declareVar(buf)(convertToCType(type), name, "0")
      scanInteger(buf, mappedFile, cursor, size, delim, name)
    } else if (type.typeSym === typeSyms.f32 || type.typeSym === typeSyms.f64) {
      let integer = getNewName("integer")
      let frac = getNewName("frac")
      let scale = getNewName("scale")
      cgen.declareInt(buf)(integer, "0")
      cgen.declareInt(buf)(frac, "0")
      cgen.declareInt(buf)(scale, "1")
      scanDecimal(buf, mappedFile, cursor, size, delim, integer, frac, scale)
      cgen.declareVar(buf)(convertToCType(type), name,
        cgen.plus(integer, cgen.div(cgen.cast("double", frac), scale))
      )
    } else {
      // String
      cgen.declareInt(buf)(start, cursor)
      scanColumn(buf, mappedFile, cursor, size, delim)
      cgen.declareInt(buf)(end, cursor)
    }
  } else {
    scanColumn(buf, mappedFile, cursor, size, delim)
  }

  cgen.stmt(buf)(cgen.inc(cursor))

  // consume the newline character for tbl
  if (first && format == "tbl") cgen.stmt(buf)(cgen.inc(cursor))

  return [...emitRowScanning(f, file, cursor, schema.objParent, false), ...buf]
}

// Returns a function that will be invoked during the actual code generation
// It requests a new cursor name every time it is invoked
let getLoopTxt = (f, file, loadInput) => () => {
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
  cgen.stmt(loopHeader)(cgen.assign(quoteVar(v), "-1"))
  loopHeader.push("while (1) {")
  cgen.stmt(loopHeader)(cgen.inc(quoteVar(v)))

  let boundsChecking = [`if (${cursor} >= ${size}) break;`]

  let schema = f.schema.type
  let rowScanning = emitRowScanning(f, file, cursor, schema)

  return {
    info, data: loadInput, initCursor, loopHeader, boundsChecking, rowScanning
  }
}

let emitPath = (buf, q) => {
  if (q.key == "loadInput") {
    throw new Error("cannot have stand-alone loadInput")
  } else if (q.key == "const") {
    if (typeof q.op == "number") {
      return String(q.op)
    } else if (typeof q.op == "string") {
      let name = getNewName("tmp_str")
      cgen.declareConstCharPtr(buf)(name, '"' + q.op + '"')
      return { str: name, len: q.op.length }
    } else {
      throw new Error("constant not supported: " + pretty(q))
    }
  } else if (q.key == "var") {
    throw new Error("cannot have stand-alone var")
  } else if (q.key == "ref") {
    let q1 = assignments[q.op]

    if (q1.fre.length > 0) {
      let sym = tmpSym(q.op)
      if (q1.key == "stateful" && !emittedStateful[sym]) {
        emitStatefulInPath(q1, sym)
      }
      let keys = q1.fre[0].startsWith("K") ? mksetVarEnv[q1.fre[0]].map(key => key.val) : [q1.fre[0]]
      let keyPos = emitHashLookUp(buf, sym, keys)[1]
      let { valSchema } = hashMapEnv[sym]
      if (typing.isString(valSchema)) {
        return { str: `${sym}_values_str[${keyPos}]`, len: `${sym}_values_len[${keyPos}]` }
      } else {
        return `${sym}_values[${keyPos}]`
      }
    } else {
      let sym = tmpSym(q.op)
      if (q1.key == "stateful" && !emittedStateful[sym]) {
        emitStatefulInPath(q1, sym)
      }
      return sym
    }
  } else if (q.key == "get") {
    let [e1, e2] = q.arg

    if (e1.key == "ref") {
      let sym = tmpSym(e1.op)
      if (assignments[e1.op].key == "stateful" && !emittedStateful[sym]) {
        emitStatefulInPath(assignments[e1.op], sym)
      }
      let key = emitPath(buf, e2)
      let keyPos = emitHashLookUp(buf, sym, [key])[1]
      let { valSchema } = hashMapEnv[sym]
      if (valSchema.length > 1) {
        throw new Error("not supported for now")
      }
      if (typing.isString(valSchema[0].schema)) {
        return { str: `${sym}_${valSchema[0].name}_str[${keyPos}]`, len: `${sym}_${valSchema[0].name}_len[${keyPos}]` }
      } else {
        return `${sym}_${valSchema[0].name}[${keyPos}]`
      }
    }

    let file = e1.arg[0].arg[0]
    let filename
    if (file.key == "const" && typeof file.op == "string") {
      filename = file.op
    } else {
      filename = pretty(file)
    }

    let { mappedFile } = inputFilesEnv[filename]

    let v = e1.arg[1].op

    let name = [mappedFile, quoteVar(v), e2.op].join("_")
    let start = name + "_start"
    let end = name + "_end"

    if (typing.isNumber(q.schema.type)) {
      return name
    } else if (typing.isString(q.schema.type)) {
      return { str: `${mappedFile} + ${start}`, len: `${end} - ${start}` }
    } else {
      throw new Error("cannot extract value of type " + typing.prettyPrintTuple(q.schema))
    }
  } else if (q.key == "pure") {
    let e1 = emitPath(buf, q.arg[0])
    let op = binaryOperators[q.op]
    let res
    if (op) {
      // binary op
      let e2 = emitPath(buf, q.arg[1])
      if (q.op == "equal" || q.op == "notEqual" || q.op == "lessThan" || q.op == "greaterThan" || q.op == "lessThanOrEqual" || q.op == "greaterThanOrEqual") {
        if (typing.isString(q.arg[0].schema.type) && typing.isString(q.arg[1].schema.type)) {
          let { str: str1, len: len1 } = e1
          let { str: str2, len: len2 } = e2
          let name = getNewName("tmp_cmpstr")
          cgen.declareInt(buf)(name, cgen.binary(cgen.call("compare_str2", str1, len1, str2, len2), "0", op))
          return name
        } else {
          res = cgen.binary(e1, e2, op)
        }
      } else if (q.op == "fdiv") {
        res = cgen.binary(cgen.cast("double", e1), cgen.cast("double", e2), op)
      } else {
        res = cgen.binary(e1, e2, op)
      }
    } else if (q.op == "and") {
      throw new Error("unexpected and op" + pretty(q))
    } else if (q.op.startsWith("convert_")) {
      res = cgen.cast(ctypeMap[q.op.substring("convert_".length)], e1)
    } else {
      throw new Error("pure operation not supported: " + pretty(q))
    }
    return "(" + res + ")"
  } else {
    throw new Error("unknown op: " + pretty(q))
  }
}

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
  buf.push(`for (int i = 0; i < ${HASH_SIZE}; i++) ${sym}_htable[i] = -1;`)

  cgen.comment(buf)(`values of ${sym}`)

  for (let i in valSchema) {
    let { name, schema } = valSchema[i]

    if (typing.isObject(schema)) {
      // stateful "array" op
      if (typing.isString(schema.objValue)) {
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
      cgen.declareCharPtrPtr(buf)(`${sym}_${name}_str`, cgen.cast("char **", cgen.malloc("char *", KEY_SIZE)))
      cgen.declareIntPtr(buf)(`${sym}_${name}_len`, cgen.cast("int *", cgen.malloc("int", KEY_SIZE)))
    } else {
      // let convertToCType report "type not supported" errors
      let cType = convertToCType(schema)
      cgen.declarePtr(buf)(cType, `${sym}_${name}`, cgen.cast(`${cType} *`, cgen.malloc(cType, KEY_SIZE)))
    }
  }
}

// Emit the code that performs a lookup of the key in the hashmap, then
// if the key is found:
//   does nothing
// if the key is not found:
//   inserts a new key into the hashmap and initializes it
let emitHashLookUpOrUpdate = (buf, sym, keys, target, update) => {
  let [pos, keyPos] = emitHashLookUp(buf, sym, keys)

  cgen.if(buf)(cgen.equal(keyPos, "-1"), buf1 => {
    cgen.stmt(buf1)(cgen.assign(keyPos, `${sym}_key_count`))
    cgen.stmt(buf1)(cgen.inc(`${sym}_key_count`))
    cgen.stmt(buf1)(cgen.assign(`${sym}_htable[${pos}]`, keyPos))
    let { keySchema, valSchema } = hashMapEnv[sym]

    for (let i in keys) {
      let key = keys[i]
      let schema = keySchema[i]

      if (typing.isString(schema)) {
        let keyStr = `${sym}_keys_str${i}[${keyPos}]`
        let keyLen = `${sym}_keys_len${i}[${keyPos}]`

        cgen.stmt(buf1)(cgen.assign(keyStr, key.str))
        cgen.stmt(buf1)(cgen.assign(keyLen, key.len))
      } else {
        cgen.stmt(buf1)(cgen.assign(`${sym}_keys${i}[${keyPos}]`, key))
      }
    }

    let schema = valSchema.find(val => val.name === target).schema

    let lhs
    if (typing.isObject(schema)) {
      lhs = {
        keyPos,
        dataCount: `${sym}_${target}_count`,
        bucketCount: `${sym}_${target}_bucket_counts[${keyPos}]`,
        buckets: `${sym}_${target}_buckets`,
        target: `${sym}_${target}`,
        schema
      }
    } else if (typing.isString(schema)) {
      lhs = { str: `${sym}_${target}_str[${keyPos}]`, len: `${sym}_${target}_len[${keyPos}]` }
    } else {
      lhs = `${sym}_${target}[${keyPos}]`
    }

    update(buf1, lhs)
  })
}

let emitHashLookUpAndUpdate = (buf, sym, keys, target, update, checkExistance) => {
  let [pos, keyPos] = emitHashLookUp(buf, sym, keys)
  let { keySchema, valSchema } = hashMapEnv[sym]

  if (checkExistance) {
    cgen.if(buf)(cgen.equal(keyPos, "-1"), buf1 => {
      cgen.stmt(buf1)(cgen.assign(keyPos, `${sym}_key_count`))
      cgen.stmt(buf1)(cgen.inc(`${sym}_key_count`))
      cgen.stmt(buf1)(cgen.assign(`${sym}_htable[${pos}]`, keyPos))

      for (let i in keys) {
        let key = keys[i]
        let schema = keySchema[i]

        if (typing.isString(schema)) {
          let keyStr = `${sym}_keys_str${i}[${keyPos}]`
          let keyLen = `${sym}_keys_len${i}[${keyPos}]`

          cgen.stmt(buf1)(cgen.assign(keyStr, key.str))
          cgen.stmt(buf1)(cgen.assign(keyLen, key.len))
        } else {
          cgen.stmt(buf1)(cgen.assign(`${sym}_keys${i}[${keyPos}]`, key))
        }
      }
    })
  }

  let schema = valSchema.find(val => val.name === target).schema

  let lhs
  if (typing.isObject(schema)) {
    lhs = {
      keyPos,
      dataCount: `${sym}_${target}_count`,
      bucketCount: `${sym}_${target}_bucket_counts[${keyPos}]`,
      buckets: `${sym}_${target}_buckets`,
      target: `${sym}_${target}`,
      schema
    }
  } else if (typing.isString(schema)) {
    lhs = { str: `${sym}_${target}_str[${keyPos}]`, len: `${sym}_${target}_len[${keyPos}]` }
  } else {
    lhs = `${sym}_${target}[${keyPos}]`
  }
  update(buf, lhs)
}

let emitHashBucketInsert = (buf, bucket, value) => {
  let dataPos = getNewName("data_pos")
  cgen.declareInt(buf)(dataPos, bucket.dataCount)

  cgen.stmt(buf)(cgen.inc(bucket.dataCount))

  let bucketPos = getNewName("bucket_pos")
  cgen.declareInt(buf)(bucketPos, bucket.bucketCount)

  cgen.stmt(buf)(cgen.assign(bucket.bucketCount, cgen.plus(bucketPos, "1")))

  let idx = cgen.plus(cgen.mul(bucket.keyPos, BUCKET_SIZE), bucketPos)
  cgen.stmt(buf)(cgen.assign(`${bucket.buckets}[${idx}]`, dataPos))

  if (typing.isString(bucket.schema.objValue)) {
    cgen.stmt(buf)(cgen.assign(`${bucket.target}_str[${dataPos}]`, value.str))
    cgen.stmt(buf)(cgen.assign(`${bucket.target}_len[${dataPos}]`, value.len))
  } else {
    cgen.stmt(buf)(cgen.assign(`${bucket.target}[${dataPos}]`, value))
  }
}

// Emit code that prints the keys and values in a hashmap.
let emitHashMapPrint = (buf, sym) => {
  let { keySchema, valSchema } = hashMapEnv[sym]
  buf.push(`for (int i = 0; i < ${HASH_SIZE}; i++) {`)
  buf.push(`int key_pos = ${sym}_htable[i];`)
  buf.push(`if (key_pos == -1) {`)
  buf.push(`continue;`)
  buf.push(`}`)
  buf.push(`// print key`)

  for (let i in keySchema) {
    let schema = keySchema[i]
    if (typing.isString(schema)) {
      buf.push(`print(${sym}_keys_str${i}[key_pos], ${sym}_keys_len${i}[key_pos]);`)
    } else {
      buf.push(`printf("%${getFormatSpecifier(schema)}", ${sym}_keys${i}[key_pos]);`)
    }
    buf.push(`print("|", 1);`)
  }

  buf.push(`// print value`)

  for (let i in valSchema) {
    let { name, schema } = valSchema[i]
    if (typing.isObject(schema)) {
      buf.push(`print("[", 1);`)
      buf.push(`int bucket_count = ${sym}_${name}_bucket_counts[key_pos];`)
      buf.push(`for (int j = 0; j < bucket_count; j++) {`)
      buf.push(`int data_pos = ${sym}_${name}_buckets[key_pos * 256 + j];`)

      if (typing.isString(schema.objValue)) {
        buf.push(`print(${sym}_${name}_str[data_pos], ${sym}_${name}_len[data_pos]);`)
      } else {
        buf.push(`printf("%${getFormatSpecifier(schema.objValue)}", ${sym}_${name}[data_pos]);`)
      }

      buf.push(`if (j != bucket_count - 1) {`)
      buf.push(`print(", ", 2);`)
      buf.push(`}`)
      buf.push(`}`)
      buf.push(`print("]", 1);`)
    } else if (typing.isString(schema)) {
      buf.push(`print(${sym}_${name}_str[key_pos], ${sym}_${name}_len[key_pos]);`)
    } else {
      buf.push(`printf("%${getFormatSpecifier(schema)}", ${sym}_${name}[key_pos]);`)
    }
    buf.push(`print("|", 1);`)
  }

  buf.push(`print("\\n", 1);`)
  buf.push(`}`)
}

let assignmentToSym

let reset = () => {
  // c1 IR
  assignmentStms = []
  generatorStms = []
  tmpVarWriteRank = {}

  usedCols = {}
  hashMapEnv = {}
  mksetVarEnv = {}
  mksetVarDeps = {}
  inputFilesEnv = {}
  assignmentToSym = {}

  emittedStateful = {}

  nameIdMap = {}
}

let emitStatefulInit = (buf, q, lhs) => {
  if (q.op == "sum" || q.op == "count") {
    cgen.stmt(buf)(cgen.assign(lhs, "0"))
  } else if (q.op == "product") {
    cgen.stmt(buf)(cgen.assign(lhs, "1"))
  } else if (q.op == "min") {
    cgen.stmt(buf)(cgen.assign(lhs, "INT_MAX"))
  } else if (q.op == "max") {
    cgen.stmt(buf)(cgen.assign(lhs, "INT_MIN"))
  } else if (q.op == "array") {
    // lhs passed will be the bucket info object
    cgen.stmt(buf)(cgen.assign(lhs.bucketCount, "0"))
  } else {
    throw new Error("stateful op not supported: " + pretty(q))
  }
}

let emitOptionalAndOp = (buf, e, update) => {
  if (e.key == "pure" && e.op == "and") {
    let cond = emitPath(buf, e.arg[0])
    let rhs = emitPath(buf, e.arg[1])

    cgen.if(buf)(cond, buf1 => {
      update(buf1, rhs)
    })
  } else {
    let rhs = emitPath(buf, e)
    update(buf, rhs)
  }
}

let emitStatefulUpdate = (buf, q, lhs, sym) => {
  let e = q.arg[0]
  if (q.op == "sum") {
    emitOptionalAndOp(buf, e, (buf1, rhs) => {
      cgen.stmt(buf1)(cgen.binary(lhs, rhs, "+="))
    })
  } else if (q.op == "count") {
    emitOptionalAndOp(buf, e, (buf1, rhs) => {
      cgen.stmt(buf1)(cgen.binary(lhs, "1", "+="))
    })
  } else if (q.op == "product") {
    emitOptionalAndOp(buf, e, (buf1, rhs) => {
      cgen.stmt(buf1)(cgen.binary(lhs, rhs, "*="))
    })
  } else if (q.op == "min") {
    emitOptionalAndOp(buf, e, (buf1, rhs) => {
      cgen.stmt(buf1)(`${lhs} = ${rhs} < ${lhs} ? ${rhs} : ${lhs}`)
    })
  } else if (q.op == "max") {
    emitOptionalAndOp(buf, e, (buf1, rhs) => {
      cgen.stmt(buf1)(`${lhs} = ${rhs} > ${lhs} ? ${rhs} : ${lhs}`)
    })
  } else if (q.op == "single") {
    emitOptionalAndOp(buf, e, (buf1, rhs) => {
      if (typing.isString(e.schema.type)) {
        let { str: lhsStr, len: lhsLen } = lhs
        let { str: rhsStr, len: rhsLen } = rhs
        cgen.stmt(buf1)(cgen.assign(lhsStr, rhsStr))
        cgen.stmt(buf1)(cgen.assign(lhsLen, rhsLen))
      } else {
        cgen.stmt(buf1)(cgen.assign(lhs, rhs))
      }
    })
  } else if (q.op == "array") {
    // lhs passed will be the bucket info object
    console.assert(sym !== undefined)
    emitOptionalAndOp(buf, e, (buf1, rhs) => {
      emitHashBucketInsert(buf1, lhs, rhs)
    })
  } else if (q.op == "print") {
    emitOptionalAndOp(buf, e, (buf1, rhs) => {
      if (typing.isString(e.schema.type)) {
        let { str, len } = rhs
        cgen.stmt(buf1)(cgen.call("println1", str, len))
      } else {
        cgen.stmt(buf1)(cgen.call("printf", `"%${getFormatSpecifier(q.arg[0].schema.type)}\\n"`, rhs))
      }
    })
  } else {
    throw new Error("stateful op not supported: " + pretty(q))
  }
}

let emitStatefulInPath = (q, sym) => {
  if (q.fre.length > 1) throw new Error("unexpected number of free variables for stateful op " + pretty(v))

  if (q.fre.length != 0) {
    // Create hashmap
    let buf = []
    let keySchema = q.fre[0].startsWith("K") ? mksetVarEnv[q.fre[0]].map(key => key.schema.type) : [{ type: types.i32 }]
    let valSchema = [{ name: "values", schema: q.schema.type }]
    emitHashMapInit(buf, sym, keySchema, valSchema)
    assign(buf, sym, [], [])

    hashMapEnv[sym] = { keySchema, valSchema }
  }

  let fv = trans(q.fre)

  // Get the lhs of the assignment and emit the code for the stateful op

  if (initRequired[q.op]) {
    let buf = []
    cgen.comment(buf)("init " + sym + (q.fre.length > 0 ? "[" + q.fre[0] + "]" : "") + " = " + pretty(q))
    if (q.fre.length > 0) {
      // perform hashmap lookup
      let keys = q.fre[0].startsWith("K") ? mksetVarEnv[q.fre[0]].map(key => key.val) : [q1.fre[0]]
      emitHashLookUpOrUpdate(buf, sym, keys, "values", (buf1, lhs) => {
        emitStatefulInit(buf1, q, lhs)
      })
    } else {
      cgen.declareVar(buf)(convertToCType(q.schema.type), sym)
      emitStatefulInit(buf, q, sym)
    }
    // init
    assign(buf, sym, fv, [])
  }

  let deps = [...union(fv, q.bnd), ...q.tmps.map(tmp => assignmentToSym[tmp] ? assignmentToSym[tmp] : tmpSym(tmp))] // XXX rhs dims only?

  // update
  let buf = []
  cgen.comment(buf)("update " + sym + (q.fre.length > 0 ? "[" + q.fre[0] + "]" : "") + " = " + pretty(q))
  if (q.fre.length > 0) {
    // perform hashmap lookup
    // we need to check existance for the ops that don't need initialization
    let keys = q.fre[0].startsWith("K") ? mksetVarEnv[q.fre[0]].map(key => key.val) : [q1.fre[0]]
    emitHashLookUpAndUpdate(buf, sym, keys, "values", (buf1, lhs) => {
      emitStatefulUpdate(buf1, q, lhs, sym)
    }, !initRequired[q.op])
  } else {
    emitStatefulUpdate(buf, q, sym)
  }
  assign(buf, sym, fv, deps)

  emittedStateful[sym] = true
}

let emitCode = (q, ir) => {
  filters = ir.filters
  assignments = ir.assignments

  reset()

  validateAndExtractUsedCols(q)
  // analyzeDestination(q)

  let prolog = []
  prolog.push(`#include "rhyme-sql.h"`)
  prolog.push("int main() {")

  // Iterate through all update ops to group stateful ops together
  for (let i in assignments) {
    let q = assignments[i]

    if (q.key != "update") continue
    let sym = tmpSym(i)

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
    if (v.key == "pure" && v.op == "mkTuple") {
      for (let i = 0; i < q.arg[2].arg.length; i += 2) {
        let key = q.arg[2].arg[i]
        let val = q.arg[2].arg[i + 1]

        if (val.key == "pure" && val.op.startsWith("convert_")) {
          val = val.arg[0]
        }

        if (val.key != "ref" || assignments[val.op].key == "update") {
          throw new Error("stateful op expected but got " + pretty(val))
        }
        assignmentToSym[val.op] = sym
        val.extraGroupPath = [key.op]
        assignments[val.op].extraGroupPath = [key.op]
        valSchema.push({ name: key.op, schema: val.schema.type })
      }
    } else {
      if (v.key != "ref" || assignments[v.op].key == "update") {
        throw new Error("stateful op expected but got " + pretty(v))
      }
      assignmentToSym[v.op] = sym
      valSchema.push({ name: "values", schema: v.schema.type })
    }

    // Create hashmap
    let buf = []
    emitHashMapInit(buf, sym, keySchema, valSchema)
    assign(buf, sym, [], [])

    hashMapEnv[sym] = { keySchema, valSchema }
  }

  for (let v in ir.vars) {
    if (v.startsWith("K")) continue
    let counter = `${quoteVar(v)}`
    cgen.declareInt(prolog)(counter)
  }

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
        let buf = isConstStr ? prolog : loadInput
        cgen.comment(buf)(`loading input file: ${file}`)
        let filename = emitPath(buf, g1.arg[0])
        let filenameStr
        if (!isConstStr) {
          filenameStr = getNewName("tmp_filename")
          cgen.declareCharArr(buf)(filenameStr, `${filename.len} + 1`)
          cgen.stmt(buf)(cgen.call("extract_str1", filename.str, filename.len, filenameStr))
        } else {
          filenameStr = filename.str
        }
        let { mappedFile, size } = emitLoadInput(buf, filenameStr, i)
        inputFilesEnv[file] = { mappedFile, size, format: g1.op }
      }

      let getLoopTxtFunc = getLoopTxt(f, file, loadInput)
      addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
    } else if (g1.key == "mkset") {
      let data = []
      if (g1.arg[0].key == "pure" && g1.arg[0].op == "combine") {
        let vals = g1.arg[0].arg.map(e => ({
          val: emitPath(data, e),
          schema: e.schema
        }))
        mksetVarEnv[v1] = vals
      } else {
        let val = emitPath(data, g1.arg[0])
        mksetVarEnv[v1] = [{ val, schema: g1.arg[0].schema }]
      }
      addMkset(f.arg[0], f.arg[1], data)
    } else {
      throw new Error("invalid filter: " + pretty(f))
    }
  }

  // Iterate through other stateful ops that does not come after an update op
  // and create hashmaps if needed
  // for (let i in assignments) {
  //   let q = assignments[i]

  //   if (q.key != "stateful" || assignmentToSym[i]) continue
  //   let sym = tmpSym(i)

  //   if (q.fre.length > 1) throw new Error("unexpected number of free variables for stateful op " + pretty(v))

  //   if (q.fre.length != 0) {
  //     // Create hashmap
  //     let buf = []
  //     let keySchema = q.fre[0].startsWith("K") ? mksetVarEnv[q.fre[0]].map(key => key.schema.type) : [{ type: types.i32 }]
  //     let valSchema = [{ name: "values", schema: q.schema.type }]
  //     emitHashMapInit(buf, sym, keySchema, valSchema)
  //     assign(buf, sym, [], [])

  //     hashMapEnv[sym] = { keySchema, valSchema }
  //   }
  // }

  // Iterate and emit stateful ops
  for (let i in assignments) {
    let q = assignments[i]

    if (q.key != "stateful" || !assignmentToSym[i]) continue

    let sym = assignmentToSym[i] ? assignmentToSym[i] : tmpSym(i)

    let fv = trans(q.fre)

    // Get the lhs of the assignment and emit the code for the stateful op

    if (initRequired[q.op]) {
      let buf = []
      cgen.comment(buf)("init " + sym + (q.fre.length > 0 ? "[" + q.fre[0] + "]" : "") + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))
      if (q.fre.length > 0) {
        // perform hashmap lookup
        let keys = q.fre[0].startsWith("K") ? mksetVarEnv[q.fre[0]].map(key => key.val) : [q1.fre[0]]
        emitHashLookUpOrUpdate(buf, sym, keys, q.extraGroupPath ? q.extraGroupPath[0] : "values", (buf1, lhs) => {
          emitStatefulInit(buf1, q, lhs)
        })
      } else {
        cgen.declareVar(buf)(convertToCType(q.schema.type), sym)
        emitStatefulInit(buf, q, sym)
      }
      // init
      assign(buf, sym, fv, [])
    }

    let deps = [...union(fv, q.bnd), ...q.tmps.map(tmp => assignmentToSym[tmp] ? assignmentToSym[tmp] : tmpSym(tmp))] // XXX rhs dims only?

    // update
    let buf = []
    cgen.comment(buf)("update " + sym + (q.fre.length > 0 ? "[" + q.fre[0] + "]" : "") + (q.extraGroupPath ? "[" + q.extraGroupPath[0] + "]" : "") + " = " + pretty(q))
    if (q.fre.length > 0) {
      // perform hashmap lookup
      // we need to check existance for the ops that don't need initialization
      let keys = q.fre[0].startsWith("K") ? mksetVarEnv[q.fre[0]].map(key => key.val) : [q1.fre[0]]
      emitHashLookUpAndUpdate(buf, sym, keys, q.extraGroupPath ? q.extraGroupPath[0] : "values", (buf1, lhs) => {
        emitStatefulUpdate(buf1, q, lhs, sym)
      }, !initRequired[q.op])
    } else {
      emitStatefulUpdate(buf, q, sym)
    }
    assign(buf, sym, fv, deps)
  }

  let epilog = []
  let res = emitPath(epilog, q)

  if (q.schema.type.typeSym !== typeSyms.never) {
    if (hashMapEnv[res]) {
      cgen.comment(epilog)("print hashmap")
      emitHashMapPrint(epilog, res)
    } else {
      if (typing.isString(q.schema.type)) {
        cgen.stmt(epilog)(cgen.call("println1", res.str, res.len))
      } else {
        cgen.stmt(epilog)(cgen.call("printf", `"%${getFormatSpecifier(q.schema.type)}\\n"`, res))
      }
    }
  }

  cgen.return(epilog)("0")
  epilog.push("}")

  let newCodegenIR = {
    assignmentStms,
    generatorStms,
    tmpVarWriteRank,
    prolog,
    epilog
  }
  return generate(newCodegenIR, "c-sql")
}

let generateCSqlNew = (q, ir, outDir, outFile) => {
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

  let cFile = joinPaths(outDir, outFile)
  let out = joinPaths(outDir, "tmp")
  let codeNew = emitCode(q, ir)

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