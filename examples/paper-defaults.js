let { rh, api } = require("../src/rhyme");

// The examples of the PLDI'27 draft as surface terms, compiled with
// { inferDefaults: true }: the pass (src/defaults.js) translates them into
// the core calculus (Figure 6). paper-core.js runs the same rows translated
// by hand, with the guards and defaults written out.
//
// Each row is labelled with its source in the paper (section, figure).
//
//   Λi.t   { *i: t }            (group *i t)
//   Σi.t   sum(t)
//   x?     *x?                  (a filter: x also has a strict generator)
//   ⊥      .bot                 (a missing input field)
//   ⟨t⟩    singleton(t)
//
// Rows marked "core" use the core loops sum? and group?, which have no
// default; the pass leaves them as they are.
//
// Rhyme variables are global to a query: two loops that use the same name
// share it, so loops that the paper writes with the same name use
// different names here. Inside a call, an input field is written .a: a
// bare a is the string "a".

let line = (tag, src, name, out, note) =>
  console.log(tag, src.padEnd(12), name.padEnd(44), out, note)

let evaluate = (q, inp) => {
  try {
    return JSON.stringify(api.compile(q, { inferDefaults: true })(inp))
  } catch (e) {
    return "ERROR: " + String(e.message).split("\n")[0]
  }
}

// a row with the paper's result
let run = (src, name, q, inp, expected) => {
  let out = evaluate(q, inp)
  let ok = out === JSON.stringify(expected)
  line(ok ? "ok  " : "DIFF", src, name, out, ok ? "" : "  expected " + JSON.stringify(expected))
}

// a term that the paper rejects as ill-grounded; Rhyme should reject it too
let rejects = (src, name, q, inp) => {
  let out = evaluate(q, inp)
  line(out.startsWith("ERROR") ? "rjct" : "DIFF", src, name, out, "")
}

// an example that cannot be run
let na = (src, name, why) => line("n/a ", src, name, "", why)

// ---------- Data ----------

let va = { 0: 1, 1: 2, 3: 4 }, vb = { 1: 10, 2: 20, 3: 30 }  // vectors
let M = [[1, 2], [3, 4]], N = [[5, 6], [7, 8]]                // matrices
let emp = [
  { name: "Alice", age: 34, salary: 120, dept: 1 },
  { name: "Bob", age: 19, salary: 40, dept: 2 },
  { name: "Carol", age: 45, salary: 150, dept: 1 },
  { name: "Dave", age: 21, salary: 60, dept: 3 },
]
let dept = [{ id: 1, mgr: "Erin" }, { id: 2, mgr: "Frank" }]
let G = { 0: { 1: true }, 1: { 2: true }, 2: { 0: true, 3: true }, 3: {} } // adjacency map
let alpha = { 0: { 1: 3 }, 1: { 2: 4 } }                     // α
let alpha1 = { 0: { 1: 3 }, 1: { 0: 4 }, 5: {} }             // α'
let A = [[0, 1, 2], [], [10, 11, 12]]                         // sparse matrix, Section 3.1
let d = [{ key: 7, val: 10 }, { key: 11, val: 5 }, { key: 7, val: 30 }]
let d1 = [{ key: 7, val: 10 }, { key: 11 }, { key: 7, val: 30 }] // d', no value 5
let delta = { 0: 1, 1: 1, 5: 1 }                              // δ, Figure 7
let num = { n5: 5, n6: 6, e: {} }                             // constants 5, 6, {}
let p = { 0: 1, 2: 1 }, a3 = { 0: 10, 1: 20, 2: 30 }          // filter p, values a


// ==================== Section 1: Introduction ====================

console.log("--- Section 1")

run("§1", "dot product", rh`sum(a.*i * b.*i)`, { a: va, b: vb }, 140)
run("§1", "matrix transpose", rh`{ *j: { *i: A.*i.*j } }`, { A: M }, { 0: { 0: 1, 1: 3 }, 1: { 0: 2, 1: 4 } })
run("§1", "row sums", rh`{ *i: sum(A.*i.*j) }`, { A: M }, { 0: 3, 1: 7 })
run("§1", "matrix multiply", rh`{ *i: { *j: sum(A.*i.*k * B.*k.*j) } }`, { A: M, B: N }, { 0: { 0: 19, 1: 22 }, 1: { 0: 43, 1: 50 } })
run("§1", "selection & projection", rh`sum((a.*i.age > 21) & a.*i.salary)`, { a: emp }, 270)
{
  let body = rh`singleton(a.*i.dept).(b.*j.id) & { emp: a.*i.name, mgr: b.*j.mgr }`
  run("§1", "nested join (Dave: no department)", rh`{ *i: { *j: ${body} } }`, { a: emp, b: dept },
    { 0: { 0: { emp: "Alice", mgr: "Erin" } }, 1: { 1: { emp: "Bob", mgr: "Frank" } }, 2: { 0: { emp: "Carol", mgr: "Erin" } }, 3: {} })
  run("§1 core", "nested join without defaults", rh`group? *i (group? *j (${body}))`, { a: emp, b: dept },
    { 0: { 0: { emp: "Alice", mgr: "Erin" } }, 1: { 1: { emp: "Bob", mgr: "Frank" } }, 2: { 0: { emp: "Carol", mgr: "Erin" } } })
}
// outer join with maybe lookups (see "outer join" below)
let outerJoin = (a, b) => rh`{ *i: (${a}.*i? + ${b}.*i?) || ${a}.*i? || ${b}.*i? }`
run("§1", "outer join (vector add)", outerJoin(rh`.a`, rh`.b`), { a: va, b: vb }, { 0: 1, 1: 12, 2: 20, 3: 34 })
na("§1", "outer join with strict lookups",
  "Rhyme intersects all strict generators of *i in a query, so a_i ∥ b_i is an inner join; outer joins use a.*i?")
run("§1", "group-by", rh`{ a.*i.dept: sum(a.*i.salary) }`, { a: emp }, { 1: 270, 2: 40, 3: 60 })
// Rhyme binds the three variables in one loop (the nearest enclosing aggregate)
run("§1", "triangle counting", rh`sum(G.*i.*j & G.*j.*k & G.*k.*i & 1)`, { G }, 3)
na("§1", "min-plus product", "inferDefaults supports sum and group only (min has no default, Section 5.2)")


// ==================== Section 2: Values, Folds, and a Core Calculus ====================

console.log("--- Section 2")

run("§2.2", "Λi.(a_i + b_i), inner join", rh`{ *i: a.*i + b.*i }`, { a: va, b: vb }, { 1: 12, 3: 34 })
// Rhyme binds j at the outer sum only if j occurs outside the inner one,
// so we write j & a_{s_j}, which has the same value
run("§2.3 core", "Σj.a_{s_j}", rh`sum? (*j & a.(sum? (a.*j & a.*i & 0)))`, { a: [1] }, 1)
run("§2.3", "Σj.a_{s_j}, with defaults", rh`sum(*j & a.(sum(a.*j & a.*i & 0)))`, { a: [1] }, 1)


// ==================== Section 3.1: Empty or Absent? ====================

console.log("--- Section 3.1")

run("§3.1 core", "row sums of A drop row 1", rh`group? *i (sum? A.*i.*j)`, { A }, { 0: 3, 2: 33 })
run("§3.1 core", "copy of A drops row 1", rh`group? *i (group? *j A.*i.*j)`, { A },
  { 0: { 0: 0, 1: 1, 2: 2 }, 2: { 0: 10, 1: 11, 2: 12 } })


// ==================== Section 3.2: The Filtering Semantics, Figure 5 ====================

console.log("--- Section 3.2, Figure 5")

run("Fig. 5", "Λi.a_i on {}", rh`{ *i: a.*i }`, { a: {} }, {})
run("Fig. 5 §3.2", "Λi.a_i on 5", rh`{ *i: a.*i }`, { a: 5 }, 5)
run("Fig. 5 §3.3", "row sums", rh`{ *i: sum(A.*i.*j) }`, { A }, { 0: 3, 1: 0, 2: 33 })
run("Fig. 5", "copy A", rh`{ *i: { *j: a.*i.*j } }`, { a: A }, { 0: { 0: 0, 1: 1, 2: 2 }, 1: {}, 2: { 0: 10, 1: 11, 2: 12 } })
run("Fig. 5 §1.1", "copy JSON", rh`{ *i: { *j: a.*i.*j } }`, { a: { 0: 5, 1: { 1: 1, 2: 2 } } }, { 0: 5, 1: { 1: 1, 2: 2 } })
{
  let q = rh`{ *i: { *j: a.*i.*j & b.*i.*j } }`
  run("Fig. 5 §3.2", "deep intersection", q, { a: { 0: 5, 1: 6 }, b: { 0: 5, 2: 6 } }, { 0: 5 })
  run("§3.2", "deep intersection, 5 vs 6", q, { a: { 0: 5 }, b: { 0: 6 } }, {})
  run("§3.2", "deep intersection, maps", q, { a: { 0: { 1: 2 } }, b: { 0: { 3: 2 } } }, { 0: {} })
}
run("Fig. 5 §3.1", "Σi.(a_i & ⊥)", rh`sum(a.*i & .bot)`, { a: alpha }, 0)
run("Fig. 5 §3.1", "Σj.a_{j,9}", rh`sum(a.*j.(9))`, { a: alpha }, 0)
run("Fig. 5", "Λi.(a_i =? 5) on {1: 7}", rh`{ *i: singleton(a.*i).(5) }`, { a: { 1: 7 } }, {})
run("Fig. 5 §3.2 §5", "Λi.(a_i =? 5) on 7", rh`{ *i: singleton(a.*i).(5) }`, { a: 7 }, 7)
{
  let q = rh`{ *i: sum(a.*j.*i) }`
  run("Fig. 5 §3.3", "column sums on α", q, { a: alpha }, { 1: 3, 2: 4 })
  run("Fig. 5", "column sums on {0: {}}", q, { a: { 0: {} } }, {})
  run("Fig. 5", "column sums on {}", q, { a: {} }, undefined)
}
run("Fig. 5 §3.2", "Λi.(a_i & Σj.a_{j,i})", rh`{ *i: a.*i & sum(a.*j.*i) }`, { a: alpha1 }, { 0: 4, 1: 3 })
run("Fig. 5 §3.2", "Λi.(a_i & Σj.a_{j,i?})", rh`{ *i: a.*i & sum(a.*j.*i?) }`, { a: alpha1 }, { 0: 4, 1: 3, 5: 0 })
run("Fig. 5", "diagonal on {}", rh`{ *i: a.*i.*i }`, { a: {} }, undefined)
run("Fig. 5", "diagonal on {0: {1: 7}}", rh`{ *i: a.*i.*i }`, { a: { 0: { 1: 7 } } }, undefined)
run("Fig. 5", "diagonal filter on {}", rh`{ *i: a.*i.*i? }`, { a: {} }, {})
run("Fig. 5", "diagonal filter on {0: {1: 7}}", rh`{ *i: a.*i.*i? }`, { a: { 0: { 1: 7 } } }, {})
// Rhyme's { e: t } is read as Λk.(⟨e⟩_k & t), with the filter moved into the sum that binds i
{
  let q = rh`{ a.*i.key: sum(a.*i.val) }`
  run("Fig. 5", "group-by on d", q, { a: d }, { 7: 40, 11: 5 })
  run("Fig. 5 §5.3", "group-by on d'", q, { a: d1 }, { 7: 40, 11: 0 })
  run("Fig. 5 §5.3", "group-by on {}", q, { a: {} }, undefined)
}
// Rhyme's singleton stores the key as a string: { 1: "1" }, not { 1: 1 }
run("Fig. 5 §3.3", "Λm.Λi.(a_i & ⟨i⟩_m)", rh`{ *m: { *i: a.*i & singleton(*i).*m } }`, { a: { 1: 5, 2: 6 } }, { 1: { 1: "1" }, 2: { 2: "2" } })


// ==================== Section 3.2: Generators, Shapes and Numbers ====================

console.log("--- Section 3.2")

{
  let q = rh`{ *i: a.*i? || b.*i? }`
  run("§3.2", "Λi.(a_i ∥ b_i)", q, { a: { 0: 1 }, b: { 1: 2 } }, { 0: 1, 1: 2 })
  run("§3.2", "Λi.(a_i ∥ b_i), a = {}, b = ⊥", q, { a: {} }, {})
  run("§3.2", "Λi.(a_i ∥ b_i), a = b = ⊥", q, {}, undefined)
}
run("§3.2", "Λi.(5_i & 6_i)", rh`{ *i: n5.*i & n6.*i }`, num, undefined)
run("§3.2", "Λi.({}_i & 5_i)", rh`{ *i: e.*i & n5.*i }`, num, undefined)
run("§3.2", "Λi.(asfun(a)_i =? 5) on 7", rh`{ *i: singleton(asObj(.a).*i).(5) }`, { a: 7 }, undefined)
run("§3.2", "Λi.((asfun(a) ∥ {})_i =? 5) on 7", rh`{ *i: singleton((asObj(.a) || {}).*i).(5) }`, { a: 7 }, {})
run("§3.2", "Λi.(asfun(a)_i =? 5) on a map", rh`{ *i: singleton(asObj(.a).*i).(5) }`, { a: { 1: 5, 2: 7 } }, { 1: 5 })
run("§3.2 §5.2", "Σi.5_i", rh`sum(n5.*i)`, num, undefined)


// ==================== Section 3.3: Translating Defaults ====================

console.log("--- Section 3.3")

na("§3.3 §4.2", "simpler variant: Λj.t_j on 5", "inferDefaults implements the translation with shapes, not the simpler variant")
na("§3.3", "simpler variant: Λj.t_j on {}", "inferDefaults implements the translation with shapes, not the simpler variant")
// row sums, column sums, Λm.Λi: see Figure 5


// ==================== Section 4.2-4.3: η and Congruence ====================

console.log("--- Section 4.2, 4.3")

run("§4.3", "Λi.⊥_i", rh`{ *i: .bot.*i }`, num, undefined)
run("§4.3", "Λi.{}_i", rh`{ *i: e.*i }`, num, {})
run("§4.3", "key i", rh`{ *i: a.*i & sum(a.*j.*i) }`, { a: alpha1 }, { 0: 4, 1: 3 })
run("§4.3", "key i & i", rh`{ *i: a.*i & sum(a.*j.(*i & *i)) }`, { a: alpha1 }, { 0: 4, 1: 3, 5: 0 })
run("§4.3", "Λi.(6_i & 5_i)", rh`{ *i: n6.*i & n5.*i }`, num, undefined)
run("§4.3", "Λi.(⊥ & 6_i)", rh`{ *i: .bot & n6.*i }`, num, 6)
run("§4.3", "Λi.(5_i & ({}_i & ⊥))", rh`{ *i: n5.*i & (e.*i & .bot) }`, num, undefined)
run("§4.3", "Λi.(5_i & ⊥)", rh`{ *i: n5.*i & .bot }`, num, 5)


// ==================== Section 4.4: Unrestricted β Is Incompatible with Defaults ====================

console.log("--- Section 4.4")

run("§4.4 Fig. 7", "(Λi.Σj.a_{j,i})_9", rh`({ *i: sum(a.*j.*i) }).(9)`, { a: alpha }, undefined)
run("§4.4 Fig. 7", "Σj.a_{j,9}", rh`sum(a.*j.(9))`, { a: alpha }, 0)
run("§4.4 §1.1", "double transposition: R", rh`({ *i: { *j: ({ *l: A.*l.*j }).*i } }).(1)`, { A }, undefined)
run("§4.4 §1.1", "double transposition: S", rh`({ *i: { *j: A.*i.*j } }).(1)`, { A }, {})
{
  let rows02 = { 0: { 0: 0, 1: 1, 2: 2 }, 2: { 0: 10, 1: 11, 2: 12 } }
  run("§4.4 core", "(A^T)^T", rh`group? *i (group? *j (group? *j2 (group? *i2 A.*i2.*j2)).*j.*i)`, { A }, rows02)
  run("§4.4", "(A^T)^T, with defaults", rh`{ *i: { *j: ({ *j2: { *i2: A.*i2.*j2 } }).*j.*i } }`, { A }, rows02)
}


// ==================== Section 4.5: Where β Holds, Figure 7 ====================

console.log("--- Section 4.5, Figure 7")

run("§4.5", "(Λi.Σj.a_{i,j})_0", rh`({ *i: sum(a.*i.*j) }).(0)`, { a: alpha }, 3)
run("§4.5", "Σj.a_{0,j}", rh`sum(a.(0).*j)`, { a: alpha }, 3)
run("§4.5", "(Λi.Σj.a_{i,j})_9", rh`({ *i: sum(a.*i.*j) }).(9)`, { a: alpha }, undefined)
run("§4.5", "Σj.a_{9,j}", rh`sum(a.(9).*j)`, { a: alpha }, undefined)
run("Fig. 7 (C1)", "outer product: redex", rh`{ *i: { *j: ({ *l: a.*l * b.*j }).*i } }`, { a: [1, 2], b: {} }, undefined)
run("Fig. 7 (C1)", "outer product: reduct", rh`{ *i: { *j: a.*i * b.*j } }`, { a: [1, 2], b: {} }, { 0: {}, 1: {} })
run("Fig. 7 (C2)", "nested: redex", rh`({ *i: sum(d.*j & sum(a.*i.*k)) }).(5)`, { a: alpha, d: delta }, undefined)
run("Fig. 7 (C2)", "nested: reduct", rh`sum(d.*j & sum(a.(5).*k))`, { a: alpha, d: delta }, 0)
run("Fig. 7 (C3) §4.5", "redex", rh`{ *m: ({ *i: a.*i & singleton(*i).*m }).(0) }`, { a: {} }, undefined)
run("Fig. 7 (C3) §4.5", "reduct", rh`{ *m: a.(0) & singleton(0).*m }`, { a: {} }, {})
run("Fig. 7 (C4)", "redex", rh`{ *x: ({ *i: (a.*i & n5.*x) || (a.*i & n6.*x) }).(n6.*x) }`, { a: {}, ...num }, undefined)
run("Fig. 7 (C4)", "reduct", rh`{ *x: (a.(n6.*x) & n5.*x) || (a.(n6.*x) & n6.*x) }`, { a: {}, ...num }, 6)
run("Fig. 7 (C5)", "redex", rh`{ *x: ({ *i: { *y: { *j: a.*j.*x & b.*i.*y } } }).(n5.*x) }`, { a: { 0: 7 }, b: {}, ...num }, 5)
run("Fig. 7 (C5)", "reduct", rh`{ *x: { *y: { *j: a.*j.*x & b.(n5.*x).*y } } }`, { a: { 0: 7 }, b: {}, ...num }, {})
{
  let c = { 0: 1, 1: 2 }
  let redex = rh`{ *x: ({ *i: c.*i & d.*x }).*x? }`
  let reduct = rh`{ *x: c.*x? & d.*x }`
  run("§4.5", "non-grounded reduct: redex", redex, { c, d: { 0: 5, 2: 6 } }, { 0: 5 })
  run("§4.5", "non-grounded reduct: reduct", reduct, { c, d: { 0: 5, 2: 6 } }, { 0: 5 })
  run("§4.5", "non-grounded reduct: redex, d = {}", redex, { c, d: {} }, {})
  run("§4.5", "non-grounded reduct: reduct, d = {}", reduct, { c, d: {} }, {})
}
{
  let a = { 0: 1, 1: 3, 3: 0 }
  run("§4.5", "(Λl.a_l)_{a_x}: redex", rh`{ *x: ({ *l: a.*l }).(a.*x) }`, { a }, { 0: 3, 1: 0, 3: 1 })
  run("§4.5", "(Λl.a_l)_{a_x}: reduct", rh`{ *x: a.(a.*x) }`, { a }, { 0: 3, 1: 0, 3: 1 })
  let b = { 0: 1, 1: 2, 2: 5 }
  run("§4.5", "(Λl.Σj.a_{l,j})_{b_x}: redex", rh`{ *x: ({ *l: sum(a.*l.*j) }).(b.*x) }`, { a: A, b }, { 0: 0, 1: 33 })
  run("§4.5", "(Λl.Σj.a_{l,j})_{b_x}: reduct", rh`{ *x: sum(a.(b.*x).*j) }`, { a: A, b }, { 0: 0, 1: 33 })
}


// ==================== Section 5: Expressiveness and Design Space ====================

console.log("--- Section 5")

// the two sums use different names, since Rhyme would share one variable
{
  let q = rh`singleton(sum(a.*i & 1)).(sum(a.*j & (a.*j > 3) & 1))`
  run("§5.1", "∀ holds", q, { a: { 0: 5, 1: 7 } }, 2)
  run("§5.1", "∀ fails", q, { a: { 0: 5, 1: 2 } }, undefined)
  run("§5.1", "∀ on {}", q, { a: {} }, 0)
  run("§5.1 core", "∀ on {}", rh`singleton(sum? (a.*i & 1)).(sum? (a.*j & (a.*j > 3) & 1))`, { a: {} }, undefined)
}
{
  let not = t => rh`singleton(0).(sum(singleton(0).*x & ${t} & 1))`
  run("§5.1", "¬⊥", not(rh`.bot`), {}, 0)
  run("§5.1", "¬1", not(rh`1`), {}, undefined)
  run("§5.1 core", "¬⊥", rh`singleton(0).(sum? (singleton(0).*x & .bot & 1))`, {}, undefined)
  let inp = { d: { 0: 1, 1: 1 }, a: { 0: 1 } }
  run("§5.1", "Λy.(d_y & ¬a_y)", rh`{ *y: d.*y & ${not(rh`a.*y`)} }`, inp, {})
  run("§5.1", "Λy.(d_y & ¬a_{y?})", rh`{ *y: d.*y & ${not(rh`a.*y?`)} }`, inp, { 1: 0 })
}
run("§5.1", "outer join of {} and {}", outerJoin(rh`.a`, rh`.b`), { a: {}, b: {} }, {})
run("§5.1", "outer join of {} and ⊥", outerJoin(rh`.a`, rh`.b`), { a: {} }, {})
run("§5.1", "outer join of ⊥ and ⊥", outerJoin(rh`.a`, rh`.b`), {}, undefined)
run("§5.1 core", "outer join of {} and {}", rh`group? *i ((a.*i? + b.*i?) || a.*i? || b.*i?)`, { a: {}, b: {} }, undefined)
run("§5.1 §3.2", "outer join of 5 and 6", outerJoin(rh`.a`, rh`.b`), { a: 5, b: 6 }, 5)
run("§5.1", "outer join of 5 and {}", outerJoin(rh`.a`, rh`.b`), { a: 5, b: {} }, 5)
run("§5.1", "outer join of asfun 5, asfun 6", outerJoin(rh`asObj(.a)`, rh`asObj(.b)`), { a: 5, b: 6 }, undefined)
run("§5.1", "outer join of asfun 5, asfun {}", outerJoin(rh`asObj(.a)`, rh`asObj(.b)`), { a: 5, b: {} }, {})
na("§5.2 core", "min over an empty collection", "inferDefaults supports sum and group only")
na("§5.2", "∃", "Rhyme has no existential fold")
na("§5.2", "products default to 1", "not part of the translation (Figure 6 covers Σ and Λ)")
na("§5.2", "order-sensitive folds, efficiency", "no examples")
na("§5.3", "SQL", "see the group-by on d' and on {} (Figure 5)")
