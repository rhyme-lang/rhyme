// C syntax builders, copied from cgen/utils.js so that cgen2 stays
// self-contained (the same reason ctypes.js exists).
//
// What was left behind, and why:
//   - malloc/calloc/open/close/mmap: cgen2 allocates through the runtime's
//     bump arena and reads input with yyjson, so it emits none of these
//   - declareStruct/struct and the declareInt/declareCharPtr/... shorthands:
//     cgen2 emits no structs, and names its own C types (rh_val, yyjson_val)
//     at each declaration site
//   - printErr: cgen2 has no error paths in generated code yet
//
// Added here, not in the original: stmt1 and if1, for the single-line form
// cgen2 emits. Its block helpers below are kept for completeness, but the loop
// emitters do not use them -- cgen2 streams into a sink with open/close
// markers (see emitLoopHeader) rather than passing a body callback.

let c = {}

// ----- expressions -----

c.cast = (type, expr) => `(${type})${expr}`

c.inc = (expr) => expr + "++"

c.binary = (lhs, rhs, op) => `(${lhs} ${op} ${rhs})`
c.ternary = (cond, tVal, fVal) => `(${cond} ? ${tVal} : ${fVal})`

c.assign = (lhs, rhs) => `${lhs} = ${rhs}`

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

c.addr = (expr) => "&" + expr
c.deref = (expr) => "*" + expr

// ----- statements -----

c.comment = (buf) => (s) => buf.push("// " + s)
c.stmt = (buf) => (expr) => buf.push(expr + ";")

// a statement as text, for the places that need one without a buffer -- the
// single-line if below, and nativeFold
c.stmt1 = (expr) => expr + ";"

c.declareVar = (buf) => (type, name, init, constant = false) =>
  buf.push((constant ? "const " : "") + type + " " + name + (init ? ` = ${init};` : ";"))
c.declareArr = (buf) => (type, name, len, init, constant = false) =>
  buf.push((constant ? "const " : "") + `${type} ${name}[${len}]` + (init ? ` = ${init};` : ";"))
c.declarePtr = (buf) => (type, name, init, constant = false) =>
  buf.push((constant ? "const " : "") + `${type} *${name}` + (init ? ` = ${init};` : ";"))

c.printf = (buf) => (fmt, ...args) => buf.push(c.call("printf", '"' + fmt + '"', ...args) + ";")

c.if = (buf) => (cond, tBranch, fBranch) => {
  buf.push(`if (${cond}) {`)
  tBranch(buf)
  if (fBranch) {
    buf.push("} else {")
    fBranch(buf)
  }
  buf.push("}")
}

// braceless single-statement if -- `stmt` already carries its semicolon
c.if1 = (cond, stmt) => `if (${cond}) ${stmt}`

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

module.exports = { c }
