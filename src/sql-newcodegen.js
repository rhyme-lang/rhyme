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
let hashMapEnv


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
    validateAndExtractUsedCols(e3)
    // mkset
    validateAndExtractUsedCols(e4.arg[0].arg[0])
  } else if (q.arg) {
    q.arg.map(validateAndExtractUsedCols)
  }
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

// For numbers, the returned value is the extracted column or a literal value for constants.
// For strings, the returned value is an object with the mapped file, the starting index and ending index.
//   { file, start, end }
// If the string is extracted, it will be the name of the temporary buffer storing the copied string.
let codegen = (q, buf) => {
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
      let keys = q1.fre[0].startsWith("K") ? mksetVarEnv[q1.fre[0]].map(key => key.val) : [q1.fre[0]]
      let keyPos = hashLookUp(buf, sym, keys)[1]
      let { valSchema } = hashMapEnv[sym]
      if (typing.isString(valSchema)) {
        return { str: `${sym}_values_str[${keyPos}]`, len: `${sym}_values_len[${keyPos}]` }
      } else {
        return `${sym}_values[${keyPos}]`
      }
    } else {
      return tmpSym(q.op)
    }
  } else if (q.key == "get") {
    let [e1, e2] = q.arg

    if (e1.key == "ref") {
      let sym = tmpSym(e1.op)
      let key = codegen(e2, buf)
      let keyPos = hashLookUp(buf, sym, [key])[1]
      let { valSchema } = hashMapEnv[sym]
      if (typing.isString(valSchema)) {
        return { str: `${sym}_values_str[${keyPos}]`, len: `${sym}_values_len[${keyPos}]` }
      } else {
        return `${sym}_values[${keyPos}]`
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
    let e1 = codegen(q.arg[0], buf)
    let op = binaryOperators[q.op]
    let res
    if (op) {
      // binary op
      let e2 = codegen(q.arg[1], buf)
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
      if (q.arg[1].op == "and") {
        throw new Error("chained & not supported")
      }
      cgen.if(buf)(`!(${e1})`, buf1 => {
        cgen.continue(buf1)()
      })
      let e2 = codegen(q.arg[1], buf)
      return e2
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

let hash = (buf, keys, keysSchema) => {
  let hashed = getNewName("hash")
  cgen.declareULong(buf)(hashed, "0")

  for (let i in keys) {
    let key = keys[i]
    let keySchema = keysSchema[i]
    let tmpHash = getNewName("tmp_hash")

    if (typing.isString(keySchema)) {
      cgen.declareULong(buf)(tmpHash, cgen.call("hash", key.str, key.len))
    } else if (typing.isInteger(keySchema)) {
      cgen.declareULong(buf)(tmpHash, cgen.cast("unsigned long", key))
    } else {
      throw new Error("cannot hash key with type " + typing.prettyPrintType(keySchema))
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
let hashLookUp = (buf, sym, keys) => {
  let { keysSchema } = hashMapEnv[sym]
  let hashed = hash(buf, keys, keysSchema)

  let pos = getNewName("pos")
  cgen.declareULong(buf)(pos, cgen.binary(hashed, HASH_MASK, "&"))

  let keyPos = `${sym}_htable[${pos}]`

  let compareKeys = undefined

  for (let i in keys) {
    let key = keys[i]
    let keySchema = keysSchema[i]

    if (typing.isString(keySchema)) {
      let keyStr = `${sym}_keys_str${i}[${keyPos}]`
      let keyLen = `${sym}_keys_len${i}[${keyPos}]`

      let { str, len } = key
      let comparison = cgen.notEqual(cgen.call("compare_str2", keyStr, keyLen, str, len), "0")
      compareKeys = compareKeys ? cgen.or(compareKeys, comparison) : comparison
    } else if (typing.isInteger(keySchema)) {
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

// Emit the code that performs a lookup of the key in the hashmap, then
// if the key is found:
//   does nothing
// if the key is not found:
//   inserts a new key into the hashmap and initializes it
let hashLookUpOrUpdate = (buf, sym, keys, update) => {
  let [pos, keyPos] = hashLookUp(buf, sym, keys)

  cgen.if(buf)(cgen.equal(keyPos, "-1"), buf1 => {
    cgen.stmt(buf1)(cgen.assign(keyPos, `${sym}_key_count`))
    cgen.stmt(buf1)(cgen.inc(`${sym}_key_count`))
    cgen.stmt(buf1)(cgen.assign(`${sym}_htable[${pos}]`, keyPos))
    let { keysSchema, valSchema } = hashMapEnv[sym]

    for (let i in keys) {
      let key = keys[i]
      let keySchema = keysSchema[i]

      if (typing.isString(keySchema)) {
        let keyStr = `${sym}_keys_str${i}[${keyPos}]`
        let keyLen = `${sym}_keys_len${i}[${keyPos}]`

        cgen.stmt(buf1)(cgen.assign(keyStr, key.str))
        cgen.stmt(buf1)(cgen.assign(keyLen, key.len))
      } else {
        cgen.stmt(buf1)(cgen.assign(`${sym}_keys${i}[${keyPos}]`, key))
      }
    }

    let lhs
    if (typing.isObject(valSchema)) {
      lhs = `${sym}_bucket_counts[${keyPos}]`
    } else if (typing.isString(valSchema)) {
      lhs = { str: `${sym}_values_str[${keyPos}]`, len: `${sym}_values_len[${keyPos}]` }
    } else {
      lhs = `${sym}_values[${keyPos}]`
    }

    update(lhs)
  })

  return [pos, keyPos]
}

// Emit the code that performs a lookup of the key in the hashmap, then
// if the key is found:
//   updates the corresponding value.
// if the key is not found:
//   inserts a new key into the hashmap and initializes it.
let hashUpdate = (buf, sym, keys, update) => {
  let [pos, keyPos] = hashLookUp(buf, sym, keys)

  let { keysSchema, valSchema } = hashMapEnv[sym]

  cgen.if(buf)(cgen.equal(keyPos, "-1"), buf1 => {
    cgen.stmt(buf1)(cgen.assign(keyPos, `${sym}_key_count`))
    cgen.stmt(buf1)(cgen.inc(`${sym}_key_count`))
    cgen.stmt(buf1)(cgen.assign(`${sym}_htable[${pos}]`, keyPos))

    for (let i in keys) {
      let key = keys[i]
      let keySchema = keysSchema[i]

      if (typing.isString(keySchema)) {
        let keyStr = `${sym}_keys_str${i}[${keyPos}]`
        let keyLen = `${sym}_keys_len${i}[${keyPos}]`

        cgen.stmt(buf1)(cgen.assign(keyStr, key.str))
        cgen.stmt(buf1)(cgen.assign(keyLen, key.len))
      } else {
        cgen.stmt(buf1)(cgen.assign(`${sym}_keys${i}[${keyPos}]`, key))
      }
    }
  })

  let lhs
  if (typing.isObject(valSchema)) {
    lhs = `${sym}_bucket_counts[${keyPos}]`
  } else if (typing.isString(valSchema)) {
    lhs = { str: `${sym}_values_str[${keyPos}]`, len: `${sym}_values_len[${keyPos}]` }
  } else {
    lhs = `${sym}_values[${keyPos}]`
  }

  update(lhs)

  return [pos, keyPos]
}

// Emit the code that performs a lookup of the key in the hashmap, then
let hashUpdateExist = (buf, sym, keys, update) => {
  let [pos, keyPos] = hashLookUp(buf, sym, keys)

  let { keysSchema, valSchema } = hashMapEnv[sym]

  let lhs
  if (typing.isObject(valSchema)) {
    lhs = `${sym}_bucket_counts[${keyPos}]`
  } else if (typing.isString(valSchema)) {
    lhs = { str: `${sym}_values_str[${keyPos}]`, len: `${sym}_values_len[${keyPos}]` }
  } else {
    lhs = `${sym}_values[${keyPos}]`
  }

  update(lhs)

  return [pos, keyPos]
}

let hashBufferInsert = (buf, sym, keys, value) => {
  let { keysSchema, valSchema } = hashMapEnv[sym]

  let [pos, keyPos] = hashLookUp(buf, sym, keys)

  let dataPos = getNewName("data_pos")
  cgen.declareInt(buf)(dataPos, `${sym}_data_count`)

  cgen.stmt(buf)(cgen.inc(`${sym}_data_count`))

  let bucketPos = getNewName("bucket_pos")
  cgen.declareInt(buf)(bucketPos, `${sym}_bucket_counts[${keyPos}]`)

  cgen.stmt(buf)(cgen.assign(`${sym}_bucket_counts[${keyPos}]`, cgen.plus(bucketPos, "1")))

  let idx = cgen.plus(cgen.mul(keyPos, BUCKET_SIZE), bucketPos)
  cgen.stmt(buf)(cgen.assign(`${sym}_buckets[${idx}]`, dataPos))

  if (!typing.isObject(valSchema)) {
    throw new Error("array type expected")
  }

  if (typing.isString(valSchema.objValue)) {
    cgen.stmt(buf)(cgen.assign(`${sym}_data_str[${dataPos}]`, value.str))
    cgen.stmt(buf)(cgen.assign(`${sym}_data_len[${dataPos}]`, value.len))
  } else {
    cgen.stmt(buf)(cgen.assign(`${sym}_data[${dataPos}]`, value))
  }
}

// Emit code that initializes a hashmap.
// For string keys / values, they are represented by
// a pointer to the beginning of the string and the length of the string
let hashMapInit = (buf, sym, keysSchema, valSchema) => {
  cgen.comment(buf)(`init hashmap for ${sym}`)
  // keys
  cgen.comment(buf)(`keys of ${sym}`)

  for (let i in keysSchema) {
    let keySchema = keysSchema[i]
    if (typing.isString(keySchema)) {
      cgen.declareCharPtrPtr(buf)(`${sym}_keys_str${i}`, cgen.cast("char **", cgen.malloc("char *", KEY_SIZE)))
      cgen.declareIntPtr(buf)(`${sym}_keys_len${i}`, cgen.cast("int *", cgen.malloc("int", KEY_SIZE)))
    } else {
      let cType = convertToCType(keySchema)
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

  if (typing.isObject(valSchema)) {
    // stateful "array" op
    if (typing.isString(valSchema.objValue)) {
      // arrays for the actual data will have size KEY_SIZE * BUCKET_SIZE
      cgen.declareCharPtrPtr(buf)(`${sym}_data_str`, cgen.cast("char **", cgen.malloc("char *", DATA_SIZE)))
      cgen.declareIntPtr(buf)(`${sym}_data_len`, cgen.cast("int *", cgen.malloc("int", DATA_SIZE)))
    } else {
      let cType = convertToCType(valSchema.objValue)
      cgen.declarePtr(buf)(cType, `${sym}_data`, cgen.cast(`${cType} *`, cgen.malloc(cType, DATA_SIZE)))
    }
    cgen.declareInt(buf)(`${sym}_data_count`, "0")

    cgen.declareIntPtr(buf)(`${sym}_buckets`, cgen.cast("int *", cgen.malloc("int", DATA_SIZE)))
    cgen.declareIntPtr(buf)(`${sym}_bucket_counts`, cgen.cast("int *", cgen.malloc("int", KEY_SIZE)))
    // throw new Error("hashMap value object not implemented")
  } else if (typing.isString(valSchema)) {
    cgen.declareCharPtrPtr(buf)(`${sym}_values_str`, cgen.cast("char **", cgen.malloc("char *", KEY_SIZE)))
    cgen.declareIntPtr(buf)(`${sym}_values_len`, cgen.cast("int *", cgen.malloc("int", KEY_SIZE)))
  } else {
    // let convertToCType report "type not supported" errors
    let cType = convertToCType(valSchema)
    cgen.declarePtr(buf)(cType, `${sym}_values`, cgen.cast(`${cType} *`, cgen.malloc(cType, KEY_SIZE)))
  }

  hashMapEnv[sym] = { keysSchema, valSchema }
}

let hashMapShallowCopy = (buf, sym1, sym2, keysSchema, valSchema) => {
  cgen.comment(buf)(`init hashmap for ${sym1}`)
  // keys
  cgen.comment(buf)(`keys of ${sym1}`)

  for (let i in keysSchema) {
    let keySchema = keysSchema[i]
    if (typing.isString(keySchema)) {
      cgen.declareCharPtrPtr(buf)(`${sym1}_keys_str${i}`, `${sym2}_keys_str${i}`)
      cgen.declareIntPtr(buf)(`${sym1}_keys_len${i}`, `${sym2}_keys_len${i}`)
    } else {
      let cType = convertToCType(keySchema)
      cgen.declarePtr(buf)(cType, `${sym1}_keys${i}`, `${sym2}_keys${i}`)
    }
  }

  cgen.comment(buf)(`key count for ${sym1}`)
  cgen.declareInt(buf)(`${sym1}_key_count`, `${sym2}_key_count`)

  // htable
  cgen.comment(buf)(`hash table for ${sym1}`)
  cgen.declareIntPtr(buf)(`${sym1}_htable`, `${sym2}_htable`)

  cgen.comment(buf)(`values of ${sym1}`)

  if (typing.isObject(valSchema)) {
    // stateful "array" op
    if (typing.isString(valSchema.objValue)) {
      cgen.declareCharPtrPtr(buf)(`${sym1}_data_str`, `${sym2}_data_str`)
      cgen.declareIntPtr(buf)(`${sym1}_data_len`, `${sym2}_data_len`)
    } else {
      let cType = convertToCType(valSchema.objValue)
      cgen.declarePtr(buf)(cType, `${sym1}_data`, `${sym2}_data`)
    }
    cgen.declareInt(buf)(`${sym1}_data_count`, `${sym2}_data_count`)

    cgen.declareIntPtr(buf)(`${sym1}_buckets`, `${sym2}_buckets`)
    cgen.declareIntPtr(buf)(`${sym1}_bucket_counts`, `${sym2}_bucket_counts`)
  } else if (typing.isString(valSchema)) {
    cgen.declareCharPtrPtr(buf)(`${sym1}_values_str`, `${sym2}_values_str`)
    cgen.declareIntPtr(buf)(`${sym1}_values_len`, `${sym2}_values_len`)
  } else {
    // let convertToCType report "type not supported" errors
    let cType = convertToCType(valSchema)
    cgen.declarePtr(buf)(cType, `${sym1}_values`, `${sym2}_values`)
  }

  hashMapEnv[sym1] = { keysSchema, valSchema }
}

// Emit code that prints the keys and values in a hashmap.
let hashMapPrint = (buf, sym) => {
  let { keysSchema, valSchema } = hashMapEnv[sym]
  buf.push(`for (int i = 0; i < ${HASH_SIZE}; i++) {`)
  buf.push(`int key_pos = ${sym}_htable[i];`)
  buf.push(`if (key_pos == -1) {`)
  buf.push(`continue;`)
  buf.push(`}`)
  buf.push(`// print key`)

  for (let i in keysSchema) {
    let keySchema = keysSchema[i]
    if (typing.isString(keySchema)) {
      buf.push(`print(${sym}_keys_str${i}[key_pos], ${sym}_keys_len${i}[key_pos]);`)
    } else {
      buf.push(`printf("%${getFormatSpecifier(keySchema)}", ${sym}_keys${i}[key_pos]);`)
    }
    if (i != keysSchema.length - 1) {
      buf.push(`print("|", 1);`)
    }
  }

  buf.push(`print(": ", 2);`)

  buf.push(`// print value`)
  if (typing.isObject(valSchema)) {
    buf.push(`print("[", 1);`)
    buf.push(`int bucket_count = ${sym}_bucket_counts[key_pos];`)
    buf.push(`for (int j = 0; j < bucket_count; j++) {`)
    buf.push(`int data_pos = ${sym}_buckets[key_pos * 256 + j];`)

    if (typing.isString(valSchema.objValue)) {
      buf.push(`print(${sym}_data_str[data_pos], ${sym}_data_len[data_pos]);`)
    } else {
      buf.push(`printf("%${getFormatSpecifier(valSchema.objValue)}", ${sym}_data[data_pos]);`)
    }

    buf.push(`if (j != bucket_count - 1) {`)
    buf.push(`print(", ", 2);`)
    buf.push(`}`)
    buf.push(`}`)
    buf.push(`print("]", 1);`)
  } else if (typing.isString(valSchema)) {
    buf.push(`print(${sym}_values_str[key_pos], ${sym}_values_len[key_pos]);`)
  } else {
    buf.push(`printf("%${getFormatSpecifier(valSchema)}", ${sym}_values[key_pos]);`)
  }
  buf.push(`print("\\n", 1);`)
  buf.push(`}`)
}

let emitStmInit = (q, sym) => {
  let buf = []
  if (q.key == "stateful") {
    cgen.comment(buf)(`init ${sym} for ${q.op}`)
    if (q.fre.length > 0) {
      let init
      if (q.op == "sum" || q.op == "count") {
        init = `0`
      } else if (q.op == "product") {
        init = `1`
      } else if (q.op == "min") {
        init = `INT_MAX`
      } else if (q.op == "max") {
        init = `INT_MIN`
      } else if (q.op == "array") {
        init = `0`
      } else {
        throw new Error("stateful op not supported: " + pretty(q))
      }
      let keys = q.fre[0].startsWith("K") ? mksetVarEnv[q.fre[0]].map(key => key.val) : [q.fre[0]]
      hashLookUpOrUpdate(buf, sym, keys, (lhs) => cgen.stmt(buf)(cgen.assign(lhs, init)))
    } else {
      if (q.op == "sum" || q.op == "count") {
        cgen.declareVar(buf)(convertToCType(q.schema.type), sym, "0")
      } else if (q.op == "product") {
        cgen.declareVar(buf)(convertToCType(q.schema.type), sym, "1")
      } else if (q.op == "min") {
        cgen.declareVar(buf)(convertToCType(q.schema.type), sym, "INT_MAX")
      } else if (q.op == "max") {
        cgen.declareVar(buf)(convertToCType(q.schema.type), sym, "INT_MIN")
      } else {
        throw new Error("stateful op not supported: " + pretty(q))
      }
    }
  } else if (q.key == "update") {
    cgen.comment(buf)(`init ${sym} for group`)
    let keySchema = mksetVarEnv[q.arg[1].op].schema
    hashMapInit(buf, sym, keySchema.type, q.schema.type.objValue)
  } else {
    throw new Error("unknown op: " + pretty(q))
  }

  return buf
}

let emitStmUpdate = (q, sym) => {
  let buf = []
  if (q.key == "prefix") {
    throw new Error("prefix op not supported: " + pretty(q))
  } if (q.key == "stateful") {
    cgen.comment(buf)(`update ${sym} for ${q.op}`)
    let [e1] = q.arg.map(x => codegen(x, buf))
    if (q.op == "print") {
      if (typing.isString(q.arg[0].schema.type)) {
        let { str, len } = e1
        cgen.stmt(buf)(cgen.call("println1", str, len))
      } else {
        cgen.stmt(buf)(cgen.call("printf", `"%${getFormatSpecifier(q.arg[0].schema.type)}\\n"`, e1))
      }
      return buf
    }
    if (q.fre.length > 0) {
      let update
      if (q.op == "sum") {
        update = (lhs) => cgen.stmt(buf)(cgen.binary(lhs, e1, "+="))
      } else if (q.op == "product") {
        update = (lhs) => cgen.stmt(buf)(cgen.binary(lhs, e1, "*="))
      } else if (q.op == "min") {
        update = (lhs) => cgen.stmt(buf)(`${lhs} = ${e1} < ${lhs} ? ${e1} : ${lhs}`)
      } else if (q.op == "max") {
        update = (lhs) => cgen.stmt(buf)(`${lhs} = ${e1} > ${lhs} ? ${e1} : ${lhs}`)
      } else if (q.op == "count") {
        update = (lhs) => cgen.stmt(buf)(cgen.binary(lhs, "1", "+="))
      } else if (q.op == "single") {
        if (typing.isString(q.schema.type)) {
          update = (lhs) => {
            cgen.stmt(buf)(cgen.assign(lhs.str, e1.str))
            cgen.stmt(buf)(cgen.assign(lhs.len, e1.len))
          }
        } else {
          update = (lhs) => cgen.stmt(buf)(cgen.assign(lhs, e1))
        }
      } else if (q.op == "array") {
        let keys = q.fre[0].startsWith("K") ? mksetVarEnv[q.fre[0]].map(key => key.val) : [q.fre[0]]
        hashBufferInsert(buf, sym, keys, e1)
        return buf
      } else {
        throw new Error("stateful op not supported: " + pretty(q))
      }
      let keys = q.fre[0].startsWith("K") ? mksetVarEnv[q.fre[0]].map(key => key.val) : [q.fre[0]]
      hashUpdate(buf, sym, keys, update)
    } else {
      if (q.op == "sum") {
        cgen.stmt(buf)(cgen.binary(sym, e1, "+="))
      } else if (q.op == "product") {
        cgen.stmt(buf)(cgen.binary(sym, e1, "*="))
      } else if (q.op == "min") {
        cgen.stmt(buf)(`${sym} = ${e1} < ${sym} ? ${e1} : ${sym}`)
      } else if (q.op == "max") {
        cgen.stmt(buf)(`${sym} = ${e1} > ${sym} ? ${e1} : ${sym}`)
      } else if (q.op == "count") {
        cgen.stmt(buf)(cgen.binary(sym, "1", "+="))
      } else if (q.op == "single") {
        // single without free variables
        throw new Error("stateful op not implmeneted: " + pretty(q))
      } else {
        throw new Error("stateful op not supported: " + pretty(q))
      }
    }
  } else if (q.key == "update") {
    cgen.comment(buf)(`update ${sym} for group`)
    let e3 = codegen(q.arg[2], buf)
    let update

    let { valSchema } = hashMapEnv[sym]
    if (typing.isString(valSchema)) {
      update = (lhs) => {
        cgen.stmt(buf)(cgen.assign(lhs.str, e3.str))
        cgen.stmt(buf)(cgen.assign(lhs.len, e3.len))
      }
    } else {
      update = (lhs) => {
        cgen.stmt(buf)(cgen.assign(lhs, e3))
      }
    }
    let keys = q.fre[0].startsWith("K") ? mksetVarEnv[q.fre[0]].map(key => key.val) : [q.fre[0]]
    hashUpdate(buf, sym, keys, update)
  } else {
    throw new Error("unknown op: " + pretty(q))
  }
  return buf
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

let emitCode = (q, ir) => {
  // Translate to newcodegen and let newcodegen do the generation
  let assignmentStms = []
  let generatorStms = []
  let tmpVarWriteRank = {}

  filters = ir.filters
  assignments = ir.assignments
  vars = ir.vars
  order = ir.ordeer

  inputFilesEnv = {}
  nameIdMap = {}
  usedCols = {}

  mksetVarEnv = {}
  hashMapEnv = {}

  validateAndExtractUsedCols(q)

  // generator ir api: mirroring necessary bits from ir.js
  let expr = (txt, ...args) => ({ txt, deps: args })

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
    let info = [`// generator: ${e2.op} <- ${pretty(e1)}`]
    e.getLoopTxt = () => ({
      info, data, initCursor: [], loopHeader: ["{", "// singleton value here"], boundsChecking: [], rowScanning: []
    })
    generatorStms.push(e)
  }

  let getDeps = q => [...q.fre, ...q.tmps.map(tmpSym)]

  let prolog = []
  prolog.push(`#include "rhyme-sql.h"`)
  prolog.push("int main() {")

  let trivialUpdate = {}

  // Collect hashmaps for groupby
  for (let i in assignments) {
    let sym = tmpSym(i)

    let q = assignments[i]

    if (q.key == "update") {
      let keysSchema
      if (q.arg[3].arg[0].arg[0].key == "pure" && q.arg[3].arg[0].arg[0].op == "combine") {
        keysSchema = q.arg[3].arg[0].arg[0].arg.map(e => e.schema.type)
      } else {
        keysSchema = [q.arg[3].arg[0].arg[0].schema.type]
      }
      hashMapEnv[sym] = { keysSchema: keysSchema, valSchema: q.schema.type.objValue }

      if (q.arg[2].key == "pure" && q.arg[2].op == "mkTuple") {
        console.log("here")
      }
      if (q.arg[2].fre.length == 1 && q.arg[1].op == q.arg[2].fre[0]) {
        trivialUpdate[sym] = (q.arg[2].key == "pure" ? tmpSym(q.arg[2].arg[0].op) : tmpSym(q.arg[2].op))
      }
    }
  }

  let emittedCounter = {}
  for (let i in filters) {
    let f = filters[i]
    let v1 = f.arg[1].op
    let g1 = f.arg[0]

    if (g1.key == "loadInput") {
      let loadInput = []
      let file = pretty(g1.arg[0])
      // constant string filename

      // TODO: need to have a better way to do CSE
      // should be done when the loop is actually emitted by new-codegen
      // where we have the info about the current scope

      if (inputFilesEnv[file] == undefined) {
        let isConstStr = g1.arg[0].key == "const" && typeof g1.arg[0].op == "string"
        let buf = isConstStr ? prolog : loadInput
        cgen.comment(buf)(`loading input file: ${file}`)
        let filename = codegen(g1.arg[0], buf)
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

      // declare the loop variable e.g. xA, xB, D0 etc.
      // should just be an integer
      if (!emittedCounter[v1]) {
        let counter = `${quoteVar(v1)}`
        cgen.declareInt(prolog)(counter)
        emittedCounter[v1] = true
      }

      let getLoopTxtFunc = getLoopTxt(f, file, loadInput)
      addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
    } else if (g1.key == "mkset") {
      let data = []
      if (g1.arg[0].key == "pure" && g1.arg[0].op == "combine") {
        let vals = g1.arg[0].arg.map(e => ({
          val: codegen(e, data),
          schema: e.schema
        }))
        mksetVarEnv[v1] = vals
      } else {
        let val = codegen(g1.arg[0], data)
        mksetVarEnv[v1] = [{ val, schema: g1.arg[0].schema }]
      }
      addMkset(f.arg[0], f.arg[1], data)
    } else {
      throw new Error("invalid filter: " + pretty(f))
    }
  }

  for (let i in assignments) {
    let sym = tmpSym(i)

    let q = assignments[i]

    if (q.key == "stateful" && q.fre.length != 0) {
      // if q.fre is not empty, the initialization of stateful op will be in a loop
      // we need to initialize the actual tmp variable separately

      // initialize hashmap
      let keysSchema = q.fre[0].startsWith("K") ? mksetVarEnv[q.fre[0]].map(key => key.schema.type) : [{ type: types.i32 }]
      let buf = []
      hashMapInit(buf, sym, keysSchema, q.schema.type)
      assign(buf, sym, [], [])
    } else if (q.key == "update" && trivialUpdate[sym] !== undefined) {
      let keysSchema = mksetVarEnv[q.arg[1].op].map(key => key.schema.type)
      let buf = []
      hashMapShallowCopy(buf, sym, trivialUpdate[sym], keysSchema, q.schema.type.objValue)
      assign(buf, sym, [], [trivialUpdate[sym]])
      continue
    }

    // emit init
    if (q.key == "stateful" && initRequired[q.op] || q.key == "update") {
      assign(emitStmInit(q, sym), sym, q.fre, [])
    }

    // emit update
    let fv = union(q.fre, q.bnd)
    let deps = [...fv, ...q.tmps.map(tmpSym)] // XXX rhs dims only?

    assign(emitStmUpdate(q, sym), sym, q.fre, deps)
  }

  let res = codegen(q, [], {})

  let epilog = []
  if (q.schema.type.typeSym !== typeSyms.never) {
    if (hashMapEnv[res]) {
      cgen.comment(epilog)("print hashmap")
      hashMapPrint(epilog, res)
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

  let new_codegen_ir = {
    assignmentStms,
    generatorStms,
    tmpVarWriteRank,
    res,
    prolog,
    epilog
  }

  return generate(new_codegen_ir, "c-sql")
}

let emitCode1 = (q, ir) => {

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
  let code1 = emitCode1(q, ir)
  let code = emitCode(q, ir)

  let cFlags = "-Icgen-sql -O3"

  let func = async () => {
    let stdout = await sh(`./${out} `)
    return stdout
  }

  func.explain = func.explain

  let writeAndCompile = async () => {
    await fs.writeFile(cFile, code)
    await sh(`gcc ${cFlags} ${cFile} -o ${out} -Icgen-sql`)
    return func
  }

  return writeAndCompile()
}

exports.generateCSqlNew = generateCSqlNew