const { generate } = require('./new-codegen')
const { typing, typeSyms } = require('./typing')

const KEY_SIZE = 256
const HASH_SIZE = 256

const HASH_MASK = HASH_SIZE - 1

let filters
let assignments
let csvFilesEnv
let usedCols
let mksetVarEnv
let hashMapEnv

let unique = xs => xs.filter((x, i) => xs.indexOf(x) == i)
let union = (a, b) => unique([...a, ...b])

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
}


let ctypeMap = {
  // any:  "rh",
  // never:"rh",
  // boolean:  "rh",
  // string:"rh",
  u8:   "uint8_t",
  u16:  "uint16_t",
  u32:  "uint32_t",
  u64:  "uint64_t",
  i8:   "int8_t",
  i16:  "int16_t",
  i32:  "int32_t",
  i64:  "int64_t",
  f32:  "float",
  f64:  "double",
}

let formatSpecifierMap = {
  // any:  "rh",
  // never:"rh",
  // boolean:  "rh",
  // string:"rh",
  u8:   "hhu",
  u16:  "hu",
  u32:  "u",
  u64:  "lu",
  i8:   "hhd",
  i16:  "hd",
  i32:  "d",
  i64:  "ld",
  f32:  ".3f",
  f64:  ".3lf",
}


let convertToCType = (type) => {
  if (type.typeSym === "dynkey")
    return convertToCType(type.keySuperkey);
  if (type.typeSym === "union")
    throw new Error("Unable to convert union type to C type currently: " + typing.prettyPrintType(type));
  if (type.typeSym in ctypeMap)
    return ctypeMap[type.typeSym]
  throw new Error("Unknown type: " + typing.prettyPrintType(type));
}

let getFormatSpecifier = (type) => {
  if (type.typeSym === "dynkey")
    return getFormatSpecifier(type.keySuperkey);
  if (type.typeSym === "union")
    throw new Error("Unable to get type specifier for union tpyes currently: " + typing.prettyPrintType(type));
  if (type.typeSym in formatSpecifierMap)
    return formatSpecifierMap[type.typeSym]
  throw new Error("Unknown type: " + typing.prettyPrintType(type));
}

let prettyPath = es => {
  if (es === undefined) return "[?]"
  let sub = x => typeof (x) === "string" ? x : pretty(x)
  return "[" + es.map(sub).join(",") + "]"
}

let pretty = q => {
  if (q.key == "input") {
    return "inp"
  } else if (q.key == "loadInput") {
    let [e1] = q.arg.map(pretty)
    return `loadCSV(${e1})`
  } else if (q.key == "const") {
    if (typeof q.op === "object" && Object.keys(q.op).length == 0) return "{}"
    else return "" + q.op
  } else if (q.key == "var") {
    return q.op
  } else if (q.key == "ref") {
    let e1 = assignments[q.op]
    return "tmp" + q.op + prettyPath(e1.fre)
  } else if (q.key == "get") {
    let [e1, e2] = q.arg.map(pretty)
    if (e1 == "inp") return e2
    // if (q.arg[1].key == "var") { // hampers CSE pre-extract
    // if (q.filter === undefined) // def
    // return e2 + " <- " + e1
    // }
    return e1 + "[" + e2 + "]"
  } else if (q.key == "pure") {
    let es = q.arg.map(pretty)
    return q.op + "(" + es.join(", ") + ")"
  } else if (q.key == "hint") {
    let es = q.arg.map(pretty)
    return q.op + "(" + es.join(", ") + ")"
  } else if (q.key == "mkset") {
    let [e1] = q.arg.map(pretty)
    return "mkset(" + e1 + ")"
  } else if (q.key == "prefix") {
    let [e1] = q.arg.map(pretty)
    return "prefix_" + q.op + "(" + e1 + ")"
  } else if (q.key == "stateful") {
    let [e1] = q.arg.map(pretty)
    return q.op + "(" + e1 + ")"
  } else if (q.key == "group") {
    let [e1, e2] = q.arg.map(pretty)
    return "{ " + e1 + ": " + e2 + " }"
  } else if (q.key == "update") {
    let [e0, e1, e2, e3] = q.arg.map(pretty)
    if (e3) return e0 + "{ " + e1 + ": " + e2 + " } / " + e3
    return e0 + "{ " + e1 + ": " + e2 + " }"
  } else {
    console.error("unknown op", q)
  }
}

let operators = {
  equal: "==",
  notEqual: "!=",

  plus: "+",
  minus: "-",
  times: "*",
  fdiv: "/",
  div: "/",
  mod: "%",
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
    if (!(e1.arg[0].key == "loadInput" && e1.arg[1].key == "var")) {
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
      // strings do not need to be extracted
      return
    }
    if (typing.isInteger(q.schema.type)) {
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
let emitLoadCSV = (buf, filename, id, isConstStr = true) => {
  let fd = "fd" + id
  let mappedFile = "csv" + id
  let size = "n" + id
  if (isConstStr) {
    buf.push(`int ${fd} = open("${filename}", 0);`)
  } else {
    buf.push(`int ${fd} = open(${filename}, 0);`)
  }
  buf.push(`if (${fd} == -1) {`)
  if (isConstStr) {
    buf.push(`fprintf(stderr, "Unable to open file ${filename}\\n");`);
  } else {
    buf.push(`fprintf(stderr, "Unable to open file ${filename}: %s\\n", ${filename});`);
  }
  buf.push(`return 1;`)
  buf.push(`}`)
  buf.push(`int ${size} = fsize(${fd});`)
  buf.push(`char *${mappedFile} = mmap(0, ${size}, PROT_READ, MAP_FILE | MAP_SHARED, ${fd}, 0);`)
  buf.push(`close(${fd});`)

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
      buf.push(`char ${name}[${q.op.length + 1}] = "${q.op}";`)
      return { file: name, start: "0", end: q.op.length }
    } else {
      throw new Error("constant not supported: " + pretty(q))
    }
  } else if (q.key == "var") {
    throw new Error("cannot have stand-alone var")
  } else if (q.key == "ref") {
    let q1 = assignments[q.op]
    if (q1.fre.length > 0) {
      let sym = tmpSym(q.op)
      let key = mksetVarEnv[q1.fre[0]].val
      let keyPos = hashLookUp(buf, sym, key)[1]
      let { valSchema } = hashMapEnv[sym]
      if (typing.isString(valSchema)) {
        return { file: `${sym}_values_str[${keyPos}]`, start: "0", end: `${sym}_values_len[${keyPos}]` }
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
      let keyPos = hashLookUp(buf, sym, key)[1]
      let { valSchema } = hashMapEnv[sym]
      if (typing.isString(valSchema)) {
        return { file: `${sym}_values_str[${keyPos}]`, start: "0", end: `${sym}_values_len[${keyPos}]` }
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

    let { mappedFile } = csvFilesEnv[filename]

    let v = e1.arg[1].op

    let start = [mappedFile, quoteVar(v), e2.op, "start"].join("_")
    let end = [mappedFile, quoteVar(v), e2.op, "end"].join("_")

    let name = [mappedFile, quoteVar(v), e2.op].join("_")

    if (typing.isInteger(q.schema.type)) {
      return name
    } else if (typing.isString(q.schema.type)) {
      return { file: mappedFile, start, end }
    } else {
      throw new Error("cannot extract value of type " + typing.prettyPrintTuple(q.schema))
    }
  } else if (q.key == "pure") {
    let e1 = codegen(q.arg[0], buf)
    let op = operators[q.op]
    if (q.op == "plus" || q.op == "minus" || q.op == "times" || q.op == "fdiv" || q.op == "div" || q.op == "mod") {
      let e2 = codegen(q.arg[1], buf)
      if (q.op == "fdiv") {
        return `(double)${e1} ${op} (double)${e2}`
      }
      return `${e1} ${op} ${e2}`
    } else if (q.op == "equal" || q.op == "notEqual") {
      let e2 = codegen(q.arg[1], buf)
      if (typing.isString(q.arg[0].schema.type) && typing.isString(q.arg[1].schema.type)) {
        let { file: file1, start: start1, end: end1 } = e1
        let { file: file2, start: start2, end: end2 } = e2
        let name = getNewName("tmp_cmpstr")
        buf.push(`int ${name} = compare_str1(${file1}, ${start1}, ${end1}, ${file2}, ${start2}, ${end2}) ${op} 0;`)
        return name
      } else if (typing.isInteger(q.arg[0].schema.type) && typing.isInteger(q.arg[1].schema.type)) {
        return `${e1} ${op} ${e2}`
      }
    } else if (q.op == "and") {
      buf.push(`if (!(${e1})) {`)
      buf.push(`continue;`)
      buf.push(`}`)
      let e2 = codegen(q.arg[1], buf)
      return e2
    } else {
      throw new Error("pure operation not supported: " + pretty(q))
    }
  } else {
    throw new Error("unknown op: " + pretty(q))
  }
}

let hash = (buf, key, schema) => {
  let hashed = getNewName("hash")
  if (typing.isString(schema)) {
    buf.push(`unsigned long ${hashed} = hash(${key.file}, ${key.start}, ${key.end});`)
  } else if (typing.isInteger(schema)) {
    buf.push(`unsigned long ${hashed} = (unsigned long)${key};`)
  } else {
    throw new Error("cannot hash key with type " + typing.prettyPrintType(schema))
  }

  return hashed
}

// Emit the code that finds the key in the hashmap.
// Linear probing is used for resolving collisions.
// Comparison of keys is based on different key types.
let hashLookUp = (buf, sym, key) => {
  let { keySchema } = hashMapEnv[sym]
  let hashed = hash(buf, key, keySchema)

  let pos = getNewName("pos")
  buf.push(`unsigned long ${pos} = ${hashed} & ${HASH_MASK};`)

  let keyPos = `${sym}_htable[${pos}]`

  if (typing.isString(keySchema)) {
    let keyStr = `${sym}_keys_str[${keyPos}]`
    let keyLen = `${sym}_keys_len[${keyPos}]`

    let str = `${key.file} + ${key.start}`
    let len = `${key.end} - ${key.start}`

    buf.push(`while (${keyPos} != -1 && compare_str2(${keyStr}, ${keyLen}, ${str}, ${len}) != 0) {`)
    buf.push(`${pos} = (${pos} + 1) & ${HASH_MASK};`)
    buf.push(`}`)
  } else {
    buf.push(`while (${keyPos} != -1 && ${sym}_keys[${keyPos}] != ${key}) {`)
    buf.push(`${pos} = (${pos} + 1) & ${HASH_MASK};`)
    buf.push(`}`)
  }

  keyPos = getNewName("key_pos")
  buf.push(`int ${keyPos} = ${sym}_htable[${pos}];`)

  return [pos, keyPos]
}

// Emit the code that performs a lookup of the key in the hashmap, then
// if the key is found:
//   does nothing
// if the key is not found:
//   inserts a new key into the hashmap and initializes it
let hashLookUpOrUpdate = (buf, sym, key, update) => {
  let [pos, keyPos] = hashLookUp(buf, sym, key)

  buf.push(`if (${keyPos} == -1) {`)

  buf.push(`${keyPos} = ${sym}_key_count;`)
  buf.push(`${sym}_key_count++;`)

  buf.push(`${sym}_htable[${pos}] = ${keyPos};`)

  let { keySchema, valSchema } = hashMapEnv[sym]
  if (typing.isString(keySchema)) {
    let keyStr = `${sym}_keys_str[${keyPos}]`
    let keyLen = `${sym}_keys_len[${keyPos}]`

    buf.push(`${keyStr} = ${key.file} + ${key.start};`)
    buf.push(`${keyLen} = ${key.end} - ${key.start};`)
  } else {
    buf.push(`${sym}_keys[${keyPos}] = ${key};`)
  }

  let lhs
  if (typing.isString(valSchema)) {
    lhs = { str: `${sym}_values_str[${keyPos}]`, len: `${sym}_values_len[${keyPos}]` }
  } else {
    lhs = `${sym}_values[${keyPos}]`
  }

  buf.push(update(lhs))

  buf.push(`}`)
}

// Emit the code that performs a lookup of the key in the hashmap, then
// if the key is found:
//   updates the corresponding value.
// if the key is not found:
//   inserts a new key into the hashmap and initializes it.
let hashUpdate = (buf, sym, key, update) => {
  let [pos, keyPos] = hashLookUp(buf, sym, key)

  buf.push(`if (${keyPos} == -1) {`)

  buf.push(`${keyPos} = ${sym}_key_count;`)
  buf.push(`${sym}_key_count++;`)

  buf.push(`${sym}_htable[${pos}] = ${keyPos};`)

  let { keySchema, valSchema } = hashMapEnv[sym]
  if (typing.isString(keySchema)) {
    let keyStr = `${sym}_keys_str[${keyPos}]`
    let keyLen = `${sym}_keys_len[${keyPos}]`

    buf.push(`${keyStr} = ${key.file} + ${key.start};`)
    buf.push(`${keyLen} = ${key.end} - ${key.start};`)
  } else {
    buf.push(`${sym}_keys[${keyPos}] = ${key};`)
  }

  buf.push(`}`)

  let lhs
  if (typing.isString(valSchema)) {
    lhs = { str: `${sym}_values_str[${keyPos}]`, len: `${sym}_values_len[${keyPos}]` }
  } else {
    lhs = `${sym}_values[${keyPos}]`
  }

  buf.push(update(lhs))
}

// Emit code that initializes a hashmap.
// For string keys / values, they are represented by
// a pointer to the beginning of the string and the length of the string
let hashMapInit = (buf, sym, keySchema, valSchema) => {
  buf.push(`// init hashmap for ${sym}`)
  // keys
  buf.push(`// keys of ${sym}`)

  if (typing.isString(keySchema)) {
    buf.push(`char **${sym}_keys_str = (char **)malloc(${KEY_SIZE} * sizeof(char *));`)
    buf.push(`int *${sym}_keys_len = (int *)malloc(${KEY_SIZE} * sizeof(int));`)
  } else {
    let cType = convertToCType(keySchema)
    buf.push(`${cType} *${sym}_keys = (${cType} *)malloc(${KEY_SIZE} * sizeof(${cType}));`)
  }

  buf.push(`// key count for ${sym}`)
  buf.push(`int ${sym}_key_count = 0;`)

  // htable
  buf.push(`// hash table for ${sym}`)
  buf.push(`int *${sym}_htable = (int *)malloc(${HASH_SIZE} * sizeof(int));`)

  // init htable entries to -1
  buf.push(`// init hash table entries to -1 for ${sym}`)
  buf.push(`for (int i = 0; i < ${HASH_SIZE}; i++) ${sym}_htable[i] = -1;`)

  buf.push(`// values of ${sym}`)

  if (typing.isString(valSchema)) {
    buf.push(`char **${sym}_values_str = (char **)malloc(${KEY_SIZE} * sizeof(char *));`)
    buf.push(`int *${sym}_values_len = (int *)malloc(${KEY_SIZE} * sizeof(int));`)
  } else {
    let cType = convertToCType(valSchema)
    buf.push(`${cType} *${sym}_values = (${cType} *)malloc(${KEY_SIZE} * sizeof(${cType}));`)
  }

  hashMapEnv[sym] = { keySchema, valSchema }
}

// Emit code that prints the keys and values in a hashmap.
let hashMapPrint = (buf, sym) => {
  let { keySchema, valSchema } = hashMapEnv[sym]
  buf.push(`for (int i = 0; i < ${HASH_SIZE}; i++) {`)
  buf.push(`int keyPos = ${sym}_htable[i];`)
  buf.push(`if (keyPos == -1) {`)
  buf.push(`continue;`)
  buf.push(`}`)
  buf.push(`// print key`)

  if (typing.isString(keySchema)) {
    buf.push(`print(${sym}_keys_str[keyPos], ${sym}_keys_len[keyPos]);`)
  } else {
    buf.push(`printf("%${getFormatSpecifier(keySchema)}", ${sym}_keys[keyPos]);`)
  }

  buf.push(`print(": ", 2);`)

  buf.push(`// print value`)
  if (typing.isString(valSchema)) {
    buf.push(`print(${sym}_values_str[keyPos], ${sym}_values_len[keyPos]);`)
    buf.push(`print("\\n", 1);`)
  } else {
    buf.push(`printf("%${getFormatSpecifier(valSchema)}\\n", ${sym}_values[keyPos]);`)
  }
  buf.push(`}`)
}

let emitStmInit = (q, sym) => {
  let buf = []
  if (q.key == "stateful") {
    buf.push(`// init ${sym} for ${q.op}`)
    if (q.fre.length > 0) {
      let update
      if (q.op == "sum" || q.op == "count") {
        update = `= 0`
      } else if (q.op == "product") {
        update = `= 1`
      } else if (q.op == "min") {
        update = `= INT_MAX`
      } else if (q.op == "max") {
        update = `= INT_MIN`
      } else {
        throw new Error("stateful op not supported: " + pretty(q))
      }
      let key = mksetVarEnv[q.fre[0]].val
      hashLookUpOrUpdate(buf, sym, key, (lhs) => `${lhs} ${update};`)
    } else {
      if (q.op == "sum" || q.op == "count") {
        buf.push(`${convertToCType(q.schema.type)} ${sym} = 0;`)
      } else if (q.op == "product") {
        buf.push(`${convertToCType(q.schema.type)} ${sym} = 1;`)
      } else if (q.op == "min") {
        buf.push(`${convertToCType(q.schema.type)} ${sym} = INT_MAX;`)
      } else if (q.op == "max") {
        buf.push(`${convertToCType(q.schema.type)} ${sym} = INT_MIN;`)
      } else {
        throw new Error("stateful op not supported: " + pretty(q))
      }
    }
  } else if (q.key == "update") {
    buf.push(`// init ${sym} for group`)
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
    buf.push(`// update ${sym} for ${q.op}`)
    let [e1] = q.arg.map(x => codegen(x, buf))
    if (q.op == "print") {
      if (typing.isString(q.arg[0].schema.type)) {
        let { file, start, end } = e1
        buf.push(`println(${file}, ${start}, ${end});`)
      } else {
        let [e1] = q.arg.map(x => codegen(x, buf))
        buf.push(`printf("%${getFormatSpecifier(q.arg[0].schema.type)}\\n", ${e1});`)
      }
      return buf
    }
    if (q.fre.length > 0) {
      let update
      if (q.op == "sum") {
        update = (lhs) => `${lhs} += ${e1};`
      } else if (q.op == "product") {
        update = (lhs) => `${lhs} += ${e1};`
      } else if (q.op == "min") {
        update = (lhs) => `${lhs} = ${e1} < ${lhs} ? ${e1} : ${lhs};`
      } else if (q.op == "max") {
        update = (lhs) => `${lhs} = ${e1} > ${lhs} ? ${e1} : ${lhs};`
      } else if (q.op == "count") {
        update = (lhs) => `${lhs} += 1;`
      } else if (q.op == "single") {
        // It is possible that the value is a string
        if (typing.isString(q.schema.type)) {
          update = (lhs) => `${lhs.str} = ${e1.file} + ${e1.start}; ${lhs.len} = ${e1.end} - ${e1.start};`
        } else {
          update = (lhs) => `${lhs} = ${e1};`
        }
      } else {
        throw new Error("stateful op not supported: " + pretty(q))
      }
      let key = mksetVarEnv[q.fre[0]].val
      hashUpdate(buf, sym, key, update)
    } else {
      if (q.op == "sum") {
        buf.push(`${sym} += ${e1};`)
      } else if (q.op == "product") {
        buf.push(`${sym} *= ${e1};`)
      } else if (q.op == "min") {
        buf.push(`${sym} = ${e1} < ${sym} ? ${e1} : ${sym};`)
      } else if (q.op == "max") {
        buf.push(`${sym} = ${e1} > ${sym} ? ${e1} : ${sym};`)
      } else if (q.op == "count") {
        buf.push(`${sym} += 1;`)
      } else if (q.op == "single") {
        // single without free variables
        throw new Error("stateful op not implmeneted: " + pretty(q))
      } else {
        throw new Error("stateful op not supported: " + pretty(q))
      }
    }
  } else if (q.key == "update") {
    buf.push(`// update ${sym} for group`)
    let e3 = codegen(q.arg[2], buf)
    let update

    let { valSchema } = hashMapEnv[sym]
    if (typing.isString(valSchema)) {
      update = (lhs) => `${lhs.str} = ${e3.file} + ${e3.start}; ${lhs.len} = ${e3.end} - ${e3.start};`
    } else {
      update = (lhs) => `${lhs} = ${e3};`
    }
    let key = mksetVarEnv[q.arg[1].op].val
    hashUpdate(buf, sym, key, update)
  } else {
    throw new Error("unknown op: " + pretty(q))
  }
  return buf
}

// Emit code that scans through each row in the CSV file.
// Will extract the value of a column if the column is used by the query.
let emitRowScanning = (f, filename, cursor, schema, first = true) => {
  if (schema.objKey === null)
    return [];
  let buf = []
  let v = f.arg[1].op
  let { mappedFile, size } = csvFilesEnv[filename]

  let colName = schema.objKey
  let type = schema.objValue
  let prefix = pretty(f)
  let needToExtract = usedCols[prefix][colName]

  buf.push(`// reading column ${colName}`)

  let start = [mappedFile, quoteVar(v), colName, "start"].join("_")
  let end = [mappedFile, quoteVar(v), colName, "end"].join("_")
  let name = [mappedFile, quoteVar(v), colName].join("_")

  if (needToExtract && typing.isInteger(type)) {
    buf.push(`${convertToCType(type)} ${name} = 0;`)
  }

  let delim = first ? "\\n" : ","

  buf.push(`int ${start} = ${cursor};`)
  buf.push(`while (${cursor} < ${size} && ${mappedFile}[${cursor}] != '${delim}') {`)

  if (needToExtract && typing.isInteger(type)) {
    buf.push(`// extract integer`)
    buf.push(`${name} *= 10;`)
    buf.push(`${name} += ${mappedFile}[${cursor}] - '0';`)
  }

  buf.push(`${cursor}++;`)
  buf.push("}")

  buf.push(`int ${end} = ${cursor};`)
  buf.push(`${cursor}++;`)

  return [...emitRowScanning(f, filename, cursor, schema.objParent, false), ...buf]
}

// Returns a function that will be invoked during the actual code generation
// It requests a new cursor name every time it is invoked
let getLoopTxt = (f, filename, loadCSV) => () => {
  let v = f.arg[1].op
  let { mappedFile, size } = csvFilesEnv[filename]

  let initCursor = []

  let info = [`// generator: ${v} <- ${pretty(f.arg[0])}`]

  let cursor = getNewName("i")
  initCursor.push(`int ${cursor} = 0;`)
  initCursor.push(`while (${cursor} < ${size} && ${mappedFile}[${cursor}] != '\\n') {`)
  initCursor.push(`${cursor}++;`)
  initCursor.push("}")
  initCursor.push(`${cursor}++;`)

  let loopHeader = []
  loopHeader.push(`${quoteVar(v)} = -1;`)
  loopHeader.push("while (1) {")
  loopHeader.push(`${quoteVar(v)}++;`)
  let boundsChecking = [`if (${cursor} >= ${size}) break;`]

  let schema = f.schema.type
  let rowScanning = emitRowScanning(f, filename, cursor, schema)

  return {
    info, data: loadCSV, initCursor, loopHeader, boundsChecking, rowScanning
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

  csvFilesEnv = {}
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

  // Collect hashmaps for groupby
  for (let i in assignments) {
    let sym = tmpSym(i)

    let q = assignments[i]

    if (q.key == "update") {
      let keySchema = q.arg[3].arg[0].arg[0].schema
      hashMapEnv[sym] = { keySchema: keySchema.type, valSchema: q.schema.type.objValue }
    }
  }

  let emittedCounter = {}
  for (let i in filters) {
    let f = filters[i]
    let v1 = f.arg[1].op
    let g1 = f.arg[0]

    if (g1.key == "loadInput" && g1.op == "csv") {
      let loadCSV = []
      let filename
      // constant string filename

      // TODO: need to have a better way to do CSE
      // should be done when the loop is actually emitted by new-codegen
      // where we have the info about the current scope
      if (g1.arg[0].key == "const" && typeof g1.arg[0].op == "string") {
        filename = g1.arg[0].op
        if (csvFilesEnv[filename] == undefined) {
          prolog.push(`// loading CSV file: ${filename}`)
          let { mappedFile, size } = emitLoadCSV(prolog, filename, i)
          csvFilesEnv[filename] = { mappedFile, size }
        }
      } else {
        filename = pretty(g1.arg[0])
        if (csvFilesEnv[filename] == undefined) {
          loadCSV.push(`// loading CSV file: ${filename}`)
          let file = codegen(g1.arg[0], [])
          let tmpStr = getNewName("tmp_filename")
          loadCSV.push(`char ${tmpStr}[${file.end} - ${file.start} + 1];`)
          loadCSV.push(`extract_str(${file.file}, ${file.start}, ${file.end}, ${tmpStr});`)
          let { mappedFile, size } = emitLoadCSV(loadCSV, tmpStr, i, false)
          csvFilesEnv[filename] = { mappedFile, size }
        }
      }

      // declare the loop row counter e.g. xA, xB, D0 etc.
      // should just be an integer
      if (!emittedCounter[v1]) {
        let counter = `${quoteVar(v1)}`
        prolog.push(`int ${counter};`)
        emittedCounter[v1] = true
      }

      let getLoopTxtFunc = getLoopTxt(f, filename, loadCSV)
      addGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
    } else if (g1.key == "mkset") {
      let data = []
      let val = codegen(g1.arg[0], data)
      mksetVarEnv[v1] = { val, schema: g1.arg[0].schema }
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
      let keySchema = mksetVarEnv[q.fre[0]].schema
      let buf = []
      hashMapInit(buf, sym, keySchema.type, q.schema.type)
      assign(buf, sym, [], []);
    }

    // emit init
    if (q.key == "stateful" && initRequired[q.op] || q.key == "update") {
      assign(emitStmInit(q, sym), sym, q.fre, [])
    }

    // emit update
    let fv = union(q.fre, q.bnd)
    let deps = [...fv, ...q.tmps.map(tmpSym)] // XXX rhs dims only?

    assign(emitStmUpdate(q, sym, q.fre), sym, q.fre, deps)
  }

  let res = codegen(q, [], {})

  let epilog = []
  if (q.schema.type.typeSym !== typeSyms.never) {
    if (hashMapEnv[res]) {
      epilog.push("// print hashmap")
      hashMapPrint(epilog, res)
    } else {
      if (typing.isString(q.schema.type)) {
        epilog.push(`println(${res.file}, ${res.start}, ${res.end});`)
      } else {
        epilog.push(`printf("%${getFormatSpecifier(q.schema.type)}\\n", ${res});`)
      }
    }
  }
  epilog.push("return 0;")
  epilog.push("}");

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

let generateCSqlNew = (q, ir, outDir, outFile) => {
  const fs = require('fs/promises')
  const os = require('child_process')

  let execPromise = function (cmd) {
    return new Promise(function (resolve, reject) {
      os.exec(cmd, function (err, stdout) {
        if (err) {
          reject(err);
        }
        resolve(stdout);
      })
    })
  }

  let code = emitCode(q, ir)

  let func = async () => {
    await fs.writeFile(`${outDir}/${outFile}`, code);
    await execPromise(`gcc ${outDir}/${outFile} -o ${outDir}/tmp -Icgen-sql`)
    return `${outDir}/tmp`
  }

  let wrap = async (input) => {
    let file = await func()
    let res = await execPromise(file)
    return res
  }

  wrap.explain = {
    ir,
    code
  }

  return wrap
}

exports.generateCSqlNew = generateCSqlNew