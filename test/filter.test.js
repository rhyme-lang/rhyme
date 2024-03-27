const { api } = require('../src/rhyme')
const { rh } = require('../src/parser')

// some sample data for testing
let data = [
    { key: "A", value: 10 },
    { key: "B", value: 20 },
    { key: "A", value: 30 }
]


// In this file we explore three patterns for implementing filters:
//
// 1. Partition values into an index structure, indexed by desired condition
// 2. Using a boolean condition as 0/1 multiplier in count/sum
// 3. Building a 0 or 1 element collection as indicator


// Pattern 1: partition into auxiliary index
//
// This is simple to do, but the downside is that it takes
// more work: partial results are computed for the entire 
// collection, and then many of them discarded.
// (However if run in a loop, this can be amortized)
//
test("simpleFilterTest", () => {
    // sum data.*.value where data.*.key == "A"
    let query = rh`sum data.*.value | group data.*.key | .A`
    let expected = 40 // note: no predicate pushdown, we materialize the entire "group by" first
    let res = api.compile(query)({ data })
    expect(res).toEqual(expected)
})

test("simpleFilterTest2", () => {
    // sum data.*.value where data.*.key != "B"
    let udf = { ne: (a,b) => a != b }
    let query = rh`sum data.*.value | group (udf.ne data.*.key "B") | .true`
    let expected = 40 // note: no predicate pushdown, we materialize the entire "group by" first
    let res = api.compile(query)({ data, udf })
    expect(res).toEqual(expected)
})


// Pattern 2: multiply with boolean flag
//
// This is useful e.g. to express queries like this:
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
    // console.dir(func.explain.code)
    let res = func({data, udf})
    expect(res).toEqual(40)
})


// Pattern 3: indicator collection
//
// Recognizing that 0-element collections also act as filters, we build
// a struct that contains 0 or 1 entries depending on the desired condition c.
// When we index into that struct using a generator variable (here: *F),
// the result (and anything else that depends on *F) will be filtered on c.
//
test("generatorAsFilter", () => {
    let udf = {
        filter: c => c ? { [c]: true } : {},
        andThen: (a,b) => b, // just to add a as dependency
        eq: a => b => a == b,
        eq2: (a, b) => a == b,
        tbl: {A:true},
        tru: {true:true}
    }
    let filter = p => x => rh`udf.andThen (udf.filter (${p} ${x})).*F ${x}`
    let query = rh`sum data.*.value | group (data.*.key | ${filter("udf.eq A")})`

/*

    t0 = <A == data.*.key>[*F] && data.*.key
    t0[K0] -> sum(data.*.value)

*/

    // NOTE: can we achieve udf.filter more directly using a query
    // object expresion { ... } ? Almost, but not quite! (TODO)
    // - we need to deal with (ie prevent) undefined keys in objects
    // - there are some issues with dependencies of objects - note that this
    //   is inside a path in a key position (group (filter data.*.key ... ))
    //   so deps of the entire object aren't available yet.
    
    // DISCUSSION: what is the sum of no elements? Should it be 0 or undefined?
    //
    // Here the choice is 0. As a consequence, in the example above, if we
    // filter the values instead of the keys, we will see an additional 
    // entry "B": 0 in the result below. 
    //
    // The key is passed through, but all the values are filtered out.

    let expected = { "A": 40 }
    let func = api.compile(query)

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)


    // console.dir(func.explain.code)
    let res = func({ data, udf }, true)
    expect(res).toEqual(expected)
})


// XXX temp -- with simple eval, the following work

test("generatorAsFilter2", () => {
    let udf = {
        filter: c => c ? { [c]: true } : {},
        andThen: (a,b) => b, // just to add a as dependency
        eq2: (a, b) => a == b,
    }
    let query = { // filter value, not key (difference? see above about 0 init)
      "data.*.key":
        rh`sum(udf.andThen (udf.filter (udf.eq2 A data.*.key)).*F data.*.value)`
    }

    let expected = { "A": 40 }
    let func = api.compile(query).c2 // CS only!

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let res = func({ data, udf }, true)
    expect(res).toEqual(expected)
})

test("generatorAsFilter3", () => {
    let udf = {
        filter: c => c ? { [c]: true } : {},
        andThen: (a,b) => a && b, // proper test here!!!
        tbl: {A:true},
    }
    let query = { // rely only on non-undefined test here, not var *F
      "data.*.key":
        rh`sum(udf.andThen (udf.tbl.(data.*.key)) data.*.value)`
    }

    let expected = { "A": 40 }
    let func = api.compile(query).c2 // C2 only!

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let res = func({ data, udf }, true)
    expect(res).toEqual(expected)
})

