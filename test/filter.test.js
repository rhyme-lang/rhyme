const { api } = require('../src/rhyme')

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

// // can I express something like this:
// // SELECT Sum(r.A * r.B) FROM R r
// // WHERE
// // 0.5 * (SELECT Sum(r1.B) FROM R r1) =
// // (SELECT Sum(r2.B) FROM R r2 WHERE r2.A = r.A)
// function correlatedNestedFilter() {
//     // let data = [
//     //     {"A": 1, "B": 10},
//     //     {"A": 2, "B": 20},
//     //     {"A": 1, "B": 30},
//     // ]
//     // let rhsSum = ???
//     // let lhsSum = ??? // A -> Sum(B)
//     // // rhsSum -> SUM(A*B)
    

//     // // let rhsSum = {"data.*.A": api.sum("data.*.B")}
//     // // let lhsSum = api.sum("data.*.B")
//     // let query = api.sum(api.times("data.*.A", "data.*.B")) // TODO: how to specify the correlated constraint? -- we need to generate: `if (....)` in the code?
//     // // let query = api.sum(api.filter(eq, api.get(rhsSum("data.*.A"), api.get(lhsSum), api.times("data.*.A", "data.*.B"))))
//     // let exec = api.compile(query)
//     // exec.explain

// }