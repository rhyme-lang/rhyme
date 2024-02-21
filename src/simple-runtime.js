
// runtime support

let rt = exports.runtime = {}


rt.special = {}
rt.pure = {}
rt.stateful = {}


// special operations

rt.special.get = true
rt.special.group = true
rt.special.update = true


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

rt.pure.times = (x1,x2) => {
  if (x1 === undefined) return undefined
  if (x2 === undefined) return undefined
  return Number(x1) * Number(x2)
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

rt.stateful.last = x => ({
  init: () => undefined, // XXX want 0 to start?
  next: s => {
    if (x === undefined) return s
    return x
  }
})

rt.stateful.array = x => ({
  init: () => [], // XXX want 0 to start?
  next: s => {
    if (x === undefined) return s
    s.push(x)
    return s
  }
})

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