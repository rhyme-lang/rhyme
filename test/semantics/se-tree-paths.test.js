const { api, pipe } = require('../../src/rhyme')
const { rh, parse } = require('../../src/parser')
const { compile } = require('../../src/simple-eval')


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


test("testPath0", () => {
  let query = rh`array (data.**A & **A)` // collect all paths

  let func = compile(query)
  let res = func({data})

  expect(res).toEqual([
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
    ["foo1"],
    ["foo1","B"], ["foo1","foo2"],
    ["foo1","foo2","A"]
  ])
})

