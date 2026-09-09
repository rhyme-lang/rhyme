const { desugar } = require("./desugar")
const { ast } = require("./shared")

// Binary operators, loosest first: the ast node each one builds, its
// precedence (higher binds tighter) and its associativity (1 = left,
// 0 = right).
let binops = {
  "|" : { ast: "pipe",               prec:  40, assoc: 1 },
  "&" : { ast: "and",                prec:  50, assoc: 1 },  // low prec, could give it some other grouping semantics

  "||": { ast: "orElse",             prec:  70, assoc: 1 },
  "&&": { ast: "andAlso",            prec:  80, assoc: 1 },

  "<" : { ast: "lessThan",           prec:  90, assoc: 1 },
  "<=": { ast: "lessThanOrEqual",    prec:  90, assoc: 1 },
  ">" : { ast: "greaterThan",        prec:  90, assoc: 1 },
  ">=": { ast: "greaterThanOrEqual", prec:  90, assoc: 1 },
  "==": { ast: "equal",              prec:  90, assoc: 1 },
  "!=": { ast: "notEqual",           prec:  90, assoc: 1 },

  "::": { ast: "concat",             prec:  95, assoc: 1 },
  "+" : { ast: "plus",               prec: 100, assoc: 1 },
  "-" : { ast: "minus",              prec: 100, assoc: 1 },
  "*" : { ast: "times",              prec: 200, assoc: 1 },
  "/" : { ast: "fdiv",               prec: 200, assoc: 1 },  // float div by default
  "//": { ast: "div",                prec: 200, assoc: 1 },  // integer division
  "%" : { ast: "mod",                prec: 200, assoc: 1 },
}

function ast_binop(op, a,b) {
  let op1 = binops[op]?.ast ?? op
  return { xxkey: op1, xxparam: [a,b] }
}

function ast_postop(op, a) {
  if (op == "?" && a.xxkey == "ident") {
    return { ...a, xxop: a.xxop + "?" }
  } else if (op == "?" && a.xxkey == "get") {
    return { ...a, xxkey: "get?" }
  }
  // '?' only means something on an identifier or a field access. Anything
  // else used to build a { xxkey: "?" } node that desugar turned into an
  // apply of an undefined '?' function, failing much later.
  throw new Error("'" + op + "' expects an identifier or field access, got '" + a.xxkey + "'")
}

//
// ---------- Textual parser ----------
//


exports.rh = (strings, ...holes) => {
  return { rhyme_ast: desugar(exports.parserImpl(strings, holes)) }
}

exports.parse = (p) => {
  return { rhyme_ast: desugar(exports.parserImpl([p],[])) }
}


exports.parserImpl = (strings, holes) => {
  let input = strings.join("\0") // combine segments using a distinguished marker
  let pos = 0
  let peek
  let gap
  let str
  let start
  let hole = -1

  // ----- Lexer -----
  let opchars = '+-*/%<>=!?|&^~:'
  let optable = {}
  for (let c of opchars) optable[c] = 1

  // XXX 'sum?' and data.*A?' syntax -- FIXME: make more resilient
  let idchars = '_'
  let idtable = {}
  for (let c of idchars) idtable[c] = 1


  // init lexer with first token to get going
  let indent = whitespace();
  gap = input.substring(0, indent)
  if (input[pos] == '-' && input[pos+1] == ' ') {
    pos += 2 // skip a leading bullet ("- ")
  }
  read()

  function next() {
    // if (gap > 0) seq.push(input.substring(strt-gap,strt))
    // if (peek != str && peek != '\n')
    //   seq.push(dom(peek, {start:strt,end:pos}, "", str))
    // else
    //   seq.push(str)
    let start = pos
    let c = peek;
    let d = whitespace();
    gap = input.substring(start, pos)
    // console.log(d,"'"+gap+"'")
    read()
    return c
  }

  function read() {
    let isdigit = () => '0' <= input[pos] && input[pos] <= '9'
    let isletter = () => 'a' <= input[pos] && input[pos] <= 'z' || 'A' <= input[pos] && input[pos] <= 'Z'
    let isopchar = () => optable[input[pos]]
    start = pos
    if (isdigit()) {
      while (isdigit()) pos++
      peek = "num"
    } else if (isletter() || input[pos] == "_") {
      while (isletter() || isdigit() || idtable[input[pos]]) pos++
      peek = "ident"
    } else if (input[pos] == "*") { // special case!
      while (input[pos] == "*") pos++
      if (isletter() || isdigit() || input[pos] == "_") {
        while (isletter() || isdigit() || idtable[input[pos]]) pos++
        peek = "ident"
      } else {
        while (isopchar()) pos++
        peek = input.substring(start,pos)
      }
    } else if (isopchar()) {
      while (isopchar()) pos++
      peek = input.substring(start,pos)
    } else if (input[pos] == '"') { // TODO: also support single quotes '..' ?
      pos++
      while (input[pos] && input[pos] != '\n' && input[pos] != '"') pos++
      // note: unclosed string literals need to be detected later
      if (input[pos] == '"') pos++ // consume closing
      peek = "str"
    } else if (input[pos] == '\n') { // NOT HIT ANYMORE!
      error("unexpected newline")
    } else if (input[pos] === '\0') {
      pos += 1
      hole += 1
      peek = "hole"
    } else {
      peek = input[pos++]
    }
    str = input.substring(start,pos)
    //print(str)
  }

  function whitespace(excludeComment) {
    let start = pos
    while (input[pos] == ' ' || input[pos] == '\n') ++pos
    let commentStart = pos
    // if (input[pos] == '/' && input[pos+1] == '/') {
    //   pos += 2
    //   while (input[pos] && input[pos] != '\n') ++pos
    //   //if (input[pos] == '\n') ++pos
    // } else
    while (input[pos] == '#') {
      pos += 1
      while (input[pos] && input[pos] != '\n') ++pos
      //if (input[pos] == '\n') ++pos
      while (input[pos] == ' ' || input[pos] == '\n') ++pos
    }
    // todo: multiple single-line comments (?)
    //       --> maybe not!
    // todo: nested /* ... */ comments
    if (excludeComment)
      return commentStart - start
    else
      return pos - start
  }


  // ----- Parser -----

  // error handling: could be improved, for know
  // we just halt on first error
  // TODO: need a better way of reporting errors
  // to user
  function error(s) {
    // position info goes in the message rather than to the console, so
    // that a caller catching the error still sees where it happened
    throw new Error(s + " (at offset " + start + ": '" + input.substring(start, pos) + "')")
  }
  function sanitize(s) {
    return s // TODO?
  }

  function parens(f) {
    if (peek != '(')
      error("'(' expected") // not really used!
    next()
    let res = f()
    //try { f(); } catch (ex) {};
    if (peek != ')')
      error("')' expected but got '"+sanitize(peek)+"'")
    next()
    return res
  }

  function brackets(f) {
    if (peek != '[')
      error("'[' expected") // not really used!
    next()
    let res = f()
    //try { f(); } catch (ex) {};
    if (peek != ']')
      error("']' expected but got '"+sanitize(peek)+"'")
    next()
    return res
  }

  function braces(f) {
    if (peek != '{')
      error("'{' expected") // not really used!
    next()
    let res = f()
    //try { f(); } catch (ex) {};
    if (peek != '}')
      error("'}' expected but got '"+sanitize(peek)+"'")
    next()
    return res
  }

  function commaList(f) {
    let res = []
    if (peek == ")" || peek == "]" || peek == "}")
      return res
    res.push(f())
    while (peek == ',') {
      next()
      res.push(f())
    }
    return res
  }


  function expr() {
    if (peek == 'ident' && str == "let")
      return letExpr()
    return pipe()
  }
  function letExpr() { // 'let' ident+ '=' binop_expr (';'|'\n') expression
    next()
    if (peek != "ident")
      error("ident expected but got '"+sanitize(peek)+"'")
    let lhs = str
    next()

    let args = []
    while (peek == "ident") {
      args.push(str)
      next()
    }
    // check unique?

    if (peek != "=")
      error("'=' expected but got '"+sanitize(peek)+"'")
    next()
    let rhs = binop()
    // console.log(gap, "'"+gap+"'")
    if (peek != ";" && !gap.includes("\n"))
      error("';' or newline expected but got '"+sanitize(peek)+"'")
    if (peek == ";")
      next()
    let body = expr()

    for (let x of args.reverse()) // mutates!
      rhs = ast.call(ast.call(ast.ident("fn"), ast.ident(x)), rhs)

    let res = ast.call(ast.ident("let"), ast.ident(lhs))
    res = ast.call(res, rhs)
    res = ast.call(res, body)
    return res
  }
  // Precedence climbing: a chain of binary operators over 'operand',
  // consuming only those at precedence 'min' or tighter.
  function climb(operand, min) {
    let res = operand()
    while (peek in binops && binops[peek].prec >= min) {
      let nextMin = binops[peek].prec + binops[peek].assoc // + 1 for left assoc
      res = ast_binop(next(), res, climb(operand, nextMin))
    }
    return res
  }
  // The two chains differ only in their operand. Only '|' can actually
  // reach pipe(): everything tighter was already consumed by the binop()
  // inside an application.
  function pipe() {
    return climb(application, 0)
  }
  function binop() {
    // 50 is the precedence of '&', the loosest operator an application
    // may have inside an operand: application binds looser than every
    // operator except '|'. Keep in sync with the table above.
    return climb(path, 50)
  }
  function atom() {
    // NOTE: a bare '*' is an operand here and multiplication in binop(),
    // and the two never collide: atom() only runs where an operand is
    // expected, and binop() consumes a '*' following one before we get
    // back here. So 'a * b' is always times, '*' and '*.foo' always the
    // anonymous key. It does mean 'f *' is times looking for a right
    // operand, never application -- write 'f (*)' for that.
    if (peek == "num" || peek == "str" || peek == "ident" || peek == "*") {
      let s = str
      let res
      if (peek == "num") {
        res = ast.num(Number(s))
      } else if (peek == "str") { // strip quotes
        if (s.startsWith('"')) {
          s = s.substring(1,s.length)
          if (!s.endsWith('"'))
            error("unclosed string literal")
          s = s.substring(0,s.length-1)
        }
        res = ast.str(s)
      } else if (s == "true" || s == "false") {
        res = ast.num(s == "true") // NOTE: Boolean("false") is true!
      } else {
        res = ast.ident(s)
      }
      next()
      return res
    } else if (peek == "hole") {
      let res = ast.hole(holes[hole])
      next()
      return res
    } else if (peek == '(') {
      return parens(expr)
    } else if (peek == '{') {
      return object()
    } else if (peek == '[') {
      return array()
    } else {
      error("atom expected but got '"+sanitize(peek)+"'")
    }
  }
  function array() {
    return ast.array(brackets(() => commaList(expr)))
  }
  function object() {
    let entry = () => {
      let key = expr()
      let val
      if (peek == ":") {
        next(); val = expr()
      } else {
        val = key // shorthand, {x} is {x: x}
      }
      return [key, val]
    }
    return ast.object(braces(() => commaList(entry)).flat())
  }
  // Field names, i.e. what may follow a '.'. Deliberately narrower than
  // atom(): strings, arrays and objects are not keys -- a."x", a.[1] and
  // a.{x:1} used to parse, silently building a get with a nonsensical key.
  // Use a["x"] instead.
  function keyAtom() {
    if (gap != "")
      error("no space allowed after '.', got '"+sanitize(peek)+"'")
    if (peek == "num") {
      let res = ast.num(Number(str))
      next()
      return res
    } else if (peek == "ident" || peek == "*") {
      let res = ast.ident(str)
      next()
      return res
    } else if (peek == "hole") {
      let res = ast.hole(holes[hole])
      next()
      return res
    } else if (peek == "(") {
      return parens(expr)
    } else {
      error("field name expected after '.' but got '"+sanitize(peek)+"'")
    }
  }
  function path() {
    let res
    if (peek == ".") { // e.g. .input, to distinguish 'get' from 'ident'
      next()
      res = ast.get(keyAtom())
    } else if (peek == "num") {
      // A number at the head of a path is terminal: it is an int or a
      // float and nothing more. 5.foo, 1.5.3, 1.5[0] and 1(x) are errors.
      let int = str
      res = ast.num(Number(int))
      next()
      if (gap == "" && peek == ".") {
        next()
        if (peek != "num" || gap != "")
          error("number expected but got '"+sanitize(peek)+"'")
        let frac = str
        res = ast.num(Number(int + "." + frac))
        next()
      }
      if (gap == "" && (peek == "." || peek == "(" || peek == "[" || peek == "?"))
        error("number literal cannot be followed by '"+sanitize(peek)+"'")
      return res
    } else {
      res = atom()
    }

    if (gap == "" && peek == "?") {
      res = ast_postop(next(), res)
    }

    while (gap == "" && (peek == "." || peek == "(" || peek == "[")) {
      if (peek == ".") {
        next()
        res = ast.get(res, keyAtom())
        if (gap == "" && peek == "?") {
          res = ast_postop(next(), res)
        }
      } else if (peek == "(") {
        let rhs = parens(expr)
        res = ast.call(res, rhs)
      } else if (peek == "[") {
        let rhs = brackets(expr)
        res = ast.get(res, rhs)
      }
    }
    return res
  }
  function application() { // juxtaposition is a call: 'f x y'
    let res = binop()
    while (peek == "num" || peek == "str" || peek == "hole" ||
           peek == "ident" ||
           peek == "." || peek == "(" || peek == "[" || peek == "{") {
      res = ast.call(res, binop())
    }
    return res
  }

  // parser main entrypoint
  let res = expr()
  if (pos != input.length+1)
    error("couldn't parse '"+sanitize(peek)+"'")
  return res
}


// not used anymore
exports.parsePurePath = (p) => {
  let as = p.split(".")
  if (as.length == 1) return ast.ident(as[0])
    let ret = ast.raw("inp")
  for (let i = 0; i < as.length; i++) {
    if (as[i] == "")
      continue // skip empty
    ret = ast.get(ret, ast.ident(as[i]))
  }
  return ret
}


