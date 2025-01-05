
// 
// ---------- available operations ---------- 
// 

let ops = exports.ops = {}

ops.special = {}
ops.pure = {}
ops.stateful = {}


// special operations

ops.special.get = true
ops.special.group = true
ops.special.update = true
ops.special.update_inplace = true
ops.special.merge = ops.special.keyval = true
ops.special.flatten = true

// pure operations

ops.pure.input = true
ops.pure.get = true
ops.pure.apply = true
ops.pure.pipe = true
ops.pure.plus = true
ops.pure.minus = true
ops.pure.times = true
ops.pure.fdiv = true
ops.pure.div = true
ops.pure.mod = true
ops.pure.and = true

ops.pure.equal = true
ops.pure.notEqual = true
ops.pure.join = true
ops.pure.singleton = true

// stateful operations

ops.stateful.sum = true
ops.stateful.product = true
ops.stateful.count = true
ops.stateful.max = true
ops.stateful.min = true
ops.stateful.array = true
ops.stateful.object = true
ops.stateful.mkset = true
ops.stateful.group = true
ops.stateful.first = true
ops.stateful.last = true
ops.stateful.single = true
ops.stateful.all = true


// 
// ---------- ast creation api (used by parser, test suite) ---------- 
// 

let ast = exports.ast = {}

// wrap internal ast -> external syntax object
ast.wrap = e => {
  console.assert(e.xxkey)
  return { rhyme_ast: e }
}

// unwrap external syntax object -> internal ast
ast.unwrap = e => {
  if (typeof e === "object" && "rhyme_ast" in e) return e.rhyme_ast
  if (e.xxkey) console.error("ERROR: double wrapping of ast node " + JSON.stringify(e))
  return { xxkey: "hole", xxop: e }
}

ast.ident = (a) => {
  return { xxkey: "ident", xxop: a }
}
ast.raw = (a) => {
  return { xxkey: "raw", xxop: a }
}
ast.root = () => {
  return ast.raw("inp")
}
ast.hole = (a) => {
  return { xxkey: "hole", xxop: a }
}
ast.num = (a) => {
  return { xxkey: "const", xxop: a }
}
ast.str = (a) => {
  return { xxkey: "const", xxop: a }
}
ast.get = (a,b) => {
  if (!b) return { xxkey: "get", xxparam: [a] }
  return { xxkey: "get", xxparam: [a,b] }
}
ast.call = (a,b) => {
  return { xxkey: "apply", xxparam: [a,b] }
}
ast.array = (as) => {
  return { xxkey: "array", xxparam: as }
}
ast.object = (as) => {
  return { xxkey: "object", xxparam: as }
}

ast.apply = (a,b) => {
  return { xxkey: "apply", xxparam: [a,b] }
}

ast.plus = (a,b) => {
  return { xxkey: "plus", xxparam: [a,b] }
}

