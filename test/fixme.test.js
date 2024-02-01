const { api } = require('../src/rhyme')


// Nested grouping: this case is challenging because we're
// using "*" in two sibling fields of the same object, without
// having any key depend on "*".
//
// The current dependency extraction is not set up for this,
// as it happens at the same time as IR construction. 
//
// Possible solution: find dependencies first, then transform
// code based on context.

test("statelessRepeatedGrouping4", () => {

    let data = [{ key: "A", value: 10 }, { key: "B", value: 20}, { key: "C", value: 30 }]

    let q1 = { "*": {
        key: "data.*.key",
        data: { "data.*.key": "data.*.value" }}}
    let q2 = [{
        key: "data.*.key", // use "*" in sibling fields!
        data: { "data.*.key": "data.*.value" }}]

    let f1 = api.compile(q1)
    let f2 = api.compile(q2)

    let res1 = f1({data})
    let res2 = f2({data})

    let e = [
      { key: 'A', data: { A: 10 } },
      { key: 'B', data: { B: 20 } },
      { key: 'C', data: { C: 30 } }
    ]

    // console.dir(res1, {depth:5})
    // console.dir(res2, {depth:5})

    expect(res1).toEqual({...e})
    // expect(res2).toEqual(e)

    // wrong result:
    let bug = [
      { key: 'A', data: { A: 10, B: 20, C: 30 } },
      { key: 'B', data: { A: 10, B: 20, C: 30 } },
      { key: 'C', data: { A: 10, B: 20, C: 30 } }
    ]
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

