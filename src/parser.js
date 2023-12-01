
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

//
// ---------- Textual parser ----------
//

exports.parse2 = (p) => {
    let input = p
    let pos = 0
    let peek
    let gap
    let str
    let start
    let indent
    let bullet

    indent = gap = whitespace();
    if (input[pos] == '-' && input[pos+1] == ' ') {
        pos += 2; bullet = true
    } else
        bullet = false
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

let opchars = '+-*/%<>=!'
let optable = {}
for (let c of opchars) optable[c] = 1

function read() {
  let isdigit = () => '0' <= input[pos] && input[pos] <= '9'
  let isletter = () => 'a' <= input[pos] && input[pos] <= 'z' || 'A' <= input[pos] && input[pos] <= 'Z'
  let isopchar = () => optable[input[pos]]
  start = pos
  if (isdigit()) {
    while (isdigit()) pos++
    peek = "num"
  } else if (isletter()) {
    while (isletter() || isdigit()) pos++
    peek = "ident"
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
//
// precedence: higher binds tighter
let prec = {
  '=' :  80,
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

function error(s) {
    console.dir({start, pos, str, msg:s})
    throw new Error(s)
}
function sanitize(s) {
    return s // TODO?
}

  function isknown(p) {
    return !p || p == '(' || p == ')' || p == '\n' ||
      p == '=' || p == '+' || p == '*'
  }

  function expr() {
    return binop(0)
  }
  function binop(min) {
    let res = tight()
    while (peek in prec && prec[peek] >= min) {
      let nextMin = prec[peek] + assoc[peek] // + 1 for left assoc
      let op = next()
      let rhs = binop(nextMin)
      res = { xxpath: op, xxparam: [res, rhs]}
    }
    return res
  }
  function tight() {
    if (peek == '(') {
      //parens(expr)
      return parens(() => expr())
    } else if (peek == "num" || peek == "str" || peek == "ident") {
      let s = str
      next()
      return { xxpath: "ident", xxparam: s }
    } else {
      if (isknown(peek))
        error("atom expected")
      else {
        error("atom expected but got '"+sanitize(peek)+"'")
        next()
      }
    }
    // todo: while (peek == '(')
  }


  let res = expr()
  if (pos != input.length+1)
    error("couldn't parse '"+sanitize(peek)+"'")
  return res
}


exports.parse = (p) => {
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