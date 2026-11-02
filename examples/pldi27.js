let { rh, api } = require("../src/rhyme");
let { types, typing } = require("../src/typing");

// Examples from the PLDI'27 draft.

let run = (name, q, inp) => {
  let f = api.compile(q)
  console.log(name.padEnd(40), JSON.stringify(f(inp)))
}

// Data
let A = [[0, 1, 2], [], [10, 11, 12]]            // sparse matrix, Section 4
let alpha = { 0: { 1: 3 }, 1: { 2: 4 } }         // α
let alpha1 = { 0: { 1: 3 }, 1: { 0: 4 }, 5: {} } // α'
let d = [{ key: 7, val: 10 }, { key: 11, val: 5 }, { key: 7, val: 30 }]
let d1 = [{ key: 7, val: 10 }, { key: 11 }, { key: 7, val: 30 }] // d', no value 5

// Section 1 data: vectors, matrices, an employee and a department table,
// a graph as an adjacency map, and a distance matrix
let va = { 0: 1, 1: 2, 3: 4 }
let vb = { 1: 10, 2: 20, 3: 30 }
let M = [[1, 2], [3, 4]]
let N = [[5, 6], [7, 8]]
let emp = [
  { name: "Alice", age: 34, salary: 120, dept: 1 },
  { name: "Bob", age: 19, salary: 40, dept: 2 },
  { name: "Carol", age: 45, salary: 150, dept: 1 },
  { name: "Dave", age: 21, salary: 60, dept: 3 },
]
let dept = [{ id: 1, mgr: "Erin" }, { id: 2, mgr: "Frank" }]
let G = { 0: { 1: true }, 1: { 2: true }, 2: { 0: true, 3: true }, 3: {} }
let D = { 0: { 0: 0, 1: 4, 2: 1 }, 1: { 1: 0 }, 2: { 1: 2, 2: 0 } }

// ---------- Section 1, Introduction ----------

// Tensor algebra

// Dot product Σi. (a_i * b_i)
// 2 * 10 + 4 * 30 = 140
run("dot product", rh`sum (a.*i * b.*i)`, { a: va, b: vb })

// Matrix transpose Λj. Λi. A_{i,j}
// { 0: { 0: 1, 1: 3 }, 1: { 0: 2, 1: 4 } }
run("transpose", rh`{ *j: { *i: A.*i.*j } }`, { A: M })

// Row sums Λi. Σj. A_{i,j}
// { 0: 3, 1: 7 }
run("row sums", rh`{ *i: sum A.*i.*j }`, { A: M })

// Matrix multiply Λi. Λj. Σk. (A_{i,k} * B_{k,j})
// { 0: { 0: 19, 1: 22 }, 1: { 0: 43, 1: 50 } }
run("matrix multiply", rh`{ *i: { *j: sum (A.*i.*k * B.*k.*j) } }`, { A: M, B: N })

// Relational queries

// Selection & projection Σi. ((a_{i,age} > 21) & a_{i,salary})
// a failed comparison is undefined, so it filters: Alice + Carol = 270
run("selection & projection", rh`sum ((a.*i.age > 21) & a.*i.salary)`, { a: emp })

// Inner join Λi. Λj. (⟨a_{i,dept}⟩_{b_{j,id}} & { emp ↦ a_{i,name}, mgr ↦ b_{j,mgr} })
// use group? for the inner loop (no default, core semantics)
// result: { 0: { 0: Alice/Erin }, 1: { 1: Bob/Frank }, 2: { 0: Carol/Erin } }
run("inner join, group?", rh`{ *i: group? *j (singleton(a.*i.dept).(b.*j.id) & { emp: a.*i.name, mgr: b.*j.mgr }) }`, { a: emp, b: dept })

// Outer join (vector add) Λi. ((a_i + b_i) ∥ a_i ∥ b_i)
// result: { 0: 1, 1: 12, 2: 20, 3: 34 }, i ranges over the keys of a and of b
run("outer join", rh`{ *i: (a.*i? + b.*i?) || a.*i? || b.*i? }`, { a: va, b: vb })

// Group-by { a_{i,dept} ↦ Σi. a_{i,salary} } ≜ Λk. Σi. (⟨a_{i,dept}⟩_k & a_{i,salary})
// total salary per department: { 1: 270, 2: 40, 3: 60 }
run("group-by", rh`{ a.*i.dept: sum a.*i.salary }`, { a: emp })
run("group-by, desugared", rh`{ *k: sum (singleton(a.*i.dept).*k & a.*i.salary) }`, { a: emp })

// Tree and graph processing

// Triangle counting Σi. Σj. Σk. (G_{i,j} & G_{j,k} & G_{k,i} & 1)
// the triangle 0 → 1 → 2 → 0 is counted once per rotation: 3
run("triangle counting", rh`sum (G.*i.*j & G.*j.*k & G.*k.*i & 1)`, { G })

// Min-plus product Λi. Λj. min_k. (D_{i,k} + D_{k,j})
// one relaxation step: D_{0,1} improves from 4 to 1 + 2 = 3
run("min-plus product", rh`{ *i: { *j: min (D.*i.*k + D.*k.*j) } }`, { D })

// ---------- Section 2.3, "Why Initialize Folds to ⊥?" ----------

// Σj. a_{s_j} where s_j = Σi. (a_j & a_i & 0), a = {0 ↦ 1}
// paper: 1 (folds start at ⊥; starting at 0 diverges. won't diverge in Rhyme)
// Lift *j out so a per-j sum is performed
run("Σj.a_{s_j}", rh`sum? *j & a.(sum? a.*j & a.*i & 0)`, { a: [1] })

// ---------- Section 4, "Empty or Absent? Why Defaults Are Hard" ----------

// Row sums Λi. Σj. A_{i,j} without a default (core semantics)
// paper: row 1 is dropped, { 0: 3, 2: 33 }
run("row sums, sum?", rh`{ *i: sum? A.*i.*j }`, { A })

// Row sums with a default
// paper: { 0: 3, 1: 0, 2: 33 }
run("row sums, sum", rh`{ *i: sum A.*i.*j }`, { A })

// Copy Λi. Λj. A_{i,j} without a default (core semantics): group? is the
// tabulation that starts at ⊥, like sum? for sums
// paper: "silently deletes row 1", rhyme: { 0: {...}, 2: {...} }, no row 1
run("copy, group?", rh`group? *i (group? *j A.*i.*j)`, { A })

// ---------- Section 5, Table 1 (05-filtering.tex) ----------

// Λi. a_i, inputs {} / 5
// paper: {} / ⊥, rhyme: {} / {}
run("Λi.a_i on {}", rh`{ *i: a.*i }`, { a: {} })
run("Λi.a_i on 5", rh`{ *i: a.*i }`, { a: 5 })

// Same with group? (no default): ⊥ / ⊥. Neither group nor group? matches the
// paper on both inputs; the paper's default fires only if a is a map.
run("Λi.a_i on {}, group?", rh`group? *i a.*i`, { a: {} })
run("Λi.a_i on 5, group?", rh`group? *i a.*i`, { a: 5 })

// Row sums Λi. Σj. A_{i,j}, input A
// paper: { 0: 3, 1: 0, 2: 33 }
run("row sums", rh`{ *i: sum A.*i.*j }`, { A })

// Copy Λi. Λj. A_{i,j}, input A
// paper: A, with 1 ↦ {}
run("copy", rh`{ *i: { *j: A.*i.*j } }`, { A })

// Σi. (a_i & ⊥), input α (also Section 4, "The Body Could Succeed")
// paper: 0, every element is filtered out
run("Σi.(a_i & ⊥)", rh`sum (a.*i & a.*i.foo)`, { a: alpha })

// Σj. a_{j,9}, input α (also Section 4, "The Body Could Succeed")
// paper: 0, no row has column 9
run("Σj.a_{j,9}", rh`sum a.*j.(9)`, { a: alpha })

// Λi. (a_i =? 5), input {1 ↦ 7}
// paper: {}
run("Λi.(a_i =? 5)", rh`{ *i: a.*i == 5 }`, { a: { 1: 7 } })

// Column sums Λi. Σj. a_{j,i}, inputs α / {0 ↦ {}} / {}
// (also Section 4, "All Collections Exist")
// paper: { 1: 3, 2: 4 } / {} / ⊥, rhyme: { 1: 3, 2: 4 } / {} / {}
run("column sums on alpha", rh`{ *i: sum a.*j.*i }`, { a: alpha })
run("column sums on {0: {}}", rh`{ *i: sum a.*j.*i }`, { a: { 0: {} } })
run("column sums on {}", rh`{ *i: sum a.*j.*i }`, { a: {} })

// Same with group?: { 1: 3, 2: 4 } / ⊥ / ⊥, the paper gives {} on {0 ↦ {}}
// because a row exists
run("column sums on {0: {}}, group?", rh`group? *i (sum a.*j.*i)`, { a: { 0: {} } })
run("column sums on {}, group?", rh`group? *i (sum a.*j.*i)`, { a: {} })

// Λi. (a_i & Σj. a_{j,i}), input α' (also Section 5, "Which Derivation?")
// a.*j.*i? marking the lookup as a filter: a 'maybe' lookup
// rhyme: { 0: 4, 1: 3, 5: 0 }, same as the paper
run("Λi.(a_i & Σj.a_{j,i}), filter", rh`{ *i: a.*i & (sum a.*j.*i?) }`, { a: alpha1 })

// Diagonal Λi. a_{i,i}, inputs {} / {0 ↦ {1 ↦ 7}}
// paper: {} / {}
run("diagonal on {}", rh`{ *i: a.*i.*i }`, { a: {} })
run("diagonal on {0: {1: 7}}", rh`{ *i: a.*i.*i }`, { a: { 0: { 1: 7 } } })

// Group-by (Section 1), inputs d / d' / {}
// paper: { 7: 40, 11: 5 } / { 7: 40, 11: 0 } / ⊥, rhyme: same / same / {}
run("group-by on d", rh`{ d.*r.key: sum d.*r.val }`, { d })
run("group-by on d'", rh`{ d.*r.key: sum d.*r.val }`, { d: d1 })
run("group-by on {}", rh`{ d.*r.key: sum d.*r.val }`, { d: {} })

// Same with group? and an explicit generator ⟨d_{r,key}⟩_k for the group key
// rhyme: { 7: 40, 11: 5 } / { 7: 40, 11: 0 } / ⊥, same as the paper
run("group-by on d, group?", rh`group? *k (sum (singleton(d.*r.key).*k & d.*r.val))`, { d })
run("group-by on d', group?", rh`group? *k (sum (singleton(d.*r.key).*k & d.*r.val))`, { d: d1 })
run("group-by on {}, group?", rh`group? *k (sum (singleton(d.*r.key).*k & d.*r.val))`, { d: {} })

// Λm. Λi. (a_i & ⟨i⟩_m), input {1 ↦ 5, 2 ↦ 6}
// (variable as a value; also Section 6, where a natural translation diverges)
// paper: { 1: { 1: 1 }, 2: { 2: 2 } }
run("Λm.Λi.(a_i & ⟨i⟩_m)", rh`{ *m: { *i: a.*i & singleton(*i).*m } }`, { a: { 1: 5, 2: 6 } })
