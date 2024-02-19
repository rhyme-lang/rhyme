const { api } = require('../src/rhyme')
const { rh } = require('../src/parser')

// some sample data for testing
let data = [
    { key: "A", value: 10 },
    { key: "B", value: 20 },
    { key: "A", value: 30 }
]

test("decorrelation1", () => {
    let query = {
        total: api.sum("data.*A.value"),
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
    let res = api.compile(query)({ data })
    expect(res).toEqual(expected)
})

test("decorrelation2", () => {
    let query = {
        total: api.sum("data.*.value"),
        "data.*.key": api.fdiv(api.sum("data.*.value"), api.sum("data.*B.value"))
    }
    let expected = {
        "total": 60,
        "A": 0.6666666666666666,
        "B": 0.3333333333333333
    }
    let res = api.compile(query)({ data })
    expect(res).toEqual(expected)
})

// the following set of tests works with emitting repeated iterators logic
// (explicitly hoisted versions works fine as expected without that)
test("nestedIterators1", () => {
    let query = {
        total: api.sum("data.*A.value"),
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
    let exec = api.compile(query)
    let res = exec({ data })
    expect(res).toEqual(expected)
})


test("nestedIterators1-explicitlyHoisted", () => {
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
    let exec = api.compile(query)
    let res = exec({ data })
    expect(res).toEqual(expected)
})

test("nestedIterators2", () => {
    let query = {
        "data.*A.key": {
            "data.*B.key": api.fdiv(api.sum("data.*A.value"), api.sum("data.*B.value")) // cannot simply use nested loops,
        }                                                                               // "data.*A.value" should be fully computed before computing inner!
    }
    let expected = {
        "A": { "A": 1, "B": 2},
        "B": { "A": 0.5, "B": 1}
    }
    let exec = api.compile(query)
    let res = exec({ data })
    expect(res).toEqual(expected)
})

test("nestedIterators2-explicitlyHoisted", () => {
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
    let exec = api.compile(query)
    let res = exec({ data })
    expect(res).toEqual(expected)
})

test("nestedIterators3", () => {
    let aggr = {
        "data.*.key": api.sum("data.*.value")
    }
    let query = {
        "data.*A.key": {
            "total": api.sum("data.*A.value"),
            "data.*B.key": {
                "total": api.sum("data.*B.value"),
                "ratio": api.fdiv(api.get(aggr, "data.*A.key"), api.get(aggr, "data.*B.key"))
            }
        }
    }
    let expected = {
        "A": { "total": 40, "A": { "total": 40, "ratio": 1 }, "B": { "total": 20, "ratio": 2 } },
        "B": { "total": 20, "A": { "total": 40, "ratio": 0.5 }, "B": { "total": 20, "ratio": 1 } }
    }
    let exec = api.compile(query)
    let res = exec({ data })
    expect(res).toEqual(expected)
})

test("nestedIterators3-explicitlyHoisted", () => {
    let aggr = {
        "data.*.key": api.sum("data.*.value")
    }
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
    let exec = api.compile(query)
    let res = exec({ data })
    expect(res).toEqual(expected)
})

test("cartesianProduct", () => {
  let data1 = [10, 20]
  let data2 = [10, 20]
  let query = [{
            "data1": "data1.*i",
            "data2": "data2.*j",
            sum: "data1.*i + data2.*j",
            product: "data1.*i * data2.*j"
        }]
  let expected = [{"data1":10,"data2":10,"sum":20,"product":100},
                  {"data1":10,"data2":20,"sum":30,"product":200},
                  {"data1":20,"data2":10,"sum":30,"product":200},
                  {"data1":20,"data2":20,"sum":40,"product":400}]
  let exec = api.compile(query)
  // XXX: Currently generated code:
  //inp => {
  //    let tmp = {}
  //    tmp[0] ??= {}
  //    tmp[1] ??= []
  //    for (let KEY_star_i in inp['data1']) {
  //        tmp[0][KEY_star_i] ??= {}
  //    }
  //    // --- non-eagerly emitting remaining generators ---
  //    for (let KEY_star_i in inp['data1']) {
  //        for (let KEY_star_j in inp['data2']) {
  //            tmp[0][KEY_star_i][KEY_star_j] ??= {} //
  //            tmp[0][KEY_star_i][KEY_star_j]['data1'] = inp['data1'][KEY_star_i]
  //            tmp[0][KEY_star_i][KEY_star_j]['data2'] = inp['data2'][KEY_star_j]
  //            tmp[0][KEY_star_i][KEY_star_j]['sum'] = (inp['data1'][KEY_star_i]+inp['data2'][KEY_star_j])
  //            tmp[0][KEY_star_i][KEY_star_j]['product'] = (inp['data1'][KEY_star_i]*inp['data2'][KEY_star_j])
  //            tmp[1] .push (tmp[0][KEY_star_i][KEY_star_j])
  //        }
  //    }
  //    return tmp[1]
  //}

  // XXX: Previously generated code (repeated generators not fused)
  //inp => {
  //    let tmp = {}
  //    tmp[0] ??= {}
  //    tmp[1] ??= []
  //    for (let KEY_star_i in inp['data1']) {
  //        tmp[0][KEY_star_i] ??= {}
  //    }
  //    for (let KEY_star_j in inp['data2']) {
  //    }
  //    // --- repeated generators ---
  //    for (let KEY_star_i in inp['data1']) {
  //        for (let KEY_star_j in inp['data2']) {
  //            tmp[0][KEY_star_i][KEY_star_j] ??= {} //
  //        }
  //    }
  //    for (let KEY_star_i in inp['data1']) {
  //        for (let KEY_star_j in inp['data2']) {
  //            tmp[0][KEY_star_i][KEY_star_j]['data1'] = inp['data1'][KEY_star_i]
  //        }
  //    }
  //    for (let KEY_star_i in inp['data1']) {
  //        for (let KEY_star_j in inp['data2']) {
  //            tmp[0][KEY_star_i][KEY_star_j]['data2'] = inp['data2'][KEY_star_j]
  //        }
  //    }
  //    for (let KEY_star_i in inp['data1']) {
  //        for (let KEY_star_j in inp['data2']) {
  //            tmp[0][KEY_star_i][KEY_star_j]['sum'] = (inp['data1'][KEY_star_i]+inp['data2'][KEY_star_j])
  //        }
  //    }
  //    for (let KEY_star_i in inp['data1']) {
  //        for (let KEY_star_j in inp['data2']) {
  //            tmp[0][KEY_star_i][KEY_star_j]['product'] = (inp['data1'][KEY_star_i]*inp['data2'][KEY_star_j])
  //        }
  //    }
  //    for (let KEY_star_i in inp['data1']) {
  //        for (let KEY_star_j in inp['data2']) {
  //            tmp[1] .push (tmp[0][KEY_star_i][KEY_star_j])
  //        }
  //    }
  //    return tmp[1]
  //}
  let res = exec({ data1, data2 })
  expect(res).toEqual(expected)
})
