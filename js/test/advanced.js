import { api } from '../core.js';
import { expect, display } from './infra.js';

// some additional queries
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

function testDecorrelation1() {
    let query = {
        total: api.sum("data.*.value"),
        "data.*.key": {
            my_total: api.sum("data.*.value"),
            full_total: api.sum("data.*B.value") // should be de-correlated
        }
    }
    let expected = {
        "total": 60,
        "A": { "my_total": 40, "full_total": 60 },
        "B": { "my_total": 20, "full_total": 60 }
    }
    check(query, expected, "testDecorrelation1")
}

function testDecorrelation2() {
    let query = {
        total: api.sum("data.*.value"),
        "data.*.key": api.fdiv(api.sum("data.*.value"), api.sum("data.*B.value"))
    }

    let expected = {
        "total": 60,
        "A": 0.6666666666666666,
        "B": 0.3333333333333333
    }
    check(query, expected, "testDecorrelation2")
}

function testNestedIterators1() {
    // FixMe: this produces a wrong result because inner loop computation is repeated
    let query = {
        total: api.sum("data.*.value"),
        "data.*.key": {
            my_total: api.sum("data.*.value"),
            "data.*B.key": api.sum("data.*B.value") // should be de-correlated (note - can be explicitly de-correlated using a separate query)
        }
    }
    let expected = {
        "total": 60,
        "A": { "my_total": 40, "A": 40, "B": 20 },
        "B": { "my_total": 20, "A": 40, "B": 20 }
    }
    check(query, expected, "testNestedIterators1")
}

function testNestedIterators1_explicitlyHoisted() {
    // FixMe: aggr computation is repeated --> need to "cache" it and reuse
    // explicit de-correlation (works)
    let aggr = {
        "data.*O.key": api.sum("data.*O.value")
    }
    let query = {
        total: api.sum("data.*.value"),
        "data.*.key": {
            my_total: api.get(aggr, "data.*.key"),
            "data.*B.key": api.get(aggr, "data.*B.key")
        }
    }
    let expected = {
        "total": 60,
        "A": { "my_total": 40, "A": 40, "B": 20 },
        "B": { "my_total": 20, "A": 40, "B": 20 }
    }
    check(query, expected, "testNestedIterators2")
}

function testNestedIterators2() {
    let query = {
        "data.*A.key": {
            "data.*B.key": api.fdiv(api.sum("data.*A.value"), api.sum("data.*B.value")) // cannot simply use nested loops,
        }                                                                               // "data.*A.value" should be fully computed before computing inner!
    }
    let expected = {
        "A": { "A": 1, "B": 2},
        "B": { "A": 1, "B": 0.5}
    }
    check(query, expected, "testNestedIterators2")
}

function testNestedIterators2_explicitlyHoisted() {
    let aggr = {
        "data.*.key": api.sum("data.*.value")
    }
    let query = {
        "data.*A.key": {
            "data.*B.key": api.fdiv(api.get(aggr, "data.*A.key"), api.get(aggr, "data.*B.key"))
        }
    }
    let expected = {
        "A": { "A": 1, "B": 2 },
        "B": { "A": 0.5, "B": 1 }
    }
    check(query, expected, "testNestedIterators2")
}

function testNestedIterators3() {
    // FixMe: wrong. dependencies for outer loop result value is not properly handled, etc.
    // nested iterator, but with also some loop local computation
    let aggr = {
        "data.*.key": api.sum("data.*.value")
    }
    let query = {
        "data.*A.key": {
            "total": api.sum("data.*A.value"),    // TODO: if *A scheduled inside *B, this will repeat in nested --> incorrect result!
            "data.*B.key": {
                "total": api.sum("data.*B.value"),  // TODO: likewise here
                "ratio": api.fdiv(api.get(aggr, "data.*A.key"), api.get(aggr, "data.*B.key"))
            }
        }
    }
    let expected = {
        "A": { "total": 40, "A": { "total": 40, "ratio": 1 }, "B": { "total": 20, "ratio": 2 } },
        "B": { "total": 20, "A": { "total": 40, "ratio": 0.5 }, "B": { "total": 20, "ratio": 1 } }
    }
    check(query, expected, "testNestedIterators3")
}

function testNestedIterators3_explicitlyHoisted() {
    let aggr = {
        "data.*.key": api.sum("data.*.value")
    }
    // again, we can write this in a different way that explicitly hoists the loop local computations
    let query = {
        "data.*A.key": {
            "total": api.get(aggr, "data.*A.key"),    // this will hoist the computation out (produces correct result)
            "data.*B.key": {
                "total": api.get(aggr, "data.*B.key"),
                "ratio": api.fdiv(api.get(aggr, "data.*A.key"), api.get(aggr, "data.*B.key"))
            }
        }
    }
    let expected = {
        "A": { "total": 40, "A": { "ratio": 1, "total": 40, }, "B": { "ratio": 2, "total": 20 } },
        "B": { "total": 20, "A": { "ratio": 0.5, "total": 40 }, "B": { "ratio": 1, "total": 20 } }
    }
    check(query, expected, "testNestedIterators3")
}

// how to specify a filter
// select r.key, sum(r.value) from data r where r.key = "A"
function simpleFilterTest() {
    // TODO: this works, but no "predicate push-down" yet
    let aggr = { "data.*.key": api.sum("data.*.value") }
    let query = {
        "A": api.get(aggr, "A")
    }
    let expected = { "A": 40 }
    check(query, expected, "simpleFilterTest")
}

testDecorrelation1()
testDecorrelation2()
testNestedIterators1()
testNestedIterators1_explicitlyHoisted()
testNestedIterators2()
testNestedIterators2_explicitlyHoisted()
testNestedIterators3()
testNestedIterators3_explicitlyHoisted()