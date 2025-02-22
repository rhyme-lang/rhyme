const { runtime } = require('./simple-runtime')
const { typing, types } = require('./typing')
const { sets } = require('./shared')

const { unique, union, intersect, diff, subset, same } = sets


// ----- utils -----

let isDeepVarStr = s => s.startsWith("**")

let isDeepVarExp = s => s.key == "var" && isDeepVarStr(s.op)

let quoteVar = s => s.replaceAll("*", "x")

let csvFiles

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


let convertTypeToCType = (type) => {
  if (type.typeSym === "dynkey")
    return convertTypeToCType(type.keySuperkey);
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

let codegenCSql = (q, scope) => {
  let {buf, getNewName, fileColumnPos, file} = scope
  if (q.key == "input") {
    return "not supported"
  } else if (q.key == "loadInput") {
    if (q.op == "csv") {
      scope.file = q.arg[0].op
      let { mappedFile } = csvFiles[scope.file]
      return mappedFile
    }
    return "not supported"
  } else if (q.key == "const") {
    if (typeof q.op === "string") {
      // the string should be a column name

      let col = getNewName(q.op)
      let { start, end } = fileColumnPos[file][q.op]
      let { mappedFile } = csvFiles[file]

      if (typing.isInteger(q.schema.type)) {
        buf.push(`// extracting number from column ${q.op} in file ${file}`)

        // Assume the string holds a integer value
        buf.push(`${convertTypeToCType(q.schema.type)} ${col} = 0;`)
        let curr = getNewName("curr")
        buf.push(`int ${curr} = ${start};`)
        buf.push(`while (${curr} < ${end}) {`)
        buf.push(`${col} *= 10;`)
        buf.push(`${col} += (${mappedFile}[${curr}] - '0');`)
        buf.push(`${curr}++;`)
        buf.push("}")
      }
      
      return col
    } else if (typeof q.op == "number") {
      return q.op
    } else {
      console.error("unsupported constant ", pretty(q))
      return String(q.op)
    }
  } else if (q.key == "var") {
    return quoteVar(q.op)
  } else if (q.key == "ref") {
    return `tmp${q.op}`
  } else if (q.key == "get") {
    let e1 = codegenCSql(q.arg[0], scope)
    if (q.arg[0].key == "loadInput" && q.arg[1].key == "var") {
      let e2 = codegenCSql(q.arg[1], scope)

      return e1+"_"+e2
    }
    if (q.arg[0].key == "get" && q.arg[1].key == "const") {
      // We give the schema to the rhs to extract the column value
      q.arg[1].schema = q.schema
      let e2 = codegenCSql(q.arg[1], scope)
      return e2
    }
    console.error("malformed get")
    return "malformed get"
  } else if (q.key == "pure") {
    let es = q.arg.map(x => codegenCSql(x, scope))
    // TODO: add more pure operators
    if(q.op == "plus") {
      return `${es[0]} + ${es[1]}`
    } else if(q.op.startsWith("convert_")) {
      return `((${ctypeMap[q.op.substring("convert_".length)]}) ${es[0]})`;
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
    return "<?"+q.key+"?>"
  }
}

let emitStmInitCSql = (q, sym) => {
  if (q.key == "stateful") {
    if (q.op == "sum" || q.op == "count") {
      return `${convertTypeToCType(q.schema.type)} ${sym} = 0;`
    } else if (q.op == "product") {
      return `${convertTypeToCType(q.schema.type)} ${sym} = 1;`
    } else if (q.op == "min") {
      return `${convertTypeToCType(q.schema.type)} ${sym} = INT_MAX;`
    } else if (q.op == "max") {
      return `${convertTypeToCType(q.schema.type)} ${sym} = INT_MIN;`
    } else {
      "not supported"
    }
  } else if (q.key == "update") {
    return "not supported"
  } else {
    console.error("unknown op", q)
  }
}

let emitStmUpdateCSql = (q, scope, sym) => {
  if (q.key == "prefix") {
    return "not supported"
  } if (q.key == "stateful") {
    let [e1] = q.arg.map(x => codegenCSql(x, scope))
    if (q.op == "sum") {
      return `${sym} += ${e1};`
    } else if (q.op == "product") {
      return `${sym} *= ${e1};`
    } else if (q.op == "min") {
      return `${sym} = ${e1} < ${sym} ? ${e1} : ${sym};`
    } else if (q.op == "max") {
      return `${sym} = ${e1} > ${sym} ? ${e1} : ${sym};`
    } else if (q.op == "count") {
      return `${sym} += 1;`
    } else if (q.op == "print") {
      return `printf("%${getFormatSpecifier(q.arg[0].schema.type)}\\n", ${e1});`
    } else {
      "not supported"
    }
  } else if (q.key == "update") {
    return "not supported"
  } else {
    console.error("unknown op", q)
  }
}

let emitLoadCSV = (filename, scope) => {
  let {loadCSVBuf, getNewName} = scope
  loadCSVBuf.push(`// loadCSV ${filename}`)
  let fd = getNewName("fd")
  let mappedFile = getNewName("csv")
  let size = getNewName("n")
  loadCSVBuf.push(`int ${fd} = open(\"${filename}\", 0);`)
  loadCSVBuf.push(`if (${fd} == -1) {`)
  loadCSVBuf.push(`fprintf(stderr, "Unable to open file ${filename}\\n");`);
  loadCSVBuf.push(`return 1;`)
  loadCSVBuf.push(`}`)
  loadCSVBuf.push(`int ${size} = fsize(${fd});`)
  loadCSVBuf.push(`char *${mappedFile} = mmap(0, ${size}, PROT_READ, MAP_FILE | MAP_SHARED, ${fd}, 0);`)
  loadCSVBuf.push(`close(${fd});`)
  
  csvFiles[filename] = { fd, mappedFile, size }
}

let emitLoopHeader = (csvFile, cursor, scope) => {
  let { buf } = scope
  let { mappedFile, size } = csvFile
  
  buf.push(`int ${cursor} = 0;`)
  buf.push(`while (${mappedFile}[${cursor}] != '\\n') {`)
  buf.push(`${cursor}++;`)
  buf.push("}")

  buf.push("while (1) {")
  buf.push(`if (${cursor} >= ${size}) break;`)
}

let emitRowScanning = (csvFile, cursor, schema, scope, first=true) => {
  if (schema.objKey == null)
    return {}
  let columnPos = emitRowScanning(csvFile, cursor, schema.objParent, scope, false);
  let { buf, getNewName } = scope
  let { mappedFile } = csvFile

  buf.push(`// reading column ${schema.objKey}`)
  let delim = first ? "\\n" : ","
  let start = getNewName("start")
  let end = getNewName("end")
  buf.push(`int ${start} = ${cursor};`)
  buf.push("while (1) {")
  buf.push(`char c = ${mappedFile}[${cursor}];`)
  buf.push(`if (c == '${delim}') break;`)
  buf.push(`${cursor}++;`)
  buf.push("}")
  buf.push(`int ${end} = ${cursor};`)
  buf.push(`${cursor}++;`)
  columnPos[schema.objKey] = { start, end }

  return columnPos
}

let emitFilters1 = (scope, free, bnd) => (buf, codegen) => body => {
  // approach: build explicit projection first
  // 1. iterate over transitive iter space to
  //    build projection map
  // 2. iterate over projection map to compute
  //    desired result

  let iter = diff(union(free, bnd), scope.vars)

  if (iter.length == 0) return body(scope)

  // let full = transf(union(free, bnd))
  let full = union(free, bnd)

  if (same(diff(full,scope.vars), iter)) { // XXX should not disregard order?
    emitFilters2(scope, full)(buf, codegen)(body)
  } else {
    console.error("We don't do this for now")
  }
}


let emitFilters2 = (scope, iter) => (buf, codegen) => body => {
  let filters = scope.ir.filters
  let loadCSVBuf = scope.loadCSVBuf
  let getNewName = scope.getNewName

  // let watermark = buf.length
  // let buf0 = buf
  // let buf1 = []

  let vars = {}
  let seen = {}

  if (iter.length == 0)
    return body()

  // remember the set of iteration vars
  for (let v of iter) vars[v] = true

  // record current scope
  for (let v of scope.vars) seen[v] = true

  // only consider filters contributing to iteration vars
  let pending = []
  for (let i in filters) {
    let f = filters[i]
    let v1 = f.arg[1].op
    let g1 = f.arg[0]
    if (vars[v1]) // not interested in this? skip
      pending.push(i)
  }

  let filtersInScope = [...scope.filters]

  // compute next set of available filters:
  // all dependent iteration vars have been seen (emitted before)
  let available = []
  let next = () => {
    let p = pending
    pending = []
    for (let i of p) {
      let f = filters[i]
      let v1 = f.arg[1].op
      let g1 = f.arg[0]

      let avail = g1.fre.every(x => seen[x])

      // NOTE: doesn't work yet for nested codegen: filters
      // propagates too far -- it should only propagate
      // as far upwards as they are used!

      avail &&= subset(g1.filters??[], filtersInScope) // plusTest4a has g1.filters null?

      if (avail)
        available.push(i) // TODO: insert in proper place
      else
        pending.push(i)
    }
    return available.length > 0
  }

  let closing = ""

  // record the cursor variable for the current loops that are being generated
  let cursors = {}
  let fileColumnPos = {}

  // process filters
  while (next()) {
    // sort available by estimated selectivity
    // crude proxy: number of free vars
    let selEst = i => filters[i].arg[0].fre.length
    available.sort((a,b) => selEst(b) - selEst(a))

    let i = available.shift()
    filtersInScope.push(i)

    let f = filters[i]
    let v1 = f.arg[1].op
    let g1 = f.arg[0]

    let schema = f.schema

    if (g1.key != "loadInput" || g1.op != "csv") {
      console.error("invalid filter");
      return;
    }

    if (g1.arg[0].key != "const" || typeof g1.arg[0].op != "string") {
      console.error("expected filename to be constant string for c-sql backend");
      return;
    }

    let extra = g1.fre.filter(x => !vars[x])
    if (extra.length != 0) {
      console.error("extra dependency: "+extra)
    }

    if (isDeepVarStr(v1)) {
      buf.push("deep var not supported")
    } else { // ok, just emit current
      let filename = g1.arg[0].op

      // if file f is not open yet, open it
      // if file is already open for reading, get the mapped buffer name and size
      if (csvFiles[filename] === undefined) {
        emitLoadCSV(filename, scope)
      }
      let csvFile = csvFiles[filename]

      buf.push(`// filter ${v1} <- ${filename}`)

      let cursor = getNewName("i")
      cursors[filename] = cursor

      if (!seen[v1]) {
        emitLoopHeader(csvFile, cursor, scope)
        let columnPos = emitRowScanning(csvFile, cursor, schema.type, scope)
        fileColumnPos[filename] = columnPos
        closing = "}\n"+closing
      } else {
        loadCSVBuf.push(`int ${cursor} = 0;`)
        loadCSVBuf.push(`while (${csvFile.mappedFile}[${cursor}] != '\\n') {`)
        loadCSVBuf.push(`${cursor}++;`)
        loadCSVBuf.push("}");
        buf.push(`if (${cursor} >= ${csvFile.size}) break;`)
        let columnPos = emitRowScanning(csvFile, cursor, schema.type, scope)
        fileColumnPos[filename] = columnPos
      }
      seen[v1] = true
    }
  }

  if (pending.length > 0) {
    let problem = pending.map(i => pretty(filters[i])).join(", ")
    console.warn("unsolved filter ordering problem: couldn't emit "+problem)
    for (let i of pending) {
      buf.push("// ERROR: unsolved filter ordering problem: "+i+" := "+pretty(filters[i]))
    }
  }

  let scope1 = {...scope, vars: [...scope.vars, ...iter], filters: [...filtersInScope], fileColumnPos}
  body(scope1)

  buf.push(closing)
}

let emitCodeSqlProlog =
`#include <stdio.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#include <limits.h>
#include <stdint.h>

int fsize(int fd) {
struct stat stat;
int res = fstat(fd,&stat);
return stat.st_size;
}

int main() {
`

let emitCodeSqlEpilog =
`return 0;
}
`



let initRequired = {
  "sum": true,
  "prodcut": true,
  "min": true,
  "max": true,
  "count": true,
  "print": true
}


let emitCodeCSql = (q, ir) => {
  csvFiles = {}
  filters = ir.filters
  let { assignments, order } = ir

  let buf = []
  let loadCSVBuf = []

  let map = {}
  let getNewName = (prefix) => {
    map[prefix] ??= 0
    let name = prefix + map[prefix]
    map[prefix] += 1
    return name
  }

  for (let is of order) {
    if (is.length > 1)
      console.error("cycle "+is)
    let [i] = is
    let q = assignments[i]

    buf.push("// --- tmp"+i+" ---")
    if (q.key == "stateful" && initRequired[q.op]) {
      buf.push(emitStmInitCSql(q, `tmp${i}`))
    }

    // emit filter
    // filters always come from loadCSV
    let scope = {buf, loadCSVBuf, ir, getNewName, vars:[], filters:[]}
    emitFilters1(scope, q.fre, q.bnd)(buf, codegenCSql)(scope1 => {
      buf.push(emitStmUpdateCSql(q, scope1, `tmp${i}`))
    })
  }

  if (q.schema.type != types.never) {
    buf.push(`${convertTypeToCType(q.schema.type)} res = ${codegenCSql(q, {buf, ir, getNewName})};`)
    buf.push(`printf(\"%${getFormatSpecifier(q.schema.type)}\\n\", res);`)
  }
  loadCSVBuf.push("")

  return emitCodeSqlProlog + loadCSVBuf.join("\n") + buf.join("\n") + emitCodeSqlEpilog
}

let fixIndent = s => {
  let lines = s.split("\n")
  let out = []
  let indent = 0
  for (let str of lines) {
    if (str.trim() == "") continue
    let count = r => (str.match(r)??[]).length
    let delta = count(/{/g) - count(/}/g)
    if (str[0] == "}") indent += delta
    out.push("".padEnd(indent * 4, ' ') + str.trim())
    if (str[0] != "}") indent += delta
  }
  return out.join("\n")
}

let generateCSql = (q, ir) => {
  const fs = require('fs/promises')
  const os = require('child_process')

  let execPromise = function(cmd) {
    return new Promise(function(resolve, reject) {
      os.exec(cmd, function(err, stdout) {
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

  let code = fixIndent(emitCodeCSql(q, ir))
  let func = (async () => {
    await fs.writeFile(`out/sql.c`, code);
    await execPromise(`gcc out/sql.c -o out/sql`)
    return 'out/sql'
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

exports.generateCSql = generateCSql