const { api } = require('../src/rhyme')
const { rh } = require('../src/parser')

const { runtime } = require('../src/simple-runtime')
let rt = runtime


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

test("plainSumTest_parse2", () => {
    let query = rh`sum(data.*.value)`
    let res = api.compile(query)({ data })
    let expected = 60
    expect(res).toBe(expected)
})

test("plainAverageTest", () => {
    let query = api.div(api.sum("data.*.value"), api.count("data.*.value"))
    // console.dir(query)
    let res = api.compile(query)({ data })
    let expected = 20
    expect(res).toBe(expected)
})

test("plainAverageTest_parse", () => {
    let query = rh`${api.sum("data.*.value")} / ${api.count("data.*.value")}`
    // console.dir(query)
    let res = api.compile(query)({ data })
    let expected = 20
    expect(res).toBe(expected)
})

test("plainAverageTest_parse2", () => {
    let query = rh`sum(data.*.value) / count(data.*.value)`
    // console.dir(query)
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

test("uncorrelatedAverageTest_parse2", () => {
    let query = rh`sum(data.*A.value) / count(data.*B.value)`
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
    let func = api.compile(query)
    let res = func({ data })
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

test("groupByAverageTest_parse2", () => {
    let avg = p => rh`sum(${p}) / count(${p})`
    let query = {
        total: "sum(data.*.value)",
        "data.*.key": rh`${avg}(data.*.value)`,
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
    let func = api.compile(query)
    let res = func({ data })
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

test("joinSimpleTest1", () => {
    let q1 = {
        "other.*O.country": "other.*O.region"
    }
    let query = {
        "data.*.city": {
            country: "data.*.country",
            region: api.get(q1,"data.*.country")
        }
    }
    let func = api.compile(query)
    let res = func({ data: countryData, other: regionData })
    let expected = {
        "Beijing": { country: "China", region: "Asia" },
        "Paris": { country: "France", region: "Europe" },
        "London": { country: "UK", region: "Europe" },
        "Tokyo": { country: "Japan", region: "Asia" }
    }
    expect(res).toEqual(expected)
})

test("joinSimpleTest2", () => {
    let q1 = {
        "other.*O.country": "other.*O.region"
    }
    let query = {
        "-": api.merge(api.get(q1, "data.*.country"), {
            "data.*.city": api.sum("data.*.population")
        }),
    }
    let func = api.compile(query)
    let res = func({ data: countryData, other: regionData })
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
    let func = api.compile(query)
    let res = func({ data: countryData, other: regionData })
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
    let func = api.compile(query)
    let res = func({ data, udf })
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
    let res = func({ data })
    let expected = {
      "A": [10, 30, 10,30],
      "B": [20, 20]}
    expect(res).toEqual(expected)
})

test("arrayTest7Eta", () => {
    let query0 = { "data.*.key": ["data.*.value"] }
    let query = { "*k": api.get(query0,"*k") }
    //let func0 = api.compile(query0)
    let func = api.compile(query)

    console.log(func.explain2.pseudo0)
    console.log(func.explain2.pseudo)
    console.log(func.explain2.code)

let code = `(inp => k => {
      let tmp = {}
      // --- tmp0 ---
      for (let x_DEFAULT_0 in inp?.['data'])
        rt.update(tmp,0)
        (rt.stateful.array(inp?.['data']?.[x_DEFAULT_0]?.['value'],1))
      // --- tmp1 ---
      // pre-gen *_DEFAULT_0
      let gen1x_DEFAULT_0 = {}
      for (let x_DEFAULT_0 in inp?.['data'])
      for (let xK1 in {[inp?.['data']?.[x_DEFAULT_0]?.['key']]: true})
        gen1x_DEFAULT_0[xK1] = true //{[inp?.['data']?.[x_DEFAULT_0]?.['key']]: true}?.[xK1]
      // main loop
      for (let xK1 in gen1x_DEFAULT_0) {
        rt.update(tmp,1)
        (rt.stateful.group(xK1, tmp?.[0]))
        console.log("KEY", xK1)
    }
      // --- tmp2 ---
      for (let xk in tmp?.[1])
        rt.update(tmp,2,xk)
        (rt.stateful.single(tmp?.[1]?.[xk],0))
      // --- tmp3 ---
      for (let xk in tmp?.[1])
        rt.update(tmp,3)
        (rt.stateful.group(xk, tmp?.[2]?.[xk]))
      // --- res ---
      k(tmp?.[3])
      })

`
let func2 = eval(code)

func2({data})(x => console.log(x))


    let res = func({ data })
    let expected = {
      "A": [10, 30],
      "B": [20]}
    expect(res).toEqual(expected)
})




test("graphicsBasicTestParsing", () => {
    // to make sure $display doesn't mess up with parsing
    // TODO: currently "type:svg", "300px" won't work unless we mark
    // them as strings like '"300px"'
    let data = [{x:20,y:70},{x:40,y:30},{x:60,y:50},{x:80,y:60},{x:100,y:40}]
    let query = {
        "$display": "select",
        data: data
    }
    let res = api.compile(query)({ data })
    let expected = {
        "$display": "select",
        data: data
    }
    expect(res).toEqual(expected)
})