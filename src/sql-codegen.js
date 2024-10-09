const { runtime } = require('./simple-runtime')


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

let assignments

let codegenCSql = (q, scope) => {
  let {buf, csvSchema, getNewName} = scope
  if (q.key == "input") {
    return "not supported"
  } else if (q.key == "const") {
    if (typeof q.op === "string") {
      // the string should be a column name
      let idx = csvSchema.indexOf(q.op)
      if (idx < 0) {
        console.error("unknown field ", q.op)
        return "<?"+q.key+"?>"
      }

      // Assume the string holds a integer value
      buf.push("// converting string to number")

      let col = getNewName(q.op)
      let start = "start" + idx
      let end = "end" + idx
      buf.push(`int ${col} = 0;`)
      let cursor = getNewName("curr")
      buf.push(`int ${cursor} = ${start};`)
      buf.push(`while (${cursor} < ${end}) {`)
      buf.push(`${col} *= 10;`)
      buf.push(`${col} += (inp[${cursor}] - '0');`)
      buf.push(`${cursor}++;`)
      buf.push("}")

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
    if (q.arg[1].key == "const" && q.arg[0].key == "get") {
      return codegenCSql(q.arg[1], scope)
    } if (q.arg[1].key == "var" && q.arg[0].key == "input") {
      return "not supported"
    } else {
      console.error("malformed get", pretty(q))
      return "<?"+q.key+"?>"
    }
  } else if (q.key == "pure") {
    let es = q.arg.map(x => codegenCSql(x, scope))
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
  let iter = union(free, bnd)

  if (iter.length == 0) return body(scope)

  // let full = transf(union(free, bnd))

  // assertSame(full, iter)

  let csvSchema = scope.csvSchema
  let getNewName = scope.getNewName

  let cursor = getNewName("i")
  buf.push(`int ${cursor} = 0;`)
  buf.push(`while (inp[${cursor}] != '\\n') {`)
  buf.push(`${cursor}++;`)
  buf.push("}")

  buf.push("while (1) {")
  buf.push(`if (${cursor} >= n) break;`)
  for (let i in csvSchema) {
    buf.push(`// reading ${csvSchema[i]}`)
    let delim = i == csvSchema.length - 1 ? "\\n" : ","
    buf.push(`int start${i} = ${cursor};`)
    buf.push("while (1) {")
    buf.push(`char c${i} = inp[${cursor}];`)
    buf.push(`if (c${i} == '${delim}') break;`)
    buf.push(`${cursor}++;`)
    buf.push("}")
    buf.push(`int end${i} = ${cursor};`)
    buf.push(`${cursor}++;`)
  }
  body(scope)

  buf.push("}")
}

let emitCodeCSql = (q, assignments, order, csvSchema) => {
  let buf = []
  buf.push("#include <stdio.h>")
  buf.push("#include <fcntl.h>")
  buf.push("#include <sys/mman.h>")
  buf.push("#include <sys/stat.h>")
  buf.push("#include <unistd.h>")

  buf.push("int query(char *inp, int n);")

  buf.push("int fsize(int fd) {")
  buf.push("struct stat stat;")
  buf.push("int res = fstat(fd,&stat);")
  buf.push("return stat.st_size;")
  buf.push("}")

  buf.push("int main(int argc, char *argv[]) {")
  buf.push("if (argc < 2) {")
  buf.push("printf(\"Usage: %s <csv_file>\\n\", argv[0]);")
  buf.push("return 1;")
  buf.push("}")
  
  buf.push("// perform the actual loadCSV operation here")
  buf.push("int fd = open(argv[1], 0);")
  buf.push("int size = fsize(fd);")
  buf.push("char* file = mmap(0, size, PROT_READ, MAP_FILE | MAP_SHARED, fd, 0);")
  
  buf.push("printf(\"%d\\n\", query(file, size));")
  
  buf.push("close(fd);")
  buf.push("return 0;")
  buf.push("}")

  buf.push("int query(char *inp, int n) {")

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

    buf.push(`// emit tmp${i}`)
    if (q.key == "stateful" && (q.op+"_init") in runtime.stateful || q.key == "update") {
      buf.push(`int tmp${i} ${emitStmInitCSql(q)};`)
    }

    // emit filter
    // filters always come from inp
    let scope = {buf, csvSchema, getNewName}
    emitFiltersCSql(scope, q.fre, q.bnd)(buf, codegenCSql)(scope1 => {
      buf.push(`tmp${i} ${emitStmUpdateCSql(q, scope1)};`)
    })
  }

  buf.push(`return ${codegenCSql(q, {buf, csvSchema})};`);
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

let generate = (q, assignments, order, csvSchema) => {
  const fs = require('node:fs/promises')
  const os = require('node:child_process')

  let execPromise = function(cmd) {
    return new Promise(function(resolve, reject) {
      os.exec(cmd, function(err, stdout) {
        if (err) return reject(err);
        resolve(stdout);
      })
    })
  }

  // Assumptions:
  // A var will always be from inp
  // A "get" will always get from a var which is the generator on all table rows
  // and the op will be the name of the column
  // eg. sum(.*.value)

  let code = fixIndent(emitCodeCSql(q, assignments, order, csvSchema))
  let func = (async () => {
    await fs.writeFile(`out/sql.c`, code);
    await execPromise(`gcc out/sql.c -o out/sql`)
    return 'out/sql'
  })()

  let wrap = async (input) => {
    let file = await func
    let res = await execPromise(`${file} ${input}`)
    return res
  }

  return wrap
}

exports.generateCSql = generate