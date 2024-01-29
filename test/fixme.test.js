const { api } = require('../src/rhyme')

test("statelessGrouping", () => { // this one works

    let data = { A: 10, B: 20, C: 30 }

    let q1 = { "*": "data.*" }
    let q2 = api.get({ "foo": { "*": "data.*" }}, "foo")

    let f1 = api.compile(q1)
    let f2 = api.compile(q2)
    let res1 = f1({data})
    let res2 = f2({data})

    let e = { A: 10, B: 20, C: 30}

    expect(res1).toEqual(e)
    expect(res2).toEqual(e)
})

test("statelessRepeatedGrouping1", () => { // this one doesn't!

    let data = { A: 10, B: 20, C: 30 }

    let q1 = { "*": { "*": "data.*" }}
    let q2 = api.get({ "foo": { "*": { "*": "data.*" }}}, "foo")

    let f1 = api.compile(q1)
    let f2 = api.compile(q2)
    let res1 = f1({data})
    let res2 = f2({data})

    let e = { A: { A: 10 }, B: { B: 20 }, C: { C: 30 } }

    expect(res1).toEqual(e)
    expect(res2).toEqual(e)

    // res2 was previously this:
    let bug = {
      A: { A: 10, B: 20, C: 30 },
      B: { A: 10, B: 20, C: 30 },
      C: { A: 10, B: 20, C: 30 }
    }
})

test("statelessRepeatedGrouping2", () => { // this one doesn't!

    let data = [{ key: "A", value: 10 }, { key: "B", value: 20}, { key: "C", value: 30 }]

    let q1 = { "data.*.key": { "data.*.key": "data.*.value" }}
    let q2 = api.get({ "foo": { "data.*.key": { "data.*.key": "data.*.value" }}}, "foo")

    let f1 = api.compile(q1)
    let f2 = api.compile(q2)
    let res1 = f1({data})
    let res2 = f2({data})

    let e = { A: { A: 10 }, B: { B: 20 }, C: { C: 30 } }

    expect(res1).toEqual(e)
    expect(res2).toEqual(e)

    // res2 was previously this:
    let bug = {
      A: { A: 10, B: 20, C: 30 },
      B: { A: 10, B: 20, C: 30 },
      C: { A: 10, B: 20, C: 30 }
    }
})

test("statelessRepeatedGrouping3", () => { // this one doesn't!

    let data = [{ key: "A", value: 10 }, { key: "B", value: 20}, { key: "C", value: 30 }]

    let q1 = { "data.*.key": { "data.*.key": 7 }}
    let q2 = api.get({ "foo": { "data.*.key": { "data.*.key": 7 }}}, "foo")

    let f1 = api.compile(q1)
    let f2 = api.compile(q2)

    let res1 = f1({data})
    let res2 = f2({data})

    let e = { A: { A: 7 }, B: { B: 7 }, C: { C: 7 } }

    expect(res1).toEqual(e)
    // expect(res2).toEqual(e)

    // console.log(res2)

    // wrong result:
    let bug = {
      A: { A: 7, B: 7, C: 7 },
      B: { A: 7, B: 7, C: 7 },
      C: { A: 7, B: 7, C: 7 }
    }
})


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
    // or perhaps (this is the current output):
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
    expect(r2).toEqual(e2alt)

    // previous (wrong) result:
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

test("subQueryGrouping", () => {

  let data = [[{key:"A", val:10}, {key:"A", val:20}, {key:"B", val:30}, {key:"B", val:40}],
              [{key:"A", val:40}, {key:"A", val:30}, {key:"B", val:20}, {key:"B", val:10}]]

  let q0 = {"*i": {"data.*i.*j.key" : api.sum("data.*i.*j.val")}}

  let q1 = {"*q": api.get(q0, "*q")}

  let f0 = api.compile(q0)
  let f1 = api.compile(q1)

  let r0 = f0({data})
  let r1 = f1({data})

  let expected = {
    0: { A: 30, B: 70},
    1: { A: 70, B: 30}
  }

  // r0 and r1 should all be equal to expected, but r1 is not
  // f1 has the following buggy code snippet:
  // for (let KEY_star_i in inp['data']) {
  //    tmp[1][KEY_star_i] ??= {}
  //    for (let KEY_star_j in inp['data'][KEY_star_i]) {
  //        ...
  //        tmp[2][inp['data'][KEY_star_i][KEY_star_j]['key']] = ...
  //    }
  //    tmp[3] ??= {} //
  //    tmp[3][KEY_star_i] = tmp[2]
  //}
  // This makes tmp[3][*] all point to the same object (the object referenced by tmp[2])

  expect(r0).toEqual(expected)
  expect(r1).toEqual(expected)

  // console.dir(r1)

  // previous (wrong) result:
  let bug1 = {
    0: { A: 70, B: 30},
    1: { A: 70, B: 30}
  }
})
