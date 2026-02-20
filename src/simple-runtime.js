const fs = require("fs")

// runtime support

let rt = exports.runtime = {}


rt.special = {}
rt.pure = {}
rt.stateful = {}


// special operations

rt.special.get = true
rt.special.group = true
rt.special.update = true
rt.special.update_inplace = true
rt.special.merge = rt.special.keyval = true

// loadInput operations
let inputFiles = {}
rt.reset = () => {
  inputFiles = {}
}

rt.loadJSON = (path) => {
  if (oath === undefined) return undefined
  if (!inputFiles[path]) {
    inputFiles[path] = JSON.parse(fs.readFileSync(path))
  }
  return inputFiles[path]
}

rt.loadNDJSON = (path) => {
  if (path === undefined) return undefined
  if (!inputFiles[path]) {
    const fd = fs.openSync(path, 'r')
    const chunkSize = 256 * 1024 * 1024
    const buf = Buffer.alloc(chunkSize)
    const records = []
    let leftover = ''
    let bytesRead

    while ((bytesRead = fs.readSync(fd, buf, 0, chunkSize)) > 0) {
      const chunk = leftover + buf.toString('utf8', 0, bytesRead)
      const lines = chunk.split('\n')
      leftover = lines.pop() // last incomplete line
      for (const line of lines) {
        if (line.trim()) records.push(JSON.parse(line))
      }
    }

    if (leftover.trim()) records.push(JSON.parse(leftover))
    fs.closeSync(fd)
    inputFiles[path] = records
  }

  return inputFiles[path]
}

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

rt.pure.equal = (x1, x2) => {
  if (x1 === undefined) return undefined
  if (x2 === undefined) return undefined
  return x1 === x2 ? true : undefined
}

rt.pure.notEqual = (x1, x2) => {
  if (x1 === undefined) return undefined
  if (x2 === undefined) return undefined
  return x1 !== x2 ? true : undefined
}

rt.pure.lessThan = (x1, x2) => {
  if (x1 === undefined) return undefined
  if (x2 === undefined) return undefined
  return x1 < x2 ? true : undefined
}

rt.pure.lessThanOrEqual = (x1, x2) => {
  if (x1 === undefined) return undefined
  if (x2 === undefined) return undefined
  return x1 <= x2 ? true : undefined
}

rt.pure.greaterThan = (x1, x2) => {
  if (x1 === undefined) return undefined
  if (x2 === undefined) return undefined
  return x1 > x2 ? true : undefined
}

rt.pure.greaterThanOrEqual = (x1, x2) => {
  if (x1 === undefined) return undefined
  if (x2 === undefined) return undefined
  return x1 >= x2 ? true : undefined
}

rt.pure.plus = (x1,x2) => {
  if (x1 === undefined) return undefined
  if (x2 === undefined) return undefined
  // Remove string concat in favor of separate "concat" function.
  return Number(x1) + Number(x2)
}

rt.pure.concat = (x1,x2) => {
  if (x1 === undefined) return undefined
  if (x2 === undefined) return undefined
  return String(x1) + String(x2)
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

rt.pure.andAlso = (x1,x2) => {
  if (x1 === undefined) return undefined
  return x2
}

rt.pure.orElse = (x1,x2) => {
  if (x1 === undefined) return x2
  return x1
}

rt.pure.singleton = (x1) => { // 'mkset'
  if (x1 === undefined) return {}
  return {[x1]:true}
}

rt.pure.ifElse = (c,tB,eB) => {
  return c !== undefined ? tB : eB
}

rt.pure.sort = (x1, ...x2) => {
  // Parse arguments into field-order pair
  if (x1 === undefined) return undefined
  if (!Array.isArray(x1)) {
    if (typeof x1 === 'object' && x1 !== null) {
      x1 = Object.values(x1);
    } else {
      throw new Error('First argument must be an array or object');
    }
  }
  
  const sortCriteria = []
  for (let i = 0; i < x2.length; i += 2) {
    if (i + 1 < x2.length) {
      sortCriteria.push({
        field: x2[i],
        descending: x2[i + 1] === 1
      })
    }
  }

  // Sort the array
  return x1.sort((a, b) => {
    for (const { field, descending } of sortCriteria) {
      const valueA = a[field]
      const valueB = b[field]
      
      let comparison = 0
      
      // Compare values
      if (valueA < valueB) {
        comparison = -1
      } else if (valueA > valueB) {
        comparison = 1
      }
      
      // If values are different, return the comparison
      if (comparison !== 0) {
        return descending ? -comparison : comparison
      }
      
      // If equal, continue to next sort criterion
    }
    
    return 0 // All fields are equal
  })
}

rt.pure.convert_u8 = (x) => x === undefined ? undefined : (Number(x) & 0xff);
rt.pure.convert_u16 = (x) => x === undefined ? undefined : (Number(x) & 0xffff);
rt.pure.convert_u32 = (x) => x === undefined ? undefined : (Number(x) & 0xffffffff);
rt.pure.convert_u64 = (x) => x === undefined ? undefined : BigInt(x) & BigInt("0xffffffffffffffff");
// TODO: Determine if these properly hold for really big numbers (Answer: They don't). Also, find a way to optimize?
rt.pure.convert_i8 = (x) => x === undefined ? undefined : (((Number(x) + 0x80) & 0xff) - 0x80);
rt.pure.convert_i16 = (x) => x === undefined ? undefined : (((Number(x) + 0x8000) & 0xffff) - 0x8000);
rt.pure.convert_i32 = (x) => x === undefined ? undefined : (((Number(x) + 0x80000000) & 0xffffffff) - 0x80000000);
rt.pure.convert_i64 = (x) => x === undefined ? undefined : ((BigInt(x) + BigInt("0x8000000000000000")) & BigInt("0xffffffffffffffff")) - BigInt("0x8000000000000000");
// TODO: Determine if all implementations have Math.fround implemented.
rt.pure.convert_f32 = (x) => x === undefined ? undefined : Math.fround(Number(x));
rt.pure.convert_f64 = (x) => x === undefined ? undefined : Number(x);

rt.pure.convert_string = (x) => x === undefined ? undefined : String(x);

rt.singleton = (x1) => { // 'mkset'
  if (x1 === undefined) return {}
  return {[x1]:true}
}

rt.pure.mkTuple = (...arg) => {
  let res = {}
  for (let i = 0; i < arg.length; i += 2) {
    if (arg[i + 1] === undefined) continue
    res[arg[i]] = arg[i + 1]
  }
  if (Object.keys(res) == 0) return undefined
  return res
}

// stateful operations (reducers)

// contract: 
// - reducing with 'undefined' typically does not
//   change state
//   exception: forall, exists
// - when reducing an empty set of values, the result
//   may be either 'undefined' or some other default


rt.stateful.sum_init = () => 0

rt.stateful.sum = x => s => {
  // TODO: generalize NaN handling
  if (x === undefined || Number.isNaN(Number(x))) return s
  if (s === undefined || Number.isNaN(Number(s))) return x
  return s + x
}

rt.stateful.product_init = () => 1

rt.stateful.product = x => s => {
  if (x === undefined) return s
  if (s === undefined) return x
  return s * x
}

rt.stateful.count_init = () => 0

rt.stateful.count = x => s => {
  if (x === undefined) return s
  if (s === undefined) return 1
  return s + 1
}

rt.stateful.min_init = () => Number.POSITIVE_INFINITY

rt.stateful.min = x => s => {
  if (x === undefined) return s
  if (s === undefined) return x
  return s <= x ? s : x
}

rt.stateful.max_init = () => Number.NEGATIVE_INFINITY

rt.stateful.max = x => s => {
  if (x === undefined) return s
  if (s === undefined) return x
  return s >= x ? s : x
}

rt.stateful.all_init = () => true

rt.stateful.all = x => s => {
  if (x === undefined) return undefined
  if (s === undefined) return undefined
  return s // return first encountered
}

rt.stateful.any = x => s => {
  if (x === undefined) return s
  if (s === undefined) return x
  return s // return first encountered
}

rt.stateful.first = x => s => {
  if (x === undefined) return s
  if (s === undefined) return x
  return s
}

rt.stateful.last = x => s => {
  if (x === undefined) return s
  return x
}

rt.stateful.single = x => s => { // error if more than one
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
  return x
}

rt.stateful.array_init = () => []

rt.stateful.array = x => s => {
  if (x === undefined) return s
  s.push(x)
  return s
}

rt.stateful.mkset_init = () => ({})

rt.stateful.mkset = x => s => {
  if (x === undefined) return s
  s[x] = true
  return s
}


// sum, count, min, max, 
// first, last, single, unique
// array, mkset

rt.stateful.prefix_init = () => ([])

rt.stateful.prefix = fold => s => {
  if (s && s.length)
    s.push(fold(s[s.length-1]))
  else
    s = [fold(undefined)]
  return s
}



// group and update

// these are dealt with somewhat specially

rt.stateful.group_init = () => ({})

rt.stateful.group = (x1,x2) => s => {
  if (x1 === undefined) return s
  if (x2 === undefined) return s
  if (s === undefined) s = {}
  s[x1] = x2
  return s
}


rt.uniqueMutableCopy = x0 => {
  console.assert(typeof x0 === "object")
  return {...x0}
}

rt.stateful.update_init = (x0) => () => {
  if (typeof x0 === "object")
    return rt.uniqueMutableCopy(x0)
  return x0 // should return undefined?
}

rt.stateful.update = (x1,x2) => s => {
  if (x1 === undefined) return s
  if (x2 === undefined) return s
  if (s === undefined) s = {} // not intialized? assume empty object
  if (typeof s !== "object") return s // not an object? do nothing
  if (x1 instanceof Array) {
    s = rt.deepUpdate(s, x1, x2)
  } else {
    s[x1] = x2
  }
  return s
}


// utils

// update stateful tmp with a given reducer
rt.update = (root,...path) => (fold) => {
  let obj = root
  let c = 0
  for (let ix of path.slice(0,path.length-1)) {
    if (ix === undefined) return
    ix = rt.encodeTemp(ix)
    obj[ix] ??= {}
    obj = obj[ix]
  }

  let ix = path[path.length-1]
  ix = rt.encodeTemp(ix)
  obj[ix] = fold(obj[ix])
}

// update stateful tmp with a given reducer
rt.init = (root,...path) => (init) => {
  let obj = root
  let c = 0
  for (let ix of path.slice(0,path.length-1)) {
    if (ix === undefined) return
    ix = rt.encodeTemp(ix)
    obj[ix] ??= {}
    obj = obj[ix]
  }

  let ix = path[path.length-1]
  ix = rt.encodeTemp(ix)
  obj[ix] ??= init()
}



// iteration utils: possible future hook for extension

rt.entries = (root) => {
  // possible extension point for user-defined
  // data structures:
  // 
  // if (root.rhyme_iterator)
  //   return root.rhyme_iterator()

  return Object.entries(root ?? {})
}

rt.has = (root, key) => {
  return (key in (root ?? {}))
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
    if (root && a in root)
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
    if (ix === undefined) return
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


