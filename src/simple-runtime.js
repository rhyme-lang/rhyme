
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

rt.pure.plus = (x1,x2) => {
  if (x1 === undefined) return undefined
  if (x2 === undefined) return undefined
  return Number(x1) + Number(x2)
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

rt.pure.apply = (x1,...x2) => {
  if (x1 === undefined) return undefined
  return x1(...x2)
}

rt.pure.join = (x1) => { // string join
  if (x1 === undefined) return undefined
  return x1.join()
}

rt.pure.flatten = (...x1) => { // array flatten
  if (x1 === undefined) return undefined
  return x1.flat()
}


// stateful operations (reducers)

// contract: 
// - reducing with 'undefined' typically does not
//   change state
//   exception: forall, exists
// - when reducing an empty set of values, the result
//   may be either 'undefined' or some other default


rt.stateful.sum = (x,extra) => ({
  init: () => undefined, // XXX want 0 to start?
  next: s => {
    if (!extra) return x // FIXME partial solution to double-sum bug
    if (x === undefined) return s
    if (s === undefined) return x
    return s + x
  }
})

rt.stateful.product = x => ({
  init: () => undefined, // XXX want 0 to start?
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

rt.stateful.single = x => ({ // error if more than one (XXX can't really do that...)
  init: () => undefined, 
  next: s => {
    if (x === undefined) return s
    if (s === undefined) return x
    // throw new Error("single value expected but got two: "+s+", "+x)
    // see groupByAverageTest, current codegen is set up to produce
    // the same value repeatedly in a grouped context
    if (JSON.stringify(s) !== JSON.stringify(x))
      console.error("single value expected but got two: "+s+", "+x)
    return s
  }
})


rt.stateful.array = (x,extra) => ({
  init: () => [], 
  next: s => {
    if (!extra) return [x]  // FIXME partial solution to double-sum bug
    if (x === undefined) return s
    s.push(x)
    return s
  }
})



// sum, count, min, max, 
// first, last, single, unique
// array


// these are dealt with somewhat specially
rt.stateful.group = (x1,x2) => ({
  init: () => ({}),
  next: s => { 
    if (x1 === undefined) return s
    if (x2 === undefined) return s
    s[x1] = x2
    return s
  }
})

rt.stateful.update = (x0,x1,x2) => ({
  init: () => ({...x0}),
  next: s => { 
    if (x1 === undefined) return s
    if (x2 === undefined) return s
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