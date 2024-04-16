const { api, pipe } = require('../../src/rhyme')
const { rh, parse } = require('../../src/parser')
const { compile } = require('../../src/simple-eval')
const { runtime } = require('../../src/simple-runtime')


let data = {
  A: 7, B: 8,
  foo1: { 
    A: 17, B: 18,
    foo2: {
      A: 27, B: 28,      
    }
  },
}

let other = {
  C: 9,
  foo1: {
    B: 12,
    foo2: {
      A: 13, C: 15,
    }
  }
}

/*

Motivation:

Shape polymorphism - we want to recurse over trees (such
as DOM trees or file systems) with arbitrary nesting
and perform some structured operations. Another example
would be adding two tensors of arbitrary (but matching)
shapes.

Initial design:

Variables like data.**A denote 'deep' traversal, and will 
take the value of an array [foo1, foo2].

Alternatives:

An alternative would be to use special syntax for field
selections and group operations such as data..*A. Without 
such special syntax, the regular operations need to be 
overloaded to work with both scalars and arrays as selection
keys. There are some tradeoffs that should be explored 
further.

*/


// test traversal

test("testPath0", () => {
  let query = rh`array (data.**A & **A)` // collect all paths

  let func = compile(query)
  let res = func({data})

  expect(res).toEqual([
    [],
    ["A"], ["B"], ["foo1"],
    ["foo1","A"], ["foo1","B"], ["foo1","foo2"],
    ["foo1","foo2","A"], ["foo1","foo2","B"]
  ])
})

test("testPath1", () => {
  // filter and collect paths (equijoin)
  let query = rh`array (data.**A & other.**A & **A)`

  let func = compile(query)
  let res = func({data,other})

  expect(res).toEqual([
    [],
    ["foo1"],
    ["foo1","B"], ["foo1","foo2"],
    ["foo1","foo2","A"]
  ])
})

test("testPath2", () => {
  // look for specific keys deep in the tree
  let query = rh`array data.**A.B`

  let func = compile(query)
  let res = func({data,other})

  expect(res).toEqual([8,18,28])
})


// test grouping: implicit & explicit

test("testPathGroup1", () => {
  let query = rh`data.**A.B`

  let func = compile(query)
  let res = func({data,other})

  // XXX: implicit grouping is problematic if parts of
  // key path are removed

  let wrong = 8
  expect(res).toEqual(wrong) // FIXME: top-level has path [],
                             // so we set res = 8 and then try to
                             // add 8.foo1 = ... etc.
                             // What's the desired result here?
  // expect(res).toEqual({B: 8, foo1: {B: 18, foo2: {B:28}}})
})

test("testPathGroup2", () => {
  // look for specific keys deep in the tree
  let query = { "join **A": rh`data.**A.B` }

  let func = compile(query)
  let res = func({data,other})

  // Explicit grouping is ok if we convert the key to a string

  expect(res).toEqual({
    "": 8, 
    "foo1": 18,
    "foo1,foo2": 28
  })
})

test("testPathGroup3", () => {
  // let query = { "**A": rh`data.**A.B` }  // same issue as implicit grouping
  let query = { "**A": { "BOO": rh`data.**A.B` } }

  let func = compile(query)
  let res = func({data,other})

  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)
  // console.log(res)

  // XXX similar problem if we introduce a level of nesting:
  // paths [] and [foo1] and [foo1,foo2] all have B key,
  // so we successively overwrite.

  // Possible solution: merge, don't overwrite.
  // Pitfall: want to preserve "update" semantics of
  // overwriting *previous* values.
  // (Value from before the update)

  // XXX todo: proper analysis
  // This is only partially what was going on. The main
  // issue was that we extract tmp0[**A] = data.**A.B,
  // so exactly the same issue as for implicit grouping
  // above. 

  // Current solution: make tmps converts paths to strings
  // before indexing. Alternative: preserve path structure
  // but append an auxiliary field at the end to ensure
  // everything is a struct.

  // Still need to investigate if there are other overwriting
  // issues, but since we're doing preorder traversals this
  // may not occur.

  // TODO: we still want to get rid of the empty A,B fields.
  // Could be done in rt.stateful.ipdate, but there are
  // conflicting demands from react-todo-app.html.
  // (need to see if we can disambiguate)

  // XXX: now fixed with tightened initialization due
  // to AOC 5/2 and 7

  let expected = {
    BOO: 8,
    foo1: {
      BOO: 18,
      foo2: {
        BOO: 28,
      }
    }
  }

  expect(res).toEqual(expected)
})


test("testPathGroup4-1", () => {
  let query = { "**A": { "C": rh`data.**A.A + data.**A.B` } }

  let func = compile(query)
  let res = func({data,other})

  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)
  // console.log(res)

  let expected = {
    C: 15,
    foo1: {
      C: 35,
      foo2: {
        C: 55,
      }
    }
  }

  expect(res).toEqual(expected)
})

test("testPathGroup4-2", () => {
  // perform structural modifications -- add a computed A+B field 
  // for every path that has A and B
  let query = { "**A": rh`update data.**A "C" (data.**A.A + data.**A.B)` }

  // FIXME: the following is not parsed correctly:
  // let query = { "**A": rh` (data.**A.A + data.**A.B) | update data.**A "C"` }

  let func = compile(query)
  let res = func({data,other})

  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)
  // console.log(res)

  // TODO: test with missing A/B key somewhere

  let expected = {
    A: 7, B: 8, C: 15,
    foo1: {
      A: 17, B: 18, C: 35,
      foo2: {
        A: 27, B: 28, C: 55,
      }
    }
  }

  expect(res).toEqual(expected)
})

test("testPathGroup4-3", () => {
  // perform structural modifications -- add computed sum of all numbers
  // for every node in the tree
  let query = { "**A": rh`update data.**A "sum" (sum data.**A.*B)` }

  // FIXME: the following is not parsed correctly:
  // let query = { "**A": rh` (data.**A.A + data.**A.B) | update data.**A "C"` }

  let func = compile(query)
  let res = func({data,other})

  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)
  // console.log(res)

  let expected = {
    A: 7, B: 8, sum: 15,
    foo1: {
      A: 17, B: 18, sum: 35,
      foo2: {
        A: 27, B: 28, sum: 55,
      }
    }
  }

  expect(res).toEqual(expected)
})


test("testPathGroup4-4", () => {
  // perform structural modifications -- add computed sum of all numbers
  // for every node in the tree

  // test cases where no numbers are present:
  let data = {
    hasNumbers: { A: 1, B: 2, C: "foo" },
    hasNoNumbers: { U: "foo", V: "bar" },
    hasNoEntriesAtAll: { }
  }

  let query = { "**A": rh`update data.**A "sum" (sum data.**A.*B)` }

  let func = compile(query)
  let res = func({data})

  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)
  // console.log(res)

  // Either one of the following would be defensible,
  // but we'd want to choose the default carefully:

  let expected1 = {
    hasNumbers: { A: 1, B: 2, C: "foo", sum: 3 },
    hasNoNumbers: { U: "foo", V: "bar" },
    hasNoEntriesAtAll: { }
  }

  let expected2 = {
    hasNumbers: { A: 1, B: 2, C: "foo", sum: 3 },
    hasNoNumbers: { U: "foo", V: "bar", sum: 0 },
    hasNoEntriesAtAll: { sum: 0 },
    sum: 0
  }

  // The actual result looks definitely wrong, though:

  let bug = {
    hasNumbers: { A: 1, B: 2, C: "foo", sum: 3 },
  }

  // NOTE: we get expected2 if we change **A to *A,
  // a reasonable prior would be to stay consistent

  expect(res).toEqual(bug)
})




// test shape-polymorphic arithmetic

// the default + falls back string concat
// for non-numbers, but we want undefined
let udf = {
  plus: (x1,x2) => {
    if (x1 === undefined) return undefined
    if (x2 === undefined) return undefined
    let res = Number(x1) + Number(x2)
    // do not fall back on string concat!
    if (Number.isNaN(res)) return undefined
    return res
  }
}

test("testArith0", () => {
  let A = 7
  let B = 8

  let query = rh`udf.plus A.**I B.**I`

  let func = compile(query)
  let res = func({A,B,udf})

  expect(res).toEqual(15)
})

test("testArith1", () => {
  let A = [1,2,3]
  let B = [10,20,30]

  let query = rh`udf.plus A.**I B.**I`

  let func = compile(query)
  let res = func({A,B,udf})

  expect(res).toEqual({ // [11, 22, 33]
    0: 11,1: 22, 2: 33 
  })
})

test("testArith2", () => {
  let A = [[1,2],[3,4]]
  let B = [[10,20],[30,40]]

  let query = rh`udf.plus A.**I B.**I`

  let func = compile(query)
  let res = func({A,B,udf})

  expect(res).toEqual({
    0: {0: 11, 1: 22},   // [11, 22]
    1: {0: 33, 1: 44}    // [33, 44]
  })
})
