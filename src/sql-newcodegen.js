const { generate } = require('./new-codegen')
const { runtime } = require('./simple-runtime')
const { typing, types } = require('./typing')

let filters
let assignments

let csvFiles

let currentPath

let unique = xs => xs.filter((x, i) => xs.indexOf(x) == i)
let union = (a, b) => unique([...a, ...b])

let tmpSym = i => "tmp" + i

let quoteVar = s => s.replaceAll("*", "x")

let map = {}
let getNewName = (prefix) => {
  map[prefix] ??= 0
  let name = prefix + map[prefix]
  map[prefix] += 1
  return name
}

let initRequired = {
  "sum": true,
  "prodcut": true,
  "min": true,
  "max": true,
  "count": true,
}

let emitLoadCSV = (buf, filename, id) => {
  buf.push(`// loadCSV ${filename}`)
  let fd = "fd" + id
  let mappedFile = "csv" + id
  let size = "n" + id
  buf.push(`int ${fd} = open(\"${filename}\", 0);`)
  buf.push(`if (${fd} == -1) {`)
  buf.push(`fprintf(stderr, "Unable to open file ${filename}\\n");`);
  buf.push(`return 1;`)
  buf.push(`}`)
  buf.push(`int ${size} = fsize(${fd});`)
  buf.push(`char *${mappedFile} = mmap(0, ${size}, PROT_READ, MAP_FILE | MAP_SHARED, ${fd}, 0);`)
  buf.push(`close(${fd});`)

  csvFiles[filename] = { fd, mappedFile, size }
}

let convertToCType = (type) => {
  if (type.__rh_type === "dynkey")
    return convertToCType(type.__rh_type_superkey);
  if (type.__rh_type === "union")
    throw new Error("Unable to convert union type to C type currently.");
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
    throw new Error("Unable to convert union type to C type currently.");
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

let codegenCSql = (q, extract = true) => {
  if (q.key == "loadInput") {
    console.error("stand-alone loadInput")
    return "// stand-alone loadInput not supported"
  } else if (q.key == "const") {
    if (typeof q.op == "number") {
      return q.op
    } else {
      console.error("unsupported constant ", pretty(q))
      return String(q.op)
    }
  } else if (q.key == "var") {
    console.error("stand-alone var")
    return "// stand-alone var not supported"
  } else if (q.key == "ref") {
    return tmpSym(q.op)
  } else if (q.key == "get") {
    let [e1, e2] = q.arg
    // check if the get is valid
    if (!(e1.key == "get" && e2.key == "const")) {
      console.error("malformed get")
      return "// malformed get"
    }
    if (!(e1.arg[0].key == "loadInput" && e1.arg[1].key == "var")) {
      console.error("malformed get")
      return "// malformed get"
    }
    if (typeof e2.op != "string") {
      console.error("column name is not a constant string")
      return "// column name is not a constant string"
    }

    let filename = e1.arg[0].arg[0].op
    let { mappedFile } = csvFiles[filename]

    let v = e1.arg[1].op

    let start = [mappedFile, quoteVar(v), e2.op, "start"].join("_")
    let end = [mappedFile, quoteVar(v), e2.op, "end"].join("_")

    if (extract) {
      if (typing.isInteger(q.schema)) {
        return `extract_int(${mappedFile}, ${start}, ${end})`
      }
    } 

    return { file: mappedFile, start, end }
  } else if (q.key == "pure") {
    let es = q.arg.map(x => codegenCSql(x))
    // only do plus for now
    if (q.op == "plus") {
      return `${es[0]} + ${es[1]}`
    } else {
      console.error("pure op not supported")
      return "not supported"
    }
  } else {
    console.error("unknown op", pretty(q))
    return "<?" + q.key + "?>"
  }
}

let emitStmInitCSql = (q, sym) => {
  if (q.key == "stateful") {
    if (q.op == "sum" || q.op == "count") {
      return `${convertToCType(q.schema)} ${sym} = 0`
    } else if (q.op == "product") {
      return `${convertToCType(q.schema)} ${sym} = 1`
    } else if (q.op == "min") {
      return `${convertToCType(q.schema)} ${sym} = INT_MAX`
    } else if (q.op == "max") {
      return `${convertToCType(q.schema)} ${sym} = INT_MIN`
    } else {
      "not supported"
    }
  } else if (q.key == "update") {
    return "not supported"
  } else {
    console.error("unknown op", q)
  }
}

let emitStmUpdateCSql = (q, sym) => {
  if (q.key == "prefix") {
    return "not supported"
  } if (q.key == "stateful") {
    let [e1] = q.arg.map(x => codegenCSql(x))
    if (q.op == "sum") {
      return `${sym} += ${e1}`
    } else if (q.op == "product") {
      return `${sym} *= ${e1}`
    } else if (q.op == "min") {
      return `${sym} = ${e1} < ${sym} ? ${e1} : ${sym}`
    } else if (q.op == "max") {
      return `${sym} = ${e1} > ${sym} ? ${e1} : ${sym}`
    } else if (q.op == "count") {
      return `${sym} += 1`
    } else if (q.op == "print") {
      if (q.arg[0].schema == types.string) {
        let [e1] = q.arg.map(x => codegenCSql(x, false))
        return `println(${e1.file}, ${e1.start}, ${e1.end})`
      }
      return `printf("%${getFormatSpecifier(q.arg[0].schema)}\\n", ${e1})`
    } else {
      "not supported"
    }
  } else if (q.key == "update") {
    return "not supported"
  } else {
    console.error("unknown op", q)
  }
}

let generateRowScanning = (buf, cursor, schema, mappedFile, size, e2) => {
  let columns = schema
  for (let i in columns) {
    buf.push(`// reading column ${columns[i][0]}`)
    let delim = i == columns.length - 1 ? "\\n" : ","
    let start = [mappedFile, quoteVar(e2.op), columns[i][0], "start"].join("_")
    let end = [mappedFile, quoteVar(e2.op), columns[i][0], "end"].join("_")
    buf.push(`int ${start} = ${cursor};`)
    buf.push(`while (${cursor} < ${size} && ${mappedFile}[${cursor}] != '${delim}') {`)
    buf.push(`${cursor}++;`)
    buf.push("}")
    buf.push(`int ${end} = ${cursor};`)
    buf.push(`${cursor}++;`)
  }
}

let getLoopTxt = (e1, e2, schema) => () => {
  let filename = e1.arg[0].op

  let { mappedFile, size } = csvFiles[filename]

  let initCursor = []

  let info = `// generator: ${e2.op} <- loadCSV("${filename}")`

  let cursor = getNewName("i")
  initCursor.push(`int ${cursor} = 0;`)
  initCursor.push(`while (${cursor} < ${size} && ${mappedFile}[${cursor}] != '\\n') {`)
  initCursor.push(`${cursor}++;`)
  initCursor.push("}")
  initCursor.push(`${cursor}++;`)

  let loopHeader = "while (1) {"
  let boundsChecking = `if (${cursor} >= ${size}) break;`

  let rowScanning = []
  generateRowScanning(rowScanning, cursor, schema, mappedFile, size, e2)

  return {
    info, initCursor, loopHeader, boundsChecking, rowScanning
  }
}

let emitCodeCSql = (q, ir) => {
  // Translate to newcodegen and let newcodegen do the generation
  let assignmentStms = []
  let generatorStms = []
  let tmpVarWriteRank = {}
  map = {}

  filters = ir.filters
  assignments = ir.assignments
  vars = ir.vars
  order = ir.ordeer

  csvFiles = {}

  // generator ir api: mirroring necessary bits from ir.js
  let expr = (txt, ...args) => ({ txt, deps: args })

  let assign = (txt, lhs_root_sym, lhs_deps, rhs_deps) => {
    let e = expr(txt + ";", ...lhs_deps, ...rhs_deps) // lhs.txt + " " + op + " " + rhs.txt
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

  function selectGenFilter(e1, e2, schema) {
    let a = getDeps(e1)
    let b = getDeps(e2)
    let e = expr("FOR", ...a)
    e.sym = b[0]
    e.getLoopTxt = getLoopTxt(e1, e2, schema)
    generatorStms.push(e)
  }

  let getDeps = q => [...q.fre, ...q.tmps.map(tmpSym)]

  let transExpr = q => expr(codegenCSql(q), ...getDeps(q))

  let prolog = []
  prolog.push(`#include "rhyme-sql.h"`)
  prolog.push("int main() {")

  for (let i in filters) {
    let q = filters[i]

    let f = filters[i]
    let v1 = f.arg[1].op
    let g1 = f.arg[0]

    let schema = f.schema

    if (g1.key != "loadInput" || g1.op != "csv") {
      console.error("invalid filter")
      return
    }

    // constant string filename
    if (g1.arg[0].key != "const" || typeof g1.arg[0].op != "string") {
      console.error("expected filename to be constant string for c-sql backend")
      return
    }

    let filename = g1.arg[0].op
    
    // emit loadCSV to prolog if the filename is a contant string
    // TODO: otherwise, the loadCSV should be in the loop prolog before the cursor is initialized
    if (csvFiles[filename] == undefined) {
      emitLoadCSV(prolog, filename, i)
    }

    console.assert(csvFiles[filename] != undefined)

    selectGenFilter(f.arg[0], f.arg[1], schema)
  }

  for (let i in assignments) {
    let sym = tmpSym(i)

    let q = assignments[i]

    // emit init
    if (q.key == "stateful" && initRequired[q.op]) {
      assign(emitStmInitCSql(q, sym), sym, q.fre, [])
    }

    // emit update
    let fv = union(q.fre, q.bnd)
    let deps = [...fv, ...q.tmps.map(tmpSym)] // XXX rhs dims only?

    assign(emitStmUpdateCSql(q, sym), sym, q.fre, deps)
  }

  let res = transExpr(q)

  let epilog = []
  if (q.schema !== types.nothing) {
    epilog.push(`printf("%${getFormatSpecifier(q.schema)}\\n", ${res.txt});`)
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

  let func = (async () => {
    await fs.writeFile(`cgen-sql/out.c`, code);
    await execPromise(`gcc cgen-sql/out.c -o cgen-sql/out`)
    return 'cgen-sql/out'
  })()

  let wrap = async (input) => {
    let file = await func
    let res = await execPromise(`${file}`)
    return res
  }

  wrap.explain = {
    ir,
    code
  }

  return wrap
}

exports.generateCSqlNew = generateCSqlNew