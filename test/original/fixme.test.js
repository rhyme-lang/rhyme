const { api, rh } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')

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
        60: { 1: true, 2: true }
    }

    // console.log(f1.c2.explain.pseudo0)
    // console.log(f1.c2.explain.pseudo)
    // console.log(f1.c2.explain.code)

    // console.dir(res1)
    // console.dir(res2)

    // actual result:
    let bug1 = {
        1: { 10: true, 40: true },
        2: { 20: true }
    }

    let bug2 = {
        10: { 1: true },
        30: { 2: true },
        60: { 1: true }
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


test("aggregateAsKey_encoded", () => {

    let data = [
        {"A": 1, "B": 10},
        {"A": 2, "B": 20},
        {"A": 1, "B": 30},
    ]

    let q1 = rh`
        count(singleton(data.*.A).*KEYVAR1) &
        { *KEYVAR1: 
            count(singleton(sum(data.*.B)).*KEYVAR2) &
            { *KEYVAR2: true } }`

/* first one:

    t0 = "data.*.A" -> "sum(data.*.B)"
    t1 = t0[K0] -> t0[K0][K1] -> true

*/

    let f1 = api.compile(q1)

    let res1_new = f1.c2({data})

    let e1 = {
        1: { 40: true },
        2: { 20: true }
    }

    expect(res1_new).toEqual(e1)
})


// Tree-path grouping inserts an empty record for every path that does not
// contribute a field. Moved here from test/semantics/se-tree-paths.test.js,
// where these two were testPathGroup3 and testPathGroup4-1.
//
// THE EMPTY OBJECTS BELOW ARE NOT EXPECTED. The expected results are the
// 'expected' values spelled out in each test -- paths A and B are leaves,
// they have no .B (resp. no .A and .B) child, so they should not appear in
// the output at all.
//
// What happens: '{ "**A": { BOO: ... } }' builds a record per path. For a leaf
// path the field's value is nothing, so the record comes out empty, and the
// enclosing group then inserts that empty record under the path key.
//
// These used to pass because rt.pure.mkTuple had a special case returning
// 'undefined' for an all-nothing record, which made the enclosing update skip
// the key. That special case was removed: it made the mkTuple encoding of a
// constant-key record disagree with the update chain it is supposed to encode
// (the chain starts from {} and cannot fail), so a query's meaning depended
// on whether the optimization had fired.
//
// Two candidate fixes, neither taken yet:
//
//  1. Suppress the insert in rt.stateful.update when the value is an empty
//     record. This is what testPathGroup3's own comment proposed ("Could be
//     done in rt.stateful.update, but there are conflicting demands from
//     react-todo-app.html"). It works for both encodings, but it is a global
//     semantic choice: no query could then build an empty record on purpose.
//
//  2. Give 'update'/'group' the 'maybe' mode that stateful ops already have
//     ('sum?', 'count?'). maybe means skip the init, so a record that writes
//     no field yields nothing rather than {}, and the enclosing group drops
//     the key. This is opt-in per query and honoured by both encodings, but
//     it needs: ops.special["group?"] (commented out at shared.js:22-23), the
//     '?'-stripping in extract0 extended past 'stateful' (simple-eval.js:189),
//     a mode check at the five init sites that hardcode '|| q.key == "update"',
//     a matching maybe for mkTuple, and surface syntax -- '?' currently
//     attaches to an identifier or a get, and these queries are plain JS
//     objects with nowhere to put it.

test("testPathGroup3-fixme", () => {
  let data = { A: 7, B: 8, foo1: { A: 17, B: 18, foo2: { A: 27, B: 28 } } }
  let other = { C: 9, foo1: { B: 12, foo2: { A: 13, C: 15 } } }

  let query = { "**A": { "BOO": rh`data.**A.B` } }

  let func = compile(query)
  let res = func({data,other})

  let expected = {
    BOO: 8,
    foo1: {
      BOO: 18,
      foo2: {
        BOO: 28,
      }
    }
  }

  // actual result: the empty A/B records are the bug
  let bug = {
    BOO: 8, A: {}, B: {},
    foo1: {
      BOO: 18, A: {}, B: {},
      foo2: {
        BOO: 28, A: {}, B: {},
      }
    }
  }

  expect(res).toEqual(bug)
  expect(res).not.toEqual(expected)
})


test("testPathGroup4-1-fixme", () => {
  let data = { A: 7, B: 8, foo1: { A: 17, B: 18, foo2: { A: 27, B: 28 } } }
  let other = { C: 9, foo1: { B: 12, foo2: { A: 13, C: 15 } } }

  let query = { "**A": { "C": rh`data.**A.A + data.**A.B` } }

  let func = compile(query)
  let res = func({data,other})

  let expected = {
    C: 15,
    foo1: {
      C: 35,
      foo2: {
        C: 55,
      }
    }
  }

  // actual result: the empty A/B records are the bug
  let bug = {
    C: 15, A: {}, B: {},
    foo1: {
      C: 35, A: {}, B: {},
      foo2: {
        C: 55, A: {}, B: {},
      }
    }
  }

  expect(res).toEqual(bug)
  expect(res).not.toEqual(expected)
})
