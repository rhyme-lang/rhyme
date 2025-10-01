const { api, rh } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')



// some sample data for testing
// let data = [
//     { key: "A", value: 10 },
//     { key: "B", value: 20 },
//     { key: "A", value: 30 }
// ]

// let other = [
//     { key: "A", value: 100 },
//     { key: "C", value: 400 },
// ]


let data = {
    A: { key: "U", value: 40 },
    B: { key: "U", value: 20 },
    C: { key: "V", value: 10 },
}

let other = {
    A: { value: 100 },
    B: { value: 400 },
    D: { value: 200 },
}

let nested = {
    U: {
      A: { value: 10 },
      B: { value: 20 }
    },
    V: {
      B: { value: 30 },
      C: { value: 40 },
    },
    W: {
      D: { value: 50 },
      E: { value: 60 },
    }
}

let nestedB = {
  X: { C: { value: 500 }},
  Y: { C: { value: 600 }}
}


test("test_NCG_Trivial0", () => {
  let query = rh`1 + 4`

  let func = compile(query, { newCodegen: true })
  // console.log(func.explain.codeString)
  let res = func({data, other})

  expect(res).toEqual(5)
})

test("test_NCG_Trivial1", () => {
  let query = rh`data.A.value`

  let func = compile(query, { newCodegen: true })
  // console.log(func.explain.codeString)
  let res = func({data, other})

  expect(res).toEqual(40)
})

test("test_NCG_Scalar0", () => {
  let query = rh`data.*.value`

  let func = compile(query, {newCodegen: true})
  let res = func({data, other})

  // console.log(res)

  expect(res).toEqual({A:40,B:20,C:10})
})

test("test_NCG_Scalar1", () => {
  let query = rh`sum data.*.value`

  let func = compile(query, { newCodegen: true })
  // console.log(func.explain.codeString)
  let res = func({data, other})

  expect(res).toEqual(70)
})

// ---------- end newCodegen tests -------- //


test("testScalar0", () => {
  let query = rh`data.*.value`

  let func = compile(query)
  let res = func({data, other})

  // console.log(res)

  expect(res).toEqual({A:40,B:20,C:10})
  // expect(res).toEqual([40,20,10])
})

test("testScalar1", () => {
  let query = rh`sum data.*.value`

  let func = compile(query)
  let res = func({data, other})

  // console.log(res)

  expect(res).toEqual(70)
  // expect(res).toEqual([70])
})

// ----- multiple uses of the same var

test("testZipScalar2", () => {
  let query = rh`data.*A.value + other.*A.value`

  let func = compile(query)
  let res = func({data, other})

  // console.log(res)

  expect(res).toEqual({A:140, B:420})
  // expect(res).toEqual([140,420])
})

test("testZipScalar3", () => {
  let query = rh`(sum data.*A.value) + (sum other.*A.value)`

  let func = compile(query)
  let res = func({data, other})

  // console.log(res)

  expect(res).toEqual(560)
  // expect(res).toEqual([560])
})

test("testZipScalar4", () => {
  let query = rh`(sum data.*A.value) + other.*A.value` 
  // NONSENSICAL? SHAPE ERROR? -- no, can just take sum of single element...

  let func = compile(query)
  let res = func({data, other})

  // console.log(res)

  expect(res).toEqual({A:140, B:420})
  // expect(res).toEqual([140,420])
})

// ----- multiple vars

test("testJoinScalar2", () => {
  let query = rh`data.*A.value + other.*B.value`
  let func = compile(query)
  let res = func({data, other})

  // console.log(res)

  expect(res).toEqual({
    A: { A: 140, B: 440, D: 240 },
    B: { A: 120, B: 420, D: 220 },
    C: { A: 110, B: 410, D: 210 }
  })
  // expect(res).toEqual([
  //   140, 440, 240,
  //   120, 420, 220,
  //   110, 410, 210
  // ])
})

test("testJoinScalar3", () => {
  let query = rh`(sum data.*A.value) + (sum other.*B.value)`

  let func = compile(query)
  let res = func({data, other})

  // console.log(res)

  expect(res).toEqual(770)
  // expect(res).toEqual([770])
})

test("testJoinScalar4", () => {
  let query = rh`(sum data.*A.value) + other.*B.value` 

  let func = compile(query)
  let res = func({data, other})

  // console.log(res)

  expect(res).toEqual({A:170, B:470, D:270})
  // expect(res).toEqual([170, 470, 270])
})

// ----- dependent vars

test("testNested0", () => {
  let query = rh`nested.*A.*B.value` 
// debug = true
  let func = compile(query)
  let res = func({nested, other})

  // console.log(res)

  expect(res).toEqual({ 
    U: { A: 10, B: 20 }, 
    V: { B: 30, C: 40 }, 
    W: { D: 50, E: 60 } 
  })
  // expect(res).toEqual([ 
  //   10, 20, 
  //   30, 40, 
  //   50, 60
  // ])
})

test("testNested1", () => {
  let query = rh`sum nested.*A.*B.value` 
// debug = true
  let func = compile(query)
  let res = func({nested, other})

  // console.log(res)

  expect(res).toEqual(210)
  // expect(res).toEqual([210])
})

test("testZipNested2", () => {
  let query = rh`nested.*A.*B.value + other.*B.value` 
// debug = true
  let func = compile(query)
  let res = func({nested, other})

  // console.log(res)

  expect(res).toEqual({ // restrict inner to A,B,D
    U: { A: 110, B: 420 },
    V: { B: 430 },
    W: { D: 250 }
  })
  // expect(res).toEqual([ // restrict inner to A,B,D
  //   110, 420,
  //   430,
  //   250
  // ])
})


// XXX 24/08/28 
// NOTE:   (group *A (group *B (group *C ...))) behaves different from group (group *ANY ...)
// REASON: add an entry for each *A key before knowing which are filtered due to *B

test("testZipNested3", () => {
  let query = rh`nested.*A.*B.value + nestedB.*C.*B.value` // neither *B dominates!
// debug = true
  let func = compile(query)
  let res = func({nested, nestedB})

  // console.log(res)

  expect(res).toEqual({ // result has three levels
    V: { C: { X: 540, Y: 640 } }
  })
  // expect(res).toEqual([ // result has three levels
  //   540, 640
  // ])
})

test("testZipNestedRec3", () => {

  let data = {
    A: { E: { A: { value: 10 }, B: { value: 20 }},
         F: { A: { value: 30 }, B: { value: 40 }}},
    B: { G: { A: { value: 50 }, B: { value: 60 }},
         H: { A: { value: 70 }, B: { value: 80 }}}
  }

  // match A (E/F) A, B (G/H) B

  let query = rh`data.*U.*V.*U.value` // recursive dependency!
// debug = true
  let func = compile(query)
  let res = func({data})

  // console.log(res)
  let expected = {
    "A": {"E": 10, "F": 30}, 
    "B": {"G": 60, "H": 80}
  }
  // expect(res).toEqual([10, 30, 60, 80]) // AEA, AFA, BGB, BHB
  expect(res).toEqual(expected) // AEA, AFA, BGB, BHB
})



// ----- grouping


test("testGroup0", () => {
  let query = rh`{data.*A.key: data.*A.value} | group *A`

  let func = compile(query, {newCodegen: true, enableOptimizations: false})
  let res = func({data, other})

/* plausible groupings:

  [ { U: 40 }, { U: 20 }, { V: 10 } ]

  { U: [40, 20] }, { V: [10] }

  { U: [40, 20], V: [10] }  <-- this would be rhs = array(data.*.value)

  (but here we don't group ...)
*/

console.log(func.explain.code)

  expect(res).toEqual(
    {"A": {"U": 40}, "B": {"U": 20}, "C": {"V": 10}}
  )
})

test("testGroup0-a", () => {
  let query = {"data.*.key": rh`array(data.*.value)`}

  let func = compile(query)
  let res = func({data, other})

  expect(res).toEqual(
   { U: [40, 20], V: [10] }
  )
})

test("testGroup0-b", () => {
  let query = [{"data.*.key": rh`data.*.value`}]

  let func = compile(query)
  let res = func({data, other})

  expect(res).toEqual([
    { U: 40 }, { U: 20 }, { V: 10 }
  ])
})

test("testGroup1", () => {
  let query = {"data.*.key": rh`sum(data.*.value)`}

  let func = compile(query)
  let res = func({data, other})

/* plausible:

  [ { U: 60, V: 10 } ]

  [ { U: 60 }, { V: 10 } ]  <-- no, want struct to merge

  [ { U: 40 }, { U: 20 }, { V: 10 } ]  <-- no, want sum to iterate
*/

  expect(res).toEqual({
    U: 60, V: 10
  })
})


test("testGroup2", () => {
  let query = {"data.*.key": rh`sum(data.*B.value)`}

  let func = compile(query)
  let res = func({data, other})

/* uncorrelated -- test decorrelation */

  expect(res).toEqual({
    U: 70, V: 70
  })
})


// ----- prefix sums

test("testPrefixSum1", () => {
  let query = "prefix_sum(data.*.value)"

  let func = compile(query)
  let res = func({data, other})

  expect(res).toEqual([40,60,70])
})

test("testGroupPrefixSum1", () => {
  let query = {"data.*.key": rh`prefix_sum(data.*.value)`}

  let func = compile(query)
  let res = func({data, other})

  expect(res).toEqual({
    U: [40, 60], V: [10]
  })
})


// ----- "maybe" aggregations

test("testMaybeSum", () => {
  let data = {}

  let query = { A: "sum? data.*.value", B: "sum data.*.value" }

  let func = compile(query)
  let res = func({data, other})

  expect(res).toEqual({ B: 0 })
})




// ----- outer joins

test("testOuterJoin_pre1", () => {
  let data = [ 
    {key: 'A', val: 10}, 
    {key: 'B', val: 20}, 
    {key: 'A', val: 30} 
  ]

  let other = { 1: 7 }

  // *inner* join behavior works ok
  let query = rh`mkset(*A).*B & other.*B & data.*A.val`

  let func = compile(query)
  let res = func({data, other})


  expect(res).toEqual({
    1: { 1: 20 }
  })
})


test("testOuterJoin_pre2", () => {
  let data = [ 
    {key: 'A', val: 10}, 
    {key: 'B', val: 20}, 
    {key: 'A', val: 30} 
  ]

  let other = { 'A': 7 }

  // default (inner join) behavior: 
  let query = rh`other.(data.*A.key)` // undefined if not found

  let func = compile(query)
  let res = func({data, other})


  expect(res).toEqual({
    0: 7, 2: 7
  })
})

test("testOuterJoin_pre3", () => {
  let data = [ 
    {key: 'A', val: 10}, 
    {key: 'B', val: 20}, 
    {key: 'A', val: 30} 
  ]

  let other = { 'A': 7 }

  // outer join behavior: observe missing value
  let query = rh`other.(data.*A.key) || "not found"` 

  let func = compile(query)
  let res = func({data, other})


  expect(res).toEqual({
    0: 7, 
    1: "not found", 
    2: 7,
  })
})

test("testLeftOuterJoin", () => {
  let data = [ 1, 2, 5, 5 ]
  let other = [ 4, 3 ]

  let query = rh`[data.*A + (other.*A? || 0)]`

  let func = compile(query)
  let res = func({data, other})


  expect(res).toEqual([
    5, 5, 5, 5
  ])
})

test("testFullOuterJoin1", () => {
  let data = [ , , 3, 4 ]
  let other = [ 1, 2 ]

  let query = rh`[(data.*A? || 0) + (other.*A? || 0)]`

  let func = compile(query)
  let res = func({data, other})


  expect(res).toEqual([
    1, 2, 3, 4
  ])
})

test("testFullOuterJoin2", () => {
  let data = [ , , 3, 4 ]
  let other = [ 1, 2 ]

  let query = rh`[data.*A? + other.*A? || data.*A? || other.*A?]`

  let func = compile(query)
  let res = func({data, other})


  expect(res).toEqual([
    1, 2, 3, 4
  ])
})


test("testFullOuterJoin_other1", () => {
  let data = [ , , 3, 4 ]

  // NOTE: if there is only a single "maybe" 
  // generator, missing values cannot be observed
  let query = rh`data.*A? || 0`

  let func = compile(query)
  let res = func({data, other})


  expect(res).toEqual({
    2: 3, 3: 4
  })
})


test("testFullOuterJoin_other2", () => {
  let data = [ , , 3, 4 ]
  let other = [ 1, 2 ]

  // NOTE: if there is only a single "maybe" 
  // generator, missing values cannot be observed
  let query = rh`{ A: sum(data.*A?), B: sum(other.*A?), C: [*A] }`

  let func = compile(query)
  let res = func({data, other})


  expect(res).toEqual({
    A: 7, B: 3, C: ["0", "1", "2", "3"]
  })
})

test("testEqualTrue", () => {
  let query = rh`1 == 1`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(true)
})

test("testEqualUndefined", () => {
  let query = rh`1 == 2`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(undefined)
})

test("testNotEqualTrue", () => {
  let query = rh`1 != 2`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(true)
})

test("testNotEqualUndefined", () => {
  let query = rh`1 != 1`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(undefined)
})

test("testLessThanTrue", () => {
  let query = rh`1 < 2`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(true)
})

test("testLessThanUndefined", () => {
  let query = rh`1 < 0`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(undefined)
})

test("testLessThanOrEqualTrue", () => {
  let query = rh`1 <= 2`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(true)
})

test("testLessThanOrEqualUndefined", () => {
  let query = rh`1 <= 0`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(undefined)
})

test("testGreaterThanTrue", () => {
  let query = rh`2 > 1`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(true)
})

test("testGreaterThanUndefined", () => {
  let query = rh`0 > 1`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(undefined)
})

test("testGreaterThanOrEqualTrue", () => {
  let query = rh`2 >= 1`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(true)
})

test("testGreaterThanOrEqualUndefined", () => {
  let query = rh`0 >= 1`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(undefined)
})

test("testAndTrue", () => {
  let query = rh`1 == 1 & 2 == 2`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(true)
})

test("testAndUndefined", () => {
  let query = rh`1 == 1 & 2 == 3`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(undefined)
})

test("testAndAlsoTrue", () => {
  let query = rh`1 == 1 && 2 == 2`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(true)
})

test("testAndAlsoUndefined", () => {
  let query = rh`1 == 1 && 2 == 3`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(undefined)
})

test("testOrElseTrue", () => {
  let query = rh`1 == 2 || 2 == 2`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(true)
})

test("testOrElseUndefined", () => {
  let query = rh`1 == 2 || 2 == 3`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(undefined)
})

test("testIfElseThenBranch", () => {
  let query = rh`ifElse (1 == 1) 3 5`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(3)
})

test("testIfElseElseBranch", () => {
  let query = rh`ifElse (1 != 1) 3 5`

  let func = compile(query)
  let res = func()
  expect(res).toEqual(5)
})
