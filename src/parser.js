const { desugar } = require("./desugar")
const { ast } = require("./shared")

let binop_table = {
  "|" : "pipe",
  "&" : "and",   // low prec, could give it some other grouping semantics

  "||":  "orElse",
  "&&":  "andAlso",

  "<" :  "lessThan",
  "<=":  "lessThanOrEqual",
  ">" :  "greaterThan",
  ">=":  "greaterThanOrEqual",
  "==":  "equal",
  "!=":  "notEqual",

  "::" : "concat",
  "+" : "plus",
  "-" : "minus",
  "*" : "times",
  "/" : "fdiv",  // float div by default
  "//": "div",   // integer division
  "%" : "mod",
}

function ast_binop(op, a,b) {
  let op1 = binop_table[op] ?? op
  return { xxkey: op1, xxparam: [a,b] }
}

function ast_postop(op, a) {
  if (op == "?" && a.xxkey == "ident") {
    return { ...a, xxop: a.xxop + "?" }
  } else if (op == "?" && a.xxkey == "get") {
    return { ...a, xxkey: "get?" }
  }
  return { xxkey: op, xxparam: [a] }
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
  let indent
  let bullet
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
  indent = whitespace();
  gap = input.substring(0, indent)
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
    while (input[pos] == ' ' || input[pos] == '\n') ++pos
    let commentStart = pos
    // if (input[pos] == '/' && input[pos+1] == '/') {
    //   pos += 2
    //   while (input[pos] && input[pos] != '\n') ++pos
    //   //if (input[pos] == '\n') ++pos
    // } else
    if (input[pos] == '#') {
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


  // precedence: higher binds tighter
  let prec = {
    '|' :  40,
    '&' :  50,
    '||':  70,
    '&&':  80,
    '<' :  90,
    '<=':  90,
    '>' :  90,
    '>=':  90,
    '==':  90,
    '!=':  90,
    '::':  95,
    '+' : 100,
    '-' : 100,
    '*' : 200,
    '/' : 200,
    '//': 200,
    '%' : 200,
  }
  // associativity: 1 for left, 0 for right
  let assoc = {
    '|' : 1,
    '&' : 1,
    '||': 1,
    '&&': 1,
    '=' : 0,
    '<' : 1,
    '<=': 1,
    '>' : 1,
    '>=': 1,
    '==': 1,
    '!=': 1,
    '::': 1,
    '+' : 1,
    '-' : 1,
    '*' : 1,
    '/' : 1,
    '//': 1,
    '%' : 1,
  }


  function expr() {
    if (peek == 'ident' && str == "let") {
      // 'let' ident+ '=' tight (';'|'\n') expr
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
      let rhs = exprTight()
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
    } else {
      return binop(0)
    }
  }
  function exprTight() {
    return binopTight(50)
  }
  function binop(min) {
    let res = loose()
    while (peek in prec && prec[peek] >= min) {
      let nextMin = prec[peek] + assoc[peek] // + 1 for left assoc
      res = ast_binop(next(), res, binop(nextMin))
    }
    return res
  }
  function binopTight(min) {
    let res = tight()
    while (peek in prec && prec[peek] >= min) {
      let nextMin = prec[peek] + assoc[peek] // + 1 for left assoc
      res = ast_binop(next(), res, binopTight(nextMin))
    }
    return res
  }
  function atom() {
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
        res = ast.num(Boolean(s))
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
      // object constructor syntax
      let entry = () => {
        let key = expr()
        let val
        if (peek == ":") {
          next(); val = expr()
        } else {
          val = key
        }
        return [key, val]
      }
      let elems = braces(() => commaList(entry))
      return ast.object(elems.flat())
    } else if (peek == '[') {
      // array constructor syntax
      let elems = brackets(() => commaList(expr))
      return ast.array(elems)
    } else {
      error("atom expected but got '"+sanitize(peek)+"'")
    }
  }
  function tight() {
    let res
    if (peek == ".") { // e.g. .input, to distinguish 'get' from 'ident'  TODO: require no space?
      next()
      let rhs = atom()
      res = ast.get(rhs)
    } else if (peek == "num") {
      // decimal literal? 0.123 ...
      let int = str
      res = ast.num(Number(int))
      next()
      if (peek == ".") {
        next()
        if (peek != "num") error("number expected but got '"+sanitize(peek)+"'")
        let frac = str
        res = ast.num(Number(int + "." + frac))
        next()
      }
    } else {
      res = atom()
    }

    if (gap == "" && peek == "?") {
      res = ast_postop(next(), res)
    }

    while (gap == "" && (peek == "." || peek == "(" || peek == "[")) {
      if (peek == ".") {
        next()
        let rhs = atom()
        res = ast.get(res, rhs)
        if (gap == "" && peek == "?") {
          res = ast_postop(next(), res)
        }
        // TODO: might want to prevent .{}. and .[]. which don't make sense
        // if (peek == "ident" || peek == "*") {
        //   let rhs = ast.ident(str)
        //   res = ast.get(res, rhs)
        //   next()
        // } else 
        //   error("ident expected")
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
  function loose() {
    let res = exprTight()
    while (peek == "num" || peek == "str" || peek == "hole" ||
           peek == "ident" || peek == "*" ||
           peek == "." || peek == "(" || peek == "[" || peek == "{") {
      res = ast.call(res, exprTight())
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


