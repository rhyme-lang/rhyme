
// runtime support

let rt = exports.runtime = {}


rt.pure = {}
rt.stateful = {}


// pure operations

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

rt.stateful.sum = x => ({
  init: () => undefined, // XXX want 0 to start?
  next: s => {
    if (x === undefined) return s
    if (s === undefined) return x
    return s + x
  }
})

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

// update stateful tmp with a reducer
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