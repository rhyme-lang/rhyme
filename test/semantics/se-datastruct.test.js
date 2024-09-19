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

