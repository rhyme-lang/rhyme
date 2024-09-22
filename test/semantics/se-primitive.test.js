const { api, pipe } = require('../../src/rhyme')
const { rh, parse } = require('../../src/parser')
const { compile } = require('../../src/primitive-eval')


// ========== FROM se-basic.test.js ========== //


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
  let query = {"data.*.key": rh`data.*.value`}

  let func = compile(query, {singleResult:false})
  let res = func({data, other})

/* plausible groupings:

  [ { U: 40 }, { U: 20 }, { V: 10 } ]

  { U: [40, 20] }, { V: [10] }

  { U: [40, 20], V: [10] }  <-- this would be rhs = array(data.*.value)

  (but here we don't group ...)
*/

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


test("testGroup0-a1", () => {
  let query = rh`group *K (mkset(data.*.key).*K & array(mkset(data.*.key).*K & data.*.value))`
  
  let func = compile(query)
  let res = func({data, other})

  expect(res).toEqual(
   { U: [40, 20], V: [10] }
  )
})

test("testGroup0-a2", () => {
  let query = rh`group *K (*K & array(mkset(data.*.key).*K & data.*.value))`
  
  let func = compile(query)
  let res = func({data, other})

  expect(res).toEqual(
   { U: [40, 20], V: [10] }
  )
})

test("testGroup0-a3", () => {
  let query = rh`group *K (mkset(data.*.key).*K & array(*K & data.*.value))`
  
  let func = compile(query)
  let res = func({data, other})

  // NOTE: this worked in an intermediate model of primitive-eval,
  // where filters would be able to use the entire set of variables
  // in scope.
  // 
  // This was found to conflict with aggregateAsKey, so we reverted
  // to the old behavior (consistent with simple-eval).

  expect(res).toEqual(
   { U: [40, 20, 10], V: [40, 20, 10] }
  )
})

test("testGroup0-a4", () => {
  let query = rh`group *K (mkset(data.*.key).*K & array(data.*.value))`
  
  // Difference to prev: drop *K from inner `array(...)`

  let func = compile(query)
  let res = func({data, other})

  // NOTE: this worked in an intermediate model of primitive-eval,
  // where { data.*.key: ... } had no special status and was directly
  // desugared into group *K without touching nested aggregations
  // via path. 
  // 
  // This was found to conflict with eta5, so we reverted to the
  // old behavior (consistent with simple-eval).

  expect(res).toEqual(
   { U: [40, 20, 10], V: [40, 20, 10] }
  )
})

test("testGroup0-a5", () => {
  // NOTE: added special *KEYVAR var prefix as part of broadening handling of
  // correlated key vars. Now this works ...

  let query = rh`(count (singleton data.*D.key).*KEYVAR) &
  (group *KEYVAR (array data.*D.value))`
  
  // NOTE: here we use 'singleton' (pure) not 'mkset' (aggr),
  // because correlation is determined by dims* and dims(mkset ..) = Ø,
  // so the dependency *KEYVAR -> D wouldn't register for mkset.

  let func = compile(query)
  let res = func({data, other})

  expect(res).toEqual(
   { U: [40, 20], V: [10] }
  )
})

test("testGroup0-a6", () => {
  let query = rh`(count (*D & (mkset data.*D.key)).*KEYVAR) &
  (group *KEYVAR (array data.*D.value))`
  
  // NOTE: here we massage a prefix for *KEYVAR that both includes D
  // among its dims and also uses mkset to perform the selection.

  // Note that the following doesn't work:
  //
  //   (count *D & (mkset data.*D.key).*KEYVAR)
  //
  // This elaborates to (mkset_Ø^D data.*.key) and thus has the
  // right bound/free sets. BUT we're still relying on dims
  // of the selection prefix for *KEYVAR -- free isn't
  // available yet.

  let func = compile(query)
  let res = func({data, other})

  expect(res).toEqual(
   { U: [40, 20], V: [10] }
  )
})


test("testGroup0-a7", () => {
  let query = rh`(count (*D & (mkset data.*D.key).*KEYVAR)) &
  (group *KEYVAR (array data.*D.value))`
  
  // If we make .free available in a fixpoint loop this
  // actually does work:
  //
  //   (count *D & (mkset data.*D.key).*KEYVAR)
  //

  let func = compile(query)
  let res = func({data, other})

  expect(res).toEqual(
   { U: [40, 20], V: [10] }
  )
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



// ----- outer joins

// want: left outer joins (observe failure) ...

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

  // *inner* join behavior works ok
  let query = rh`other.(data.*A.key)` // || -1 (not found)

  let func = compile(query)
  let res = func({data, other})


  expect(res).toEqual({
    0: 7, 2: 7
  })
})



// ========== FROM se-bug.test.js ========== //

// simplified from se-bug/eta2Indirect2
test("eta2Indirect2-simpl", () => { // BUG -- eta via array constr
    let data = { 0: 2, 1: 2, 2: 2 }
    let data1 = ["data.*E"]
    let q0 = rh`count ${data1}.*A | group ${data1}.*A`
    let func = compile(q0)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = {
      2: 3
    }
    let bug = {
      2: 1
    }
    expect(res).toEqual(expected)
})




