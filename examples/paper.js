let { rh, api } = require("../src/rhyme");

// The examples of the PLDI'27 draft (Nursery Rhyme), lowered by hand into
// the base calculus. This follows the current paper, in which defaults are
// the constants 0 and {} and every guard type-tests the prefixes of the
// loop variable's generators with asfun (paper-core.js is the earlier
// version with shapes).
//
// Each row is labelled with its source in the paper (section, figure).
// A surface term t is run as its lowering L(t) of Figure 6, written with
// base-calculus constructs only:
//
//   Λi.t   group? *i t          (no default: ⊥ if empty)
//   Σi.t   sum? t               (no default: ⊥ if empty)
//   t1 ∥ t2, t1 & t2            ||, &
//   asfun t                     asObj(t)
//   ⟨t⟩                         singleton(t)
//   x?  (= 1 & x)               *x?  (a filter: x also has a strict generator)
//   ⊥                           .bot (a missing input field)
//
// L(Σi.t) = Σi.X ∥ (G & 0) and L(Λi.t) = Λi.X ∥ (G & {}), where X = L(t)
// and G = G_i(X); the comments give G. Conjuncts 1 of a domain check are
// left out. Input maps are input fields, so like constants their own
// domain check is 1. Rows marked "core" are base-calculus terms, run
// without lowering.
//
// Rhyme variables are global to a query: two folds that use the same name
// share it. Guards that bind a loop variable themselves (when it must take
// real keys) therefore use fresh names (*i1, *j2, ...), and so do folds
// that the paper writes with the same name.
//
// Inside a call, an input field is written .a: a bare a is the string "a".

let line = (tag, src, name, out, note) =>
  console.log(tag, src.padEnd(16), name.padEnd(50), out, note)

let evaluate = (q, inp) => {
  try {
    return JSON.stringify(api.compile(q)(inp))
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
let Dm = { 0: { 0: 0, 1: 4, 2: 1 }, 1: { 1: 0 }, 2: { 1: 2, 2: 0 } }     // edge weights
let alpha = { 0: { 1: 3 }, 1: { 2: 4 } }                     // α
let alpha1 = { 0: { 1: 3 }, 1: { 0: 4 }, 5: {} }             // α'
let A = [[0, 1, 2], [], [10, 11, 12]]                         // sparse matrix, Section 3.1
let d = [{ key: 7, val: 10 }, { key: 11, val: 5 }, { key: 7, val: 30 }]
let d1 = [{ key: 7, val: 10 }, { key: 11 }, { key: 7, val: 30 }] // d', no value 5
let delta = { 0: 1, 1: 1, 5: 1 }                              // δ, Figure 7
let p = { 0: 1, 2: 1 }, a3 = { 0: 10, 1: 20, 2: 30 }          // filter p, values a


// ==================== Section 1: Introduction ====================

console.log("--- Section 1")

// Σi.(a_i * b_i): G = asfun(a) & asfun(b)
run("§1", "dot product", rh`(sum? (a.*i * b.*i)) || ((asObj(.a) & asObj(.b)) & 0)`, { a: va, b: vb }, 140)

// Λj.Λi.A_{i,j}
// Λi: A_{i,j} is a generator of the outer j whose prefix mentions i:
//   G = Λi1.A_{i1,j}
// Λj: the generator of j reduces to asfun(A_i), which mentions i:
//   G = Λi2.asfun(A_{i2})
run("§1", "matrix transpose",
  rh`(group? *j ((group? *i A.*i.*j) || ((group? *i1 A.*i1.*j) & {}))) || ((group? *i2 asObj(A.*i2)) & {})`,
  { A: M }, { 0: { 0: 1, 1: 3 }, 1: { 0: 2, 1: 4 } })

// Λi.Σj.A_{i,j}: Σj: G = asfun(A_i); Λi: G = asfun(A)
let rowSums = rh`(group? *i ((sum? A.*i.*j) || (asObj(A.*i) & 0))) || (asObj(.A) & {})`
run("§1", "row sums", rowSums, { A: M }, { 0: 3, 1: 7 })

// Λi.Λj.Σk.(A_{i,k} * B_{k,j})
// Σk: B_{k,j} is a generator of the outer j whose prefix mentions k:
//   G = Λk1.(A_{i,k1} & B_{k1,j})
// Λj: G = Λk2.(A_{i,k2} & asfun(B_{k2}))
// Λi: G = asfun(A)
run("§1", "matrix multiply",
  rh`(group? *i ((group? *j ((sum? (A.*i.*k * B.*k.*j)) || ((group? *k1 (A.*i.*k1 & B.*k1.*j)) & 0)))
                  || ((group? *k2 (A.*i.*k2 & asObj(B.*k2))) & {})))
     || (asObj(.A) & {})`,
  { A: M, B: N }, { 0: { 0: 19, 1: 22 }, 1: { 0: 43, 1: 50 } })

// Σi.((a_{i,age} > 21) & a_{i,salary}): G = asfun(a)
run("§1", "selection & projection",
  rh`(sum? ((a.*i.age > 21) & a.*i.salary)) || (asObj(.a) & 0)`, { a: emp }, 270)

// Λi.Λj.(⟨a_{i,dept}⟩_{b_{j,id}} & {emp ↦ a_{i,name}, mgr ↦ b_{j,mgr}})
// Λj: the lookups on the outer i are kept: G = a_i & asfun(b)
// Λi: G = asfun(a)
{
  let body = rh`(singleton(a.*i.dept).(b.*j.id) & { emp: a.*i.name, mgr: b.*j.mgr })`
  let q = rh`(group? *i ((group? *j ${body}) || ((a.*i & asObj(.b)) & {}))) || (asObj(.a) & {})`
  run("§1", "nested join (Dave: no department)", q, { a: emp, b: dept },
    { 0: { 0: { emp: "Alice", mgr: "Erin" } }, 1: { 1: { emp: "Bob", mgr: "Frank" } }, 2: { 0: { emp: "Carol", mgr: "Erin" } }, 3: {} })
  run("§1 core", "nested join without defaults", rh`group? *i (group? *j ${body})`, { a: emp, b: dept },
    { 0: { 0: { emp: "Alice", mgr: "Erin" } }, 1: { 1: { emp: "Bob", mgr: "Frank" } }, 2: { 0: { emp: "Carol", mgr: "Erin" } } })
}

// Λi.((a_i + b_i) ∥ a_i ∥ b_i): G = (asfun(a) & asfun(b)) ∥ asfun(a) ∥ asfun(b)
// Rhyme intersects all strict generators of *i in a query, so a_i ∥ b_i
// with strict lookups would be an inner join; maybe lookups are its outer
// join, which is what the paper's ∥ of generators computes.
let outerJoin = rh`(group? *i ((a.*i? + b.*i?) || a.*i? || b.*i?))
  || (((asObj(.a) & asObj(.b)) || asObj(.a) || asObj(.b)) & {})`
run("§1 §2.2", "outer join (vector add)", outerJoin, { a: va, b: vb }, { 0: 1, 1: 12, 2: 20, 3: 34 })

// group-by { a_{i,key} ↦ Σi.a_{i,val} } = Λk.Σi.(⟨a_{i,key}⟩_k & a_{i,val})
// Σi: ⟨a_{i,key}⟩_k is a generator of the outer k whose prefix mentions i:
//   G = Λi1.(⟨a_{i1,key}⟩_k & a_{i1})
// Λk: the generator of k reduces to asfun(⟨a_{i,key}⟩), which mentions i:
//   G = Λi2.(asfun(⟨a_{i2,key}⟩) & a_{i2})
let groupBy = (key, val) => rh`(group? *k ((sum? (singleton(a.*i.${key}).*k & a.*i.${val}))
    || ((group? *i1 (singleton(a.*i1.${key}).*k & a.*i1)) & 0)))
  || ((group? *i2 (asObj(singleton(a.*i2.${key})) & a.*i2)) & {})`
run("§1", "group-by", groupBy("dept", "salary"), { a: emp }, { 1: 270, 2: 40, 3: 60 })

// Σi.Σj.Σk.(G_{i,j} & G_{j,k} & G_{k,i} & 1). Rhyme binds the three
// variables in one fold, so this is Σ_{i,j,k}. Its domain check with
// I = {i,j,k} mentions the loop variables, so they must take real keys:
// G = Λi1.Λj1.Λk1.(G_{i1,j1} & G_{j1,k1} & G_{k1,i1}).
run("§1", "triangle counting",
  rh`(sum? (G.*i.*j & G.*j.*k & G.*k.*i & 1)) || ((group? *i1 (group? *j1 (group? *k1 (G.*i1.*j1 & G.*j1.*k1 & G.*k1.*i1)))) & 0)`,
  { G }, 3)

// Λi.Λj.min_k.(D_{i,k} + D_{k,j}): min has no default (Section 5.2), so it
// stays a base-calculus fold; the tabulations get defaults:
// Λj: G = Λk1.(D_{i,k1} & asfun(D_{k1})); Λi: G = asfun(D)
run("§1", "Bellman-Ford step",
  rh`(group? *i ((group? *j (min? (D.*i.*k + D.*k.*j))) || ((group? *k1 (D.*i.*k1 & asObj(D.*k1))) & {})))
     || (asObj(.D) & {})`,
  { D: Dm }, { 0: { 0: 0, 1: 3, 2: 1 }, 1: { 1: 0 }, 2: { 1: 2, 2: 0 } })

// Section 1.1: composition of lookups, Λx.(Λl.a_l)_{b_x} ≡ Λx.a_{b_x}
// (data of Section 4.4)
// redex: Λl: G = asfun(a); Λx: G = asfun(b)
// reduct: Λx: G = asfun(b)
{
  let b = { 0: 1, 1: 3, 2: 2, 4: 0 }, a = { 0: 10, 1: 11, 3: 13 }
  let res = { 0: 11, 1: 13, 4: 10 }
  run("§1.1 §4.4", "composition: redex",
    rh`(group? *x ((group? *l a.*l) || (asObj(.a) & {})).(b.*x)) || (asObj(.b) & {})`, { a, b }, res)
  run("§1.1 §4.4", "composition: reduct", rh`(group? *x a.(b.*x)) || (asObj(.b) & {})`, { a, b }, res)
}

// Section 1.1: a filter that always holds does not change a collection,
// Λi.(1 & a_i) = a, also when a is empty: G = asfun(a)
{
  let q = rh`(group? *i (1 & a.*i)) || (asObj(.a) & {})`
  run("§1.1", "Λi.(1 & a_i) on {}", q, { a: {} }, {})
  run("§1.1", "Λi.(1 & a_i) on {0: 1}", q, { a: { 0: 1 } }, { 0: 1 })
  run("§1.1 core", "Λi.(1 & a_i) on {}", rh`group? *i (1 & a.*i)`, { a: {} }, undefined)
}

// Section 1.1: (Λi.Σj.(a_j & b_i))_⊥ = ⊥, but Σj.(a_j & b_⊥) = 0
// redex: Σj: G = asfun(a) & b_i; Λi: G = asfun(b)
// reduct: Σj: b_⊥ is a filter, G = asfun(a)
{
  let inp = { a: { 0: 1 }, b: { 0: 2 } }
  run("§1.1", "(Λi.Σj.(a_j & b_i))_⊥",
    rh`((group? *i ((sum? (a.*j & b.*i)) || ((asObj(.a) & b.*i) & 0))) || (asObj(.b) & {})).(.bot)`, inp, undefined)
  run("§1.1", "Σj.(a_j & b_⊥)", rh`(sum? (a.*j & b.(.bot))) || (asObj(.a) & 0)`, inp, 0)
}


// ==================== Section 2: Values, Folds, and a Base Calculus ====================

console.log("--- Section 2")

// Figure 1: Σi.(1 + (p_i & a_i)) under the relational reading: G = asfun(p) & asfun(a)
run("§2.2 Fig. 1", "Σi.(1 + (p_i & a_i))", rh`(sum? (1 + (p.*i & a.*i))) || ((asObj(.p) & asObj(.a)) & 0)`,
  { p, a: a3 }, 42)

// Λi.(a_i + b_i): strict +, entries only where both vectors have one
// G = asfun(a) & asfun(b)
run("§2.2", "Λi.(a_i + b_i), inner join",
  rh`(group? *i (a.*i + b.*i)) || ((asObj(.a) & asObj(.b)) & {})`, { a: va, b: vb }, { 1: 12, 3: 34 })

// Σj.a_{s_j}, s_j = Σi.(a_j & a_i & 0), a = {0 ↦ 1}. Rhyme binds j at the
// outer sum only if j occurs outside the inner one, so we write j & a_{s_j},
// which has the same value.
run("§2.3 core", "Σj.a_{s_j}", rh`sum? (*j & a.(sum? (a.*j & a.*i & 0)))`, { a: [1] }, 1)
// Σi: G = a_j & asfun(a); Σj: G = asfun(a)
run("§2.3", "Σj.a_{s_j}, with defaults",
  rh`(sum? (*j & a.((sum? (a.*j & a.*i & 0)) || ((a.*j & asObj(.a)) & 0)))) || (asObj(.a) & 0)`, { a: [1] }, 1)

// Proposition 2.10: no η in the base calculus
run("§2.6 core", "Λj.{}_j", rh`group? *j a.*j`, { a: {} }, undefined)


// ==================== Section 3.1: Empty or Absent? ====================

console.log("--- Section 3.1")

run("§3.1 core", "row sums of A drop row 1", rh`group? *i (sum? A.*i.*j)`, { A }, { 0: 3, 2: 33 })
run("§3.1 core", "copy of A drops row 1", rh`group? *i (group? *j A.*i.*j)`, { A },
  { 0: { 0: 0, 1: 1, 2: 2 }, 2: { 0: 10, 1: 11, 2: 12 } })

na("§3.1", "a constant guard; a guard on existing prefixes", "these diverge (Σj.a_{s_j}, the column sums)")
na("§3.1", "a guard on possible success", "an alternative guard, not the lowering of Figure 6")

// i = 9 bound by the environment: Σj.a_{j,i} is ⊥, Σj.a_{j,9} and
// Σj.a_{j,i?} are 0. Rhyme has no environment, so i is bound by a
// base-calculus fold over ⟨9⟩, and we look at its entry at 9.
// Σj.a_{j,i}: G = Λj1.a_{j1,i}; Σj.a_{j,i?}, Σj.a_{j,9}: G = asfun(a)
{
  let env = t => rh`(group? *i (singleton(9).*i & ${t})).(9)`
  run("§3.1", "Σj.a_{j,i}, i = 9", env(rh`((sum? a.*j.*i) || ((group? *j1 a.*j1.*i) & 0))`), { a: alpha }, undefined)
  run("§3.1", "Σj.a_{j,i?}, i = 9", env(rh`((sum? a.*j.*i?) || (asObj(.a) & 0))`), { a: alpha }, 0)
  run("§3.1", "Σj.a_{j,9}", rh`(sum? a.*j.(9)) || (asObj(.a) & 0)`, { a: alpha }, 0)
}


// ==================== Section 3.2: The Filtering Semantics, Figure 5 ====================

console.log("--- Section 3.2, Figure 5")

// Λi.a_i: G = asfun(a)
{
  let q = rh`(group? *i a.*i) || (asObj(.a) & {})`
  run("Fig. 5", "Λi.a_i on {}", q, { a: {} }, {})
  run("Fig. 5", "Λi.a_i on 5", q, { a: 5 }, undefined)
}

// row sums: Σj: G = asfun(A_i); Λi: G = asfun(A)
run("Fig. 5", "row sums", rowSums, { A }, { 0: 3, 1: 0, 2: 33 })

// Σi.(a_i & ⊥), Σj.a_{j,9}: G = asfun(a)
run("Fig. 5", "Σi.(a_i & ⊥)", rh`(sum? (a.*i & .bot)) || (asObj(.a) & 0)`, { a: alpha }, 0)
run("Fig. 5", "Σj.a_{j,9}", rh`(sum? a.*j.(9)) || (asObj(.a) & 0)`, { a: alpha }, 0)

// column sums Λi.Σj.a_{j,i} (Section 3.3, Examples)
// Σj: a_{j,i} is a generator of the outer i, kept, and mentions j:
//   G = Λj1.a_{j1,i}
// Λi: the generator of i reduces to asfun(a_j), which mentions j:
//   G = Λj2.asfun(a_{j2})
let colSums = rh`(group? *i ((sum? a.*j.*i) || ((group? *j1 a.*j1.*i) & 0))) || ((group? *j2 asObj(a.*j2)) & {})`
run("Fig. 5 §3.3", "column sums on α", colSums, { a: alpha }, { 1: 3, 2: 4 })
run("Fig. 5", "column sums on {0: {}}", colSums, { a: { 0: {} } }, {})
run("Fig. 5", "column sums on {}", colSums, { a: {} }, undefined)

// Λi.(a_i & Σj.a_{j,i}): Σj as in the column sums;
// Λi: G = asfun(a) & Λj2.asfun(a_{j2})
let rowsCols = rh`(group? *i (a.*i & ((sum? a.*j.*i) || ((group? *j1 a.*j1.*i) & 0))))
  || ((asObj(.a) & (group? *j2 asObj(a.*j2))) & {})`
run("Fig. 5", "Λi.(a_i & Σj.a_{j,i})", rowsCols, { a: alpha1 }, { 0: 4, 1: 3 })
// Λi.(a_i & Σj.a_{j,i?}): Σj: G = asfun(a); Λi: G = asfun(a)
let rowsColsF = rh`(group? *i (a.*i & ((sum? a.*j.*i?) || (asObj(.a) & 0)))) || (asObj(.a) & {})`
run("Fig. 5", "Λi.(a_i & Σj.a_{j,i?})", rowsColsF, { a: alpha1 }, { 0: 4, 1: 3, 5: 0 })

// diagonal Λi.a_{i,i}: the generator's prefix a_i mentions i:
//   G = Λi1.a_{i1,i1}
run("Fig. 5", "Λi.a_{i,i}", rh`(group? *i a.*i.*i) || ((group? *i1 a.*i1.*i1) & {})`,
  { a: { 0: { 1: 7 } } }, undefined)
// Λi.a_{i,i?}: G = asfun(a)
run("Fig. 5", "Λi.a_{i,i?}", rh`(group? *i a.*i.*i?) || (asObj(.a) & {})`,
  { a: { 0: { 1: 7 } } }, {})

// group-by Λk.Σi.(⟨a_{i,key}⟩_k & a_{i,val})
run("Fig. 5", "group-by on d", groupBy("key", "val"), { a: d }, { 7: 40, 11: 5 })
run("Fig. 5 §5.3", "group-by on d'", groupBy("key", "val"), { a: d1 }, { 7: 40, 11: 0 })
run("Fig. 5", "group-by on {}", groupBy("key", "val"), { a: {} }, undefined)

// Λm.Λi.(a_i & ⟨i⟩_m) (Section 3.3, Variables That Must Take Real Keys)
// Λi: ⟨i⟩_m is a generator of the outer m, kept, and mentions i:
//   G = Λi1.(a_{i1} & ⟨i1⟩_m)
// Λm: the generator of m reduces to asfun(⟨i⟩), which mentions i:
//   G = Λi2.(a_{i2} & asfun(⟨i2⟩))
// Rhyme's singleton stores the key as a string: { 1: "1" }, not { 1: 1 }.
run("Fig. 5 §3.3", "Λm.Λi.(a_i & ⟨i⟩_m)",
  rh`(group? *m ((group? *i (a.*i & singleton(*i).*m)) || ((group? *i1 (a.*i1 & singleton(*i1).*m)) & {})))
     || ((group? *i2 (a.*i2 & asObj(singleton(*i2)))) & {})`,
  { a: { 1: 5, 2: 6 } }, { 1: { 1: "1" }, 2: { 2: "2" } })

// Section 3.2, Generators and Filters: Λi.(a_i ∥ b_i) ranges over the
// keys of a and of b (with maybe lookups, see the outer join):
// G = asfun(a) ∥ asfun(b)
run("§3.2", "Λi.(a_i ∥ b_i)", rh`(group? *i (a.*i? || b.*i?)) || ((asObj(.a) || asObj(.b)) & {})`,
  { a: { 0: 1 }, b: { 1: 2 } }, { 0: 1, 1: 2 })


// ==================== Section 4.2: Congruence and η ====================

console.log("--- Section 4.2")

// Λi.⊥_i vs Λi.{}_i: G = asfun(⊥) / asfun({})
run("§4.2", "Λi.⊥_i", rh`(group? *i .bot.*i) || (asObj(.bot) & {})`, {}, undefined)
run("§4.2", "Λi.{}_i", rh`(group? *i e.*i) || (asObj(.e) & {})`, { e: {} }, {})

// the key i vs i & i in Λi.(a_i & Σj.a_{j,[·]}) on α': a_{j,(i & i)} is a
// filter, lowered like a_{j,i?}
run("§4.2", "key i", rowsCols, { a: alpha1 }, { 0: 4, 1: 3 })
run("§4.2", "key i & i",
  rh`(group? *i (a.*i & ((sum? a.*j.(*i & *i)) || (asObj(.a) & 0)))) || (asObj(.a) & {})`,
  { a: alpha1 }, { 0: 4, 1: 3, 5: 0 })

// Theorem 4.5: asfun(t) ≈ Λj.asfun(t)_j; the guard is asfun(asfun(t))
{
  let eta = rh`(group? *j asObj(.t).*j) || (asObj(asObj(.t)) & {})`
  for (let t of [{}, { 0: 1, 2: { 3: 4 } }, 5])
    run("§4.2 Thm 4.5", `η: Λj.asfun(t)_j, t = ${JSON.stringify(t)}`, eta, { t }, typeof t == "object" ? t : undefined)
  // without asfun: Λj.t_j on 5 is ⊥ although 5 is not ⊥ (G = asfun(5))
  run("§4.2", "Λj.t_j, t = 5", rh`(group? *j t.*j) || (asObj(.t) & {})`, { t: 5 }, undefined)
}


// ==================== Section 4.3: Unrestricted β Is Incompatible with Defaults ====================

console.log("--- Section 4.3")

// Proposition 4.7: (Λi.Σj.a_{j,i})_9 = ⊥ vs Σj.a_{j,9} = 0
run("§4.3 Prop. 4.7", "(Λi.Σj.a_{j,i})_9", rh`(${colSums}).(9)`, { a: alpha }, undefined)
run("§4.3 Prop. 4.7", "Σj.a_{j,9}", rh`(sum? a.*j.(9)) || (asObj(.a) & 0)`, { a: alpha }, 0)

// double transposition R = (Λi.Λj.(Λl.A_{l,j})_i)_1 and S = (Λi.Λj.A_{i,j})_1
// Λl: A_{l,j} is a generator of the outer j whose prefix mentions l:
//   L(j) = Λl.A_{l,j} ∥ (Λl1.A_{l1,j} & {})
// Λj: the lookup L(j)_i on the outer i is kept and mentions j: G = Λj1.L(j1)_i
// Λi: the generator of i reduces to asfun(L(j)): G = Λj2.asfun(L(j2))
{
  let L = (j, l, l1) => rh`((group? ${l} A.${l}.${j}) || ((group? ${l1} A.${l1}.${j}) & {}))`
  let R = rh`((group? *i ((group? *j ${L("*j", "*l", "*l1")}.*i) || ((group? *j1 ${L("*j1", "*l2", "*l3")}.*i) & {})))
             || ((group? *j2 asObj(${L("*j2", "*l4", "*l5")})) & {})).(1)`
  // Λj: G = asfun(A_i); Λi: G = asfun(A)
  let S = rh`((group? *i ((group? *j A.*i.*j) || (asObj(A.*i) & {}))) || (asObj(.A) & {})).(1)`
  run("§4.3 §1.1", "double transposition: R", R, { A }, undefined)
  run("§4.3 §1.1", "double transposition: S", S, { A }, {})
}


// ==================== Section 4.4: Where β Holds, Figure 7 ====================

console.log("--- Section 4.4, Figure 7")

// composition: see Section 1.1 above

// a reduct that is not well-grounded: (Λi.(c_i & d_x))_{x?}, here under Λx
// redex: Λi: G = asfun(c) & d_x; Λx: G = asfun(d)
// reduct Λx.(c_{x?} & d_x): G = asfun(d)
{
  let redex = rh`(group? *x ((group? *i (c.*i & d.*x)) || ((asObj(.c) & d.*x) & {})).*x?) || (asObj(.d) & {})`
  let reduct = rh`(group? *x (c.*x? & d.*x)) || (asObj(.d) & {})`
  let c = { 0: 1, 1: 2 }
  run("§4.4", "non-grounded reduct: redex", redex, { c, d: { 0: 5, 2: 6 } }, { 0: 5 })
  run("§4.4", "non-grounded reduct: reduct", reduct, { c, d: { 0: 5, 2: 6 } }, { 0: 5 })
}

// (C1) Λi.Λj.(Λl.(a_l * b_j))_i vs Λi.Λj.(a_i * b_j), a = [1, 2], b = {}
// redex: Λl: G = asfun(a) & b_j, giving L(j)
//   Λj: the lookup L(j)_i on the outer i is kept and mentions j: G = Λj1.L(j1)_i
//   Λi: G = Λj2.asfun(L(j2))
// reduct: Λj: G = a_i & asfun(b); Λi: G = asfun(a)
{
  let L = j => rh`((group? *l (a.*l * b.${j})) || ((asObj(.a) & b.${j}) & {}))`
  let redex = rh`(group? *i ((group? *j ${L("*j")}.*i) || ((group? *j1 ${L("*j1")}.*i) & {}))) || ((group? *j2 asObj(${L("*j2")})) & {})`
  let reduct = rh`(group? *i ((group? *j (a.*i * b.*j)) || ((a.*i & asObj(.b)) & {}))) || (asObj(.a) & {})`
  run("Fig. 7 (C1)", "outer product: redex", redex, { a: [1, 2], b: {} }, undefined)
  run("Fig. 7 (C1)", "outer product: reduct", reduct, { a: [1, 2], b: {} }, { 0: {}, 1: {} })
}

// (C2) (Λi.Σj.a_{j,i})_9 vs Σj.a_{j,9}: see Proposition 4.7
run("Fig. 7 (C2)", "(Λi.Σj.a_{j,i})_9", rh`(${colSums}).(9)`, { a: alpha }, undefined)
run("Fig. 7 (C2)", "Σj.a_{j,9}", rh`(sum? a.*j.(9)) || (asObj(.a) & 0)`, { a: alpha }, 0)

// (C2) (Λi.Σj.(δ_j & Σk.a_{i,k}))_5 vs Σj.(δ_j & Σk.a_{5,k})
// redex: Σk: G = asfun(a_i); Σj: G = asfun(δ) & a_i; Λi: G = asfun(a)
// reduct: Σk: G = asfun(a_5); Σj: G = asfun(δ)
{
  let redex = rh`((group? *i ((sum? (d.*j & ((sum? a.*i.*k) || (asObj(a.*i) & 0)))) || ((asObj(.d) & a.*i) & 0)))
                  || (asObj(.a) & {})).(5)`
  let reduct = rh`(sum? (d.*j & ((sum? a.(5).*k) || (asObj(a.(5)) & 0)))) || (asObj(.d) & 0)`
  run("Fig. 7 (C2)", "nested: redex", redex, { a: alpha, d: delta }, undefined)
  run("Fig. 7 (C2)", "nested: reduct", reduct, { a: alpha, d: delta }, 0)
}

// (C3) Λm.(Λi.(a_i & ⟨i⟩_m))_0 vs Λm.(a_0 & ⟨0⟩_m), a = {}
// redex: Λi: G = Λi1.(a_{i1} & ⟨i1⟩_m); Λm: G = Λi2.(a_{i2} & asfun(⟨i2⟩))
// reduct: Λm: G = asfun(⟨0⟩)
{
  let redex = rh`(group? *m ((group? *i (a.*i & singleton(*i).*m)) || ((group? *i1 (a.*i1 & singleton(*i1).*m)) & {})).(0))
                 || ((group? *i2 (a.*i2 & asObj(singleton(*i2)))) & {})`
  let reduct = rh`(group? *m (a.(0) & singleton(0).*m)) || (asObj(singleton(0)) & {})`
  run("Fig. 7 (C3)", "redex", redex, { a: {} }, undefined)
  run("Fig. 7 (C3)", "reduct", reduct, { a: {} }, {})
}


// ==================== Section 5: Expressiveness and Design Space ====================

console.log("--- Section 5")

// ∀i ∈ a. 3 < a_i = Σi.(a_i & 1) =? Σi.(a_i & (3 < a_i) & 1). The two sums
// use different names, since Rhyme would share one variable. G = asfun(a)
{
  let core = rh`singleton(sum? (a.*i & 1)).(sum? (a.*j & (a.*j > 3) & 1))`
  let q = rh`singleton((sum? (a.*i & 1)) || (asObj(.a) & 0)).((sum? (a.*j & (a.*j > 3) & 1)) || (asObj(.a) & 0))`
  run("§5.1", "∀ holds", q, { a: { 0: 5, 1: 7 } }, 2)
  run("§5.1", "∀ fails", q, { a: { 0: 5, 1: 2 } }, undefined)
  run("§5.1", "∀ on {}", q, { a: {} }, 0)
  run("§5.1 core", "∀ on {}", core, { a: {} }, undefined)
}

// ¬t = 0 =? Σx.((0 =? x) & t & 1), where 0 =? x = ⟨0⟩_x is the generator of x
// for a closed t: G = asfun(⟨0⟩)
{
  let not = t => rh`singleton(0).((sum? (singleton(0).*x & ${t} & 1)) || (asObj(singleton(0)) & 0))`
  run("§5.1", "¬⊥", not(rh`.bot`), {}, 0)
  run("§5.1", "¬1", not(rh`1`), {}, undefined)
  run("§5.1 core", "¬⊥", rh`singleton(0).(sum? (singleton(0).*x & .bot & 1))`, {}, undefined)
  let inp = { d: { 0: 1, 1: 1 }, a: { 0: 1 } }
  // Λy.(d_y & ¬a_y): Σx: G = asfun(⟨0⟩) & a_y (kept: y is outer);
  //   Λy: G = asfun(d) & asfun(a)
  run("§5.1", "Λy.(d_y & ¬a_y)",
    rh`(group? *y (d.*y & singleton(0).((sum? (singleton(0).*x & a.*y & 1)) || ((asObj(singleton(0)) & a.*y) & 0))))
       || ((asObj(.d) & asObj(.a)) & {})`, inp, {})
  // Λy.(d_y & ¬a_{y?}): Σx: G = asfun(⟨0⟩); Λy: G = asfun(d)
  run("§5.1", "Λy.(d_y & ¬a_{y?})",
    rh`(group? *y (d.*y & singleton(0).((sum? (singleton(0).*x & a.*y? & 1)) || (asObj(singleton(0)) & 0))))
       || (asObj(.d) & {})`, inp, { 1: 0 })
}

// outer join Λi.((a_i + b_i) ∥ a_i ∥ b_i): one side suffices for the default
run("§5.1", "outer join of {} and {}", outerJoin, { a: {}, b: {} }, {})
run("§5.1", "outer join of {} and ⊥", outerJoin, { a: {} }, {})
run("§5.1", "outer join of ⊥ and ⊥", outerJoin, {}, undefined)
run("§5.1 core", "outer join of {} and {}", rh`group? *i ((a.*i? + b.*i?) || a.*i? || b.*i?)`, { a: {}, b: {} }, undefined)

// other folds: min has no default (base calculus), and neither has ∃
run("§5.2 core", "min over an empty collection", rh`min? e.*i`, { e: {} }, undefined)
na("§5.2", "∃", "Rhyme has no existential fold")
na("§5.2", "products default to 1", "not part of the lowering (Figure 6 covers Σ and Λ)")
na("§5.3", "SQL", "see the group-by on d' and on {} (Figure 5)")
