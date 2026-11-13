const { api, rh } = require('../../src/rhyme')
const { compileC2CrossCheck } = require('../utils')

// A maybe lookup b.*j.*i? of a variable *i that also has a strict
// generator (a.*i) is a filter: it does not produce the keys of *i, so it
// must not nest the loop over *i inside the loop over *j. If every lookup
// on *i is a maybe lookup, they generate *i (a full outer join) and the
// nesting is needed.

let alpha = { 0: { 1: 3 }, 1: { 2: 4 } }

// strict generator a.*i, maybe filter b.*j.*i? over another collection
test("maybe-filter-other-collection", () => {
  let f = api.compile(rh`group? *i (a.*i & (sum b.*j.*i?))`)
  let a = { 0: 1, 1: 2 }
  // no rows in b: the sums are empty and get their default
  expect(f({ a, b: {} })).toEqual({ 0: 0, 1: 0 })
  expect(f({ a, b: { 0: {} } })).toEqual({ 0: 0, 1: 0 })
  expect(f({ a, b: { 0: { 0: 5 } } })).toEqual({ 0: 5, 1: 0 })
  expect(f({ a, b: { 0: { 0: 5 }, 1: { 0: 1, 2: 7 } } })).toEqual({ 0: 6, 1: 0 })
})

// the same filter, with the generator and the filter on the same collection
test("maybe-filter-same-collection", () => {
  let f = api.compile(rh`group? *i (a.*i & (sum a.*j.*i?))`)
  expect(f({ a: { 0: { 1: 3 }, 1: { 0: 4 }, 5: {} } })).toEqual({ 0: 4, 1: 3, 5: 0 })
})

// the core term: no default on the inner sum, written as an explicit guard
test("maybe-filter-core-term", () => {
  let f = api.compile(rh`group? *i (a.*i & ((sum? b.*j.*i?) || (asObj(.b) & 0)))`)
  expect(f({ a: { 0: 1, 1: 2 }, b: {} })).toEqual({ 0: 0, 1: 0 })
  expect(f({ a: { 0: 1, 1: 2 }, b: 5 })).toEqual(undefined)
})

// a maybe filter whose prefix mentions the variable itself
test("maybe-filter-diagonal", () => {
  let f = api.compile(rh`group *i a.*i.*i?`)
  expect(f({ a: {} })).toEqual({})
  expect(f({ a: { 0: { 1: 7 } } })).toEqual({})
  expect(f({ a: { 0: { 0: 7 }, 1: { 0: 8 } } })).toEqual({ 0: 7 })
})

// only maybe lookups on *i: they generate *i, nested in the loop over *j
test("maybe-generator-nested", () => {
  expect(api.compile(rh`{ *i: sum a.*j.*i? }`)({ a: alpha })).toEqual({ 1: 3, 2: 4 })
  expect(api.compile(rh`group? *i (sum? a.*j.*i?)`)({ a: alpha })).toEqual({ 1: 3, 2: 4 })
})

// only maybe lookups on *i, at the top level: a full outer join
test("maybe-generator-outer-join", () => {
  let f = api.compile(rh`{ *i: (a.*i? + b.*i?) || a.*i? || b.*i? }`)
  expect(f({ a: { 0: 1, 1: 2, 3: 4 }, b: { 1: 10, 2: 20, 3: 30 } })).toEqual({ 0: 1, 1: 12, 2: 20, 3: 34 })
})

// only maybe lookups on *i, and *i is projected out (in ext, not iter): the
// outer join is still a disjunct, or the loop over *j can't be emitted
test("maybe-generator-projected", () => {
  let f = compileC2CrossCheck(rh`{ *j: sum data.*i?.*j }`)
  expect(f({ data: { 0: [1], 1: [2] } })).toEqual({ 0: 3 })
  expect(f({ data: { 0: [1], 1: [undefined, 2] } })).toEqual({ 0: 1, 1: 2 })
  expect(f({ data: {} })).toEqual({})
})


// several variables with only maybe lookups in one loop: each one needs its
// generator in the same loop nest (a loop per maybe filter left the others
// without one)
test("testFullOuterJoinTwoVars", () => {
  let f = compileC2CrossCheck(rh`sum data.*i1?.*j + data.*i2?.*j`)
  // (i1,i2) ranges over {0,1}^2, j = 0: (1+1) + (1+2) + (2+1) + (2+2)
  expect(f({ data: { 0: [1], 1: [2] } })).toEqual(12)
  let g = compileC2CrossCheck(rh`sum(data.*A? + other.*B?)`)
  expect(g({ data: { a: 1 }, other: { b: 2 } })).toEqual(3)
})

// a variable with several maybe lookups ranges over the union of their keys
test("testFullOuterJoinUnion", () => {
  let f = compileC2CrossCheck(rh`{ data.*A?.k : 1, other.*A?.k : 2 }`)
  expect(f({ data: { a: { k: "x" } }, other: { b: { k: "y" } } })).toEqual({ x: 1, y: 2 })
  let g = compileC2CrossCheck(rh`{ *A: data.*A? + other.*A? }`)
  expect(g({ data: { a: 1, b: 2 }, other: { a: 10, c: 30 } })).toEqual({ a: 11 })
})

// the union domain of *B depends on *A: it is taken per value of *A
test("testFullOuterJoinUnionDependent", () => {
  let f = compileC2CrossCheck(rh`{ *A: sum(data.*A.*B? + other.*A.*B?) }`)
  let data = { a: { x: 1 }, b: { y: 2 } }
  let other = { a: { z: 10 }, b: { y: 20 } }
  expect(f({ data, other })).toEqual({ a: 0, b: 22 })
})

// a maybe lookup that needs its own variable (data.*A?.*A?) can only check
// a value of *A, never produce one: *A ranges over data.*A? alone
test("testFullOuterJoinSelfDependent", () => {
  let f = compileC2CrossCheck(rh`sum(data.*A?.*A?)`)
  expect(f({ data: { a: { a: 1, b: 2 }, b: { b: 5 } } })).toEqual(6)
})

// deep vars: a single maybe generator is looped over directly, several
// over the union of their paths
test("testFullOuterJoinDeep", () => {
  let f = compileC2CrossCheck(rh`sum(data.**A?)`)
  expect(f({ data: { a: 1, b: { c: 2 } } })).toEqual(3)
  let g = compileC2CrossCheck(rh`sum(data.**A? + other.**A?)`)
  expect(g({ data: { a: 1, b: { c: 2 } }, other: { a: 10, b: { c: 20 } } })).toEqual(33)
})
