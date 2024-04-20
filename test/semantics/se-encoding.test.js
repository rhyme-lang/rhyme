const { api, pipe } = require('../../src/rhyme')
const { rh, parse } = require('../../src/parser')
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
      1: { 40: "true" },
      2: { 20: "true" }
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
      60: { 1: "true", 2: "true" } // XXX is this the right one?
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
    10: { 1: "true" },
    20: { 2: "true" },
    30: { 1: "true" },
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

