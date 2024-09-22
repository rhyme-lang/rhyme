const { api, pipe } = require('../../src/rhyme')
const { rh, parse } = require('../../src/parser')
const { compile } = require('../../src/simple-eval')



let data = [
    { key: "A", value: 10 },
    { key: "B", value: 20 },
    { key: "A", value: 30 }
]


// Test double-sum situations, i.e. where the
// result of one accumulation is used in another
// one.

test("scalarTest0", () => {
    let query = {
      total: api.sum(api.sum("data.*.value")),
      all: [["data.*.value"]]
    }
    let func = compile(query)
    let res = func({ data })
    let expected = { total: 60, all: [[10,20,30]] }
    expect(res).toEqual(expected)
})


test("groupTest0", () => {
    let query = {
        "total": api.sum("data.*.value"),
        "data.*.key": api.sum("data.*.value")
    }
    let func = compile(query)
    let res = func({ data })
    let expected = { "total": 60, "A": 40, "B": 20 }
    expect(res).toEqual(expected)
})

test("groupTest1", () => {
    let query = {
        "total": api.sum("data.*.value"),
        "data.*.key": api.plus(api.sum("data.*.value"), 0)
    }
    let func = compile(query)
    let res = func({ data })
    let expected = { "total": 60, "A": 40, "B": 20 }
    expect(res).toEqual(expected)
})

test("groupTest2", () => { // BUG!!!
    let query = {
        "total": api.sum(api.sum("data.*.value")),
        "data.*.key": api.sum(api.sum("data.*.value"))  // XXXX !!!!
    }
    let func = compile(query)
    let res = func({ data })
    let expected = { "total": 60, "A": 40, "B": 20 }
    let bug = { "total": 60, "A": 80, "B": 20 }
    expect(res).toEqual(expected)
})

test("groupTest3", () => { // BUG!!!
    let query = {
        "total": api.sum(api.sum("data.*.value")),
        "data.*.key": [([("data.*.value")])]  // XXXX !!!!
    }
    let func = compile(query)

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let res = func({ data })
    let expected = { "total": 60, "A": [[10,30]], "B": [[20]] }
    let bug = { "total": 60, "A": [[10,30],[10,30]], "B": [[20]] }
    expect(res).toEqual(expected)
})


// These simple cases above are fixed by considering if
// sum(q) actually does any dimensionality reduction.
// If not, codegen makes the sum act as a no-op.

// Now what about cases where we're removing *some* 
// variables, but not all.

let data3 = [
    { key: "A", sub: [110, 120] }, // 230
    { key: "A", sub: [330] },
    { key: "B", sub: [200] },
]


test("groupTestNested_pre1", () => {
    let query1 = {
        "data3.*.key": rh`array(*B)`
    }
    let query2 = rh`count(data3.*.sub.*B) & ${query1}`
    let func = compile(query2)

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let res = func({ data3 })

    let expected = { 
        A: [ "0", "1" /*, "0" */ ], // XXX: now implicitly grouping
        B: [ "0" ] 
    }
    expect(res).toEqual(expected)

})

test("groupTestNested_pre2", () => {
    let query1 = {
        "data3.*D.key": rh`array(*B & array(data3.*D.sub.*B))`
    }
    let func = compile(query1)

    //  gen0: data3[*D]
    //  gen1: data3[*D][sub][*B]
    //  gen2: mkset(data3[*D][key])[K0]
    //
    //  tmp0[*B,K0] = array(data3[*D][sub][*B])
    //    fre: *B,K0
    //    bnd: *D
    //  tmp1[K0] = array(and(*B, tmp0[*B,K0]))
    //    fre: K0
    //    bnd: *B,*D  <--- *D !!! removed again by 
    //  tmp2[] = {}{ K0: tmp1[K0] } / mkset(data3[*D][key])[K0]
    //    bnd: K0,*D
    //  tmp2[]


    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let res = func({ data3 })

    let expected = { 
        A: [ [110, 330], [120] ], 
        B: [ [200] ] 
    }
    expect(res).toEqual(expected)

})


test("groupTestNested1", () => {
    let query1 = {
        // "total": api.sum(api.sum("data3.*.sub.*B")),
        "data3.*.key": {
          // "subtotal": rh`sum (udf.guard *B (sum data3.*.sub.*B))`,
          "items": rh`array (*B & (array data3.*.sub.*B))`
        }
    }

    let func = compile(query1)

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let res = func({ data3, udf: {guard: (x,y) => y }})

    // console.dir(res, {depth:7})


    let expected = { 
      // "total": 760, 
      "A": {
        // "subtotal": 560, 
        items: [[110, 330], [120]],
      },
      "B": {
        // "subtotal": 200, 
        items: [[200]],
      }
    }
    let bug = {
      // "total": 760,
      "A": {
        // "subtotal": 1000,  // extra 110+330 !!!
        items: [[110, 330], [120], [110, 330]], // extra 110, 330 !!!
      },
      "B": {
        // "subtotal": 200, 
        items: [[200]],
      }
    }
    expect(res).toEqual(expected)
})


test("groupTestNested2", () => {
    let query1 = {
        // "total": api.sum(api.sum("data3.*.sub.*B")),
        "data3.*.key": {
          // "subtotal": rh`sum (udf.guard *B (sum data3.*.sub.*B))`,
          "items": { "*B":  rh`array data3.*.sub.*B` }
        }
    }


    let func = compile(query1)

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let res = func({ data3, udf: {guard: (x,y) => y }})

    // console.dir(res, {depth:7})


    let expected = {
      // "total": 760,
      "A": {
        // "subtotal": 560,
        items: { 0: [110, 330], 1: [120] },
      },
      "B": {
        // "subtotal": 200,
        items: { 0: [200] },
      }
    }
    let bug = {
      // "total": 760,
      "A": {
        // "subtotal": 560,
        items: { 0: [110, 330], 1: [120] },
      },
      "B": {
        // "subtotal": 200,
        items: { 0: [200], 1: [] },
      }
    }
    expect(res).toEqual(expected)
})



test("groupTestNested2_encoding1", () => {
    let q0 = {"data3.*A.key": { "*A": "data3.*A" }}

    let q1 = rh`udf.guard *K (array (udf.guard *B (array ${q0}.*K.*.sub.*B)))`

    // NOTE: it's convenient to replace 'data' with 'q0.*K' in
    //   data.*.sub.*B --> q0.*K.*.sub.*B
    // but not strictly required -- we could also do something
    // like (q0.*K.*C) && (data.*C.sub.*B), i.e decouple data
    // access from key filtering.  ----> see test case below!
    //
    // Ultimately it's a choice between indexing each variable
    // (i.e. *A) via *K (so all the filter together) or indexing
    // each generator (i.e. data.*A).
    //
    // It seems reasonable to treat all generators in a 
    // contextual way, subject to a path filter. One could
    // try doing that in emitFilters. 

    let func = compile(q1)
    let res = func({ data3, udf: {guard: (x,y) => y }})

    let expected = { 
      "A": [[110, 330], [120]],
      "B": [[200]],
    }
    let bug = { 
      "A": [[110, 330], [120], [110, 330]], // extra 110, 330 !!!
      "B": [[200]],
    }
    expect(res).toEqual(expected)
})


test("groupTestNested2_encoding2", () => {
    let q0 = {"data3.*A.key": { "*A": true }}

    let q1 = rh`udf.guard *K (array (udf.guard *B (
                        array (udf.guard ${q0}.*K.*C data3.*C.sub.*B))))`

    // Second encoding discussed above -- add a separate filter to
    // each *variable* rather than changing access paths
    // NOTE (1): have to use *C instead of default * to match
    // NOTE (2): have to use *K to iterate, can't just 
    //           use data3.*C.key (without the bugfix!!)

    let func = compile(q1)
    let res = func({ data3, udf: {guard: (x,y) => y }})

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = { 
      "A": [[110, 330], [120]],
      "B": [[200]],
    }
    expect(res).toEqual(expected)
})


test("groupTestNested2_encoding3", () => {
    let q0 = rh`(mkset data3.*C.key)`

    let q1 = rh`udf.guard *K (array (udf.guard *B (
                        array (udf.guard ${q0}.*K data3.*C.sub.*B))))`

    let func = compile(q1)
    let res = func({ data3, udf: {guard: (x,y) => y }})

    let expected = { 
      "A": [[110, 330], [120]],
      "B": [[200]],
    }
    expect(res).toEqual(expected)
})



// approach:
//  - group/update creates new filter *K <- mkset(data.*.key)
//  - internal stateful op picks up dependency on *K


test("gt1", () => {
    let q0 = {"data.*.key": "array data.*.value"}

    let func = compile(q0)
    let res = func({ data, udf: {guard: (x,y) => y }})

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = { 
      "A": [10,30],
      "B": [20],
    }
    expect(res).toEqual(expected)
})

test("gt2", () => {
    let q0 = {"data.*.key": "data.*.value"}

    let func = compile(q0, {singleResult:false})
    let res = func({ data, udf: {guard: (x,y) => y }})

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = { 
      0: {"A": 10 },
      1: {"B": 20 },
      2: {"A": 30 },
    }
    expect(res).toEqual(expected)
})

test("gt3", () => {
    let q0 = {foo: {"data.*.key": { bar: "sum data.*.value" }}}

    let func = compile(q0)
    let res = func({ data, udf: {guard: (x,y) => y }})

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = { 
      foo: {"A": { bar: 40 },
            "B": { bar: 20 }},
    }
    expect(res).toEqual(expected)
})

test("gt4", () => {
    let q0 = { foo: 1,//{"data.*.key": "sum data.*.value" },
               bar: 1}//{"data.*.key": "sum data.*.value" }}

    let func = compile(q0)
    let res = func({ data, udf: {guard: (x,y) => y }})

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = { 
      // foo: {"A": 40, "B": 20},
      // bar: {"A": 40, "B": 20},
      foo: 1,
      bar: 1,
    }
    expect(res).toEqual(expected)
})




//  another case -- like advanced/nestedIterator1-explicitlyHoisted
//
//  this doesn't seem to be a bug, but just how things are.
//  however, encodings/hoisting need to operate accordingly.
//
//  TODO: investigate a transform that checks for every expression
//  if it is in the grouping path, and if yes, does not create
//  mind dependencies. 

test("groupTest_explicitHoisting", () => {
    let q0 = { "data.*.key": "array(data.*.key)" }

    let func = compile(q0)
    let res = func({ data })

    let expected = { 
      "A": ["A"], // NOTE: two entries w/same key -> two results
      "B": ["B"]
    }

    let bug = { 
      "A": ["A", "A"], // NOTE: two entries w/same key -> two results
      "B": ["B"]
    }
    expect(res).toEqual(bug)
})


// The following is from demos/tables.html

test("undefinedFields1", () => {
    let data = [
        {product: "iPhone", model: "7", quantity: 10},
        {product: "Galaxy", model: "S6", quantity: 20},
    ]
    let q0 = { "data.*.product": { "data.*.model": "sum(data.*.quantity)" }}
    let func = compile(q0)
    let res = func({ data })

    let expected = { 
      "iPhone": { "7": 10},
      "Galaxy": { "S6": 20},
    }
    expect(res).toEqual(expected)
})

test("undefinedFields2", () => {
    let data = [
        {product: "iPhone", model: "7", quantity: 10},
        {product: "Galaxy", model: "S6", quantity: 20},
    ]
    let q0 = { "data.*.product": { "data.*.model": {Q:"sum(data.*.quantity)" }}}
    let func = compile(q0)
    let res = func({ data })

    let expected = { 
      "iPhone": { 
        "7": { Q: 10} 
      },
      "Galaxy": { 
        "S6": { Q: 20} 
      },
    }
    let bug = { 
      "iPhone": { 
        "7": { Q: 10},
        "S6": { },
      },
      "Galaxy": { 
        "S6": { Q: 20},
        "7": { },
      }
    }
    expect(res).toEqual(expected)
    // NOTE: fixed by using 'undefined' instead of {} as
    // init value in stateful.group
})

test("undefinedFields3", () => {
    let data = [
        {product: "iPhone", model: "7", quantity: 10},
        {product: "Galaxy", model: "S6", quantity: 20},
    ]
    let q0 = { "data.*.product": { "data.*.model": true}}
    let func = compile(q0)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = {
      "iPhone": { 
        "7": true
      },
      "Galaxy": { 
        "S6": true
      },
    }
    let bug = { 
      "iPhone": { 
        "7": true,
        "S6": true
      },
      "Galaxy": { 
        "S6": true,
        "7": true
      }
    }
    expect(res).toEqual(expected)
    // NOTE: fixed by being more careful about decorrelation
})


test("eta-kv-rec1", () => { // OK -- no eta
    let data = [
        {product: "iPhone", model: "7", quantity: 10},
        {product: "Galaxy", model: "S6", quantity: 20},
    ]
    let q0 = rh`sum data.*A.quantity | group data.*A.product`
    let func = compile(q0)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = {
      "iPhone": 10,
      "Galaxy": 20
    }
    expect(res).toEqual(expected)
})

test("eta-kv-rec2", () => { // OK -- eta in body of group expr
    let data = [
        {product: "iPhone", model: "7", quantity: 10},
        {product: "Galaxy", model: "S6", quantity: 20},
    ]
    let data0 = "data"
    let data1 = {"*E": "data.*E"}
    let q0 = rh`sum data.*A.quantity | group ${data1}.*A.product`
    let func = compile(q0)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = {
      "iPhone": 10,
      "Galaxy": 20
    }
    expect(res).toEqual(expected)
})

// XXXX this one fails!!
test("eta-kv-rec2-alt", () => { // consistent index var for data.*E
    let data = [
        {product: "iPhone", model: "7", quantity: 10},
        {product: "Galaxy", model: "S6", quantity: 20},
    ]
    let data0 = "data"
    let data1 = {"*E": "data.*E"}
    let q0 = rh`sum data.*E.quantity | group ${data1}.*A.product`
    let func = compile(q0)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = {
      "iPhone": 10,
      "Galaxy": 20
    }
    let bug = {
      "iPhone": 30,
      "Galaxy": 30
    }
    // expect(res).toEqual(expected)
    expect(res).toEqual(bug) // BUG!!!
})

test("eta-kv-rec3", () => { // BUG -- eta in key of group expr
    let data = [
        {product: "iPhone", model: "7", quantity: 10},
        {product: "Galaxy", model: "S6", quantity: 20},
    ]
    let data0 = "data"
    let data1 = {"*E": "data.*E"}
    let q0 = rh`sum ${data1}.*A.quantity | group data.*A.product`
    let func = compile(q0)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = {
      "iPhone": 10,
      "Galaxy": 20
    }
    expect(res).toEqual(expected)
    // NOTE: requires recursion fix
})

test("eta-kv-rec3-alt", () => { // consistent index var for data.*E
    let data = [
        {product: "iPhone", model: "7", quantity: 10},
        {product: "Galaxy", model: "S6", quantity: 20},
    ]
    let data0 = "data"
    let data1 = {"*E": "data.*E"}
    let q0 = rh`sum ${data1}.*A.quantity | group data.*E.product`
    let func = compile(q0)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = {
      "iPhone": 10,
      "Galaxy": 20
    }
    expect(res).toEqual(expected)
    // NOTE: requires recursion fix
})

test("eta-kv-rec4", () => { // BUG -- eta in key of group expr
    let data = [
        {product: "iPhone", model: "7", quantity: 10},
        {product: "Galaxy", model: "S6", quantity: 20},
    ]
    let data0 = "data"
    let data1 = {"*E": "data.*E"}
    let q0 = rh`sum ${data1}.*A.quantity | group ${data1}.*A.product`
    let func = compile(q0)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = {
      "iPhone": 10,
      "Galaxy": 20
    }
    expect(res).toEqual(expected)
    // NOTE: requires recursion fix
})


test("eta-kv-array2", () => {
    let data = [
        {product: "iPhone", model: "7", quantity: 10},
        {product: "Galaxy", model: "S6", quantity: 20},
    ]
    let data0 = "data"
    let data1 = ["data.*E"]
    let q0 = rh`sum data.*A.quantity | group ${data1}.*A.product`
    let func = compile(q0)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = {
      "iPhone": 10,
      "Galaxy": 20
    }
    expect(res).toEqual(expected)
})

test("eta-kv-array2-alt", () => {
    let data = [
        {product: "iPhone", model: "7", quantity: 10},
        {product: "Galaxy", model: "S6", quantity: 20},
    ]
    let data0 = "data"
    let data1 = ["data.*E"]
    let q0 = rh`sum data.*E.quantity | group ${data1}.*A.product`
    let func = compile(q0)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = {
      "iPhone": 10,
      "Galaxy": 20
    }
    let bug = {
      "iPhone": 30,
      "Galaxy": 30
    }
    // expect(res).toEqual(expected)
    expect(res).toEqual(bug) // BUG!!!
})

test("eta-kv-array3", () => { // BUG -- eta in key of group expr
    let data = [
        {product: "iPhone", model: "7", quantity: 10},
        {product: "Galaxy", model: "S6", quantity: 20},
    ]
    let data0 = "data"
    let data1 = ["data.*E"]
    let q0 = rh`sum ${data1}.*A.quantity | group data.*A.product`
    let func = compile(q0)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = {
      "iPhone": 10,
      "Galaxy": 20
    }
    expect(res).toEqual(expected)
    // NOTE: requires recursion fix
})

test("eta-kv-array3-alt", () => { // consistent index var for data.*E
    let data = [
        {product: "iPhone", model: "7", quantity: 10},
        {product: "Galaxy", model: "S6", quantity: 20},
    ]
    let data0 = "data"
    let data1 = ["data.*E"]
    let q0 = rh`sum ${data1}.*A.quantity | group data.*E.product`
    let func = compile(q0)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = {
      "iPhone": 10,
      "Galaxy": 20
    }
    expect(res).toEqual(expected)
    // NOTE: requires recursion fix
})

// this is the core of plainSortTest3
test("eta-kv-array4", () => { // BUG -- eta via array constr
    let data = [
        {product: "iPhone", model: "7", quantity: 10},
        {product: "Galaxy", model: "S6", quantity: 20},
    ]
    let data0 = "data"
    let data1 = ["data.*E"]
    let q0 = rh`sum ${data1}.*A.quantity | group ${data1}.*A.product`
    let func = compile(q0)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = {
      "iPhone": 10,
      "Galaxy": 20
    }
    expect(res).toEqual(expected)
    // NOTE: requires recursion fix
})

test("etaIndirect1", () => { // OK
    let data = { foo: [1,2,2,4,4,5] }
    let q0 = { "*FOO": rh`count data.*FOO.*A | group data.*FOO.*A` }
    let func = compile(q0)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = { foo: {
      1:1,
      2:2,
      4:2,
      5:1,
    }}
    expect(res).toEqual(expected)
    // NOTE: requires recursion fix
})

// this is the core of day4-part1
test("etaIndirect2", () => { // BUG -- eta via array constr
    let data = { foo: [1,2,2,4,4,5] }
    let data0 = "data.*FOO"
    let data1 = ["data.foo.*E"]
    let q0 = { "foo": rh`count ${data1}.*A | group ${data1}.*A` }
    let func = compile(q0)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = { foo: {
      1:1,
      2:2,
      4:2,
      5:1,
    }}
    expect(res).toEqual(expected)
    // NOTE: requires recursion fix
})

/*

The issue:

{ data.*.key: sum data.*.value }

for (* <- data)
  for (K <- mkset(data.*.key))
    tmp[K] += data.*.value

Want:

{ [data.*E].*.key: sum [data.*E].*.value }

for (* <- [data.*E])
  for (K <- mkset([data.*E].*.key))
    tmp[K] += [data.*E].*.value

But we're more likely to get:

for (*E <- data)
  for (* <- [data.*E])
    ...

*/

// more test cases for equivalence of eta expansion
test("etaSame0", () => { // baseline
    let data = [1,2,3]
    let q = rh`(sum data.*) + (sum data.*)`
    let func = compile(q)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = 12
    expect(res).toEqual(expected)
})

test("etaSame1", () => { 
    let data = [1,2,3]
    let q = rh`(sum data.*) + (sum (array data.*).*)`
    let func = compile(q)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = 12
    expect(res).toEqual(expected)
})

test("etaSame2", () => { 
    let data = [1,2,3]
    let q = rh`sum (data.* + (array data.*).*)`
    let func = compile(q)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = 12
    expect(res).toEqual(expected)
})

test("etaSame3", () => { 
    let data = [1,2,3]
    let q = rh`sum (data.*A + (array data.*A).*B)`
    let func = compile(q)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = 12
    expect(res).toEqual(expected)
})

test("etaSame4", () => { 
    let data = [1,2,3]
    let q = rh`sum (data.*A + (group *A data.*A).*B)`
    let func = compile(q)
    let res = func({ data })

    // console.log(func.explain.pseudo0)
    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = 12
    expect(res).toEqual(expected)
})


// ----- test indirect correlation of group keys

test("testIndirectCorrelation1", () => {
  let other = {
    0: { 0: 1 },
    1: { 1: 1 },
    2: { 2: 1 }
  }

  // (test direct correlation first)

  // Want: inner sum depends on key expr, and
  // key expr needs q.free not just q.dims

  let query = { "data.*A.key": rh`sum(other.*B.*A & data.*B.value)` }

  let func = compile(query)
  let res = func({data, other})

  expect(res).toEqual({
    A: 40, B: 20
  })
})

test("testIndirectCorrelation2", () => {
  let other = {
    0: { 0: 1 },
    1: { 1: 1 },
    2: { 2: 1 }
  }

  // Want: inner sum depends on key expr, and
  // key expr needs q.free not just q.dims

  let query = { "data.*A.key": rh`sum(data.*B.value)` }

  let func = compile(rh`sum(other.*A.*B) & ${query}`)
  let res = func({data, other})

  expect(res).toEqual({
    A: 40, B: 20
  })
  // Want 40, 20 as in testIndirectCorrelation1,
  // this needs indirect correlation.
})

test("testIndirectCorrelation3", () => {
  let other = {
    0: { 0: 1 },
    1: { 1: 1 },
    2: { 2: 1 }
  }

  // Want: inner sum depends on key expr, and
  // key expr needs q.free not just q.dims

  let query = { "data.*A.key": rh`sum(data.*B.value)` }

  let func = compile(rh`sum(other.*B.*A) & ${query}`)
  let res = func({data, other})

  expect(res).toEqual({
    A: 40, B: 20
  })
  // Want 40, 20 as in testIndirectCorrelation1,
  // this needs indirect correlation.
})



// tests above exercise a 1:1 mapping ("other"), now
// we consider a many:few mapping

test("testIndirectCorrelation4", () => {
  let data = {
    Osaka:    { region: "Asia" },
    Shanghai: { region: "Asia" },
    Hamburg:  { region: "Europe" },
  }
  let partner = {
    Osaka:    { Hamburg: 1 },
    Shanghai: { Hamburg: 1 },    
    Hamburg:  { Osaka: 1, Shanghai: 1 } // (symmetry not strictly needed)
  }

  // (test direct correlation first)

  // Want: inner aggregation binds both A and B

  let query = { "data.*A.region": rh`array(partner.*A.*B & *B)` }

  let func = compile(query)
  let res = func({data, partner})

  expect(res).toEqual({
    Europe: ["Osaka", "Shanghai"],
    Asia: ["Hamburg", "Hamburg"],   // implicitly iterating over A,    
  })                                // so duplicate result is expected
})


test("testIndirectCorrelation5", () => {
  let data = {
    Osaka:    { region: "Asia" },
    Shanghai: { region: "Asia" },
    Hamburg:  { region: "Europe" },
  }
  let partner = {
    Osaka:    { Hamburg: 1 },
    Shanghai: { Hamburg: 1 },
    Hamburg:  { Osaka: 1, Shanghai: 1 } // (symmetry not strictly needed)
  }

  // Want: inner aggregation now only binds B,
  // as A,B dependency moved elsewhere

  let query = { "data.*A.region": rh`array(*B)` }

  let func = compile(rh`sum(partner.*A.*B) & ${query}`)
  let res = func({data, partner})

  let bug = {
    Europe: ["Osaka", "Shanghai"],
    Asia: ["Hamburg", "Hamburg"],   // duplication much harder
                                    // to rationalize here
  }

  expect(res).toEqual({
    Europe: ["Osaka", "Shanghai"],
    Asia: ["Hamburg"],   // only once!
  })
})


// should we be able to compute group keys indirectly?

// sum(mkset(data.*A.key).*K) & { *K: sum(data.*A.value) }

// sum(mkset(data.*A.key).*K) & sum(other.*A.*B) & { *K: sum(data.*B.value) }




// test("testXX", () => {
//   let other = {
//     0: { 0: 1 },
//     1: { 1: 1 },
//     2: { 2: 1 }
//   }

//   // Want: inner sum depends on key expr, and
//   // key expr needs q.free not just q.dims

//   let query = { "*K": rh`sum(data.*A.value)` }

//   let func = compile(rh`sum(mkset(data.*A.key).*K) & ${query}`)
//   let res = func({data, other})

//   expect(res).toEqual({
//     A: 40, B: 20
//   })
// })


test("testFreeVars", () => {

  let a = [[1,2,3]]
  let b = [[1,2,3]]
  let d = [[1,2,3]]

  let data = [
      7,7,7,7
  ]

  let query = rh`(array a.*A.*C) & 
  (array (array b.*B).*C) & 
  (array (array d.*D).*C) & 
  (group *A (group *B (
      *A + *B + (sum data.*C))))`

  // inner sum:
  //   sum^{*A}_{*C}(data[*C])
  // free: A, bound: C

/*
array_{*A,*C}(a[*A][*C]) &
array_{*C}(array_{*B}(b[*B])[*C]) &
array_{*C}(array_{*D}(d[*D])[*C]) &
group_{*A} (group^{*A}_{*B} 
  (single^{*A,*B}(plus(plus(*A, *B), 
    sum^{*A}_{*C}(data[*C])))))
*/

  let func = compile(query)

  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)

  let res1 = func({a,b,d, data})

  let e1 = {
      0: { 0: 7 }
  }

  expect(res1).toEqual(e1)
})

test("testIndirectFreeVars0", () => {
  let other = {
    0: { 0: 1 },
    1: { 1: 1 },
    2: { 2: 1 }
  }

  // XXX this one also works with trans(q.dims)

  let filter1 = rh`count other.*B.*A`

  let expr = rh`*B & array(data.*A.value)`

  let query = rh`${filter1} & ${expr}`

  let func = compile(query)
  let res = func({data, other})

  expect(res).toEqual({
    0: [10], 1: [20], 2: [30]
  })
})

test("testIndirectFreeVars1", () => {
  let other = {
    0: { 0: 1 },
    1: { 1: 1 },
    2: { 2: 1 }
  }

  // Consider a in (q.bnd \ out), b in (transf1(a) \ out), c in (transf1(b) & out)
  // Make sure we're not missing c!

  // XXX this one also works with trans(q.dims)

  let filter1 = rh`count other.*B.*A`
  let filter2 = rh`count other.*C.*B`
  let filter3 = rh`count other.*D.*C`
  let filter4 = rh`count other.*E.*D`

  let expr = rh`*E & array(data.*A.value)`

  let query = rh`${filter1} & ${filter2} & ${filter3} & ${filter4} & ${expr}`

  let func = compile(query)
  let res = func({data, other})

  expect(res).toEqual({
    0: [10], 1: [20], 2: [30]
  })
})

test("testIndirectFreeVars2", () => {
  let other = {
    0: { 0: 1 },
    1: { 1: 1 },
    2: { 2: 1 }
  }

  // XXX this one genuinely requires trans(q.fre)

  let filter1 = rh`count (group *AX (sum other.*B.*AX)).*A`
  let filter2 = rh`count (group *BX (sum other.*C.*BX)).*B`
  let filter3 = rh`count (group *CX (sum other.*D.*CX)).*C`
  let filter4 = rh`count (group *DX (sum other.*E.*DX)).*D`

  let expr = rh`*E & array(data.*A.value)`

  let query = rh`${filter1} & ${filter2} & ${filter3} & ${filter4} & ${expr}`

  let func = compile(query)
  let res = func({data, other})

  expect(res).toEqual({
    0: [10], 1: [20], 2: [30]
  })
})

test("day5-part2-debug", () => {
  let extra = { seeds: [79, 14, 55, 13] }

  let udf = {
    filter: c => c ? { [c]: true } : {},
    andThen: (a,b) => b, // just to add a as dependency
    modulo: (x,y) => x % y,
    isEqual: (x,y) => x === y,

    isEven: x => (Number(x) % 2) === 0,
    isOdd: x => (Number(x) % 2) === 1,

    filterEven: x => (x % 2) === 0 ? {1:1} : {},
    filterOdd: x => (x % 2) === 1 ? {1:1} : {},
  }

  let filterBy = (p, gen, x) => rh`(udf.filter ${p}).${gen} & ${x}`

  let isEven = x => rh`udf.isEqual 0 (udf.modulo ${x} 2)`

  let isOdd = x => rh`udf.isEqual 1 (udf.modulo ${x} 2)`

  // this works
  // let starts0 = [rh`(mkset (udf.modulo *seed 2)).0 & extra.seeds.*seed`]
  // let lengths0 = [rh`(mkset (udf.modulo *seed 2)).1 & extra.seeds.*seed`]

  // this also works
  // let starts0 = [rh`(mkset 0).(udf.modulo *seed 2) & extra.seeds.*seed`]
  // let lengths0 = [rh`(mkset 1).(udf.modulo *seed 2) & extra.seeds.*seed`]

  let starts0 = [rh`(udf.filterEven *seed).*ev & extra.seeds.*seed`]
  let lengths0 = [rh`(udf.filterOdd *seed).*od & extra.seeds.*seed`]

  // ev,od --> seed

  // NOTE: the problem is using *seed twice, for starts and lengths.
  // if we use two different variables, e.g. *seedE and *seedO, then
  // it works.

  // PROBLEM: index space of *A -- *A depends on both *ev and *od, 
  // codegen reconstructs loops over *ev AND *od, so we end up
  // trying to filter *seed for both even AND odd indexes.

  // POSSIBLE SOLUTION: take *A only from the respective tmp,
  // the filtering on *ev/*od has already been done. 

  let starts1 = rh`${starts0}.*A`
  let lengths1 = rh`${lengths0}.*A`

  let f0 = compile([{startX: starts1, lengthX: lengths1}])

  let res = f0({udf, extra})

/* desired pattern:

    let starts = []
    let lengths = []

    for (*seed <- extra.seeds)
      for (*ev <- filter (*seed % 2 == 0))
        starts .push (extra.seeds.*seed)
      for (*od <- filter (*seed % 2 == 1))
        lengths .push (extra.seeds.*seed)

    let res = []
    for (*A <- starts /\ lengths)
      res .push ({ start: starts.*A, length: lengths.*A })

    return res
*/

  // console.log(f0.explain.pseudo)
  // console.log(f0.explain.code)
  // console.log(res)

  expect(res).toEqual([ 
    { startX: 79, lengthX: 14 }, 
    { startX: 55, lengthX: 13 } 
  ])


  // let r1 = f0.c1({udf, extra})
  // let r1b = f0.c1_opt({udf, extra})
  // let r2 = f0.c2({udf, extra})

  // console.log(r1)
  // console.log(r1b)
  // console.log(r2)
})


test("day4-part1-debug1", () => {

  let xs = [1,2,3,4,3,2,1]

  let ys1 = rh`xs`
  let q1 = rh`${ys1}.* | count | group ${ys1}.*`

  let ys2 = rh`xs.*`
  let q2 = rh`${ys2} | count | group ${ys2}`

  let ys3 = rh`(array xs.*).*`
  let q3 = rh`${ys3} | count | group ${ys3}`

  let ys4 = rh`(array xs.*)`
  let q4 = rh`${ys4}.* | count | group ${ys4}.*`

  let expected = { 
    1: 2, 2: 2, 3: 2, 4: 1 
  }

  let func1 = compile(q1)
  let func2 = compile(q2)
  let func3 = compile(q3)
  let func4 = compile(q4)

  let res1 = func1({xs})
  let res2 = func2({xs})
  let res3 = func3({xs})
  let res4 = func4({xs})
  
  expect(res1).toEqual(expected)
  expect(res2).toEqual(expected)
  expect(res3).toEqual(expected)
  expect(res4).toEqual(expected)

})

test("day4-part1-debug2", () => {

  let xs = [[1,2,3,4,3,2,1]]

  let ys1 = rh`xs.*line.*num`
  let q1 = {"*line": rh`count ${ys1} | group ${ys1}`}

  let ys2 = rh`(array xs.*line.*).*num`
  let q2 = {"*line": rh`count ${ys2} | group ${ys2}`}

  let expected = {
    0: { 1: 2, 2: 2, 3: 2, 4: 1 }
  }

  let bug = { 0: {} }

  let func1 = compile(q1)
  let func2 = compile(q2)

  let res1 = func1({xs})
  let res2 = func2({xs})
  
  expect(res1).toEqual(expected)
  expect(res2).toEqual(expected)

})
