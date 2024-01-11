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

