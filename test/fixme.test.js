const { api } = require('../src/rhyme')

// some sample data for testing
let data = [
    { region: "Europe", name: "London", value: 10 },
    { region: "Europe", name: "Paris", value: 11 },
    { region: "Europe", name: "Berlin", value: 12 },
    { region: "Asia", name: "Beijing", value: 20 },
    { region: "Asia", name: "Tokyo", value: 21 },
    { region: "Asia", name: "Seoul", value: 22 },
]


// interaction of array and object construction

test("arrayWithinGrouping", () => {
    // queries
    let q0 = { "data.*.region": {"data.*.name": "data.*.value"} }
    let q1 = { "data.*.region": [{name: "data.*.name", value: "data.*.value"}] }
    let q2 = { "data.*.region": [{"data.*.name": "data.*.value"}] } // <-- BUG

    // expected results
    let e0 = {
        Europe: { London: 10, Paris: 11, Berlin: 12},
        Asia: { Beijing: 20, Tokyo: 21, Seoul: 22}
    }
    let e1 = {
        Europe: [
            { name: "London", value: 10},
            { name: "Paris", value: 11},
            { name: "Berlin", value: 12}
        ],
        Asia: [
            { name: "Beijing", value: 20 },
            { name: "Tokyo", value: 21 },
            { name: "Seoul", value: 22}
        ]
    }
    let e2 = {
        Europe: [{ London: 10, Paris: 11, Berlin: 12}],
        Asia: [{ Beijing: 20, Tokyo: 21, Seoul: 22}]
    }
    // or perhaps:
    let e2alt = {
        Europe: [{ London: 10}, {Paris: 11}, {Berlin: 12}],
        Asia: [{ Beijing: 20}, {Tokyo: 21}, {Seoul: 22}]
    }

    let f0 = api.compile(q0)
    let f1 = api.compile(q1)
    let f2 = api.compile(q2)

    let r0 = f0({ data })
    let r1 = f1({ data })
    let r2 = f2({ data })

    expect(r0).toEqual(e0)
    expect(r1).toEqual(e1)
    // expect(r2).toEqual(e2)

    // console.dir(r2, {depth:9})

    // actual result (wrong):
    let bug = {
      Europe: [
        {
          London: 10,
          Paris: 11,
          Berlin: 12,
          Beijing: 20,
          Tokyo: 21,
          Seoul: 22
        }
      ],
      Asia: [
        {
          London: 10,
          Paris: 11,
          Berlin: 12,
          Beijing: 20,
          Tokyo: 21,
          Seoul: 22
        }
      ]
    }

})


// Treatment of "undefined": we need to decide on the desired
// behavior.
//
// Right now, there are few special cases, so "undefined" can
// show up easily, e.g. in key and value positions.
//
// A sensible alterntive design would be to propagate "undefined"
// values uniformly as failure, so that they trigger abortive
// behavior (proper "inner join" semantics). So, rather than
// inserting "undefined" as a key/val, we would just not insert
// anything. Of course there still needs to be an operation
// to "observe" undefined and obtain "outer join" behavior,
// e.g. "a ?? b" (return b if a is undefined -- and of course
// b could be undefined as well).


test("undefinedVal", () => {

    let data = { A: 10, B: 20 }
    let index = ["A","B","C"]

    let q = {
        "index.*": "data.(index.*)"
    }

    let f = api.compile(q)
    let res = f({data, index})

    // console.dir(res)

    // actual result:
    let bug = { A: 10, B: 20, C: undefined }
})

test("undefinedKey", () => {

    let data = { A: 10, B: 20, C: 30 }
    let index = [{key:"A"},{},{key:"B"},{key:"B"}]

    let q = {
        "index.*.key": "count(index.*)"
    }

    let f = api.compile(q)
    let res = f({data, index})

    // console.dir(res)

    // actual result:
    let bug = { A: 1, undefined: 1, B: 2 }

})
