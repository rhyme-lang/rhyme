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

let buildCSR = mat => {
  let data = []
  let cols = []
  let rows = []
  // note: we rely on in-order traversal
  for (let y in mat) {
    rows.push(data.length)
    for (let x in mat[y]) {
      if (mat[y][x]) {
        cols.push(x)
        data.push(mat[y][x])
      }
    }
  }
  return {data, cols, rows}
}


let CSVectorProxy = {
  get(target, prop, receiver) {
    if (!Number.isNaN(Number(String(prop)))) {
      // inefficient: use binary search to improve
      let i = target.cols.indexOf(prop, target.start)
      if (target.start <= i && i < target.end) return target.data[i]
      return undefined
    }
    return Reflect.get(...arguments)
  },
  has(target, prop) {
    if (!Number.isNaN(Number(String(prop)))) {
      let i = target.cols.indexOf(prop, target.start)
      return i < target.end
    }
    return Reflect.has(...arguments)
  },
  set(target, prop, value) {
    if (!Number.isNaN(Number(String(prop)))) {
      let i = Number(prop)
      console.error("update not yet supported for CSVector")
    }
    return Reflect.set(...arguments)
  },
  ownKeys(target) {
    return target.cols.slice(target.start, target.end)
  },
  getOwnPropertyDescriptor(target, prop) {
    return { configurable: true, enumerable: true }
  }
}

let CSVector = (data, cols, start, end) => {
  return new Proxy({data, cols, start, end}, CSVectorProxy)
}

let CSRMatrixProxy = {
  get(target, prop, receiver) {
    if (!Number.isNaN(Number(String(prop)))) {
      let i = Number(prop)
      if (i < target.rows.length) {
        let start = target.rows[i]
        let end = (i == target.rows.length - 1)
                  ? target.data.length
                  : target.rows[i + 1]
        return CSVector(target.data, target.cols, start, end)
      }
      return undefined
    }
    return Reflect.get(...arguments)
  },
  has(target, prop) {
    if (!Number.isNaN(Number(String(prop)))) {
      let i = Number(prop)
      return (i < target.rows.length)
    }
    return Reflect.has(...arguments)
  },
  set(target, prop, value) {
    if (!Number.isNaN(Number(String(prop)))) {
      let i = Number(prop)
      console.error("update not yet supported for CSRMatrix")
    }
    return Reflect.set(...arguments)
  },
  ownKeys(target) {
    let l = target.rows.length
    let res = new Array(l)
    for (let i = 0; i < l; i++)
      res[i] = String(i)
    return res
  },
  getOwnPropertyDescriptor(target, prop) {
    return { configurable: true, enumerable: true }
  }
}


let CSRMatrix = (data, cols, rows) => {
  return new Proxy({data, cols, rows}, CSRMatrixProxy)
}

test("csr0_buildManual", () => {

  let mat = [
    [10, 20,  0,  0,  0,  0,  0],
    [ 0, 30,  0, 40,  0,  0,  0],
    [ 0,  0, 50, 60, 70,  0,  0],
    [ 0,  0,  0,  0,  0, 80,  0],
    [ 0,  0,  0,  0,  0,  0,  0],
  ]

  let csr = {
    data: [10, 20, 30, 40, 50, 60, 70, 80],
    cols: ['0', '1', '1','3', '2', '3','4', '5'],
    rows: [ 0, 2, 4, 7, 8 ]
  }

  expect(buildCSR(mat)).toEqual(csr)

})

test("csr1_traverseManual", () => {

  let mat = [
    [10, 20,  0,  0,  0,  0,  0],
    [ 0, 30,  0, 40,  0,  0,  0],
    [ 0,  0, 50, 60, 70,  0,  0],
    [ 0,  0,  0,  0,  0, 80,  0],
    [ 0,  0,  0,  0,  0,  0,  0],
  ]

  let csr_data = {
    data: [10, 20, 30, 40, 50, 60, 70, 80],
    cols: ['0', '1', '1','3', '2', '3','4', '5'],
    rows: [ 0, 2, 4, 7, 8 ]
  }

  let csr = CSRMatrix(csr_data.data, csr_data.cols, csr_data.rows)

  let mat2 = []
  for (let y in csr) {
    mat2[y] = new Array(7).fill(0) // will be undefined without zeros
    for (let x in csr[y]) {
      mat2[y][x] = csr[y][x]
    }
  }

  expect(mat2).toEqual(mat)

})


test("csr2_sparseMatrixVectorProduct", () => {

  let csr_data = {
    data: [10, 20, 30, 40, 50, 60, 70, 80],
    cols: ['0', '1', '1','3', '2', '3','4', '5'],
    rows: [ 0, 2, 4, 7, 8 ]
  }

  let csr = CSRMatrix(csr_data.data, csr_data.cols, csr_data.rows)

  let vec = [4, -2, 1, 0, 4, 9, -5]

  let udf = {
    array: (n) => new Array(n)
  }

  let query = rh`update (udf.array 5) *i sum(csr.*i.*j * vec.*j)`

  let func = compile(query)
  let res = func({csr, vec, udf})

  expect(res).toEqual([
    0, -60, 330, 720, 0
  ])


})


test("sortMergeJoin1", () => {
  // prototype some code for sort-merge joins:

  let C = [0, 1, 3, 4, 5, 6, 7, 8, 9, 11]
  let B = [0, 2, 6, 7, 8, 9]
  let A = [2, 4, 5, 8, 10]

  // general strategy: most selective (smallest) first

  let EOF = Number.MAX_SAFE_INTEGER

  let itA = {pos: 0}
  let itB = {pos: 0}
  let itC = {pos: 0}

  let key = 0

  let seek = (array, pos, min) => {
    // suboptimal, should use binary search
    while (pos < array.length && array[pos] < min) pos++
    let key = pos < array.length ? array[pos] : EOF
    return {pos, key}
  }

  let res = []
  for (;;) {
    itA = seek(A,itA.pos,key)
    itB = seek(B,itB.pos,itA.key)
    itC = seek(C,itC.pos,itB.key)

    key = itC.key
    if (key == EOF) {
      break
    }
    if (key == itA.key) {
      res.push(key)
      key++
    }
  }

  expect(res).toEqual([8])
})


test("sortMergeJoin2", () => {
  // add some stub API

  let EOF = Number.MAX_SAFE_INTEGER

  let sortedArray = array => ({
    pos: 0,
    size: array.length,
    seek: function(min) {
      // suboptimal, should use binary search
      while (this.pos < array.length && array[this.pos] < min) this.pos++
      let key = this.pos < array.length ? array[this.pos] : EOF
      return key
    }
  })

  let intersection = sets => {
    sets.sort((a,b) => a.size - b.size) // smallest first
    return {
      size: Math.min(sets.map(x => x.size)), // size estimate: smallest input set
      seek: function(min) {
        for (;;) {
          let key = min
          for (let s of sets) {
            key = s.seek(key)
          }
          // note: this takes one additional cycle to stabilize
          // (really want to compare output of first set with last)
          if (key == min)
            return key
          min = key
        }
      }
    }
  }

  // could define union as well (outer join, e.g. SpV + SpV)

  let A = [0, 1, 3, 4, 5, 6, 7, 8, 9, 11]
  let B = [0, 2, 6, 7, 8, 9]
  let C = [2, 4, 5, 8, 10]

  let it = intersection([A,B,C].map(sortedArray))
  let res = []
  let key = 0
  for (;;) {
    key = it.seek(key)
    if (key == EOF) break
    res.push(key++)
  }

  expect(res).toEqual([8])
})

test("sortMergeJoin3", () => {

  let EOF = Number.MAX_SAFE_INTEGER

  let sortedArray = array => ({
    size: array.length,
    foreach: function(k, min=0) {
      let pos = 0
      for (;;) {
        // suboptimal, should use binary search
        while (pos < array.length && array[pos] < min) pos ++
        if (pos == array.length) return EOF
        min = k(array[pos++])
      }
    },
    seek: function(min) {
      let pos = 0
      // suboptimal, should use binary search
      while (pos < array.length && array[pos] < min) pos ++
      if (pos == array.length) return EOF
      return array[pos]
    }
  })



  let A = [0, 1, 3, 4, 5, 6, 7, 8, 9, 11]
  let B = [0, 2, 6, 7, 8, 9]
  let C = [2, 4, 5, 8, 10]

  let itA = sortedArray(A)
  let itB = sortedArray(B)
  let itC = sortedArray(C)

  // if we prefer to not keep iterator state for inner
  // filter, and we don't mind doing a full binary search
  // for each of those, then the following pattern also
  // works.

  // this is a lightweight extension of the standard hashjoin
  // pattern, that could allow sorted collections to offer and
  // take additional hints of the form "hey, I didn't have
  // this element, but the next bigger one is X" and then let
  // the parent traversal (optionally) skip ahead.

  let res = []
  itA.foreach(a => {
    let b = itB.seek(a)
    let c = itC.seek(b)
    if (c == a)
      res.push(a)
    return c
  })

  expect(res).toEqual([8])
})

