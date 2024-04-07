
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


rt.stateful.sum = x => ({
  init: () => undefined, // XXX want 0 to start?
  next: s => {
    if (x === undefined) return s
    if (s === undefined) return x
    return s + x
  }
})

rt.stateful.product = x => ({
  init: () => undefined, // XXX want 1 to start?
  next: s => {
    if (x === undefined) return s
    if (s === undefined) return x
    return s * x
  }
})

rt.stateful.count = x => ({
  init: () => undefined, // XXX want 0 to start?
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

rt.stateful.array = x => ({
  init: () => [], 
  next: s => {
    if (x === undefined) return s
    s.push(x)
    return s
  }
})

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
// array


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

rt.stateful.update = (x0,x1,x2) => ({
  init: () => ({...x0}), // NOTE: preserve init value! 
                         // (see react-todo-app.html)
  next: s => { 
    if (x1 === undefined) return s
    if (x2 === undefined) return s
    if (s === undefined) s = {...x0}
    s[x1] = x2
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
    obj[ix] ??= {}
    obj = obj[ix]
  }

  let ix = path[path.length-1]
  obj[ix] ??= fold.init()

  obj[ix] = fold.next(obj[ix])
}


// deep vars (tree paths)

rt.deepGet = (root, a) => {
  if (a instanceof Array) {
    if (a.length > 0) {
      let [hd,...tl] = a
      return rt.deepGet(root?.[hd], tl)
    } else {
      return root
    }
  } else {
    return root?.[a]
  }
}

rt.deepForIn = (root, f) => {
  if (typeof root == "object") {
    for (let k in root) {
      f([k]) // preorder
      rt.deepForIn(root[k], p => {
        f([k,...p])
      })
    }
  }
}

rt.deepIfIn = (root, k, f) => {
  // TODO
  if (k[0] in root) f()
}




