const { api } = require('../../src/rhyme')
const { rh } = require('../../src/parser')

test("siblingFields", () => {
    let data = [{ key: "A", value: 10 }, { key: "B", value: 20}, { key: "C", value: 30 }]

    let q1 = [rh`data.*A.value`]
    let q2 = rh`data.*A | count`

    let q3 = rh`${q1} | sum .*B`

    let query = {
        q2, q3
    }

    let func = api.compile(query)
    // c1 produces incorrect code

    // console.dir(func.explain.code)
    // console.dir(func.explain_opt.code)
    // let res = func({data})
    // console.dir(res) 
})

// Nested grouping: this case is challenging because we're
// using "*" in two sibling fields of the same object, without
// having any key depend on "*".
//
// The current dependency extraction is not set up for this,
// as it happens at the same time as IR construction.
//
// Possible solution: find dependencies first, then transform
// code based on context.


// XXXX failure ???

test("statelessRepeatedGrouping4", () => {

    let data = [{ key: "A", value: 10 }, { key: "B", value: 20}, { key: "C", value: 30 }]

    let q1 = { "*A": {
        key: "data.*A.key",
        data: { "data.*A.key": "data.*A.value" }}}
    let q2 = [{
        key: "data.*A.key", // use "*" in sibling fields!
        data: { "data.*A.key": "data.*A.value" }}]

    let f1 = api.compile(q1)
    let f2 = api.compile(q2)

    let res1 = f1({data})
    let res2 = f2.c1({data})
    let res2_new = f2.c2({data})

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

    expect(res2).toEqual(bug)
    expect(res2_new).toEqual(e)
})


// Related

test("asymmetricPartialSum", () => {

    let data = {
        A: { key: "U", value: 40 },
        B: { key: "U", value: 20 },
        C: { key: "V", value: 10 },
    }
    let other = {
        A: { value: 100 },
        B: { value: 400 },
        D: { value: 200 },
    }

    let items = rh`(sum data.*A.value) + other.*A.value`
    let query = api.array(items)

    let func = api.compile(query)
    let res = func.c1({data, other})
    let res_new = func.c2({data, other})

    // console.log(res)

    // expect(res).toEqual([140,420]) // {A:140, B:420}

    let bug = [140, 460]

    expect(res).toEqual(bug)
    expect(res_new).toEqual([140, 420])
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
    let res = f.c1({data, index})
    let res_new = f.c2({data, index})

    // console.dir(res)

    // actual result:
    let bug = { A: 10, B: 20, C: undefined }

    expect(res).toEqual(bug)
    expect(res_new).toEqual({ A: 10, B: 20})
})

test("undefinedKey", () => {

    let data = { A: 10, B: 20, C: 30 }
    let index = [{key:"A"},{},{key:"B"},{key:"B"}]

    let q = {
        "index.*.key": "count(index.*)"
    }

    let f = api.compile(q)
    let res = f.c1({data, index})
    let res_new = f.c2({data, index})

    // console.dir(res)

    // actual result:
    let bug = { A: 1, undefined: 1, B: 2 }

    expect(res).toEqual(bug)
    expect(res_new).toEqual({ A: 1, B: 2})
})



// Using aggregates as keys: the most intuitive semantics
// would be to use the final value of the aggregate as keys
// but this is not what's currently happening.
//
// Right now, all partial sums show up as keys.
//
// Computing this fully incrementally is not trivial and
// requires moving entries from one key to another.
//
// TODO: discuss desirable semantics for q2

test("aggregateAsKey", () => {

    let data = [
        {"A": 1, "B": 10},
        {"A": 2, "B": 20},
        {"A": 1, "B": 30},
    ]

    let q1 = { "data.*.A": { "sum(data.*.B)": true } }
    let q2 = { "sum(data.*.B)": { "data.*.A": true } }

/* first one:

    t0 = "data.*.A" -> "sum(data.*.B)"
    t1 = t0[K0] -> t0[K0][K1] -> true

*/

    let f1 = api.compile(q1)
    let f2 = api.compile(q2)

    let res1 = f1.c1({data})
    let res2 = f2.c1({data})
    let res1_opt = f1.c1_opt({data})
    let res2_opt = f2.c1_opt({data})
    let res1_new = f1.c2({data})
    let res2_new = f2.c2({data})

    let e1 = {
        1: { 40: true },
        2: { 20: true }
    }

    let e2 = {
        40: { 1: true },
        20: { 2: true }
    }

    let e2_alt = {
        60: { 1: true, 2: true }, // XXX is this the right one?
    }

    let e2_alt_string = {
        60: { 1: "true", 2: "true" }
    }

    // console.log(f1.c2.explain.pseudo0)
    // console.log(f1.c2.explain.pseudo)
    // console.log(f1.c2.explain.code)

    // console.dir(res1)
    // console.dir(res2)

    // actual result:
    let bug1 = {
        1: { 10: "true", 40: "true" },
        2: { 20: "true" }
    }

    let bug2 = {
        10: { 1: "true" },
        30: { 2: "true" },
        60: { 1: "true" }
    }

    // instead of waiting for the final sum,
    // partial sums show up in the structure

    expect(res1).toEqual(bug1)
    expect(res2).toEqual(bug2)
    expect(res1_opt).toEqual(bug1)
    expect(res2_opt).toEqual(e2_alt_string)
    expect(res1_new).toEqual(e1)
    expect(res2_new).toEqual(e2_alt)
})
