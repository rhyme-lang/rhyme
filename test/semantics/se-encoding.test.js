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
  let query = {"*K": rh`sum(mkset(data.*.key).*K & data.*.value)`}

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
  let query = {"*K": rh`sum(mkset(data.*.key).*K & data.*.value) / sum(data.*.value)`}

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

  let query = {"*K1": {"*K2": 
    rh`mkset(sum(mkset(data.*.A).*K1 & data.*.B)).*K2 & true`
  }}

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

  let query = {"*K1": {"*K2": 
    rh`mkset(sum(data.*.B)).*K1 & mkset(data.*.A).*K2 & true`
  }}

  let func = compile(query)
  let res2 = func({data})

  let e2_alt_string = {
      60: { 1: "true", 2: "true" } // XXX is this the right one?
  }

  expect(res2).toEqual(e2_alt_string)
})

