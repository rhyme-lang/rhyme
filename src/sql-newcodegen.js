const { isString } = require('node:util')
const { generate } = require('./new-codegen')
const { typing, types } = require('./typing')

let filters
let assignments

let csvFilesEnv
let usedCols

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

let convertToCType = (type) => {
  if (type.__rh_type === "dynkey")
    return convertToCType(type.__rh_type_superkey);
  if (type.__rh_type === "union")
    throw new Error("Unable to convert union type to C type currently: " + typing.prettyPrintType(type));
  if (type === types.u8)
    return "uint8_t";
  if (type === types.u16)
    return "uint16_t";
  if (type === types.u32)
    return "uint32_t";
  if (type === types.u64)
    return "uint64_t";
  if (type === types.i8)
    return "int8_t";
  if (type === types.i16)
    return "int16_t";
  if (type === types.i32)
    return "int32_t";
  if (type === types.i64)
    return "int64_t";
  if (type === types.f32)
    return "float";
  if (type === types.f64)
    return "double";
  throw new Error("Unknown type: " + typing.prettyPrintType(type));
}

let getFormatSpecifier = (type) => {
  if (type.__rh_type === "dynkey")
    return getFormatSpecifier(type.__rh_type_superkey);
  if (type.__rh_type === "union")
    throw new Error("Unable to get type specifier for union tpyes currently: " + typing.prettyPrintType(type));
  if (type === types.u8)
    return "hhu";
  if (type === types.u16)
    return "hu";
  if (type === types.u32)
    return "u";
  if (type === types.u64)
    return "lu";
  if (type === types.i8)
    return "hhd";
  if (type === types.i16)
    return "hd";
  if (type === types.i32)
    return "d";
  if (type === types.i64)
    return "ld";
  if (type === types.f32)
    return "f";
  if (type === types.f64)
    return "lf";
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

let validateAndExtractUsedCols = (q, extractStr = false) => {
  if (q.key == "get") {
    let [e1, e2] = q.arg

    // check if the get is valid
    if (!(e1.key == "get" && e2.key == "const")) {
      throw new Error("malformed get: " + pretty(q))
    }
    if (!(e1.arg[0].key == "loadInput" && e1.arg[1].key == "var")) {
      throw new Error("malformed e1 in get: " + pretty(e1))
    }
    if (typeof e2.op != "string") {
      throw new Error("column name is not a constant string: " + pretty(e2))
    }

    let prefix = pretty(e1) // does this always work?
    usedCols[prefix] ??= {}

    if (typing.isInteger(q.schema)) {
      usedCols[prefix][e2.op] = true
    } else if (typing.isString(q.schema)) {
      // only extract the string if we need a null-terminated string
      // e.g. filename used for open()
      if (extractStr) {
        usedCols[prefix][e2.op] = true
      }
    } else {
      throw new Error("column data type not supported: " + pretty(q) + " has type " + typing.prettyPrintType(q.schema))
    }

    // extract used columns for the filename
    // we need to extract the string (copy to a temp buffer)
    // because we need a null-terminated string for open()
    validateAndExtractUsedCols(e1.arg[0].arg[0], true)
  } else if (q.key == "ref") {
    let e1 = assignments[q.op]
    validateAndExtractUsedCols(e1)
  } else if (q.key == "update") {
    if (q.arg[3] == undefined) {
      throw new Error("trivial group op not supported for now: " + pretty(q))
    }
    let [_e1, _e2, e3, e4] = q.arg

    if (!typing.isString(e4.arg[0].arg[0].schema)) {
      throw new Error("only string values allowed for mkset")
    }

    // value
    validateAndExtractUsedCols(e3)
    // mkset
    validateAndExtractUsedCols(e4.arg[0].arg[0])
  } else if (q.arg) q.arg.map(x => validateAndExtractUsedCols(x))
}

let emitLoadCSV = (buf, filename, id, isConstStr = true) => {
  buf.push(`// loadCSV ${filename}`)
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

  csvFilesEnv[filename] = { mappedFile, size }
}

// returns an object that contains info about the symbol generated
// since sometimes we need the start and end index istead of the value
// For column access: 
// { type, file, start, end }
// For constant string / integer
// { type, symbol }
let codegenCSql = (q, buf, extractStr = false) => {
  if (q.key == "loadInput") {
    throw new Error("cannot have stand-alone loadInput")
  } else if (q.key == "const") {
    if (typeof q.op == "number") {
      return q.op
    } else if (typeof q.op == "string") {
      let name = getNewName("tmp_str")
      buf.push(`char ${name}[${q.op.length + 1}] = "${q.op}";`)
      return extractStr ? name : { file: name, start: 0, end: q.op.length }
    } else {
      throw new Error("constant not supported: " + pretty(q))
    }
  } else if (q.key == "var") {
    throw new Error("cannot have stand-alone var")
  } else if (q.key == "ref") {
    let q1 = assignments[q.op]
    if (q1.fre.length > 0) {
      let xs = q1.fre.map(x => `[${x}]`).join("")
      return "*" + tmpSym(q.op) + xs
    } else {
      return tmpSym(q.op)
    }
  } else if (q.key == "get") {
    let [e1, e2] = q.arg

    let file = e1.arg[0].arg[0]
    let filename
    if (file.key == "const" && typeof file.op == "string") {
      filename = file.op
    } else {
      // extract filename, we don't want it to push more stuff into the buf
      filename = codegenCSql(file, [], true)
    }

    let { mappedFile } = csvFilesEnv[filename]

    let v = e1.arg[1].op

    let start = [mappedFile, quoteVar(v), e2.op, "start"].join("_")
    let end = [mappedFile, quoteVar(v), e2.op, "end"].join("_")

    let name = [mappedFile, quoteVar(v), e2.op].join("_")

    if (typing.isInteger(q.schema)) {
      return name
    } else if (q.schema == types.string) {
      if (extractStr) {
        return name
      } else {
        return { file: mappedFile, start, end }
      }
    } else {
      throw new Error("cannot extract value of type " + typing.prettyPrintType(q.schema))
    }
  } else if (q.key == "pure") {
    let e1 = codegenCSql(q.arg[0], buf)
    let op = operators[q.op]
    if (q.op == "plus" || q.op == "minus" || q.op == "times" || q.op == "fdiv" || q.op == "div" || q.op == "mod") {
      let e2 = codegenCSql(q.arg[1], buf)
      return `${e1} ${op} ${e2}`
    } else if (q.op == "equal" || q.op == "notEqual") {
      let e2 = codegenCSql(q.arg[1], buf)
      if (typing.isString(q.arg[0].schema) && typing.isString(q.arg[1].schema)) {
        let { file: file1, start: start1, end: end1 } = e1
        let { file: file2, start: start2, end: end2 } = e2
        let name = getNewName("tmp_cmpstr")
        buf.push(`int ${name} = compare_str1(${file1}, ${start1}, ${end1}, ${file2}, ${start2}, ${end2}) ${op} 0;`)
        return name
      } else if (typing.isInteger(q.arg[0].schema) && typing.isInteger(q.arg[1].schema)) {
        return `${e1} ${op} ${e2}`
      }
    } else if (q.op == "and") {
      buf.push(`if (!(${e1})) {`)
      buf.push(`continue;`)
      buf.push(`}`)
      let e2 = codegenCSql(q.arg[1], buf)
      return e2
    } else {
      throw new Error("pure operation not supported: " + pretty(q))
    }
  } else {
    throw new Error("unknown op: " + pretty(q))
  }
}

let emitTmpInit = (q, sym) => {
  let buf = []
  buf.push(`// init ${sym}`)
  buf.push(`${convertToCType(q.schema)} *${sym}[1024] = { 0 };`)

  return buf
}

let emitStmInitCSql = (q, sym, fre) => {
  let buf = []
  if (q.key == "stateful") {
    buf.push(`// init ${sym} for ${q.op}`)
    if (fre.length > 0) {
      let name = `${sym}[${fre[0]}]` // always one free var?
      buf.push(`if (${name} == NULL) {`)
      buf.push(`${name} = (${convertToCType(q.schema)} *)malloc(sizeof(${convertToCType(q.schema)}));`)
      if (q.op == "sum" || q.op == "count") {
        buf.push(`*${name} = 0;`)
      } else if (q.op == "product") {
        buf.push(`*${name} = 1;`)
      } else if (q.op == "min") {
        buf.push(`*${name} = INT_MAX;`)
      } else if (q.op == "max") {
        buf.push(`*${name} = INT_MIN;`)
      } else {
        throw new Error("stateful op not supported: " + pretty(q))
      }
      buf.push(`}`)
    } else {
      if (q.op == "sum" || q.op == "count") {
        buf.push(`${convertToCType(q.schema)} ${sym} = 0;`)
      } else if (q.op == "product") {
        buf.push(`${convertToCType(q.schema)} ${sym} = 1;`)
      } else if (q.op == "min") {
        buf.push(`${convertToCType(q.schema)} ${sym} = INT_MAX;`)
      } else if (q.op == "max") {
        buf.push(`${convertToCType(q.schema)} ${sym} = INT_MIN;`)
      } else {
        throw new Error("stateful op not supported: " + pretty(q))
      }
    }

  } else if (q.key == "update") {
    buf.push(`// init ${sym} for group`)
    let valType = q.schema[0][1]
    buf.push(`${convertToCType(valType)} *${sym}[1024] = { 0 };`)
  } else {
    throw new Error("unknown op: " + pretty(q))
  }

  return buf
}

let emitStmUpdateCSql = (q, sym, fre) => {
  let buf = []
  if (q.key == "prefix") {
    throw new Error("prefix op not supported: " + pretty(q))
  } if (q.key == "stateful") {
    buf.push(`// update ${sym} for ${q.op}`)
    let lhs
    if (fre.length > 0) {
      lhs = `*${sym}[${fre[0]}]`
    } else {
      lhs = sym
    }
    if (q.op == "print") {
      if (typing.isString(q.arg[0].schema)) {
        let [e1] = q.arg.map(x => codegenCSql(x, buf))
        let { file, start, end } = e1
        buf.push(`println(${file}, ${start}, ${end});`)
      } else {
        let [e1] = q.arg.map(x => codegenCSql(x, buf))
        buf.push(`printf("%${getFormatSpecifier(q.arg[0].schema)}\\n", ${e1});`)
      }
      return buf
    }
    let [e1] = q.arg.map(x => codegenCSql(x, buf))
    if (q.op == "sum") {
      buf.push(`${lhs} += ${e1};`)
    } else if (q.op == "product") {
      buf.push(`${lhs} *= ${e1};`)
    } else if (q.op == "min") {
      buf.push(`${lhs} = ${e1} < ${lhs} ? ${e1} : ${lhs};`)
    } else if (q.op == "max") {
      buf.push(`${lhs} = ${e1} > ${lhs} ? ${e1} : ${lhs};`)
    } else if (q.op == "count") {
      buf.push(`${lhs} += 1;`)
    } else if (q.op == "single") {
      // since init is not required for "single", the table entry could be NULL
      // call malloc if necessary
      // is lhs always a pointer dereference (when q.fre.length > 0)
      let name = lhs.slice(1)
      buf.push(`// stateful single, need to check if the key is already there and if the value is different`)
      buf.push(`if (${name} == NULL) {`)
      buf.push(`${name} = (${convertToCType(q.schema)} *)malloc(sizeof(${convertToCType(q.schema)}));`)
      buf.push(`} else if (*${name} != ${e1}) {`)
      // need to deal with different data types
      buf.push(`fprintf(stderr, "warning: single value expected but got multiple");`)
      buf.push(`}`)
      buf.push(`${lhs} = ${e1};`)
    } else {
      throw new Error("stateful op not supported: " + pretty(q))
    }
  } else if (q.key == "update") {
    buf.push(`// update ${sym} for group`)
    let val = codegenCSql(q.arg[2], buf)
    let v = q.arg[1].op
    let lhs = `${sym}[${v}]`
    buf.push(`if (${lhs} == NULL) {`)
    buf.push(`${lhs} = (${convertToCType(q.schema[0][1])} *)malloc(sizeof(${convertToCType(q.schema[0][1])}));`)
    buf.push(`}`)
    buf.push(`*${lhs} = ${val};`)
  } else {
    throw new Error("unknown op: " + pretty(q))
  }
  return buf
}

let emitRowScanning = (f, filename, cursor, schema) => {
  let buf = []
  let v = f.arg[1].op
  let { mappedFile, size } = csvFilesEnv[filename]

  let columns = schema
  for (let i in columns) {
    let colName = columns[i][0]
    let type = columns[i][1]
    let prefix = pretty(f)
    let needToExtract = usedCols[prefix][colName]

    buf.push(`// reading column ${colName}`)

    let start = [mappedFile, quoteVar(v), colName, "start"].join("_")
    let end = [mappedFile, quoteVar(v), colName, "end"].join("_")
    let name = [mappedFile, quoteVar(v), colName].join("_")

    if (needToExtract && typing.isInteger(type)) {
      buf.push(`${convertToCType(type)} ${name} = 0;`)
    }

    let delim = i == columns.length - 1 ? "\\n" : ","
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

    if (needToExtract && typing.isString(type)) {
      buf.push(`// extract string`)
      buf.push(`char ${name}[${end} - ${start} + 1];`)
      buf.push(`extract_str(${mappedFile}, ${start}, ${end}, ${name});`)
    }
  }

  return buf
}

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

  let loopHeader = ["while (1) {"]
  let boundsChecking = [`if (${cursor} >= ${size}) break;`]

  let schema = f.schema
  let rowScanning = emitRowScanning(f, filename, cursor, schema)

  return {
    info, loadCSV, initCursor, loopHeader, boundsChecking, rowScanning
  }
}

let emitCodeCSql = (q, ir) => {
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

  let createGenerator = (e1, e2, getLoopTxtFunc) => {
    let a = getDeps(e1)
    let b = getDeps(e2)
    let e = expr("FOR", ...a)
    e.sym = b[0]
    e.getLoopTxt = getLoopTxtFunc
    generatorStms.push(e)
  }

  let createMkset = (e1, e2, val) => {
    let a = getDeps(e1)
    let b = getDeps(e2)
    let e = expr("MKSET", ...a)
    e.sym = b[0]
    let info = [`// generator: ${e2.op} <- ${pretty(e1)}`]
    let rowScanning = []
    rowScanning.push(`unsigned long ${e.sym} = hash(${val.file}, ${val.start}, ${val.end}) % 1024;`)
    e.getLoopTxt = () => ({
      info, loadCSV: [], initCursor: [], loopHeader: ["{", "// singleton value here"], boundsChecking: [], rowScanning
    })
    generatorStms.push(e)
  }

  let getDeps = q => [...q.fre, ...q.tmps.map(tmpSym)]

  let prolog = []
  prolog.push(`#include "rhyme-sql.h"`)
  prolog.push("int main() {")

  for (let i in filters) {
    let q = filters[i]

    let f = filters[i]
    let v1 = f.arg[1].op
    let g1 = f.arg[0]

    let schema = f.schema

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
          emitLoadCSV(prolog, filename, i)
        }
      } else {
        filename = codegenCSql(g1.arg[0], [], {}, true)
        if (csvFilesEnv[filename] == undefined) {
          emitLoadCSV(loadCSV, filename, i, false)
        }
      }

      let getLoopTxtFunc = getLoopTxt(f, filename, loadCSV)
      createGenerator(f.arg[0], f.arg[1], getLoopTxtFunc)
    } else if (g1.key == "mkset") {
      let val = codegenCSql(g1.arg[0], [])
      createMkset(f.arg[0], f.arg[1], val)
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
      assign(emitTmpInit(q, sym), sym, [], []);
    }

    // emit init
    if (q.key == "stateful" && initRequired[q.op] || q.key == "update") {
      assign(emitStmInitCSql(q, sym, q.fre), sym, q.fre, [])
    }

    // emit update
    let fv = union(q.fre, q.bnd)
    let deps = [...fv, ...q.tmps.map(tmpSym)] // XXX rhs dims only?

    assign(emitStmUpdateCSql(q, sym, q.fre), sym, q.fre, deps)
  }

  let res = codegenCSql(q, [], {})

  let epilog = []
  if (q.schema !== types.nothing) {
    try {
      epilog.push(`printf("%${getFormatSpecifier(q.schema)}\\n", ${res});`)
    } catch (e) {
      // Object
      let valType = q.schema[0][1]
      epilog.push(`for (int i = 0; i < 1024; i++) {`)
      epilog.push(`if (${res}[i] != NULL) {`)
      epilog.push(`printf("%${getFormatSpecifier(valType)}\\n", *${res}[i]);`)
      epilog.push(`}`)
      epilog.push(`}`)
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

let generateCSqlNew = (q, ir) => {
  const fs = require('node:fs/promises')
  const os = require('node:child_process')

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

  // Assumptions:
  // A var will always be from inp
  // A "get" will always get from a var which is the generator on all table rows
  // and the op will be the name of the column
  // eg. sum(.*.value)

  let code = emitCodeCSql(q, ir)

  let func = async () => {
    await fs.writeFile(`cgen-sql/out.c`, code);
    await execPromise(`gcc cgen-sql/out.c -o cgen-sql/out`)
    return './cgen-sql/out'
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