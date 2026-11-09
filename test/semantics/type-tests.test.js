const { api, rh } = require('../../src/rhyme')

// asObj and asNum: the argument if it is an object (a map, arrays included)
// or a number, and nothing otherwise (asfun and asnum in the PLDI'27
// semantics)

let values = [5, {}, { 0: 1 }, [1, 2], "s", true, null]

test("asObj", () => {
  let f = api.compile(rh`asObj(.a)`)
  expect(values.map(a => f({ a }))).toEqual([undefined, {}, { 0: 1 }, [1, 2], undefined, undefined, undefined])
  expect(f({})).toEqual(undefined)
})

test("asNum", () => {
  let f = api.compile(rh`asNum(.a)`)
  expect(values.map(a => f({ a }))).toEqual([5, undefined, undefined, undefined, undefined, undefined, undefined])
  expect(f({})).toEqual(undefined)
})

test("asObj-asNum-filter", () => {
  let data = { a: 1, b: { c: 2 }, d: 3, e: "x" }
  expect(api.compile(rh`sum asNum(data.*k)`)({ data })).toEqual(4)
  expect(api.compile(rh`count asObj(data.*k)`)({ data })).toEqual(1)
})

// leaf(t) = asnum(t) || (asfun(t) & {}): the shape of a collection
test("leaf", () => {
  let f = api.compile(rh`asNum(.a) || (asObj(.a) & {})`)
  expect(f({ a: 5 })).toEqual(5)
  expect(f({ a: {} })).toEqual({})
  expect(f({ a: { 0: 1 } })).toEqual({})
  expect(f({ a: "s" })).toEqual(undefined)
})
