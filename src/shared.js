
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

// ops.special["get?"] = true
// ops.special["group?"] = true



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

ops.pure.andAlso = true
ops.pure.orElse = true

ops.pure.equal = true
ops.pure.notEqual = true
ops.pure.lessThan = true
ops.pure.lessThanOrEqual = true
ops.pure.greaterThan = true
ops.pure.greaterThanOrEqual = true
ops.pure.join = true
ops.pure.singleton = true
ops.pure.vars = true
ops.pure.ifElse = true

ops.pure.sort = true

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
ops.stateful.any = true

ops.stateful["sum?"] = true
ops.stateful["product?"] = true
ops.stateful["count?"] = true
ops.stateful["max?"] = true
ops.stateful["min?"] = true
ops.stateful["array?"] = true
ops.stateful["object?"] = true
ops.stateful["mkset?"] = true
ops.stateful["group?"] = true
ops.stateful["first?"] = true
ops.stateful["last?"] = true
ops.stateful["single?"] = true
ops.stateful["all?"] = true
ops.stateful["any?"] = true



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


// 
// ---------- sets, implemented as arrays ---------- 
// 

let sets = exports.sets = {}

sets.unique = xs => xs.filter((x,i) => xs.indexOf(x) == i)

sets.union = (a,b) => sets.unique([...a,...b])

sets.intersect = (a,b) => {
  let keys = {}
  let res = []
  for (let k of b)
    keys[k] = true
  for (let k of a)
    if (keys[k])
      res.push(k)
  return res
}

sets.diff = (a,b) => {
  let keys = {}
  let res = []
  for (let k of b)
    keys[k] = true
  for (let k of a)
    if (!keys[k])
      res.push(k)
  return res
}

sets.subset = (a,b) => {
  let keys = {}
  for (let k of b)
    keys[k] = true
  for (let k of a)
    if (!keys[k])
      return false
  return true
}

sets.same = (a,b) => sets.subset(a,b) && sets.subset(b,a)




// 
// ---------- deep maps, accessed with key arrays ---------- 
// 

let maps = exports.maps = {}

maps.traverse = (...objs) => depth => body => {
  console.assert(objs.length > 0)
  if (depth == 0) return body([],...objs)
  let [first, ...rest] = objs
  for (let k in first) {
    if (rest && !rest.every(e => k in e)) continue // inner join semantics
    maps.traverse(...objs.map(o=>o[k]))(depth-1)((ks,...os) => {
      body([k,...ks],...os)
    })
  }
}

maps.update = obj => path => value => {
  if (value === undefined) return obj
  if (path.length > 0) {
    let [k,...rest] = path
    obj ??= {}
    obj[k] = maps.update(obj[k] ?? {})(rest)(value)
    return obj
  } else
    return value
}

maps.reshape = obj => (path1, path2) => {
  console.assert(same(path1, path2))
  let perm = path2.map(x => path1.indexOf(x))
  let res = {}
  maps.traverse(obj)(path1.length)((a1,o1) => {
    let a2 = perm.map(i => a1[i])
    res = maps.update(res)(a2)(o1)
  })
  return res
}


maps.join = (obj1, obj2) => (schema1, schema2, schema3) => func => {
  let r1 = schema1; let r2 = schema2; let real = schema3
  let v1 = obj1; let v2 = obj2
  console.assert(sets.subset(r1, real))
  console.assert(sets.subset(r2, real))
  console.assert(sets.same(real, sets.union(r1,r2)))
  let r1only = sets.diff(real,r2)
  let r2only = sets.diff(real,r1)
  let r1r2 = sets.intersect(r1,r2)
  v1 = maps.reshape(v1)(r1, [...r1only,...r1r2])
  v2 = maps.reshape(v2)(r2, [...r2only,...r1r2])
  let res = {}
  maps.traverse(v1)(r1only.length)((a1,o1) =>
    maps.traverse(v2)(r2only.length)((a2,o2) => {
      maps.traverse(o1,o2)(r1r2.length)((a3,o3,o4) => {
        res = maps.update(res)([...a1,...a2,...a3])(func(o3,o4))
      })
    })
  )
  res = maps.reshape(res)([...r1only,...r2only,...r1r2],real)
  return res
}









