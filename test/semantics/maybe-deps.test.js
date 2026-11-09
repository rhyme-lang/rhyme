const { api, rh } = require('../../src/rhyme')

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
