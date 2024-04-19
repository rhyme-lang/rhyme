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
