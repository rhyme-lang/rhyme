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
  "print": true
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

let codegenCSql = (q) => {
  if (q.key == "input") {
    return "not supported"
  } else if (q.key == "loadInput") {
    if (q.op == "csv") {
      let { mappedFile } = csvFiles[q.arg[0].op]
      currentPath = [mappedFile]
      return mappedFile
    }
    return "not supported"
  } else if (q.key == "const") {
    if (typeof q.op === "string") {
      // the string should be a column name
      let mappedFile = currentPath[0]

      let prefix = currentPath.join("_")
      let start = prefix + `_${q.op}_start`
      let end = prefix + `_${q.op}_end`

      let res = undefined

      if (typing.isInteger(q.schema)) {
        res = `extract_int(${mappedFile}, ${start}, ${end})`
      }

      return res
    } else if (typeof q.op == "number") {
      return q.op
    } else {
      console.error("unsupported constant ", pretty(q))
      return String(q.op)
    }
  } else if (q.key == "var") {
    return quoteVar(q.op)
  } else if (q.key == "ref") {
    return tmpSym(q.op)
  } else if (q.key == "get") {
    let e1 = codegenCSql(q.arg[0])
    if (q.arg[0].key == "loadInput" && q.arg[1].key == "var") {
      let e2 = codegenCSql(q.arg[1])
      currentPath.push(e2)
      return e1 + "_" + e2
    }
    if (q.arg[0].key == "get" && q.arg[1].key == "const") {
      // We give the schema to the rhs to extract the column value
      q.arg[1].schema = q.schema
      let e2 = codegenCSql(q.arg[1])
      return e2
    }
    console.error("malformed get")
    return "malformed get"
  } else if (q.key == "pure") {
    let es = q.arg.map(x => codegenCSql(x))
    // only do plus for now
    if (q.op == "plus") {
      return `${es[0]} + ${es[1]}`
    } else {
      return "not supported"
    }
  } else if (q.key == "hint") {
    // no-op!
    return "not supported"
  } else if (q.key == "mkset") {
    return "not supported"
  } else if (q.key == "stateful" || q.key == "prefix" || q.key == "update") {
    return "not supported"
  } else {
    console.error("unknown op", pretty(q))
    return "<?" + q.key + "?>"
  }
}

let emitStmInitCSql = (q, scope) => {
  if (q.key == "stateful") {
    if (q.op == "sum" || q.op == "count") {
      return "= 0"
    } else if (q.op == "product") {
      return "= 1"
    } else if (q.op == "min") {
      return "= INT_MAX"
    } else if (q.op == "max") {
      return "= INT_MIN"
    } else if (q.op == "print") {
      return "= 0"
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
      return `+= ${e1}`
    } else if (q.op == "product") {
      return `*= ${e1}`
    } else if (q.op == "min") {
      return `= ${e1} < ${sym} ? ${e1} : ${sym}`
    } else if (q.op == "max") {
      return `= ${e1} > ${sym} ? ${e1} : ${sym}`
    } else if (q.op == "count") {
      return `+= 1`
    } else if (q.op == "print") {
      return `= 0; printf("| %${getFormatSpecifier(q.arg[0].schema)} |\\n", ${e1})`
    } else {
      "not supported"
    }
  } else if (q.key == "update") {
    return "not supported"
  } else {
    console.error("unknown op", q)
  }
}

let generateRowScanning = (buf, cursor, schema, mappedFile, e2) => {
  let columns = schema
  for (let i in columns) {
    buf.push(`// reading column ${columns[i][0]}`)
    let delim = i == columns.length - 1 ? "\\n" : ","
    let start = `${mappedFile}_${quoteVar(e2.op)}_${columns[i][0]}_start`
    let end = `${mappedFile}_${quoteVar(e2.op)}_${columns[i][0]}_end`
    buf.push(`int ${start} = ${cursor};`)
    buf.push("while (1) {")
    buf.push(`char c = ${mappedFile}[${cursor}];`)
    buf.push(`if (c == '${delim}') break;`)
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

  let loopHeader = "while (1) {"
  let boundsChecking = `if (${cursor} >= ${size}) break;`

  let rowScanning = []
  generateRowScanning(rowScanning, cursor, schema, mappedFile, e2)

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
    let a = transExpr(e1)
    let b = transExpr(e2)
    let b1 = b.deps[0]
    let e = expr("FOR", ...a.deps) // "for " + b1 + " <- " + a.txt
    e.sym = b1
    e.rhs = a.txt
    e.getLoopTxt = getLoopTxt(e1, e2, schema)
    // if (generatorStms.every(e1 => e1.txt != e.txt)) // generator CSE
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

    if (g1.arg[0].key != "const" || typeof g1.arg[0].op != "string") {
      console.error("expected filename to be constant string for c-sql backend")
      return
    }

    let filename = g1.arg[0].op
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
      assign(`${convertToCType(q.schema)} ${sym} ${emitStmInitCSql(q)}`, sym, q.fre, [])
    }

    // emit update
    let fv = union(q.fre, q.bnd)
    let deps = [...fv, ...q.tmps.map(tmpSym)] // XXX rhs dims only?

    assign(`${sym} ${emitStmUpdateCSql(q, sym)}`, sym, q.fre, deps)
  }

  let res = transExpr(q)

  let epilog = []
  epilog.push(`printf("res = %${getFormatSpecifier(q.schema)}\\n", ${res.txt});`)
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