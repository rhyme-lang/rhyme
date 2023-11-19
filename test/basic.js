import { api } from '../core.js';
import { expect, display } from './infra.js';

let data = [
    { key: "A", value: 10 },
    { key: "B", value: 20 },
    { key: "A", value: 30 }
]

function check(query, expected, testName, inp = { data }) {
    let exec = api.compile(query)
    display(exec.explain)
    let res = exec(inp)
    display(res)
    expect(res, expected, testName)
}

function plainSumTest() {
    let query = api.sum("data.*.value")
    check(query, 60, "plainSumTest")
}

function plainAverageTest() {
    let query = api.div(api.sum("data.*.value"), api.count("data.*.value"))
    check(query, 20, "plainAverageTest")
}

function uncorrelatedAverageTest() {
    let query = api.div(api.sum("data.*A.value"), api.count("data.*B.value"))
    check(query, 20, "uncorrelatedAverageTest")
}

function groupByTest() {
    let query = {
        total: api.sum("data.*.value"),
        "data.*.key": api.sum("data.*.value"),
    }
    check(query, { "total": 60, "A": 40, "B": 20 }, "groupByTest")
}

function groupByAverageTest() {
    let avg = p => api.div(api.sum(p), api.count(p))
    let query = {
        total: api.sum("data.*.value"),
        "data.*.key": avg("data.*.value"),
    }
    check(query, { "total": 60, "A": 20, "B": 20 }, "groupByAverageTest")
}

function groupByRelativeSum() {
    let query = {
        total: api.sum("data.*.value"),
        "data.*.key": api.fdiv(api.sum("data.*.value"), api.sum("data.*B.value"))
    }

    check(query, { "total": 60, "A": 0.6666666666666666, "B": 0.3333333333333333 }, "groupByRelativeSum")
}

function nestedGroupAggregateTest() {
    let data = [
        { region: "Asia", country: "Japan", city: "Tokyo", population: 30 },
        { region: "Asia", country: "China", city: "Beijing", population: 20 },
        { region: "Europe", country: "France", city: "Paris", population: 10 },
        { region: "Europe", country: "UK", city: "London", population: 10 },
    ]

    let query = {
        total: api.sum("data.*.population"),
        "data.*.region": {
            total: api.sum("data.*.population"),
            "data.*.city": api.sum("data.*.population")
        },
    }
    check(query, { total: 70, Asia: { total: 50, Tokyo: 30, Beijing: 20 }, Europe: { total: 20, Paris: 10, London: 10 } }, "nestedGroupAggregateTest", { data })
}


// data to test join
function joinTest() {
    let other = [
        { region: "Asia", country: "Japan" },
        { region: "Asia", country: "China" },
        { region: "Europe", country: "France" },
        { region: "Europe", country: "UK" },
    ]

    let data = [
        { country: "Japan", city: "Tokyo", population: 30 },
        { country: "China", city: "Beijing", population: 20 },
        { country: "France", city: "Paris", population: 10 },
        { country: "UK", city: "London", population: 10 },
    ]

    function joinSimpleTest() {
        let q1 = {
            "other.*O.country": "other.*O.region"
        }
        let query = {
            "-": api.merge(api.get(q1, "data.*.country"), {
                "data.*.city": api.sum("data.*.population")
            }),
        }
        check(query, { "Asia": { "Tokyo": 30, "Beijing": 20 }, "Europe": { "Paris": 10, "London": 10 } }, "joinSimpleTest", { data, other })
    }

    function joinWithAggrTest() {
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

        check(query, { "total": 70, "Asia": { "total": 50, "Tokyo": 30, "Beijing": 20 }, "Europe": { "total": 20, "Paris": 10, "London": 10 } }, "joinWithAggrTest", { data, other })
    }
    joinSimpleTest()
    joinWithAggrTest()
}

function udfTest() {
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
    check(query, [{ item: "iPhone", price: "$1200.00" }, { item: "Galaxy", price: "$800.00" }], "udfTest", { data, udf })
}

function testArrays() {
    function test1() {
        let data = [
            { key: "A", value: 10 },
            { key: "B", value: 20 },
            { key: "A", value: 30 }
        ]
        let query4 = api.sum(api.sum("data.*.value"))
        let exc = api.compile(query4)
        console.log(exc.explain)
        let res = exc({ data })
        display(res)
        expect(res, 60, "arraysTest1")
    }

    function test2() {
        let data = [
            { key: "A", value: 10 },
            { key: "B", value: 20 },
            { key: "A", value: 30 }
        ]
        let queryA = { "data.*.key": api.array({ foo: "data.*.value" }) }
        let queryB = api.array(api.array({ foo: "data.*.value" }))
        let query1 = api.array(api.array("data.*.value"))
        let query2 = api.array(api.sum("data.*.value"))
        let query2A = api.array({ v: api.sum("data.*.value") })
        let query3 = api.join(api.array("data.*.value"))
        let query4 = api.sum(api.sum("data.*.value"))
        let res = api.compile({ query1, query2, query2A, query3, query4 })
        console.log(res.explain)
        let vs = res({ data })
        let expected = {
            query1: [[10, 20, 30]],
            query2: [60],
            query2A: [{ v: 60 }],
            query3: "10,20,30",
            query4: 60,
        }
        for (let k in vs) {
            console.log("-- " + k + " --")
            display(vs[k])
            expect(vs[k], expected[k])
        }
    }

    // FixMe?
    function test3() {
        let data = [
            { key: "A", value: 10 },
            { key: "B", value: 20 },
            { key: "A", value: 30 }
        ]
        let query = { "data.*.key": ["Extra1", { foo: "data.*.value" }, "Extra2"] }
        let exec = api.compile(query)
        console.log(exec.explain)
        let res = exec({ data })
        display(res)
        expect(res, {
            A: ["Extra1", "Extra2", { foo: 10 }, { foo: 30 }],
            B: ["Extra1", "Extra2", { foo: 20 }]
        })
    }

    test1()
    test2()
    test3()

}


plainSumTest()
plainAverageTest()
uncorrelatedAverageTest()
groupByTest()
groupByAverageTest()
groupByRelativeSum()
nestedGroupAggregateTest()
joinTest()
udfTest()
testArrays()