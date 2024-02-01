const { api } = require('../src/rhyme')
const { rh } = require('../src/parser')

// some sample data for testing
let data = [
    { key: "A", value: 10 },
    { key: "B", value: 20 },
    { key: "A", value: 30 }
]

test("simpleFilterTest", () => {
    let aggr = { "data.*.key": api.sum("data.*.value") }
    let query = {
        "A": api.get(aggr, "A")
    }
    let expected = { "A": 40 } // essentially a filter (TODO: but no predicate pushdown; we materialize the entire group by first)
    let res = api.compile(query)({ data })
    expect(res).toEqual(expected)
})

// TODO: filters need a bit more thought

// We can express queries like this:
//
// SELECT Sum(r.A * r.B) 
//   FROM R r
//  WHERE (SELECT Sum(r2.B) FROM R r2 WHERE r2.A = r.A)
//     >= (SELECT Sum(r1.B) FROM R r1) * 0.5
//
test("correlatedNestedFilter", () => {
    let data = [
        {"A": 1, "B": 10},
        {"A": 2, "B": 20},
        {"A": 1, "B": 30},
    ]

    let udf = {
        isGE: (x, y) => x >= y
    }

    let V1 = "1/2 * sum(data.*1.B)" // (10+20+30)/2 = 30
    let F2 = { "data.*1.A": "sum(data.*1.B)" } // {1: 40, 2: 20}

    let V2 = rh`sum(data.*r.A * data.*r.B * (udf.isGE ${F2}.(data.*r.A) ${V1}))`

    let query = V2

    // DISCUSSION:
    //
    // We rely on (A) pre-computing partial sums and indexing by key (V1,F2),
    // and (B) "multiplying" with a computed condition.
    //
    // This still requires two full table scans. Fully incremental versions
    // would be possible using RPAI indexes (SIGMOD'22).

    let func = api.compile(query)
    console.dir(func.explain.code)
    let res = func({data, udf})
    expect(res).toEqual(40)
})
