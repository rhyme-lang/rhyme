const { runtime } = require('./simple-runtime')
const { typing } = require('./typing')


// ----- utils -----

// sets, implemented as arrays

let unique = xs => xs.filter((x,i) => xs.indexOf(x) == i)

let union = (a,b) => unique([...a,...b])

let intersect = (a,b) => {
  let keys = {}
  let res = []
  for (let k of b)
    keys[k] = true
  for (let k of a)
    if (keys[k])
      res.push(k)
  return res
}

let diff = (a,b) => {
  let keys = {}
  let res = []
  for (let k of b)
    keys[k] = true
  for (let k of a)
    if (!keys[k])
      res.push(k)
  return res
}

let subset = (a,b) => {
  let keys = {}
  for (let k of b)
    keys[k] = true
  for (let k of a)
    if (!keys[k])
      return false
  return true
}

let same = (a,b) => subset(a,b) && subset(b,a)

let csvFiles

let codegenCSql = (q, scope) => {
  let {buf, getNewName, columnPos, file} = scope
  if (q.key == "input") {
    if (q.op == "csv") {
      return q.file
    }
    return "not supported"
  } else if (q.key == "const") {
    if (typeof q.op === "string") {
      // the string should be a column name

      let col = getNewName(q.op)
      let { start, end } = columnPos[q.op]
      let { buffer } = csvFiles[file]

      if (q.schema == typing.number) {
        buf.push("// converting string to number")

        // Assume the string holds a integer value
        buf.push(`int ${col} = 0;`)
        let cursor = getNewName("curr")
        buf.push(`int ${cursor} = ${start};`)
        buf.push(`while (${cursor} < ${end}) {`)
        buf.push(`${col} *= 10;`)
        buf.push(`${col} += (${buffer}[${cursor}] - '0');`)
        buf.push(`${cursor}++;`)
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
    return "not supported"
  } else if (q.key == "ref") {
    return `tmp${q.op}`
  } else if (q.key == "get") {
    let e1 = codegenCSql(q.arg[0], scope)

    if (q.arg[0].key == "input" && q.arg[1].key == "var") {
      return e1
    }
    if (q.arg[0].key == "get" && q.arg[1].key == "const") {
      // We give the schema to the rhs to extract the column value
      q.arg[1].schema = q.schema
      let scope1 = { ...scope, file: e1 }
      let e2 = codegenCSql(q.arg[1], scope1)
      return e2
    }
    console.err("malformed get")
    return "malformed get"
  } else if (q.key == "pure") {
    let es = q.arg.map(x => codegenCSql(x, scope))
    // only do plus for now
    return `${es[0]} + ${es[1]}`
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

let emitStmInitCSql = (q, scope) => {
  if (q.key == "stateful") {
    if (q.op == "sum") {
      return "= 0"
    } else if (q.op == "product") {
      return "= 1"
    } else {
      "not supported"
    }
  } else if (q.key == "update") {
    return "not supported"
  } else {
    console.error("unknown op", q)
  }
}

let emitStmUpdateCSql = (q, scope) => {
  if (q.key == "prefix") {
    return "not supported"
  } if (q.key == "stateful") {
    let [e1] = q.arg.map(x => codegenCSql(x, scope))
    if (q.op == "sum") {
      return `+= ${e1}`
    } else if (q.op == "product") {
      return `*= ${e1}`
    } else {
      "not supported"
    }
  } else if (q.key == "update") {
    return "not supported"
  } else {
    console.error("unknown op", q)
  }
}

let emitFiltersCSql = (scope, free, bnd) => (buf, codegen) => body => {
  let { filters } = scope.ir

  let vars = {}
  let buf = scope.buf

  let iter = union(free, bnd)

  if (iter.length == 0)
    return body(scope)

  if (iter.length == 0) return body(scope)

  for (let v of iter) vars[v] = true

  let pending = []
  for (let i in filters) {
    let f = filters[i]
    let v1 = f.arg[1].op
    let g1 = f.arg[0]
    if (vars[v1]) // not interested in this? skip
      pending.push(i)
  }
  let getNewName = scope.getNewName

  // Currently we don't want nested loops
  console.assert(pending.length == 1)

  for (let i of pending) {
    let f = filters[i]
    let v1 = f.arg[1].op
    let g1 = f.arg[0]

    let schema = f.schema
    if (g1.key != "input" || g1.op != "csv") {
      console.error("invalid filter");
      return;
    }

    // if file f is not open yet, open it
    // if file is already open for reading, get the mapped buffer name and size
    if (csvFiles[g1.file] === undefined) {
      buf.push(`// loadCSV ${g1.file}`)
      let fd = getNewName("fd")
      let buffer = getNewName("csv")
      let size = getNewName("n")
      buf.push(`int ${fd} = open(\"${g1.file}\", 0);`)
      buf.push(`if (${fd} == -1) {`)
      buf.push(`fprintf(stderr, "Unable to open file ${g1.file}\\n");`);
      buf.push(`exit(1);`)
      buf.push(`}`)
      buf.push(`int ${size} = fsize(${fd});`)
      buf.push(`char *${buffer} = mmap(0, ${size}, PROT_READ, MAP_FILE | MAP_SHARED, ${fd}, 0);`)

      csvFiles[g1.file] = { fd, buffer, size }
    }
    let { buffer, size } = csvFiles[g1.file]

    buf.push(`// filter ${v1} <- ${g1.file}`)
    let cursor = getNewName("i")
    buf.push(`int ${cursor} = 0;`)
    buf.push(`while (${buffer}[${cursor}] != '\\n') {`)
    buf.push(`${cursor}++;`)
    buf.push("}")

    buf.push("while (1) {")
    buf.push(`if (${cursor} >= ${size}) break;`)

    let columnPos = {}

    let columns = Object.keys(schema)
    for (let i in columns) {
      buf.push(`// reading column ${columns[i]}`)
      let delim = i == columns.length - 1 ? "\\n" : ","
      let start = getNewName("start")
      let end = getNewName("end")
      buf.push(`int ${start} = ${cursor};`)
      buf.push("while (1) {")
      buf.push(`char c = ${buffer}[${cursor}];`)
      buf.push(`if (c == '${delim}') break;`)
      buf.push(`${cursor}++;`)
      buf.push("}")
      buf.push(`int ${end} = ${cursor};`)
      buf.push(`${cursor}++;`)
      columnPos[columns[i]] = { start, end }
    }
    let scope1 = { ...scope, columnPos }
    body(scope1)

    buf.push("}")
  }
}

let emitCodeCSql = (q, ir) => {
  csvFiles = {}
  let { assignments, order } = ir

  let buf = []
  buf.push("#include <stdio.h>")
  buf.push("#include <stdlib.h>")
  buf.push("#include <fcntl.h>")
  buf.push("#include <sys/mman.h>")
  buf.push("#include <sys/stat.h>")
  buf.push("#include <unistd.h>")

  buf.push("int query();")

  buf.push("int fsize(int fd) {")
  buf.push("struct stat stat;")
  buf.push("int res = fstat(fd,&stat);")
  buf.push("return stat.st_size;")
  buf.push("}")

  buf.push("int main() {")

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
    if (q.key == "stateful" && (q.op+"_init") in runtime.stateful || q.key == "update") {
      buf.push(`int tmp${i} ${emitStmInitCSql(q)};`)
    }

    // emit filter
    // filters always come from loadCSV
    let scope = {buf, ir, getNewName}
    emitFiltersCSql(scope, q.fre, q.bnd)(buf, codegenCSql)(scope1 => {
      buf.push(`tmp${i} ${emitStmUpdateCSql(q, scope1)};`)
    })
  }

  for (let file in csvFiles) {
    buf.push(`close(${csvFiles[file].fd});`)
  }

  buf.push(`int res = ${codegenCSql(q, {buf, ir, getNewName})};`)
  buf.push("printf(\"%d\\n\", res);")
  buf.push("return 0;")
  buf.push("}");

  return buf.join("\n")
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

let generate = (q, ir) => {
  const fs = require('node:fs/promises')
  const os = require('node:child_process')

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

exports.generateCSql = generate