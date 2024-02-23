const { api, pipe } = require('../../src/rhyme')
const { rh, parse } = require('../../src/parser')
const { compile } = require('../../src/simple-eval')



let data = [
    { key: "A", value: 10 },
    { key: "B", value: 20 },
    { key: "A", value: 30 }
]


test("scalarTest0", () => {
    let query = {
      total: api.sum(api.sum("data.*.value")),
      all: [["data.*.value"]]
    }
    let func = compile(query)

    console.log(func.explain.pseudo)
    console.log(func.explain.code)

    let res = func({ data }, true)
    let expected = { total: 60, all: [[10,20,30]] }
    expect(res).toEqual(expected)
})


test("groupTest0", () => {
    let query = {
        "total": api.sum("data.*.value"),
        "data.*.key": api.sum("data.*.value")
    }
    let func = compile(query)
    let res = func({ data }, true)
    let expected = { "total": 60, "A": 40, "B": 20 }
    expect(res).toEqual(expected)
})

test("groupTest1", () => {
    let query = {
        "total": api.sum("data.*.value"),
        "data.*.key": api.plus(api.sum("data.*.value"), 0)
    }
    let func = compile(query)
    let res = func({ data }, true)
    let expected = { "total": 60, "A": 40, "B": 20 }
    expect(res).toEqual(expected)
})

test("groupTest2", () => { // BUG!!!
    let query = {
        "total": api.sum(api.sum("data.*.value")),
        "data.*.key": api.sum(api.sum("data.*.value"))  // XXXX !!!!
    }
    let func = compile(query)

    console.log(func.explain.pseudo)
    console.log(func.explain.code)

    let res = func({ data }, true)
    let expected = { "total": 60, "A": 40, "B": 20 }
    let bug = { "total": 60, "A": 80, "B": 20 }
    expect(res).toEqual(bug)
})

test("groupTest3", () => { // BUG!!!
    let query = {
        "total": api.sum(api.sum("data.*.value")),
        "data.*.key": [([("data.*.value")])]  // XXXX !!!!
    }
    let func = compile(query)

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let res = func({ data }, true)
    let expected = { "total": 60, "A": [[10,30]], "B": [[20]] }
    let bug = { "total": 60, "A": [[10,30],[10,30]], "B": [[20]] }
    expect(res).toEqual(bug)
})
