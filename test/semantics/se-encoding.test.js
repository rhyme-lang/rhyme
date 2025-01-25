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
// ----- grouping: encoded versions

test("group_encoded1", () => {
  // let query = {"data.*.key": rh`sum(data.*.value)`}
  let query = rh`*K & sum(mkset(data.*.key).*K & data.*.value)`

  let func = compile(query)
  let res = func({data})

  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)

  expect(res).toEqual({
    U: 60, V: 10
  })
})

test("group_encoded1b", () => {
  // let query = {"data.*.key": rh`sum(data.*.value)`}
  let query = rh`mkset(data.*.key).* & sum(mkset(data.*.key).* & data.*.value)`

  let func = compile(query)
  let res = func({data})

  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)

  expect(res).toEqual({
    U: 60, V: 10
  })
})


test("group_encoded2", () => {
  // let query = {"data.*.key": rh`sum(data.*.value) / sum(data.*A.value)`}
  let query = rh`*K & sum(mkset(data.*.key).*K & data.*.value) / sum(data.*.value)`

  // interestingly, we can use the same * as only the first sum is filtered by K

  let func = compile(query)
  let res = func({data})

  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)

  expect(res).toEqual({
    U: 60/70,
    V: 10/70,
  })
})


// ----- aggregateAsKey

test("aggregateAsKey_encoded1", () => {

  let data = [
      {"A": 1, "B": 10},
      {"A": 2, "B": 20},
      {"A": 1, "B": 30},
  ]

  // let q1 = { "data.*.A": { "sum(data.*.B)": true } }

  let query = //{"*K1": {"*K2": 
    rh`*K1 & *K2 & mkset(sum(mkset(data.*.A).*K1 & data.*.B)).*K2 & true`
  // }}

  // this one is not correct:
  // rh`mkset(data.*.A).*K1 & mkset(sum(data.*.B)).*K2 & true`

  let func = compile(query)
  let res1 = func({data})

  let e1 = {
      1: { 40: true },
      2: { 20: true }
  }

  expect(res1).toEqual(e1)
})

test("aggregateAsKey_encoded2", () => {

  let data = [
      {"A": 1, "B": 10},
      {"A": 2, "B": 20},
      {"A": 1, "B": 30},
  ]

  // let q1 = { "sum(data.*.B)": { "data.*.A": true } }

  let query = //{"*K1": {"*K2": 
    rh`*K1 & *K2 & mkset(sum(data.*.B)).*K1 & (mkset(data.*.A).*K2 & true)`
  //}}

  let func = compile(query)
  let res2 = func({data})

  let e2_alt_string = {
      60: { 1: true, 2: true } // XXX is this the right one?
  }

  expect(res2).toEqual(e2_alt_string)
})

test("aggregateAsKey_encoded2b", () => {

  let data = [
      {"A": 1, "B": 10},
      {"A": 2, "B": 20},
      {"A": 1, "B": 30},
  ]

  // let q1 = { "sum(data.*.B)": { "data.*.A": true } }

  let query = //{"*K1": {"*K2": 
    rh`*K1 & *K2 & mkset(mkset(sum(data.*.B)).*K1 & data.*.A).*K2 & true`
  // }}

  // alternative

  let func = compile(query)
  let res2 = func({data})

  let e2_alt_string = { // not sure?
    10: { 1: true },
    20: { 2: true },
    30: { 1: true },
  }

  expect(res2).toEqual(e2_alt_string)
})


// ----- generatorAsFilter

test("generatorAsFilter_encoded1", () => {

  let data = [
      { key: "A", value: 10 },
      { key: "B", value: 20 },
      { key: "A", value: 30 }
  ]

  let query = //{ "*K1":
    rh`*K1 & sum(mkset(data.*.key).*K1 & mkset(A).*K1 & data.*.value)`
  //}

  // filtering *K1: drop B entry

  let func = compile(query)
  let res = func({data})

  let expected = { "A": 40 }

  expect(res).toEqual(expected)
})

test("generatorAsFilter_encoded1b", () => {

  let data = [
      { key: "A", value: 10 },
      { key: "B", value: 20 },
      { key: "A", value: 30 }
  ]

  let query = //{ "*K1":
    rh`*K1 & sum(mkset(mkset(A).(data.*.key) & data.*.key).*K1 & data.*.value)`
  // }

  // filtering base set of *K1: drop B entry

  let func = compile(query)
  let res = func({data})

  let expected = { "A": 40 }

  expect(res).toEqual(expected)
})


test("generatorAsFilter_encoded2", () => {

  let data = [
      { key: "A", value: 10 },
      { key: "B", value: 20 },
      { key: "A", value: 30 }
  ]

  let query = //{ "*K1":
    rh`*K1 & sum(mkset(data.*.key).*K1 & mkset(A).(data.*.key) & data.*.value)`
  // }

  // filtering data.*.key: with B = 0 entry

  let func = compile(query)
  let res = func({data})

  let expected = { "A": 40, "B": 0 }

  expect(res).toEqual(expected)
})


// ----- eta expansion

test("eta3_encoded", () => { // BUG -- eta in key of group expr
    let data = [
        {product: "iPhone", model: "7", quantity: 10},
        {product: "Galaxy", model: "S6", quantity: 20},
    ]
    let data0 = "data"
    let data1 = {"*E": "data.*E"} // need proper grouping here!
    let q0 = rh`*K & sum(mkset(${data1}.*A.product).*K & ${data1}.*A.quantity)`
    let func = compile(q0)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = {
      "iPhone": 10,
      "Galaxy": 20
    }
    expect(res).toEqual(expected)
    // NOTE: requires recursion fix
})


// ----- new group encodings (incl *KEYVAR facility)

test("testGroup0-a0", () => {
  let query = {"data.*.key": rh`array(data.*.value)`}

  let func = compile(query)
  let res = func({data})

  expect(res).toEqual(
   { U: [40, 20], V: [10] }
  )
})

test("testGroup0-a1", () => {
  let query = rh`group *K (mkset(data.*.key).*K & array(mkset(data.*.key).*K & data.*.value))`
  
  let func = compile(query)
  let res = func({data})

  expect(res).toEqual(
   { U: [40, 20], V: [10] }
  )
})

test("testGroup0-a2", () => {
  let query = rh`group *K (*K & array(mkset(data.*.key).*K & data.*.value))`
  
  let func = compile(query)
  let res = func({data})

  expect(res).toEqual(
   { U: [40, 20], V: [10] }
  )
})

test("testGroup0-a3", () => {
  let query = rh`group *K (mkset(data.*.key).*K & array(*K & data.*.value))`
  
  let func = compile(query)
  let res = func({data})

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
  let res = func({data})

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
  let res = func({data})

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
  let res = func({data})

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
  let res = func({data})

  expect(res).toEqual(
   { U: [40, 20], V: [10] }
  )
})

test("testGroup0-a8", () => {
  let query = rh`(count (singleton data.*D.key).*KEYVAR) &
  (group *KEYVAR (array data.*D.value))`
  
  // Another variation: use `singleton` (a pure op)
  // instead of `mkset`:
  //
  //   ... (singleton data.*D.key).*KEYVAR ...
  //
  // (XX same as a5)

  let func = compile(query)
  let res = func({data})

  expect(res).toEqual(
   { U: [40, 20], V: [10] }
  )
})


