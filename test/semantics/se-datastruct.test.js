const { api, pipe } = require('../../src/rhyme')
const { rh, parse } = require('../../src/parser')
const { compile } = require('../../src/simple-eval')
// const { compile } = require('../../src/primitive-eval')


// group values into a specific datastructure, rather than
// a generic object.

// first: arrays
// note: there may be empty/undefined slots

test("array0", () => {

  let data = [1,2,3,4,5]
  let udf = { array: x => [] }
  let query = rh`update (udf.array 0) *D (data.*D + 10)` // 0 b/c parser requires an arg, can't do ()

  let func = compile(query)
  let res = func({data, udf})

  let expected = [11,12,13,14,15]

  expect(res).toEqual(expected)
  expect(res).not.toEqual({...expected}) // not an object!
})


test("array1_largeInitialSize", () => {

  let data = [1,2,3,4,5]
  let udf = { array: x => new Array(x) }
  let query = rh`update (udf.array 7) *D (data.*D + 10)`

  let func = compile(query)
  let res = func({data, udf})

  // non-strict equality

  expect(res).not.toEqual({
  	0:11,1:12,2:13,3:14,4:15
  })

  expect(res).toEqual([
  	11,12,13,14,15
  ])

  expect(res).toEqual([
  	11,12,13,14,15, undefined, undefined, undefined,
  ])


  // strict equality

  expect(res).not.toStrictEqual([
  	11,12,13,14,15
  ])

  expect(res).not.toStrictEqual([
  	11,12,13,14,15, undefined, undefined, undefined,
  ])

  expect(res).not.toStrictEqual([
  	11,12,13,14,15, undefined, undefined, // not even this is equal!
  ])

  expect(res).toStrictEqual([
  	11,12,13,14,15, , , 
  ])
})

test("array2_filterGaps", () => {
  let data = [1,2,3,4,5]
  let filter = { 1: true, 3: true, 5: true }
  let udf = { array: x => new Array(x) }
  let query = rh`update (udf.array 5) *D (filter.(data.*D) & data.*D + 10)`

  let func = compile(query)
  let res = func({data, filter, udf})

  expect(res).toEqual([
  	11,,13,,15,
  ])

  expect(res).not.toEqual([
  	11,12,13,14,15,
  ])
})


// next: typed arrays
// 
// this works, but there are no undefined values and
// empty slots map to zeros. this seems consistent
// if the init value is provided explicitly.

test("typedArray0_noGapsJustZeroes", () => {
  let data = [1,2,3,4,5]
  let filter = { 1: true, 3: true, 5: true }
  let udf = { array: x => new Float32Array(x) }
  let query = rh`update (udf.array 10) *D (filter.(data.*D) & data.*D + 10)`

  let func = compile(query)
  let res = func({data, filter, udf})

  expect(res).toEqual(new Float32Array([
    11, 0, 13, 0, 15, 0, 0, 0, 0, 0
  ]))
})



// next: tensor views
//
// multidimensional interface backed by flat dense array
//
// so far read-only

let TensorViewProxy = {
  get(target, prop, receiver) {
    if (prop === "length") {
      return target.shape[0]
    }
    if (!Number.isNaN(Number(String(prop)))) {
      let i = Number(prop)
      if (i >= target.shape[0]) return undefined
      if (target.shape.length > 1) {
        let [s,...shape] = target.shape
        let size = target.size / s
        return TensorView(target.data, shape, target.offset + i * size)
      } else {
        return target.data[target.offset + i]
      }
    }
    return Reflect.get(...arguments)
  },
  has(target, prop) {
    if (prop === "length") {
      return true
    }
    if (!Number.isNaN(Number(String(prop)))) {
      let i = Number(prop)
      if (i >= target.shape[0]) return undefined
      return true
    }
    return Reflect.has(...arguments)
  },
  set(target, prop, value) {
    if (prop === "length") {
      return
    }
    if (!Number.isNaN(Number(String(prop)))) {
      let i = Number(prop)
      if (i >= target.shape[0]) return undefined
      if (target.shape.length > 1) {
        let [s,...shape] = target.shape
        let size = target.size / s
        console.assert(target.data === value.data)
        //return TensorView(target.data, shape, target.offset + i * size)
      } else {
        target.data[target.offset + i] = value
      }
    }
    return Reflect.set(...arguments)
  },
  ownKeys(target) {
    let l = target.shape[0]
    let res = new Array(l)
    for (let i = 0; i < l; i++)
      res[i] = String(i)
    return res
    // would be more efficient to return an
    // iterator, but doesn't quite seem to work
    // return (function* () {
    //   for (let i = 0; i < l; i++)
    //     yield String(i)
    // })
  },
  getOwnPropertyDescriptor(target, prop) {
    return { configurable: true, enumerable: true }
  } 

}


let TensorView = (data, shape, offset = 0) => {
  let size = 1
  for (let d of shape) {size *= d}
  console.assert(data.length - offset >= size)
  return new Proxy({data, offset, size, shape}, TensorViewProxy)
}

let toMatrix1 = tv => {
  let mat = []
  for (let i = 0; i < tv.length; i++) {
    let row = []
    for (let j = 0; j < tv[i].length; j++) {
      row.push(tv[i][j])
    }
    mat.push(row)
  }
  return mat
}

let toMatrix2 = tv => {
  let mat = []
  for (let i in tv) {
    let row = []
    for (let j in tv[i]) {
      row.push(tv[i][j])
    }
    mat.push(row)
  }
  return mat
}


test("tensorView0", () => {

  let raw = [1,2,3,4,5,6]

  let tv1 = TensorView(raw, [3,2])
  let tv2 = TensorView(raw, [2,3])

  // test for(i = 0; i < tv.length; i++)
  expect(toMatrix1(tv1)).toEqual([
    [1,2], [3,4], [5,6]
  ])
  expect(toMatrix1(tv2)).toEqual([
    [1,2,3], [4,5,6]
  ])

  // test for(i in tv)
  expect(toMatrix2(tv1)).toEqual([
    [1,2], [3,4], [5,6]
  ])
  expect(toMatrix2(tv2)).toEqual([
    [1,2,3], [4,5,6]
  ])

})


test("tensorView1_toArrays", () => {

  let raw = [1,2,3,4,5,6]

  let tv1 = TensorView(raw, [3,2])
  let tv2 = TensorView(raw, [2,3])

  let query = rh`array (*i & (array data.*i.*j))`

  let func = compile(query)

  // console.log(func.explain.code)

  let res1 = func({data: tv1})
  let res2 = func({data: tv2})

  expect(res1).toEqual([
    [1,2], [3,4], [5,6]
  ])
  expect(res2).toEqual([
    [1,2,3], [4,5,6]
  ])
})

test("tensorView2_toArraysTranspose", () => {

  let raw = [1,2,3,4,5,6]

  let tv1 = TensorView(raw, [3,2])
  let tv2 = TensorView(raw, [2,3])

  let query = rh`array (*j & (array data.*i.*j))`

  let func = compile(query)

  // console.log(func.explain.code)

  let res1 = func({data: tv1})
  let res2 = func({data: tv2})

  expect(res1).toEqual([
    [1,3,5], [2,4,6]
  ])
  expect(res2).toEqual([
    [1,4], [2,5], [3,6]
  ])
})


test("tensorView3_id", () => {

  let raw = [1,2,3,4,5,6]

  let data = TensorView(raw, [3,2])
  let out = TensorView(new Array(6), [3,2])

  let query = rh`update_inplace .out *WILDCARD 10+data.*i.*j`

  let func = compile(query)
  let res = func({data, out})

  expect(toMatrix1(res)).toEqual([
    [11,12], [13,14], [15,16]
  ])
})

test("tensorView3_transpose", () => {

  let raw = [1,2,3,4,5,6]

  let data = TensorView(raw, [3,2])
  let out = TensorView(new Array(6), [2,3])

  let query = rh`update_inplace .out *j (update_inplace out.*j *i 10+data.*i.*j)`

  let func = compile(query)
  let res = func({data, out})

  expect(toMatrix1(res)).toEqual([
    [11,13,15], [12,14,16]
  ])
})


// next: red-black trees to build sorted maps
//
// (Sedgewick's left leaning variant)

function lookup(elem, key) {
  if (!elem) return undefined
  if (key < elem.key)
    return lookup(elem.left, key)
  else if (key == elem.key)
    return elem.value
  else
    return lookup(elem.right, key)
}
function insert(elem, key, value) {
  if (!elem) return {key,value,red:true}
  if (key < elem.key)
    elem = {...elem, left: insert(elem.left,key,value)}
  else if (key == elem.key)
    elem = {...elem, value}
  else
    elem = {...elem, right: insert(elem.right,key,value)}
  if (isRed(elem.right))
    elem = rotateLeft(elem)
  if (isRed(elem.left) && isRed(elem.left.left))
    elem = rotateRight(elem)
  if (isRed(elem.left) && isRed(elem.right))
    elem = colorFlip(elem)
  return elem
}
function isRed(elem) {
  return elem && elem.red
}
function colorFlip(elem) {
  // we know both children are red
  elem.red = !elem.red
  elem.left.red = !elem.left.red
  elem.right.red = !elem.right.red
  return elem
}
function rotateLeft(elem) {
  // assert(isRed(elem.right))
  let x = elem.right
  elem.right = x.left
  x.left = elem
  x.red = elem.red//!x.left.red
  //x.left.red = true
  elem.red = true
  return x
}
function rotateRight(elem) {
  // assert(isRed(elem.left) && isRed(elem.left.left))
  let x = elem.left
  elem.left = x.right
  x.right = elem
  x.red = elem.red//x.right.red
  //x.right.red = true
  elem.red = true
  return x
}

let RedBlackTreeProxy = {
  get(target, prop, receiver) {
    if (prop === Symbol.iterator) {
      return (function*() {
        let rec = function* rec(elem) {
          if (!elem) return
          yield* rec(elem.left)
          yield ([elem.key, elem.value])
          yield* rec(elem.right)
        }
        yield* rec(target.root)
       })
    }
    return lookup(target.root, prop)
  },
  has(target, prop) {
    return lookup(target.root, prop) ?? false
  },
  set(target, prop, value) {
    return target.root = insert(target.root, prop, value)
  },
  ownKeys(target) {
    let res = new Array
    let rec = elem => {
      if (!elem) return
      rec(elem.left)
      res.push(elem.key)
      rec(elem.right)
    }
    rec(target.root)
    return res
  },
  getOwnPropertyDescriptor(target, prop) {
    return { configurable: true, enumerable: true }
  }
}


let RedBlackTree = () => {
  return new Proxy({root:null}, RedBlackTreeProxy)
}

test("redBlackTree0", () => {

  let rb = RedBlackTree()

  rb[5] = 1
  rb[4] = 2
  rb[3] = 3
  rb[2] = 4
  rb[1] = 5
  rb[0] = 6

  expect([...rb]).toEqual([
    ["0",6], ["1",5], ["2",4], ["3",3], ["4",2], ["5",1]
  ])

})


test("redBlackTree1", () => {

  // sort array and count occurence
  let data = [4,1, 5,1,2,3,7,7,2,0]

  let udf = {
    redBlackTree: () => RedBlackTree()
  }

  let query = rh`update (udf.redBlackTree 0) data.* (count data.*)`

  let func = compile(query)
  let res = func({data, udf})

  expect([...res]).toEqual([
    ['0',1],
    ['1',2],
    ['2',2],
    ['3',1],
    ['4',1],
    ['5',1],
    ['7',2]
  ])

})


// next: sparse matrices in CSR format (compressed sparse row)

/*
example:

      10 20  0  0  0  0  0
       0 30  0 40  0  0  0
  M =  0  0 50 60 70  0  0
       0  0  0  0  0 80  0
       0  0  0  0  0  0  0

  v = 10 20 30 40 50 60 70 80
  c =  0  1  1  3  2  3  4  5

  r =  0  2  4  7  8  8

matrix is a concatenation of sparse row vectors

*/
