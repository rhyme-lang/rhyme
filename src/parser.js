
// XXX could use main api from rhyme.js
function ast_ident(a) {
  return { xxpath: "ident", xxparam: a }
}
function ast_raw(a) {
  return { xxpath: "raw", xxparam: a }
}
function ast_get(a,b) {
  return { xxpath: "get", xxparam: [a,b] }
}
function ast_call(a,b) {
  return { xxpath: "apply", xxparam: [a,b] }
}
function ast_root() {
  return ast_raw("inp")
}
function ast_arg() {
  return ast_raw("_ARG_")
}
let binop_table = {
  "|": "pipe",

  "+": "plus",
  "-": "minus",
  "*": "times",
  "/": "fdiv",  // float div by default
  "//": "div", // integer division
  "%": "mod",
}
function ast_binop(op, a,b) {
  let op1 = binop_table[op] ?? op
  return { xxpath: op1, xxparam: [a,b] }
}

//
// ---------- Textual parser ----------
//


exports.rh = (strings, ...holes) => {
  return exports.desugar(exports.parserImpl(strings, holes))
}

exports.parse = (p) => {
  return exports.desugar(exports.parserImpl([p],[]))
}


exports.parserImpl = (strings, holes) => {
  let input = strings.join("\0") // combine segments using a distinguished marker
  let pos = 0
  let peek
  let gap
  let str
  let start
  let indent
  let bullet
  let hole = -1

  // ----- Lexer -----
  let opchars = '+-*/%<>=!|&?'
  let optable = {}
  for (let c of opchars) optable[c] = 1

  // init lexer with first token to get going
  indent = gap = whitespace();
  if (input[pos] == '-' && input[pos+1] == ' ') {
    pos += 2; bullet = true
  } else {
    bullet = false
  }
  read()

  function next() {
    // if (gap > 0) seq.push(input.substring(strt-gap,strt))
    // if (peek != str && peek != '\n')
    //   seq.push(dom(peek, {start:strt,end:pos}, "", str))
    // else
    //   seq.push(str)
    let c = peek;
    gap = whitespace();
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
      while (isletter() || isdigit() || input[pos] == "_") pos++
      peek = "ident"
    } else if (input[pos] == "*") { // special case!
      while (input[pos] == "*") pos++
      if (isletter() || isdigit() || input[pos] == "_") {
        while (isletter() || isdigit() || input[pos] == "_") pos++
        peek = "ident"
      } else {
        while (isopchar()) pos++
        peek = input.substring(start,pos)
      }
    } else if (isopchar()) {
      while (isopchar()) pos++
      peek = input.substring(start,pos)
    } else if (input[pos] == '"') {
      pos++
      while (input[pos] && input[pos] != '\n' && input[pos] != '"') pos++
      if (input[pos] == '"') pos++ // consume closing
        peek = "str"
    } else if (input[pos] == '\n') {
      // while (input[pos] == '\n') {
      peek = input[pos++]
      // let save = indent
      indent = whitespace(true)
      /*if (input[pos] == '\n') {
        indent = save // blank line, treat as prev indent
      } else*/ if (input[pos] == '-' && input[pos+1] == ' ') {
        pos += 2; bullet = true; indent+=2
      } else bullet = false
        // }      
      next() // XXX TODO: treat as whitespace for now ...
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
    while (input[pos] == ' ') ++pos
      let commentStart = pos
    if (input[pos] == '/' && input[pos+1] == '/') {
      pos += 2
      while (input[pos] && input[pos] != '\n') ++pos
      //if (input[pos] == '\n') ++pos
    } else if (input[pos] == '#') {
      pos += 1
      while (input[pos] && input[pos] != '\n') ++pos
      //if (input[pos] == '\n') ++pos
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
    console.dir({start, pos, str, msg:s})
    throw new Error(s)
  }
  function sanitize(s) {
    return s // TODO?
  }

  // is this a known token? useful in error repair
  function isknown(p) {
    return !p || p == '(' || p == ')' || p == '\n' ||
    p == '=' || p == '+' || p == '*'
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

  // precedence: higher binds tighter
  let prec = {
    '|' :  80,
    '<' :  90,
    '<=':  90,
    '>' :  90,
    '>=':  90,
    '==':  90,
    '!=':  90,
    '+' : 100,
    '-' : 100,
    '*' : 200,
    '/' : 200,
    '%' : 200,
  }
  // associativity: 1 for left, 0 for right
  let assoc = {
    '|' : 1,
    '=' : 0,
    '<' : 1,
    '<=': 1,
    '>' : 1,
    '>=': 1,
    '==': 1,
    '!=': 1,
    '+' : 1,
    '-' : 1,
    '*' : 1,
    '/' : 1,
    '%' : 1,
  }


  function expr() {
    return binop(0)
  }
  function binop(min) {
    let res = tight()
    while (peek in prec && prec[peek] >= min) {
      let nextMin = prec[peek] + assoc[peek] // + 1 for left assoc
      res = ast_binop(next(), res, binop(nextMin))
    }
    return res
  }
  function atom() {
    if (peek == '(') {
      return parens(expr)
    } else if (peek == "num" || peek == "str" || peek == "ident" || peek == "*") {
      let res = ast_ident(str)
      next()
      return res
    } else if (peek == "hole") {
      let res = holes[hole]
      next()
      return res
    } else if (peek == '{') {
      error("object constructor syntax not supported yet")
    } else if (peek == '[') {
      error("array constructor syntax not supported yet")
    } else {
      error("atom expected but got '"+sanitize(peek)+"'")
    }
  }
  function tight() {
    let res
    if (peek == ".") { // e.g. .input, to distinguish 'get' from 'ident'  TODO: require no space?
      next()
      res = ast_get(atom())
    } else
      res = atom()
    while (peek == "." || peek == "(" || peek == "[") {
      if (peek == ".") {
        next()
        if (peek == "ident" || peek == "*") {
          let rhs = ast_ident(str)
          res = ast_get(res, rhs)
          next()
        } else 
          error("ident expected")
      } else if (peek == "(") {
        let rhs = parens(expr)
        res = ast_call(res, rhs)
      } else if (peek == "[") {
        let rhs = brackets(expr)
        res = ast_get(res, rhs)
      }
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
  if (as.length == 1) return ast_ident(as[0])
    let ret = ast_raw("inp")
  for (let i = 0; i < as.length; i++) {
    if (as[i] == "")
      continue // skip empty
    ret = ast_get(ret, ast_ident(as[i]))
  }
  return ret
}


exports.desugar = (p) => {

  let argProvided = { xxpath: "raw", xxparam: "inp" }
  let argUsed = false

  function toFunc(p, args) {
    let save = [argProvided, argUsed]
    argProvided = args[0]
    argUsed = false
    p = trans(p)
    let h = argUsed
    argProvided = save[0]; argUsed = save[1] // [argProvided, argUsed] = save doesn't work??

    // is the argument used? i.e. syntax '.foo' --> we have 'arg.foo', just return
    if (h)
      return p

    // argument not used yet: i.e. syntax 'udf.fun' --> apply to arg, return 'udf.fun(arg)'
    if (p.xxpath == "ident") {
      if (p.xxparam == "get") {
        return { xxpath: "get", xxparam: args }
      } else if (p.xxparam == "sum") {
        return { xxkey: "sum", xxparam: args[0] } // unpack!
      } else if (p.xxparam == "max") {
        return { xxkey: "max", xxparam: args[0] } // unpack!
      } else if (p.xxparam == "group" && args.length < 2) {
        if (args[0].xxpath != "ident")
          error("ERROR - key passed to 'group' needs to be an ident but got '" + args[0] + "'")
        return { xxpath: "group", xxparam: args[0].xxparam } // unpack!
      }
    } else if (p.xxpath == "get" && p.xxparam.length == 1) { // partially applied, i.e. 'get(*line)'
      return { xxpath: "get", xxparam: [args[0],p.xxparam[0]] }
    } else if (p.xxpath == "group") { // partially applied, i.e. 'group(*line)'
      return { [p.xxparam]: args[0] }
    }

    return { xxpath: "apply", xxparam: [p,...args] }
  }

  function trans(p) {
    if (p == undefined) {
      return p
    } else if (p.xxpath == "ident") {
      return p
    } else if (p.xxpath == "raw") {
      if (p.xxparam == "_ARG_") {
        argUsed = true
        return argProvided
      }
      return p
    } else if (p.xxpath == "pipe") {
      let [e1,e2,...e3s] = p.xxparam
      return trans ({ xxpath: "apply", xxparam: [e2,e1,...e3s] })
    } else if (p.xxpath == "apply") {
      let [e1,...e2s] = p.xxparam
      return toFunc(e1, e2s.map(trans))
    } else if (p.xxpath == "get") {
      let [e1, ...e2s] = p.xxparam.map(trans)
      if (e2s.length == 0 || e2s[0] === undefined) {
        // implicit hole = argument ref
        e2s = [e1]
        e1 = argProvided
        argUsed = true
      }
      if (e1.xxpath == "ident")
        e1 = { xxpath: "get", xxparam: [{ xxpath: "raw", xxparam: "inp"}, e1] }
      return { xxpath: "get", xxparam: [e1,...e2s] }
    } else if (p.xxpath) {
      return { xxpath: p.xxpath, xxparam: p.xxparam.map(trans) }
    } else if (p.xxkey) {
      return { xxkey: p.xxkey, xxparam: trans(p.xxparam) }
    }
    return p
  }

  return trans(p)
}