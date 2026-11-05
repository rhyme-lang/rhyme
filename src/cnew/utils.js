// C text helpers for the c-new backend (src/c-codegen.js).
//
// Pure string functions: they know C syntax and the backend's naming scheme,
// nothing about the IR or about value representations (cnew/value.js).
//
//   c          generic C syntax builders: expressions return text, statement
//              builders take a line buffer, c.stmt(buf)(expr) pushes "expr;".
//              Moved here from cgen/utils.js, which re-exports it for the
//              schema-directed "c" backend.
//   the rest   c-new naming and literals: symbols, string literals, slot
//              key arrays, indentation

let c = {}

// Expressions
c.cast = (type, expr) => `(${type})${expr}`

c.inc = (expr) => expr + "++"

c.binary = (lhs, rhs, op) => `(${lhs} ${op} ${rhs})`
c.ternary = (cond, tVal, fVal) => `(${cond} ? ${tVal} : ${fVal})`

c.assign = (lhs, rhs) => `(${lhs} = ${rhs})`

c.add = (lhs, rhs) => c.binary(lhs, rhs, "+")
c.sub = (lhs, rhs) => c.binary(lhs, rhs, "-")

c.mul = (lhs, rhs) => c.binary(lhs, rhs, "*")
c.div = (lhs, rhs) => c.binary(lhs, rhs, "/")

c.not = (expr) => "!" + expr
c.and = (lhs, rhs) => c.binary(lhs, rhs, "&&")
c.or = (lhs, rhs) => c.binary(lhs, rhs, "||")
c.eq = (lhs, rhs) => c.binary(lhs, rhs, "==")
c.ne = (lhs, rhs) => c.binary(lhs, rhs, "!=")

c.lt = (lhs, rhs) => c.binary(lhs, rhs, "<")
c.gt = (lhs, rhs) => c.binary(lhs, rhs, ">")

c.le = (lhs, rhs) => c.binary(lhs, rhs, "<=")
c.ge = (lhs, rhs) => c.binary(lhs, rhs, ">=")

c.call = (f, ...args) => `${f}(${args.join(", ")})`

c.malloc = (type, n) => c.call("malloc", `sizeof(${type}) * ${n}`)
c.calloc = (type, n) => c.call("calloc", n, `sizeof(${type})`)
c.open = (file) => c.call("open", file, 0)
c.close = (fd) => c.call("close", fd)

c.mmap = (fd, size) => c.call("mmap", 0, size, "PROT_READ", "MAP_FILE | MAP_SHARED", fd, 0)

c.addr = (expr) => "&" + expr
c.deref = (expr) => "*" + expr

// Statements
c.comment = (buf) => (s) => buf.push("// " + s)
c.stmt = (buf) => (expr) => buf.push(expr + ";")

c.declareVar = (buf) => (type, name, init, constant = false) => buf.push((constant ? "const " : "") + type + " " + name + (init ? ` = ${init};` : ";"))
c.declareArr = (buf) => (type, name, len, init, constant = false) => buf.push((constant ? "const " : "") + `${type} ${name}[${len}]` + (init ? ` = ${init};` : ";"))
c.declarePtr = (buf) => (type, name, init, constant = false) => buf.push((constant ? "const " : "") + `${type} *${name}` + (init ? ` = ${init};` : ";"))
c.declarePtrPtr = (buf) => (type, name, init, constant = false) => buf.push((constant ? "const " : "") + `${type} **${name}` + (init ? ` = ${init};` : ";"))

c.declareSize = (buf) => (name, init) => c.declareVar(buf)("size_t", name, init)
c.declareInt = (buf) => (name, init) => c.declareVar(buf)("int", name, init)
c.declareLong = (buf) => (name, init) => c.declareVar(buf)("long", name, init)
c.declareULong = (buf) => (name, init) => c.declareVar(buf)("unsigned long", name, init)
c.declareCharArr = (buf) => (name, len, init) => c.declareArr(buf)("char", name, len, init)
c.declareIntPtr = (buf) => (name, init) => c.declarePtr(buf)("int", name, init)
c.declareCharPtr = (buf) => (name, init) => c.declarePtr(buf)("char", name, init)
c.declareConstCharPtr = (buf) => (name, init) => c.declarePtr(buf)("char", name, init, true)
c.declareCharPtrPtr = (buf) => (name, init) => c.declarePtrPtr(buf)("char", name, init, true)

c.declareBoxed = (buf) => (name, init) => c.declareVar(buf)("rh_val", name, init)
c.declareBoxedPtr = (buf) => (name, init) => c.declarePtr(buf)("rh_val", name, init)

c.declareStruct = (buf) => (struct) => {
  let { name, fields } = struct
  buf.push(`struct ${name} {`)
  for (let i in fields) {
    let { type, name } = fields[i]
    if (type.indexOf("*") >= 0)
      buf.push(`${type}${name};`)
    else
      c.declareVar(buf)(type, name)
  }
  buf.push(`};`)
}

c.struct = (name) => ({
  name, fields: [],
  addField: function (type, name) {
    this.fields.push({ type, name })
  }
})

c.printf = (buf) => (fmt, ...args) => buf.push(c.call("printf", "\"" + fmt + "\"", ...args) + ";")
c.printErr = (buf) => (fmt, ...args) => buf.push(c.call("fprintf", "stderr", "\"" + fmt + "\"", ...args) + ";")

c.if = (buf) => (cond, tBranch, fBranch) => {
  buf.push(`if (${cond}) {`)
  tBranch(buf)
  if (fBranch) {
    buf.push("} else {")
    fBranch(buf)
  }
  buf.push("}")
}

// a bare { ... } block, to scope the names declared in it
c.block = (buf) => (body) => {
  buf.push("{")
  body(buf)
  buf.push("}")
}

c.while = (buf) => (cond, body) => {
  buf.push(`while (${cond}) {`)
  body(buf)
  buf.push("}")
}

c.while1 = (buf) => (cond, body) => {
  buf.push(`while (${cond}) ${body};`)
}

c.continue = (buf) => () => buf.push("continue;")
c.break = (buf) => () => buf.push("break;")
c.return = (buf) => (expr) => buf.push(`return ${expr};`)

// Rhyme variable -> C identifier: *A -> xA, D0 -> D0. Same as quoteVar in
// simple-codegen.js, minus constant folding (handled by emitVar).
let cVar = s => s.replaceAll("*", "x")

let tmpSym = i => "tmp" + i
let genSym = i => "gen" + i
let projSym = id => "proj" + id

// A C string literal for a JS string, plus its UTF-8 byte length, which is
// what rh_strv / rh_str_lit take. Anything outside printable ASCII is written
// as a three-digit octal escape, which (unlike \x) cannot run into the next
// character.
//   cStr("a\"b") -> { lit: "\"a\\\"b\"", len: 3 }
let cStr = s => {
  let bytes = Buffer.from(s, "utf8")
  let out = ""
  for (let b of bytes) {
    let ch = String.fromCharCode(b)
    if (ch == '"' || ch == "\\") out += "\\" + ch
    else if (ch == "?") out += "\\?" // no trigraphs
    else if (b >= 0x20 && b < 0x7f) out += ch
    else out += "\\" + b.toString(8).padStart(3, "0")
  }
  return { lit: '"' + out + '"', len: bytes.length }
}

// The key path of a slot: rh_slot takes (const rh_val *keys, int n). Returns
// the C argument text for both, e.g. for [K1, D0]:
//   "(rh_val[]){K1, D0}, 2"       and for []:   "NULL, 0"
// (compound literal, so it can sit inline in the call).
let cKeys = cexprs =>
  cexprs.length == 0 ? "NULL, 0" : `(rh_val[]){${cexprs.join(", ")}}, ${cexprs.length}`

// Re-indent the emitted lines by brace depth, like fixIndent in
// simple-codegen.js. Lines are emitted unindented.
let indent = lines => {
  let out = []
  let depth = 1
  for (let l of lines) {
    let t = l.trim()
    if (t.startsWith("}")) depth = Math.max(1, depth - 1)
    out.push("  ".repeat(depth) + t)
    if (t.endsWith("{")) depth++
  }
  return out
}

module.exports = { c, cVar, tmpSym, genSym, projSym, cStr, cKeys, indent }
