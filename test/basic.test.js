const { api } = require('../src/rhyme')
const { rh } = require('../src/parser')

// some sample data for testing
let data = [
    { key: "A", value: 10 },
    { key: "B", value: 20 },
    { key: "A", value: 30 }
]

let countryData = [
    { region: "Asia", country: "Japan", city: "Tokyo", population: 30 },
    { region: "Asia", country: "China", city: "Beijing", population: 20 },
    { region: "Europe", country: "France", city: "Paris", population: 10 },
    { region: "Europe", country: "UK", city: "London", population: 10 },
]

let regionData = [
    { region: "Asia", country: "Japan" },
    { region: "Asia", country: "China" },
    { region: "Europe", country: "France" },
    { region: "Europe", country: "UK" },
]

test("plainSumTest", () => {
    let query = api.sum("data.*.value")
    let res = api.compile(query)({ data })
    let expected = 60
    expect(res).toBe(expected)
})

test("plainSumTest_parse", () => {
    let query = rh`${api.sum("data.*.value")}`
    let res = api.compile(query)({ data })
    let expected = 60
    expect(res).toBe(expected)
})

test("plainAverageTest", () => {
    let query = api.div(api.sum("data.*.value"), api.count("data.*.value"))
    console.dir(query)
    let res = api.compile(query)({ data })
    let expected = 20
    expect(res).toBe(expected)
})

test("plainAverageTest_parse", () => {
    let query = rh`${api.sum("data.*.value")} / ${api.count("data.*.value")}`
    console.dir(query)
    let res = api.compile(query)({ data })
    let expected = 20
    expect(res).toBe(expected)
})

test("uncorrelatedAverageTest", () => {
    let query = api.div(api.sum("data.*A.value"), api.count("data.*B.value"))
    let res = api.compile(query)({ data })
    let expected = 20
    expect(res).toBe(expected)
})

test("uncorrelatedAverageTest_parse", () => {
    let query = rh`${api.sum("data.*A.value")} / ${api.count("data.*B.value")}`
    let res = api.compile(query)({ data })
    let expected = 20
    expect(res).toBe(expected)
})

test("groupByTest", () => {
    let query = {
        total: api.sum("data.*.value"),
        "data.*.key": api.sum("data.*.value"),
    }
    let res = api.compile(query)({ data })
    let expected = { "total": 60, "A": 40, "B": 20 }
    expect(res).toEqual(expected)
})

test("groupByAverageTest", () => {
    let avg = p => api.div(api.sum(p), api.count(p))
    let query = {
        total: api.sum("data.*.value"),
        "data.*.key": avg("data.*.value"),
    }
    let res = api.compile(query)({ data })
    let expected = { "total": 60, "A": 20, "B": 20 }
    expect(res).toEqual(expected)
})

test("groupByAverageTest_parse", () => {
    let avg = p => rh`${api.sum(p)} / ${api.count(p)}`
    let query = {
        total: api.sum("data.*.value"),
        "data.*.key": avg("data.*.value"),
    }
    let res = api.compile(query)({ data })
    let expected = { "total": 60, "A": 20, "B": 20 }
    expect(res).toEqual(expected)
})

test("groupByRelativeSum", () => {
    let query = {
        total: api.sum("data.*.value"),
        "data.*.key": api.fdiv(api.sum("data.*.value"), api.sum("data.*B.value"))
    }
    let res = api.compile(query)({ data })
    let expected = { "total": 60, "A": 0.6666666666666666, "B": 0.3333333333333333 }
    expect(res).toEqual(expected)
})

test("groupByRelativeSum_parse", () => {
    let query = {
        total: api.sum("data.*.value"),
        "data.*.key": rh`${api.sum("data.*.value")} / ${api.sum("data.*B.value")}`
    }
    let res = api.compile(query)({ data })
    let expected = { "total": 60, "A": 0.6666666666666666, "B": 0.3333333333333333 }
    expect(res).toEqual(expected)
})

test("nestedGroupAggregateTest", () => {
    let query = {
        total: api.sum("data.*.population"),
        "data.*.region": {
            total: api.sum("data.*.population"),
            "data.*.city": api.sum("data.*.population")
        },
    }
    let res = api.compile(query)({ data: countryData })
    let expected = {
        "total": 70,
        "Asia": { "total": 50, "Beijing": 20, "Tokyo": 30 },
        "Europe": { "total": 20, "London": 10, "Paris": 10 }
    }
    expect(res).toEqual(expected)
})

test("joinSimpleTest", () => {
    let q1 = {
        "other.*O.country": "other.*O.region"
    }
    let query = {
        "-": api.merge(api.get(q1, "data.*.country"), {
            "data.*.city": api.sum("data.*.population")
        }),
    }
    let res = api.compile(query)({ data: countryData, other: regionData })
    let expected = {
        "Asia": {
            "Tokyo": 30,
            "Beijing": 20
        },
        "Europe": {
            "Paris": 10,
            "London": 10
        }
    }
    expect(res).toEqual(expected)
})

test("joinWithAggrTest", () => {
    let q1 = {
        "other.*O.country": "other.*O.region"
    }
    let query = {
        total: api.sum("data.*.population"),
        "-": api.merge(api.get(q1, "data.*.country"), {
            total: api.sum("data.*.population"),
            "data.*.city": api.sum("data.*.population")
        }),
    }
    let res = api.compile(query)({ data: countryData, other: regionData })
    let expected = {
        "total": 70,
        "Asia": {
            "total": 50,
            "Tokyo": 30,
            "Beijing": 20
        },
        "Europe": {
            "total": 20,
            "Paris": 10,
            "London": 10
        }
    }
    expect(res).toEqual(expected)
})

test("udfTest", () => {
    let data = [
        { item: "iPhone", price: 1200 },
        { item: "Galaxy", price: 800 },
    ]
    let udf = {
        formatDollar: p => "$" + p + ".00"
    }
    let query = [{
        item: "data.*.item",
        price: api.apply("udf.formatDollar", "data.*.price")
    }]
    let res = api.compile(query)({ data, udf })
    let expected = [{ item: "iPhone", price: "$1200.00" }, { item: "Galaxy", price: "$800.00" }]
    expect(res).toEqual(expected)
})

test("arrayTest1", () => {
    let query4 = api.sum(api.sum("data.*.value"))
    let res = api.compile(query4)({ data })
    let expected = 60
    expect(res).toBe(expected)
})

test("arrayTest2", () => {
    let query1 = api.array(api.array("data.*.value"))
    let query2 = api.array(api.sum("data.*.value"))
    let query2A = api.array({ v: api.sum("data.*.value") })
    let query3 = api.join(api.array("data.*.value"))
    let query4 = api.sum(api.sum("data.*.value"))

    let res = api.compile({ query1, query2, query2A, query3, query4 })({ data })
    let expected = {
        "query1": [[10, 20, 30]],
        "query2": [60],
        "query2A": [{ "v": 60 }],
        "query3": "10,20,30",
        "query4": 60
    }
    expect(res).toEqual(expected)
})

// this was the failing test from https://tiarkrompf.github.io/notes/?/js-queries/aside24
// TODO: currently implementation is inefficient, look to replace
// with a solution modeled after the manual flattening below
test("arrayTest3", () => {
    let query = { "data.*.key": ["Extra1", { foo: "data.*.value" }, "Extra2"] }
    let func = api.compile(query)
    let res = func({ data })
    let expected = {
        A: ["Extra1", { foo: 10 }, { foo: 30 }, "Extra2"],
        B: ["Extra1", { foo: 20 }, "Extra2"]
    }
    expect(res).toEqual(expected)
})

test("arrayTest4", () => {
    let query = { "data.*.key": [{ v1: "data.*.value" }, { v2: "data.*.value" }] }
    let func = api.compile(query)
    let res = func({ data })
    let expected = {
      "A": [{"v1": 10},{"v1": 30},{"v2": 10},{"v2": 30}],
      "B": [{"v1": 20},{"v2": 20}]}
    expect(res).toEqual(expected)
})

// test manual zip and flatten patterns for nested array traversal
test("arrayTest5Zip", () => {
    let query = { "data.*.key": [api.get({ v1: "data.*.value", v2: "data.*.value" },"*A")] }
    let func = api.compile(query)
    let res = func({ data })
    let expected = {
      "A": [10, 10, 30, 30],
      "B": [20, 20]}
    expect(res).toEqual(expected)
})

test("arrayTest6Flatten", () => {
    let query0 = { "data.*.key": {v1:["data.*.value"], v2:["data.*.value"]} }
    let query = { "*k": [api.get(api.get(api.get(query0,"*k"), "*A"), "*B")] }
    let func = api.compile(query)
    // console.dir(func.explain)
    let res = func({ data })
    let expected = {
      "A": [10, 30, 10,30],
      "B": [20, 20]}
    expect(res).toEqual(expected)
})

test("arrayTest7Eta", () => {
    let query0 = { "data.*.key": ["data.*.value"] }
    let query = { "*k": api.get(query0,"*k") }
    let func0 = api.compile(query0)
    let func = api.compile(query)
    // console.dir(func0.explain)
    // console.dir(func.explain)
    let res = func({ data })
    let expected = {
      "A": [10, 30],
      "B": [20]}
    expect(res).toEqual(expected)
})

