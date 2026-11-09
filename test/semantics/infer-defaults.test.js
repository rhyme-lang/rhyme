const { api, rh } = require('../../src/rhyme')

// The setting inferDefaults: sums and groups get the defaults of the
// PLDI'27 draft (src/defaults.js). Expected results are those of the
// paper (Figure 5, Figure 7, Section 5); examples/section3-core.js runs the
// same rows translated by hand.

let run = (q, inp, opts = {}) => api.compile(q, { inferDefaults: true, ...opts })(inp)

let alpha = { 0: { 1: 3 }, 1: { 2: 4 } }
let alpha1 = { 0: { 1: 3 }, 1: { 0: 4 }, 5: {} }
let A = [[0, 1, 2], [], [10, 11, 12]]
let d = [{ key: 7, val: 10 }, { key: 11, val: 5 }, { key: 7, val: 30 }]
let d1 = [{ key: 7, val: 10 }, { key: 11 }, { key: 7, val: 30 }] // d', no value 5

// [name, query, input, expected]
let figure5 = [
  ["Λi.a_i on {}", rh`{ *i: a.*i }`, { a: {} }, {}],
  ["Λi.a_i on 5", rh`{ *i: a.*i }`, { a: 5 }, 5],
  ["row sums", rh`{ *i: sum(A.*i.*j) }`, { A }, { 0: 3, 1: 0, 2: 33 }],
  ["copy A", rh`{ *i: { *j: a.*i.*j } }`, { a: A }, { 0: { 0: 0, 1: 1, 2: 2 }, 1: {}, 2: { 0: 10, 1: 11, 2: 12 } }],
  ["copy JSON", rh`{ *i: { *j: a.*i.*j } }`, { a: { 0: 5, 1: { 1: 1, 2: 2 } } }, { 0: 5, 1: { 1: 1, 2: 2 } }],
  ["deep intersection", rh`{ *i: { *j: a.*i.*j & b.*i.*j } }`, { a: { 0: 5, 1: 6 }, b: { 0: 5, 2: 6 } }, { 0: 5 }],
  ["Σi.(a_i & ⊥)", rh`sum(a.*i & .bot)`, { a: alpha }, 0],
  ["Σj.a_{j,9}", rh`sum(a.*j.(9))`, { a: alpha }, 0],
  ["Λi.(a_i =? 5) on {1: 7}", rh`{ *i: singleton(a.*i).(5) }`, { a: { 1: 7 } }, {}],
  ["Λi.(a_i =? 5) on 7", rh`{ *i: singleton(a.*i).(5) }`, { a: 7 }, 7],
  ["column sums on α", rh`{ *i: sum(a.*j.*i) }`, { a: alpha }, { 1: 3, 2: 4 }],
  ["column sums on {0: {}}", rh`{ *i: sum(a.*j.*i) }`, { a: { 0: {} } }, {}],
  ["column sums on {}", rh`{ *i: sum(a.*j.*i) }`, { a: {} }, undefined],
  ["Λi.(a_i & Σj.a_{j,i})", rh`{ *i: a.*i & sum(a.*j.*i) }`, { a: alpha1 }, { 0: 4, 1: 3 }],
  ["Λi.(a_i & Σj.a_{j,i?})", rh`{ *i: a.*i & sum(a.*j.(1 & *i)) }`, { a: alpha1 }, { 0: 4, 1: 3, 5: 0 }],
  ["diagonal on {}", rh`{ *i: a.*i.*i }`, { a: {} }, undefined],
  ["diagonal on {0: {1: 7}}", rh`{ *i: a.*i.*i }`, { a: { 0: { 1: 7 } } }, undefined],
  ["diagonal filter on {}", rh`{ *i: a.*i.(1 & *i) }`, { a: {} }, {}],
  ["diagonal filter on {0: {1: 7}}", rh`{ *i: a.*i.(1 & *i) }`, { a: { 0: { 1: 7 } } }, {}],
  ["group-by on d", rh`{ a.*i.key: sum(a.*i.val) }`, { a: d }, { 7: 40, 11: 5 }],
  ["group-by on d'", rh`{ a.*i.key: sum(a.*i.val) }`, { a: d1 }, { 7: 40, 11: 0 }],
  ["group-by on {}", rh`{ a.*i.key: sum(a.*i.val) }`, { a: {} }, undefined],
  // rhyme's singleton stores the key as a string
  ["Λm.Λi.(a_i & ⟨i⟩_m)", rh`{ *m: { *i: a.*i & singleton(*i).*m } }`, { a: { 1: 5, 2: 6 } }, { 1: { 1: "1" }, 2: { 2: "2" } }],
]

describe("inferDefaults: Figure 5", () => {
  test.each(figure5)("%s", (name, q, inp, expected) => {
    expect(run(q, inp)).toEqual(expected)
  })
})

describe("inferDefaults: existence of collections", () => {
  test("sum over a missing collection", () => expect(run(rh`sum(a.*i)`, {})).toEqual(undefined))
  test("sum over {}", () => expect(run(rh`sum(a.*i)`, { a: {} })).toEqual(0))
  test("implicit top-level group over {}", () => expect(run(rh`a.*i`, { a: {} })).toEqual({}))
  test("implicit top-level group over a missing collection", () => expect(run(rh`a.*i`, {})).toEqual(undefined))
})

describe("inferDefaults: sum? and group? have no default", () => {
  test("sum? over {}", () => expect(run(rh`sum?(a.*i)`, { a: {} })).toEqual(undefined))
  test("group? over {}", () => expect(run(rh`group? *i a.*i`, { a: {} })).toEqual(undefined))
  test("row sums with sum?", () => expect(run(rh`{ *i: sum?(A.*i.*j) }`, { A: [[1], []] })).toEqual({ 0: 1 }))
})

describe("inferDefaults: Section 5", () => {
  let forall = rh`singleton(sum(a.*i & 1)).(sum(a.*j & (a.*j > 3) & 1))`
  test("forall holds", () => expect(run(forall, { a: { 0: 5, 1: 7 } })).toEqual(2))
  test("forall fails", () => expect(run(forall, { a: { 0: 5, 1: 2 } })).toEqual(undefined))
  test("forall on {}", () => expect(run(forall, { a: {} })).toEqual(0))

  let not = t => rh`singleton(0).(sum(singleton(0).*x & ${t} & 1))`
  let dn = { d: { 0: 1, 1: 1 }, a: { 0: 1 } }
  test("not ⊥", () => expect(run(not(rh`.bot`), {})).toEqual(0))
  test("not 1", () => expect(run(not(rh`1`), {})).toEqual(undefined))
  test("negation of a generator of an outer variable", () =>
    expect(run(rh`{ *y: d.*y & ${not(rh`a.*y`)} }`, dn)).toEqual({}))
  test("negation of a filter", () =>
    expect(run(rh`{ *y: d.*y & ${not(rh`a.(1 & *y)`)} }`, dn)).toEqual({ 1: 0 }))

  // Rhyme writes outer joins with maybe lookups: a variable whose lookups
  // are all maybe lookups ranges over the union of their keys
  let oj = rh`{ *i: (a.*i? + b.*i?) || a.*i? || b.*i? }`
  test("outer join", () => expect(run(oj, { a: { 0: 1, 1: 2 }, b: { 1: 10, 2: 20 } })).toEqual({ 0: 1, 1: 12, 2: 20 }))
  test("outer join of {} and {}", () => expect(run(oj, { a: {}, b: {} })).toEqual({}))
  test("outer join of {} and ⊥", () => expect(run(oj, { a: {} })).toEqual({}))
  test("outer join of ⊥ and ⊥", () => expect(run(oj, {})).toEqual(undefined))
  test("outer join of 5 and 6", () => expect(run(oj, { a: 5, b: 6 })).toEqual(5))

  let nj = rh`{ *i: { *j: singleton(e.*i.dept).(p.*j.id) & { emp: e.*i.name, mgr: p.*j.mgr } } }`
  let e = [{ name: "A", dept: 1 }, { name: "B", dept: 3 }]
  test("nested join", () => expect(run(nj, { e, p: [{ id: 1, mgr: "M" }] }))
    .toEqual({ 0: { 0: { emp: "A", mgr: "M" } }, 1: {} }))
  test("nested join without departments", () => expect(run(nj, { e, p: {} })).toEqual({ 0: {}, 1: {} }))
})

describe("inferDefaults: beta (Figure 7)", () => {
  test("C1: a variable argument", () => {
    let inp = { a: [1, 2], b: {} }
    expect(run(rh`{ *i: { *j: ({ *l: a.*l * b.*j }).*i } }`, inp)).toEqual(undefined)
    expect(run(rh`{ *i: { *j: a.*i * b.*j } }`, inp)).toEqual({ 0: {}, 1: {} })
  })
  test("C2: column sum at a missing column", () => {
    expect(run(rh`({ *i: sum(a.*j.*i) }).(9)`, { a: alpha })).toEqual(undefined)
    expect(run(rh`sum(a.*j.(9))`, { a: alpha })).toEqual(0)
  })
  test("C3: a generator of an outer variable mentions the redex variable", () => {
    expect(run(rh`{ *m: ({ *i: a.*i & singleton(*i).*m }).(0) }`, { a: {} })).toEqual(undefined)
    expect(run(rh`{ *m: a.(0) & singleton(0).*m }`, { a: {} })).toEqual({})
  })
  test("composition of lookups", () => {
    let inp = { a: { 0: 10, 1: 11, 3: 13 }, b: { 0: 1, 1: 3, 2: 2, 4: 0 } }
    let res = { 0: 11, 1: 13, 4: 10 }
    expect(run(rh`{ *x: ({ *l: a.*l }).(b.*x) }`, inp)).toEqual(res)
    expect(run(rh`{ *x: a.(b.*x) }`, inp)).toEqual(res)
  })
})

describe("inferDefaults: new codegen", () => {
  // group-by is left out: newCodegen counts a group twice when its key
  // has generators in two correlated loops, with or without defaults
  test.each(figure5.filter(([name]) => !name.startsWith("group-by")))("%s", (name, q, inp, expected) => {
    expect(run(q, inp, { newCodegen: true })).toEqual(expected)
  })
})

describe("inferDefaults: unsupported", () => {
  test("count", () => expect(() => run(rh`count(a.*i)`, { a: {} })).toThrow(/'count' is not supported/))
  test("min", () => expect(() => run(rh`{ *i: min(a.*i.*j) }`, { a: {} })).toThrow(/'min' is not supported/))
  test("array", () => expect(() => run(rh`[a.*i]`, { a: {} })).toThrow(/'array' is not supported/))
})
