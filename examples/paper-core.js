let { rh, api } = require("../src/rhyme");

// The examples of the PLDI'27 draft, translated by hand into the core
// calculus. paper-defaults.js runs the same rows as surface terms with the
// setting inferDefaults, which performs this translation.
//
// Each row is labelled with its source in the paper (section, figure).
// A surface term t is run as its translation D(t) of Figure 6, written
// with core constructs only:
//
//   Λi.t   group? *i t          (no default: ⊥ if empty)
//   Σi.t   sum? t               (no default: ⊥ if empty)
//   t1 ∥ t2, t1 & t2            ||, &
//   asfun t, asnum t            asObj(t), asNum(t)
//   ⟨t⟩                         singleton(t)
//   x?  (= 1 & x)               *x?  (a filter: x also has a strict generator)
//   ⊥                           .bot (a missing input field)
//
// and the derived forms of Figure 6(c):
//
//   leaf(t)  = asnum(t) ∥ (asfun(t) & {})
//   t1 ⊓ t2  = ⟨asnum t1⟩_{t2} ∥ (asfun t1 & asfun t2 & {})
//
// D(Σi.t) = Σi.X ∥ (G & 0) and D(Λi.t) = Λi.X ∥ (G & z), where X = D(t);
// the comments give G and z. Conjuncts 1 of a domain check, and repeated
// conjuncts and meets of the same leaf, are left out (meets of leaves are
// idempotent). Rows marked "core" are core terms, run without D.
//
// Rhyme variables are global to a query: two loops that use the same name
// share it. Guards that bind a loop variable themselves (when it must take
// real keys) therefore use fresh names (*i1, *j2, ...), and so do loops
// that the paper writes with the same name.
//
// Inside a call, an input field is written .a: a bare a is the string "a".

let line = (tag, src, name, out, note) =>
  console.log(tag, src.padEnd(12), name.padEnd(44), out, note)

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

// a term that the paper rejects as ill-grounded; Rhyme should reject it too
let rejects = (src, name, q, inp) => {
  let out = evaluate(q, inp)
  line(out.startsWith("ERROR") ? "rjct" : "DIFF", src, name, out, "")
}

// an example that cannot be run
let na = (src, name, why) => line("n/a ", src, name, "", why)

let leaf = t => rh`(asNum(${t}) || (asObj(${t}) & {}))`
let meet = (s, t) => rh`(singleton(asNum(${s})).(${t}) || (asObj(${s}) & asObj(${t}) & {}))`

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
let num = { n5: 5, n6: 6, e: {} }                             // constants 5, 6, {}
let p = { 0: 1, 2: 1 }, a3 = { 0: 10, 1: 20, 2: 30 }          // filter p, values a


// ==================== Section 1: Introduction ====================

console.log("--- Section 1")

// Σi.(a_i * b_i): G = asfun(a) & asfun(b)
run("§1", "dot product", rh`(sum? (a.*i * b.*i)) || ((asObj(.a) & asObj(.b)) & 0)`, { a: va, b: vb }, 140)

// Λj.Λi.A_{i,j}
// inner: A_{i,j} is a generator of the outer j whose prefix mentions i:
//   G = Λi1.A_{i1,j}, z = {}
// outer: G = Λi2.leaf(A_{i2}), z = {} (the shape leaf(A_i) mentions i)
run("§1", "matrix transpose",
  rh`(group? *j ((group? *i A.*i.*j) || ((group? *i1 A.*i1.*j) & {}))) || ((group? *i2 ${leaf("A.*i2")}) & {})`,
  { A: M }, { 0: { 0: 1, 1: 3 }, 1: { 0: 2, 1: 4 } })

// Λi.Σj.A_{i,j}: inner G = asfun(A_i); outer G = z = leaf(A)
run("§1", "row sums", rh`(group? *i ((sum? A.*i.*j) || (asObj(A.*i) & 0))) || (${leaf(".A")} & ${leaf(".A")})`,
  { A: M }, { 0: 3, 1: 7 })

// Λi.Λj.Σk.(A_{i,k} * B_{k,j})
// Σk: B_{k,j} is a generator of the outer j whose prefix mentions k:
//   G = Λk1.(A_{i,k1} & B_{k1,j})
// Λj: G = Λk2.(A_{i,k2} & leaf(B_{k2})), z = {} (the shape mentions k)
// Λi: G = z = leaf(A)
run("§1", "matrix multiply",
  rh`(group? *i ((group? *j ((sum? (A.*i.*k * B.*k.*j)) || ((group? *k1 (A.*i.*k1 & B.*k1.*j)) & 0)))
                  || ((group? *k2 (A.*i.*k2 & ${leaf("B.*k2")})) & {})))
     || (${leaf(".A")} & ${leaf(".A")})`,
  { A: M, B: N }, { 0: { 0: 19, 1: 22 }, 1: { 0: 43, 1: 50 } })

// Σi.((a_{i,age} > 21) & a_{i,salary}): G = asfun(a)
run("§1", "selection & projection",
  rh`(sum? ((a.*i.age > 21) & a.*i.salary)) || (asObj(.a) & 0)`, { a: emp }, 270)

// Λi.Λj.(⟨a_{i,dept}⟩_{b_{j,id}} & {emp ↦ a_{i,name}, mgr ↦ b_{j,mgr}})
// inner: G = a_i & leaf(b), z = leaf(b); outer: G = z = leaf(a)
{
  let body = rh`(singleton(a.*i.dept).(b.*j.id) & { emp: a.*i.name, mgr: b.*j.mgr })`
  let q = rh`(group? *i ((group? *j ${body}) || ((a.*i & ${leaf(".b")}) & ${leaf(".b")}))) || (${leaf(".a")} & ${leaf(".a")})`
  run("§1", "nested join (Dave: no department)", q, { a: emp, b: dept },
    { 0: { 0: { emp: "Alice", mgr: "Erin" } }, 1: { 1: { emp: "Bob", mgr: "Frank" } }, 2: { 0: { emp: "Carol", mgr: "Erin" } }, 3: {} })
  run("§1 core", "nested join without defaults", rh`group? *i (group? *j ${body})`, { a: emp, b: dept },
    { 0: { 0: { emp: "Alice", mgr: "Erin" } }, 1: { 1: { emp: "Bob", mgr: "Frank" } }, 2: { 0: { emp: "Carol", mgr: "Erin" } } })
}

// Λi.((a_i + b_i) ∥ a_i ∥ b_i), with maybe lookups (see "outer join" below)
// G = (leaf(a) & leaf(b)) ∥ leaf(a) ∥ leaf(b), z = (leaf(a) ⊓ leaf(b)) ∥ leaf(a) ∥ leaf(b)
let outerJoin = (a, b) => rh`(group? *i ((${a}.*i? + ${b}.*i?) || ${a}.*i? || ${b}.*i?))
  || (((${leaf(a)} & ${leaf(b)}) || ${leaf(a)} || ${leaf(b)}) & ((${meet(leaf(a), leaf(b))} || ${leaf(a)}) || ${leaf(b)}))`
run("§1", "outer join (vector add)", outerJoin(".a", ".b"), { a: va, b: vb }, { 0: 1, 1: 12, 2: 20, 3: 34 })
na("§1", "outer join with strict lookups",
  "Rhyme intersects all strict generators of *i in a query, so a_i ∥ b_i is an inner join; outer joins use a.*i?")

// group-by { a_{i,dept} ↦ Σi.a_{i,salary} } = Λk.Σi.(⟨a_{i,dept}⟩_k & a_{i,salary})
// inner: G = Λi1.(⟨a_{i1,dept}⟩_k & a_{i1}); outer: G = Λi2.(leaf(⟨a_{i2,dept}⟩) & a_{i2}), z = {}
let groupBy = (key, val) => rh`(group? *k ((sum? (singleton(a.*i.${key}).*k & a.*i.${val}))
    || ((group? *i1 (singleton(a.*i1.${key}).*k & a.*i1)) & 0)))
  || ((group? *i2 (${leaf(rh`singleton(a.*i2.${key})`)} & a.*i2)) & {})`
run("§1", "group-by", groupBy("dept", "salary"), { a: emp }, { 1: 270, 2: 40, 3: 60 })

// Σi.Σj.Σk.(G_{i,j} & G_{j,k} & G_{k,i} & 1). Rhyme binds the three
// variables in one loop (the nearest enclosing aggregate), so this is
// Σ_{i,j,k}. Its domain check with I = {i,j,k} mentions the loop variables,
// so they must take real keys: G = Λi1.Λj1.Λk1.(G_{i1,j1} & G_{j1,k1} & G_{k1,i1}).
run("§1", "triangle counting",
  rh`(sum? (G.*i.*j & G.*j.*k & G.*k.*i & 1)) || ((group? *i1 (group? *j1 (group? *k1 (G.*i1.*j1 & G.*j1.*k1 & G.*k1.*i1)))) & 0)`,
  { G }, 3)

// Λi.Λj.min_k.(D_{i,k} + D_{k,j}): min has no default (Section 5.2), so it
// stays a core loop; the tabulations get defaults:
// Λj: G = Λk1.(D_{i,k1} & leaf(D_{k1})), z = {}; Λi: G = z = leaf(D)
run("§1", "min-plus product",
  rh`(group? *i ((group? *j (min? (D.*i.*k + D.*k.*j))) || ((group? *k1 (D.*i.*k1 & ${leaf("D.*k1")})) & {})))
     || (${leaf(".D")} & ${leaf(".D")})`,
  { D: Dm }, { 0: { 0: 0, 1: 3, 2: 1 }, 1: { 1: 0 }, 2: { 1: 2, 2: 0 } })

// ==================== Section 2: Values, Folds, and a Core Calculus ====================

console.log("--- Section 2")

// Λi.(a_i + b_i): strict +, entries only where both vectors have one
// G = leaf(a) & leaf(b), z = leaf(a) ⊓ leaf(b)
run("§2.2", "Λi.(a_i + b_i), inner join",
  rh`(group? *i (a.*i + b.*i)) || ((${leaf(".a")} & ${leaf(".b")}) & ${meet(leaf(".a"), leaf(".b"))})`,
  { a: va, b: vb }, { 1: 12, 3: 34 })

// Σj.a_{s_j}, s_j = Σi.(a_j & a_i & 0), a = {0 ↦ 1}. Rhyme binds j at the
// outer sum only if j occurs outside the inner one, so we write j & a_{s_j},
// which has the same value.
run("§2.3 core", "Σj.a_{s_j}", rh`sum? (*j & a.(sum? (a.*j & a.*i & 0)))`, { a: [1] }, 1)
// inner: G = a_j & asfun(a); outer: G = asfun(a)
run("§2.3", "Σj.a_{s_j}, with defaults",
  rh`(sum? (*j & a.((sum? (a.*j & a.*i & 0)) || ((a.*j & asObj(.a)) & 0)))) || (asObj(.a) & 0)`, { a: [1] }, 1)


// ==================== Section 3.1: Empty or Absent? ====================

console.log("--- Section 3.1")

run("§3.1 core", "row sums of A drop row 1", rh`group? *i (sum? A.*i.*j)`, { A }, { 0: 3, 2: 33 })
run("§3.1 core", "copy of A drops row 1", rh`group? *i (group? *j A.*i.*j)`, { A },
  { 0: { 0: 0, 1: 1, 2: 2 }, 2: { 0: 10, 1: 11, 2: 12 } })


// ==================== Section 3.2: The Filtering Semantics, Figure 5 ====================

console.log("--- Section 3.2, Figure 5")

// Λi.a_i: G = z = leaf(a)
{
  let q = rh`(group? *i a.*i) || (${leaf(".a")} & ${leaf(".a")})`
  run("Fig. 5", "Λi.a_i on {}", q, { a: {} }, {})
  run("Fig. 5 §3.2", "Λi.a_i on 5", q, { a: 5 }, 5)
}

// row sums: inner G = asfun(A_i); outer G = z = leaf(A)
run("Fig. 5 §3.3", "row sums", rh`(group? *i ((sum? A.*i.*j) || (asObj(A.*i) & 0))) || (${leaf(".A")} & ${leaf(".A")})`,
  { A }, { 0: 3, 1: 0, 2: 33 })

// copy Λi.Λj.a_{i,j}: inner G = z = leaf(a_i); outer G = z = leaf(a)
{
  let q = rh`(group? *i ((group? *j a.*i.*j) || (${leaf("a.*i")} & ${leaf("a.*i")}))) || (${leaf(".a")} & ${leaf(".a")})`
  run("Fig. 5", "copy A", q, { a: A }, { 0: { 0: 0, 1: 1, 2: 2 }, 1: {}, 2: { 0: 10, 1: 11, 2: 12 } })
  run("Fig. 5 §1.1", "copy JSON", q, { a: { 0: 5, 1: { 1: 1, 2: 2 } } }, { 0: 5, 1: { 1: 1, 2: 2 } })
}

// Λi.Λj.(a_{i,j} & b_{i,j})
// inner: G = leaf(a_i) & leaf(b_i), z = leaf(a_i) ⊓ leaf(b_i); outer likewise with a, b
{
  let q = rh`(group? *i ((group? *j (a.*i.*j & b.*i.*j)) || ((${leaf("a.*i")} & ${leaf("b.*i")}) & ${meet(leaf("a.*i"), leaf("b.*i"))})))
             || ((${leaf(".a")} & ${leaf(".b")}) & ${meet(leaf(".a"), leaf(".b"))})`
  run("Fig. 5 §3.2", "deep intersection", q, { a: { 0: 5, 1: 6 }, b: { 0: 5, 2: 6 } }, { 0: 5 })
  run("§3.2", "deep intersection, 5 vs 6", q, { a: { 0: 5 }, b: { 0: 6 } }, {})
  run("§3.2", "deep intersection, maps", q, { a: { 0: { 1: 2 } }, b: { 0: { 3: 2 } } }, { 0: {} })
}

// Σi.(a_i & ⊥): G = asfun(a)
run("Fig. 5 §3.1", "Σi.(a_i & ⊥)", rh`(sum? (a.*i & .bot)) || (asObj(.a) & 0)`, { a: alpha }, 0)
// Σj.a_{j,9}: G = asfun(a)
run("Fig. 5 §3.1", "Σj.a_{j,9}", rh`(sum? a.*j.(9)) || (asObj(.a) & 0)`, { a: alpha }, 0)

// Λi.(a_i =? 5) = Λi.⟨a_i⟩_5: G = z = leaf(a)
{
  let q = rh`(group? *i singleton(a.*i).(5)) || (${leaf(".a")} & ${leaf(".a")})`
  run("Fig. 5", "Λi.(a_i =? 5) on {1: 7}", q, { a: { 1: 7 } }, {})
  run("Fig. 5 §3.2 §5", "Λi.(a_i =? 5) on 7", q, { a: 7 }, 7)
}

// column sums Λi.Σj.a_{j,i}
// inner: G = Λj1.a_{j1,i}; outer: G = Λj2.leaf(a_{j2}), z = {}
{
  let q = rh`(group? *i ((sum? a.*j.*i) || ((group? *j1 a.*j1.*i) & 0))) || ((group? *j2 ${leaf("a.*j2")}) & {})`
  run("Fig. 5 §3.3", "column sums on α", q, { a: alpha }, { 1: 3, 2: 4 })
  run("Fig. 5", "column sums on {0: {}}", q, { a: { 0: {} } }, {})
  run("Fig. 5", "column sums on {}", q, { a: {} }, undefined)
}

// Λi.(a_i & Σj.a_{j,i}): inner as in the column sums; outer G = leaf(a) & Λj2.leaf(a_{j2}), z = leaf(a)
run("Fig. 5 §3.2", "Λi.(a_i & Σj.a_{j,i})",
  rh`(group? *i (a.*i & ((sum? a.*j.*i) || ((group? *j1 a.*j1.*i) & 0)))) || ((${leaf(".a")} & (group? *j2 ${leaf("a.*j2")})) & ${leaf(".a")})`,
  { a: alpha1 }, { 0: 4, 1: 3 })
// Λi.(a_i & Σj.a_{j,i?}): inner G = asfun(a); outer G = z = leaf(a)
run("Fig. 5 §3.2", "Λi.(a_i & Σj.a_{j,i?})",
  rh`(group? *i (a.*i & ((sum? a.*j.*i?) || (asObj(.a) & 0)))) || (${leaf(".a")} & ${leaf(".a")})`,
  { a: alpha1 }, { 0: 4, 1: 3, 5: 0 })
// diagonal Λi.a_{i,i}: G = Λi1.a_{i1,i1}, z = {}
{
  let q = rh`(group? *i a.*i.*i) || ((group? *i1 a.*i1.*i1) & {})`
  run("Fig. 5", "diagonal on {}", q, { a: {} }, undefined)
  run("Fig. 5", "diagonal on {0: {1: 7}}", q, { a: { 0: { 1: 7 } } }, undefined)
}
// Λi.a_{i,i?}: G = z = leaf(a)
{
  let q = rh`(group? *i a.*i.*i?) || (${leaf(".a")} & ${leaf(".a")})`
  run("Fig. 5", "diagonal filter on {}", q, { a: {} }, {})
  run("Fig. 5", "diagonal filter on {0: {1: 7}}", q, { a: { 0: { 1: 7 } } }, {})
}

// group-by Λk.Σi.(⟨a_{i,key}⟩_k & a_{i,val})
run("Fig. 5", "group-by on d", groupBy("key", "val"), { a: d }, { 7: 40, 11: 5 })
run("Fig. 5 §5.3", "group-by on d'", groupBy("key", "val"), { a: d1 }, { 7: 40, 11: 0 })
run("Fig. 5 §5.3", "group-by on {}", groupBy("key", "val"), { a: {} }, undefined)

// Λm.Λi.(a_i & ⟨i⟩_m): inner G = Λi1.(a_{i1} & ⟨i1⟩_m), z = {};
// outer G = Λi2.(a_{i2} & leaf(⟨i2⟩)), z = {}. Rhyme's singleton stores
// the key as a string: { 1: "1" }, not { 1: 1 }.
run("Fig. 5 §3.3", "Λm.Λi.(a_i & ⟨i⟩_m)",
  rh`(group? *m ((group? *i (a.*i & singleton(*i).*m)) || ((group? *i1 (a.*i1 & singleton(*i1).*m)) & {})))
     || ((group? *i2 (a.*i2 & ${leaf("singleton(*i2)")})) & {})`,
  { a: { 1: 5, 2: 6 } }, { 1: { 1: "1" }, 2: { 2: "2" } })


// ==================== Section 3.2: Generators, Shapes and Numbers ====================

console.log("--- Section 3.2")

// Λi.(a_i ∥ b_i): i ranges over the keys of a and b; with maybe lookups
// G = z = leaf(a) ∥ leaf(b)
{
  let q = rh`(group? *i (a.*i? || b.*i?)) || ((${leaf(".a")} || ${leaf(".b")}) & (${leaf(".a")} || ${leaf(".b")}))`
  run("§3.2", "Λi.(a_i ∥ b_i)", q, { a: { 0: 1 }, b: { 1: 2 } }, { 0: 1, 1: 2 })
  run("§3.2", "Λi.(a_i ∥ b_i), a = {}, b = ⊥", q, { a: {} }, {})
  run("§3.2", "Λi.(a_i ∥ b_i), a = b = ⊥", q, {}, undefined)
}
// Λi.(5_i & 6_i), Λi.({}_i & 5_i): G = leaf(x) & leaf(y), z = leaf(x) ⊓ leaf(y)
run("§3.2", "Λi.(5_i & 6_i)", rh`(group? *i (n5.*i & n6.*i)) || ((${leaf(".n5")} & ${leaf(".n6")}) & ${meet(leaf(".n5"), leaf(".n6"))})`, num, undefined)
run("§3.2", "Λi.({}_i & 5_i)", rh`(group? *i (e.*i & n5.*i)) || ((${leaf(".e")} & ${leaf(".n5")}) & ${meet(leaf(".e"), leaf(".n5"))})`, num, undefined)
// Λi.(asfun(a)_i =? 5): G = z = leaf(asfun(a))
{
  let q = t => rh`(group? *i singleton(${t}.*i).(5)) || (${leaf(t)} & ${leaf(t)})`
  run("§3.2", "Λi.(asfun(a)_i =? 5) on 7", q(rh`asObj(.a)`), { a: 7 }, undefined)
  run("§3.2", "Λi.((asfun(a) ∥ {})_i =? 5) on 7", q(rh`(asObj(.a) || {})`), { a: 7 }, {})
  run("§3.2", "Λi.(asfun(a)_i =? 5) on a map", q(rh`asObj(.a)`), { a: { 1: 5, 2: 7 } }, { 1: 5 })
}
// Σi.5_i: generators of a sum are checked by asfun, G = asfun(5)
run("§3.2 §5.2", "Σi.5_i", rh`(sum? n5.*i) || (asObj(.n5) & 0)`, num, undefined)


// ==================== Section 3.3: Translating Defaults ====================

console.log("--- Section 3.3")

// the simpler variant: generators of a tabulation checked by asfun, default {}
// Λj.t_j: G = asfun(t), z = {}
run("§3.3 §4.2", "simpler variant: Λj.t_j on 5", rh`(group? *j t.*j) || (asObj(.t) & {})`, { t: 5 }, undefined)
run("§3.3", "simpler variant: Λj.t_j on {}", rh`(group? *j t.*j) || (asObj(.t) & {})`, { t: {} }, {})
// row sums, column sums, Λm.Λi: see Figure 5


// ==================== Section 4.2-4.3: η and Congruence ====================

console.log("--- Section 4.2, 4.3")

// Λi.⊥_i vs Λi.{}_i: G = z = leaf(⊥) / leaf({})
run("§4.3", "Λi.⊥_i", rh`(group? *i .bot.*i) || (${leaf(".bot")} & ${leaf(".bot")})`, num, undefined)
run("§4.3", "Λi.{}_i", rh`(group? *i e.*i) || (${leaf(".e")} & ${leaf(".e")})`, num, {})

// the key i vs i & i in Λi.(a_i & Σj.a_{j,[·]}) on α'
run("§4.3", "key i", rh`(group? *i (a.*i & ((sum? a.*j.*i) || ((group? *j1 a.*j1.*i) & 0)))) || ((${leaf(".a")} & (group? *j2 ${leaf("a.*j2")})) & ${leaf(".a")})`,
  { a: alpha1 }, { 0: 4, 1: 3 })
// a_{j,(i&i)} is a filter: inner G = asfun(a); outer G = z = leaf(a)
run("§4.3", "key i & i", rh`(group? *i (a.*i & ((sum? a.*j.(*i & *i)) || (asObj(.a) & 0)))) || (${leaf(".a")} & ${leaf(".a")})`,
  { a: alpha1 }, { 0: 4, 1: 3, 5: 0 })

// Λi.(6_i & 5_i) vs Λi.(⊥ & 6_i): shapes 6 ⊓ 5 and 6
run("§4.3", "Λi.(6_i & 5_i)", rh`(group? *i (n6.*i & n5.*i)) || ((${leaf(".n6")} & ${leaf(".n5")}) & ${meet(leaf(".n6"), leaf(".n5"))})`, num, undefined)
run("§4.3", "Λi.(⊥ & 6_i)", rh`(group? *i (.bot & n6.*i)) || (${leaf(".n6")} & ${leaf(".n6")})`, num, 6)
// Λi.(5_i & ({}_i & ⊥)) vs Λi.(5_i & ⊥): shapes 5 ⊓ {} and 5
run("§4.3", "Λi.(5_i & ({}_i & ⊥))", rh`(group? *i (n5.*i & (e.*i & .bot))) || ((${leaf(".n5")} & ${leaf(".e")}) & ${meet(leaf(".n5"), leaf(".e"))})`, num, undefined)
run("§4.3", "Λi.(5_i & ⊥)", rh`(group? *i (n5.*i & .bot)) || (${leaf(".n5")} & ${leaf(".n5")})`, num, 5)


// ==================== Section 4.4: Unrestricted β Is Incompatible with Defaults ====================

console.log("--- Section 4.4")

// (Λi.Σj.a_{j,i})_9 vs Σj.a_{j,9}
run("§4.4 Fig. 7", "(Λi.Σj.a_{j,i})_9",
  rh`((group? *i ((sum? a.*j.*i) || ((group? *j1 a.*j1.*i) & 0))) || ((group? *j2 ${leaf("a.*j2")}) & {})).(9)`, { a: alpha }, undefined)
run("§4.4 Fig. 7", "Σj.a_{j,9}", rh`(sum? a.*j.(9)) || (asObj(.a) & 0)`, { a: alpha }, 0)

// double transposition R = (Λi.Λj.(Λl.A_{l,j})_i)_1 and S = (Λi.Λj.A_{i,j})_1
// Λl: A_{l,j} is a generator of the outer j whose prefix mentions l:
//   L(j) = Λl.A_{l,j} ∥ (Λl1.A_{l1,j} & {})
// Λj: the lookup L(j)_i on the outer i mentions j: G = Λj1.L(j1)_i, z = {}
// Λi: G = Λj2.leaf(L(j2)), z = {} (the shape mentions j)
{
  let L = (j, l, l1) => rh`((group? ${l} A.${l}.${j}) || ((group? ${l1} A.${l1}.${j}) & {}))`
  let R = rh`((group? *i ((group? *j ${L("*j", "*l", "*l1")}.*i) || ((group? *j1 ${L("*j1", "*l2", "*l3")}.*i) & {})))
             || ((group? *j2 ${leaf(L("*j2", "*l4", "*l5"))}) & {})).(1)`
  let S = rh`((group? *i ((group? *j A.*i.*j) || (${leaf("A.*i")} & ${leaf("A.*i")}))) || (${leaf(".A")} & ${leaf(".A")})).(1)`
  run("§4.4 §1.1", "double transposition: R", R, { A }, undefined)
  run("§4.4 §1.1", "double transposition: S", S, { A }, {})
}
// transposing twice, (A^T)^T, drops the empty row (with and without defaults)
// A^T = Λj.Λi.A_{i,j} as in the matrix transpose above; (A^T)^T = Λi.Λj.(A^T)_{j,i}
// Λj: (A^T)_{j,i} is a generator of the outer i whose prefix mentions j:
//   G = Λj3.(A^T)_{j3,i}, z = {}; Λi: G = Λj4.leaf((A^T)_{j4}), z = {}
{
  let T = (j, i, i1, i2) => rh`((group? ${j} ((group? ${i} A.${i}.${j}) || ((group? ${i1} A.${i1}.${j}) & {}))) || ((group? ${i2} ${leaf(rh`A.${i2}`)}) & {}))`
  let q = rh`(group? *i ((group? *j ${T("*jt", "*it", "*it1", "*it2")}.*j.*i) || ((group? *j3 ${T("*ju", "*iu", "*iu1", "*iu2")}.*j3.*i) & {})))
             || ((group? *j4 ${leaf(rh`${T("*jv", "*iv", "*iv1", "*iv2")}.*j4`)}) & {})`
  let rows02 = { 0: { 0: 0, 1: 1, 2: 2 }, 2: { 0: 10, 1: 11, 2: 12 } }
  run("§4.4 core", "(A^T)^T", rh`group? *i (group? *j (group? *j2 (group? *i2 A.*i2.*j2)).*j.*i)`, { A }, rows02)
  run("§4.4", "(A^T)^T, with defaults", q, { A }, rows02)
}


// ==================== Section 4.5: Where β Holds, Figure 7 ====================

console.log("--- Section 4.5, Figure 7")

// row selection (Λi.Σj.a_{i,j})_c vs Σj.a_{c,j}
{
  let redex = rh`((group? *i ((sum? a.*i.*j) || (asObj(a.*i) & 0))) || (${leaf(".a")} & ${leaf(".a")}))`
  run("§4.5", "(Λi.Σj.a_{i,j})_0", rh`${redex}.(0)`, { a: alpha }, 3)
  run("§4.5", "Σj.a_{0,j}", rh`(sum? a.(0).*j) || (asObj(a.(0)) & 0)`, { a: alpha }, 3)
  run("§4.5", "(Λi.Σj.a_{i,j})_9", rh`${redex}.(9)`, { a: alpha }, undefined)
  run("§4.5", "Σj.a_{9,j}", rh`(sum? a.(9).*j) || (asObj(a.(9)) & 0)`, { a: alpha }, undefined)
}

// (C1) Λi.Λj.(Λl.(a_l * b_j))_i vs Λi.Λj.(a_i * b_j), a = [1, 2], b = {}
// redex: Λl: G = leaf(a) & b_j, z = leaf(a): L(j)
//   Λj: the lookup L(j)_i on the outer i mentions j: G = Λj1.L(j1)_i, z = {}
//   Λi: G = Λj2.leaf(L(j2)), z = {}
// reduct: Λj: G = a_i & leaf(b), z = leaf(b); Λi: G = z = leaf(a)
{
  let L = j => rh`((group? *l (a.*l * b.${j})) || ((${leaf(".a")} & b.${j}) & ${leaf(".a")}))`
  let redex = rh`(group? *i ((group? *j ${L("*j")}.*i) || ((group? *j1 ${L("*j1")}.*i) & {}))) || ((group? *j2 ${leaf(L("*j2"))}) & {})`
  let reduct = rh`(group? *i ((group? *j (a.*i * b.*j)) || ((a.*i & ${leaf(".b")}) & ${leaf(".b")}))) || (${leaf(".a")} & ${leaf(".a")})`
  run("Fig. 7 (C1)", "outer product: redex", redex, { a: [1, 2], b: {} }, undefined)
  run("Fig. 7 (C1)", "outer product: reduct", reduct, { a: [1, 2], b: {} }, { 0: {}, 1: {} })
}

// (C2) (Λi.Σj.a_{j,i})_9: see Section 4.4
// (C2) (Λi.Σj.(δ_j & Σk.a_{i,k}))_5 vs Σj.(δ_j & Σk.a_{5,k})
// redex: Σk: G = asfun(a_i); Σj: G = asfun(δ) & a_i; Λi: G = z = leaf(a)
// reduct: Σk: G = asfun(a_5); Σj: G = asfun(δ)
{
  let redex = rh`((group? *i ((sum? (d.*j & ((sum? a.*i.*k) || (asObj(a.*i) & 0)))) || ((asObj(.d) & a.*i) & 0)))
                  || (${leaf(".a")} & ${leaf(".a")})).(5)`
  let reduct = rh`(sum? (d.*j & ((sum? a.(5).*k) || (asObj(a.(5)) & 0)))) || (asObj(.d) & 0)`
  run("Fig. 7 (C2)", "nested: redex", redex, { a: alpha, d: delta }, undefined)
  run("Fig. 7 (C2)", "nested: reduct", reduct, { a: alpha, d: delta }, 0)
}

// (C3) Λm.(Λi.(a_i & ⟨i⟩_m))_0 vs Λm.(a_0 & ⟨0⟩_m), a = {}
// redex: Λi: G = Λi1.(a_{i1} & ⟨i1⟩_m), z = {}; Λm: G = Λi2.(a_{i2} & leaf(⟨i2⟩)), z = {}
// reduct: G = z = leaf(⟨0⟩)
{
  let redex = rh`(group? *m ((group? *i (a.*i & singleton(*i).*m)) || ((group? *i1 (a.*i1 & singleton(*i1).*m)) & {})).(0))
                 || ((group? *i2 (a.*i2 & ${leaf("singleton(*i2)")})) & {})`
  let reduct = rh`(group? *m (a.(0) & singleton(0).*m)) || (${leaf("singleton(0)")} & ${leaf("singleton(0)")})`
  run("Fig. 7 (C3) §4.5", "redex", redex, { a: {} }, undefined)
  run("Fig. 7 (C3) §4.5", "reduct", reduct, { a: {} }, {})
}

// (C4) Λx.(Λi.((a_i & 5_x) ∥ (a_i & 6_x)))_{6_x} vs its reduct, a = {}
// redex: Λi: G = (leaf(a) & 5_x) ∥ (leaf(a) & 6_x), z = leaf(a) ∥ leaf(a)
//   Λx: G = (leaf(5) ∥ leaf(6)) & leaf(6), z = (leaf(5) ∥ leaf(6)) ⊓ leaf(6)
// reduct: G = (leaf(6) & leaf(5)) ∥ leaf(6), z = (leaf(6) ⊓ leaf(5)) ∥ leaf(6)
{
  let I = rh`((group? *i ((a.*i & n5.*x) || (a.*i & n6.*x)))
              || (((${leaf(".a")} & n5.*x) || (${leaf(".a")} & n6.*x)) & (${leaf(".a")} || ${leaf(".a")})))`
  let l5 = leaf(".n5"), l6 = leaf(".n6")
  let redex = rh`(group? *x ${I}.(n6.*x)) || (((${l5} || ${l6}) & ${l6}) & ${meet(rh`(${l5} || ${l6})`, l6)})`
  let reduct = rh`(group? *x ((a.(n6.*x) & n5.*x) || (a.(n6.*x) & n6.*x))) || (((${l6} & ${l5}) || ${l6}) & (${meet(l6, l5)} || ${l6}))`
  run("Fig. 7 (C4)", "redex", redex, { a: {}, ...num }, undefined)
  run("Fig. 7 (C4)", "reduct", reduct, { a: {}, ...num }, 6)
}

// (C5) Λx.(Λi.Λy.Λj.(a_{j,x} & b_{i,y}))_{5_x} vs its reduct, a = {0 ↦ 7}, b = {}
// redex: Λj: G = Λj1.(a_{j1,x} & b_{i,y}), z = {}
//   Λy: G = Λj2.(a_{j2,x} & leaf(b_i)), z = leaf(b_i)
//   Λi: G = Λj3.(a_{j3,x} & leaf(b)), z = leaf(b)
//   Λx: G = Λj4.leaf(a_{j4}) & leaf(5), z = leaf(5) (the loop over j has no shape)
// reduct: Λj: G = Λj1.(a_{j1,x} & b_{5_x,y}), z = {}
//   Λy: G = Λj2.(a_{j2,x} & leaf(b_{5_x})), z = leaf(b_{5_x})
//   Λx: G = Λj3.(leaf(a_{j3}) & leaf(5)), z = {} (the copy of 5_x is inside the loop over j)
{
  let Jn = rh`((group? *j (a.*j.*x & b.*i.*y)) || ((group? *j1 (a.*j1.*x & b.*i.*y)) & {}))`
  let Y = rh`((group? *y ${Jn}) || ((group? *j2 (a.*j2.*x & ${leaf("b.*i")})) & ${leaf("b.*i")}))`
  let I = rh`((group? *i ${Y}) || ((group? *j3 (a.*j3.*x & ${leaf(".b")})) & ${leaf(".b")}))`
  let redex = rh`(group? *x ${I}.(n5.*x)) || (((group? *j4 ${leaf("a.*j4")}) & ${leaf(".n5")}) & ${leaf(".n5")})`
  let Jr = rh`((group? *j (a.*j.*x & b.(n5.*x).*y)) || ((group? *j1 (a.*j1.*x & b.(n5.*x).*y)) & {}))`
  let Yr = rh`((group? *y ${Jr}) || ((group? *j2 (a.*j2.*x & ${leaf("b.(n5.*x)")})) & ${leaf("b.(n5.*x)")}))`
  let reduct = rh`(group? *x ${Yr}) || ((group? *j3 (${leaf("a.*j3")} & ${leaf(".n5")})) & {})`
  run("Fig. 7 (C5)", "redex", redex, { a: { 0: 7 }, b: {}, ...num }, 5)
  run("Fig. 7 (C5)", "reduct", reduct, { a: { 0: 7 }, b: {}, ...num }, {})
}

// β with a reduct that is not well-grounded: (Λi.(c_i & d_x))_{x?} under Λx
// redex: Λi: G = leaf(c) & d_x, z = leaf(c); Λx: G = z = leaf(d)
// reduct Λx.(c_{x?} & d_x): G = z = leaf(d)
{
  let redex = rh`(group? *x ((group? *i (c.*i & d.*x)) || ((${leaf(".c")} & d.*x) & ${leaf(".c")})).*x?) || (${leaf(".d")} & ${leaf(".d")})`
  let reduct = rh`(group? *x (c.*x? & d.*x)) || (${leaf(".d")} & ${leaf(".d")})`
  let c = { 0: 1, 1: 2 }
  run("§4.5", "non-grounded reduct: redex", redex, { c, d: { 0: 5, 2: 6 } }, { 0: 5 })
  run("§4.5", "non-grounded reduct: reduct", reduct, { c, d: { 0: 5, 2: 6 } }, { 0: 5 })
  run("§4.5", "non-grounded reduct: redex, d = {}", redex, { c, d: {} }, {})
  run("§4.5", "non-grounded reduct: reduct, d = {}", reduct, { c, d: {} }, {})
}

// the instances in the Rocq development: composition with one map, and
// the row sums of a selected row (Λl.Σj.a_{l,j})_{b_x}
{
  let a = { 0: 1, 1: 3, 3: 0 }
  run("§4.5", "(Λl.a_l)_{a_x}: redex",
    rh`(group? *x (((group? *l a.*l) || (${leaf(".a")} & ${leaf(".a")})).(a.*x))) || (${leaf(".a")} & ${leaf(".a")})`, { a }, { 0: 3, 1: 0, 3: 1 })
  run("§4.5", "(Λl.a_l)_{a_x}: reduct", rh`(group? *x a.(a.*x)) || (${leaf(".a")} & ${leaf(".a")})`, { a }, { 0: 3, 1: 0, 3: 1 })
  // redex: Σj: G = asfun(a_l); Λl: G = z = leaf(a); Λx: G = z = leaf(b)
  // reduct: Σj: G = asfun(a_{b_x}); Λx: G = z = leaf(b)
  let b = { 0: 1, 1: 2, 2: 5 }
  let L = rh`((group? *l ((sum? a.*l.*j) || (asObj(a.*l) & 0))) || (${leaf(".a")} & ${leaf(".a")}))`
  run("§4.5", "(Λl.Σj.a_{l,j})_{b_x}: redex", rh`(group? *x ${L}.(b.*x)) || (${leaf(".b")} & ${leaf(".b")})`, { a: A, b }, { 0: 0, 1: 33 })
  run("§4.5", "(Λl.Σj.a_{l,j})_{b_x}: reduct",
    rh`(group? *x ((sum? a.(b.*x).*j) || (asObj(a.(b.*x)) & 0))) || (${leaf(".b")} & ${leaf(".b")})`, { a: A, b }, { 0: 0, 1: 33 })
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

// ¬t = 0 =? Σx.((0 =? x) & t & 1)
// for a closed t: G = asfun(⟨0⟩)
{
  let not = t => rh`singleton(0).((sum? (singleton(0).*x & ${t} & 1)) || (asObj(singleton(0)) & 0))`
  run("§5.1", "¬⊥", not(rh`.bot`), {}, 0)
  run("§5.1", "¬1", not(rh`1`), {}, undefined)
  run("§5.1 core", "¬⊥", rh`singleton(0).(sum? (singleton(0).*x & .bot & 1))`, {}, undefined)
  let inp = { d: { 0: 1, 1: 1 }, a: { 0: 1 } }
  // Λy.(d_y & ¬a_y): Σx: G = asfun(⟨0⟩) & a_y; Λy: G = leaf(d) & leaf(a), z = leaf(d) ⊓ leaf(a)
  run("§5.1", "Λy.(d_y & ¬a_y)",
    rh`(group? *y (d.*y & singleton(0).((sum? (singleton(0).*x & a.*y & 1)) || ((asObj(singleton(0)) & a.*y) & 0))))
       || ((${leaf(".d")} & ${leaf(".a")}) & ${meet(leaf(".d"), leaf(".a"))})`, inp, {})
  // Λy.(d_y & ¬a_{y?}): Σx: G = asfun(⟨0⟩); Λy: G = z = leaf(d)
  run("§5.1", "Λy.(d_y & ¬a_{y?})",
    rh`(group? *y (d.*y & singleton(0).((sum? (singleton(0).*x & a.*y? & 1)) || (asObj(singleton(0)) & 0))))
       || (${leaf(".d")} & ${leaf(".d")})`, inp, { 1: 0 })
}

// outer join Λi.((a_i + b_i) ∥ a_i ∥ b_i)
run("§5.1", "outer join of {} and {}", outerJoin(".a", ".b"), { a: {}, b: {} }, {})
run("§5.1", "outer join of {} and ⊥", outerJoin(".a", ".b"), { a: {} }, {})
run("§5.1", "outer join of ⊥ and ⊥", outerJoin(".a", ".b"), {}, undefined)
run("§5.1 core", "outer join of {} and {}", rh`group? *i ((a.*i? + b.*i?) || a.*i? || b.*i?)`, { a: {}, b: {} }, undefined)
run("§5.1 §3.2", "outer join of 5 and 6", outerJoin(".a", ".b"), { a: 5, b: 6 }, 5)
run("§5.1", "outer join of 5 and {}", outerJoin(".a", ".b"), { a: 5, b: {} }, 5)
run("§5.1", "outer join of asfun 5, asfun 6", outerJoin(rh`asObj(.a)`, rh`asObj(.b)`), { a: 5, b: 6 }, undefined)
run("§5.1", "outer join of asfun 5, asfun {}", outerJoin(rh`asObj(.a)`, rh`asObj(.b)`), { a: 5, b: {} }, {})

// other folds: min has no default (core), and neither has ∃
run("§5.2 core", "min over an empty collection", rh`min? e.*i`, num, undefined)
na("§5.2", "∃", "Rhyme has no existential fold")
na("§5.2", "products default to 1", "not part of the translation (Figure 6 covers Σ and Λ)")
na("§5.2", "order-sensitive folds, efficiency", "no examples")
na("§5.3", "SQL", "see the group-by on d' and on {} (Figure 5)")
