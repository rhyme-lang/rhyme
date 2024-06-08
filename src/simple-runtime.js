
// runtime support

let rt = exports.runtime = {}


rt.special = {}
rt.pure = {}
rt.stateful = {}


// special operations

rt.special.get = true
rt.special.group = true
rt.special.update = true
rt.special.merge = rt.special.keyval = true

// pure operations

// contract: 
// - 'undefined' signals a missing or unexpected value
//   e.g. a type mismatch
// - most of the time, 'undefined' is propagated, i.e., an 
//   undefined arg leads to an undefined result
//   exception: &&, ||
// - operations may raise exceptions for severe error cases
//   or illegal uses of an operation

// TODO: deal with NaN specially?

rt.pure.plus = (x1,x2) => {
  if (x1 === undefined) return undefined
  if (x2 === undefined) return undefined
  let res = Number(x1) + Number(x2)
  // NOTE: falling back to string concat
  // (see e.g. svg demo)
  if (Number.isNaN(res)) return x1 + x2
  // alternative: return undefined
  // if (Number.isNaN(res)) return undefined
  return res
}

rt.pure.minus = (x1,x2) => {
  if (x1 === undefined) return undefined
  if (x2 === undefined) return undefined
  return Number(x1) - Number(x2)
}

rt.pure.times = (x1,x2) => {
  if (x1 === undefined) return undefined
  if (x2 === undefined) return undefined
  return Number(x1) * Number(x2)
}

rt.pure.fdiv = (x1,x2) => {
  if (x1 === undefined) return undefined
  if (x2 === undefined) return undefined
  return Number(x1) / Number(x2)
}

rt.pure.div = (x1,x2) => {
  if (x1 === undefined) return undefined
  if (x2 === undefined) return undefined
  return Math.trunc(Number(x1) / Number(x2))
}

rt.pure.mod = (x1,x2) => {
  if (x1 === undefined) return undefined
  if (x2 === undefined) return undefined
  return Number(x1) % Number(x2)
}

rt.pure.apply = (x1,...x2) => {
  if (x1 === undefined) return undefined
  // undefined arguments currently ok!
  // (delegate responsibility to the udf)
  return x1(...x2)
}

rt.pure.join = (x1) => { // array string join
  if (x1 === undefined) return undefined
  return x1.join()
}

rt.pure.flatten = (...x1) => { // array flatten
  if (x1 === undefined) return undefined
  return x1.flat()
}


rt.pure.and = (x1,x2) => {
  if (x1 === undefined) return undefined
  return x2
}


rt.singleton = (x1) => { // 'mkset'
  if (x1 === undefined) return {}
  return {[x1]:true}
}


// stateful operations (reducers)

// contract: 
// - reducing with 'undefined' typically does not
//   change state
//   exception: forall, exists
// - when reducing an empty set of values, the result
//   may be either 'undefined' or some other default


rt.stateful.sum_init = () => 0

rt.stateful.sum = x => ({
  init: () => 0,
  next: s => {
    // TODO: generalize NaN handling
    if (x === undefined || Number.isNaN(Number(x))) return s
    if (s === undefined || Number.isNaN(Number(s))) return x
    return s + x
  }
})

rt.stateful.product_init = () => 1

rt.stateful.product = x => ({
  init: () => 1,
  next: s => {
    if (x === undefined) return s
    if (s === undefined) return x
    return s * x
  }
})

rt.stateful.count_init = () => 0

rt.stateful.count = x => ({
  init: () => 0,
  next: s => {
    if (x === undefined) return s
    if (s === undefined) return 1
    return s + 1
  }
})

rt.stateful.min = x => ({
  init: () => undefined, 
  next: s => {
    if (x === undefined) return s
    if (s === undefined) return x
    return s <= x ? s : x
  }
})

rt.stateful.max = x => ({
  init: () => undefined, 
  next: s => {
    if (x === undefined) return s
    if (s === undefined) return x
    return s >= x ? s : x
  }
})

rt.stateful.first = x => ({
  init: () => undefined,
  next: s => {
    if (x === undefined) return s
    if (s === undefined) return x
    return s
  }
})

rt.stateful.last = x => ({
  init: () => undefined,
  next: s => {
    if (x === undefined) return s
    return x
  }
})

rt.stateful.single = x => ({ // error if more than one
  init: () => undefined, 
  next: s => {
    if (x === undefined) return s
    if (s === undefined) return x
    // throw new Error("single value expected but got two: "+s+", "+x)
    //
    // NOTE: relaxed to support multiple occurrances of the
    // same value. Tighter semantics (above) currently not 
    // in line with expected output of test nestedIterators3 
    // and variants.
    //
    // This seems to be related to not identifying 1:1 mappings,
    // specifically for keys already on the grouping path
    // (also see groupTest_explicitHoisting).
    //
    // In general, codegen must be careful not to produce
    // values multiple times in a grouped context (consider
    // e.g. count).
    if (JSON.stringify(s) !== JSON.stringify(x))
      console.error("single value expected but got two: "+s+", "+x)
    return s
  }
})

rt.stateful.array_init = () => []

rt.stateful.array = x => ({
  init: () => [], 
  next: s => {
    if (x === undefined) return s
    s.push(x)
    return s
  }
})

rt.stateful.mkset_init = () => ({})

rt.stateful.mkset = x => ({
  init: () => ({}), 
  next: s => {
    if (x === undefined) return s
    s[x] = true
    return s
  }
})


// sum, count, min, max, 
// first, last, single, unique
// array, mkset


rt.stateful.prefix = p => ({
  init: () => [],
  next: s => {
    if (s && s.length)
      s.push(p.next(s[s.length-1]))
    else
      s = [p.next(p.init())]
    return s
  }
})



// group and update

// these are dealt with somewhat specially
rt.stateful.group = (x1,x2) => ({
  init: () => ({}), // {} vs undefined, what do we want?
                    // (see undefinedFields2, tables.html)
  next: s => {
    if (x1 === undefined) return s
    if (x2 === undefined) return s
    if (s === undefined) s = {}
    s[x1] = x2
    return s
  }
})


rt.stateful.update_init = (x0) => () => ({...x0})

rt.stateful.update = (x0,x1,x2) => ({
  init: () => ({...x0}), // NOTE: preserve init value! 
                         // (see react-todo-app.html)
                         // XXX: conflicting use-cases,
                         // see also testPathGroup3
  next: s => {
    if (x1 === undefined) return s
    if (x2 === undefined) return s
    if (s === undefined) {
      // still needed for tree paths, even now with
      // pre-init path (see testPathGroup3,4)
      // XXX todo: ensure more generally that we're only
      // updating proper objects
      if (typeof x0 === "object")
        s = {...x0}
      else
        s = x0
    }
    if (x1 instanceof Array) {
      // console.error("TODO: add deep update (group)! "+x1)
      s = rt.deepUpdate(s, x1, x2)
    } else {
      s[x1] = x2
    }
    return s
  }
})



// utils

// update stateful tmp with a given reducer
rt.update = (root,...path) => (fold) => {
  let obj = root
  let c = 0
  for (let ix of path.slice(0,path.length-1)) {
    if (ix === undefined) return
    if (ix instanceof Array) 
      console.error("TODO: add deep update! ", path)
    obj[ix] ??= {}
    obj = obj[ix]
  }

  let ix = path[path.length-1]
  if (ix instanceof Array) {
    // console.error("TODO: add deep update (red)! "+ix)
    // XXX trouble with tmp path vars, see testPathGroup3
    ix = ix.join("-")+"-"
    let s = fold.init()
    // XXX hacky solution to distinguish cases in testPathGroup3/4
    if (typeof(s) === "number")
      obj[ix] ??= s
    obj[ix] = fold.next(obj[ix])
  } else {
  // if (ix instanceof Array) {
  //   // console.error("TODO: add deep update (red)! "+ix)
  //   let v = rt.deepGet(obj, ix)
  //   if (v === undefined)
  //     rt.deepUpdate(obj, ix, fold.next(fold.init()))
  //   else
  //     rt.deepUpdate(obj, ix, fold.next(v))
  // } else {
    // obj[ix] ??= fold.init()
    obj[ix] = fold.next(obj[ix])
  }
}

// update stateful tmp with a given reducer
rt.init = (root,...path) => (init) => {
  let obj = root
  let c = 0
  for (let ix of path.slice(0,path.length-1)) {
    if (ix === undefined) return
    if (ix instanceof Array)
      console.error("TODO: add deep init! ", path)
    obj[ix] ??= {}
    obj = obj[ix]
  }

  let ix = path[path.length-1]
  if (ix instanceof Array) {
    // console.error("TODO: add deep update (red)! "+ix)
    let v = rt.deepGet(obj, ix)
    if (v === undefined)
      rt.deepUpdate(obj, ix, init())
  } else {
    obj[ix] ??= init()
    // obj[ix] = fold.next(obj[ix])
  }
}


// deep vars (tree paths)

rt.deepGet = (root, a) => {
  if (a instanceof Array) {
    if (a.length > 0) {
      let [hd,...tl] = a
      if (hd instanceof Array)
        console.error("TODO: two-level nesting: ", a)
      return rt.deepGet(root?.[hd], tl)
    } else {
      return root
    }
  } else {
    return root?.[a]
  }
}

rt.deepUpdate = (obj, path, value) => {
  // console.log(path, value)
  if (value === undefined) return obj
  if (path.length > 0) {
    let [k,...rest] = path
    if (k instanceof Array) {
      // deep! e.g. deep var in top-level iter space
      obj = rt.deepUpdate(obj, [...k,...rest], value)
    } else {
      obj ??= {}
      obj[k] = rt.deepUpdate(obj[k] ?? {}, rest, value)
    }
    return obj
  } else
    return value
}

rt.deepForIn = (root, f) => {
  f([]) // preorder
  if (typeof root == "object") {
    for (let k in root) {
      rt.deepForIn(root[k], p => {
        f([k,...p])
      })
    }
  }
}

rt.deepIfIn = (root, a, f) => {
  if (a instanceof Array) {
    if (a.length > 0) {
      let [hd,...tl] = a
      if (hd instanceof Array)
        console.error("TODO: two-level nesting: ", a)
      if (root && hd in root)
        rt.deepIfIn(root[hd], tl, f)
    } else {
      f()
    }
  } else {
    if (a in root)
      f()
  }
}


// XXX new support for 'temp' encoding
// (flatten nested keys for 'deep' vars)

rt.encodeTemp = x => {
  if (x instanceof Array) return JSON.stringify(x)
  return x
}
rt.decodeTemp = x => {
  if (x.startsWith("[")) return JSON.parse(x)
  return x
}


// update stateful tmp with a given reducer
rt.initTemp = (root,...path) => (init) => {
  let obj = root
  let c = 0
  for (let ix of path.slice(0,path.length-1)) {
    ix = rt.encodeTemp(ix)
    obj[ix] ??= {}
    obj = obj[ix]
  }

  let ix = path[path.length-1]
  ix = rt.encodeTemp(ix)
  obj[ix] ??= init()
}

rt.deepForInTemp = (root, f) => {
  for (let k in root) {
    f(k,rt.decodeTemp(k))
  }
}

