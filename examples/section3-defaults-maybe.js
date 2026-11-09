let { rh, api } = require("../src/rhyme");

// Figure 5 of the PLDI'27 draft, translated by the inferDefaults pass.
//
// A copy of section3-core-maybe.js in which every row is written as the
// surface term and compiled with { inferDefaults: true }: the pass
// (src/defaults.js) inserts the guards and defaults that
// section3-core-maybe.js writes by hand. Expected results are the same.
//
//   Λi.t       { *i: t }  (group *i t)
//   Σi.t       sum(t)
//   x?         *x?  (a filter: x also has a strict generator in every row)
//   ⊥          .bot (a missing input field)
//   ⟨t⟩        singleton(t)
//
// The comments give the guard G and the default z of each loop that the
// pass computes; see section3-core-maybe.js for the hand-written terms.

let run = (name, q, inp, expected, explain = false) => {
  let out
  try {
    let f = api.compile(q, { inferDefaults: true })
    if (explain) {
      console.log(f.explain.pseudo)
      console.log(f.explain.code)
    }
    out = JSON.stringify(f(inp))
  } catch (e) {
    out = "ERROR: " + String(e.message).split("\n")[0]
  }
  let ok = out === JSON.stringify(expected) ? "ok  " : "DIFF"
  console.log(ok, name.padEnd(34), out, ok == "ok  " ? "" : "  expected " + JSON.stringify(expected))
}

// ---------- Data ----------

let alpha = { 0: { 1: 3 }, 1: { 2: 4 } }
let alpha1 = { 0: { 1: 3 }, 1: { 0: 4 }, 5: {} }
let A = [[0, 1, 2], [], [10, 11, 12]]
let d = [{ key: 7, val: 10 }, { key: 11, val: 5 }, { key: 7, val: 30 }]
let d1 = [{ key: 7, val: 10 }, { key: 11 }, { key: 7, val: 30 }] // d', no value 5

// ---------- Λi.a_i ----------
// G = leaf(a), z = leaf(a)
{
  let q = rh`{ *i: a.*i }`
  run("Λi.a_i on {}", q, { a: {} }, {})
  run("Λi.a_i on 5", q, { a: 5 }, 5)
}

// ---------- row sums Λi.Σj.A_{i,j} ----------
// inner: G = asfun(A_i); outer: G = z = leaf(A)
{
  let q = rh`{ *i: sum(A.*i.*j) }`
  run("row sums", q, { A }, { 0: 3, 1: 0, 2: 33 })
}

// ---------- copy Λi.Λj.a_{i,j} ----------
// inner: G = z = leaf(a_i); outer: G = z = leaf(a)
{
  let q = rh`{ *i: { *j: a.*i.*j } }`
  run("copy A", q, { a: A }, { 0: { 0: 0, 1: 1, 2: 2 }, 1: {}, 2: { 0: 10, 1: 11, 2: 12 } })
  run("copy JSON", q, { a: { 0: 5, 1: { 1: 1, 2: 2 } } }, { 0: 5, 1: { 1: 1, 2: 2 } })
}

// ---------- Λi.Λj.(a_{i,j} & b_{i,j}) ----------
// inner: G = leaf(a_i) & leaf(b_i), z = leaf(a_i) ⊓ leaf(b_i)
// outer: G = leaf(a) & leaf(b),     z = leaf(a) ⊓ leaf(b)
{
  let q = rh`{ *i: { *j: a.*i.*j & b.*i.*j } }`
  run("deep intersection", q, { a: { 0: 5, 1: 6 }, b: { 0: 5, 2: 6 } }, { 0: 5 })
  run("deep intersection, 5 vs 6", q, { a: { 0: 5 }, b: { 0: 6 } }, {})
  run("deep intersection, maps", q, { a: { 0: { 1: 2 } }, b: { 0: { 3: 2 } } }, { 0: {} })
}

// ---------- Σi.(a_i & ⊥) ----------
// G = asfun(a) & 1
{
  let q = rh`sum(a.*i & .bot)`
  run("Σi.(a_i & ⊥)", q, { a: alpha }, 0)
}

// ---------- Σj.a_{j,9} ----------
// G = asfun(a) & 1
{
  let q = rh`sum(a.*j.(9))`
  run("Σj.a_{j,9}", q, { a: alpha }, 0)
}

// ---------- Λi.(a_i =? 5) = Λi.⟨a_i⟩_5 ----------
// G = leaf(a) & 1, z = leaf(a)
{
  let q = rh`{ *i: singleton(a.*i).(5) }`
  run("Λi.(a_i =? 5) on {1: 7}", q, { a: { 1: 7 } }, {})
  run("Λi.(a_i =? 5) on 7", q, { a: 7 }, 7)
}

// ---------- column sums Λi.Σj.a_{j,i} ----------
// inner: G = Λj.a_{j,i} (j must take real keys)
// outer: G = Λj.leaf(a_j), z = {} (the shape mentions j)
{
  let q = rh`{ *i: sum(a.*j.*i) }`
  run("column sums on α", q, { a: alpha }, { 1: 3, 2: 4 })
  run("column sums on {0: {}}", q, { a: { 0: {} } }, {})
  run("column sums on {}", q, { a: {} }, undefined)
}

// ---------- Λi.(a_i & Σj.a_{j,i}) ----------
// inner as in the column sums
// outer: G = leaf(a) & Λj.leaf(a_j), z = leaf(a)
{
  let q = rh`{ *i: a.*i & sum(a.*j.*i) }`
  run("Λi.(a_i & Σj.a_{j,i})", q, { a: alpha1 }, { 0: 4, 1: 3 })
}

// ---------- Λi.(a_i & Σj.a_{j,i?}) ----------
// inner: a.*j.*i? is a filter, G = asfun(a)
// outer: G = leaf(a) & 1 & 1, z = leaf(a)
{
  let q = rh`{ *i: a.*i & sum(a.*j.*i?) }`
  run("Λi.(a_i & Σj.a_{j,i?})", q, { a: alpha1 }, { 0: 4, 1: 3, 5: 0 })
}

// ---------- diagonal Λi.a_{i,i} ----------
// G = Λi.a_{i,i} (i must take real keys), z = {}
{
  let q = rh`{ *i: a.*i.*i }`
  run("diagonal on {}", q, { a: {} }, undefined)
  run("diagonal on {0: {1: 7}}", q, { a: { 0: { 1: 7 } } }, undefined)
}

// ---------- Λi.a_{i,i?} ----------
// G = leaf(a) & 1, z = leaf(a)
{
  let q = rh`{ *i: a.*i.*i? }`
  run("diagonal filter on {}", q, { a: {} }, {})
  run("diagonal filter on {0: {1: 7}}", q, { a: { 0: { 1: 7 } } }, {})
}

// ---------- group-by Λk.Σi.(⟨a_{i,key}⟩_k & a_{i,val}) ----------
// Rhyme's { e: t } is read as Λk.(⟨e⟩_k & t), with the filter moved into
// the sum that binds i.
// inner: G = Λi.(⟨a_{i,key}⟩_k & a_i & 1)
// outer: G = Λi.(leaf(⟨a_{i,key}⟩) & a_i & 1), z = {}
{
  let q = rh`{ a.*i.key: sum(a.*i.val) }`
  run("group-by on d", q, { a: d }, { 7: 40, 11: 5 })
  run("group-by on d'", q, { a: d1 }, { 7: 40, 11: 0 })
  run("group-by on {}", q, { a: {} }, undefined)
}

// ---------- Λm.Λi.(a_i & ⟨i⟩_m) ----------
// inner: G = Λi.(a_i & ⟨i⟩_m), z = {}
// outer: G = Λi.(a_i & leaf(⟨i⟩)), z = {}
// rhyme's singleton stores the key as a string: { 1: "1" }, not { 1: 1 }
{
  let q = rh`{ *m: { *i: a.*i & singleton(*i).*m } }`
  run("Λm.Λi.(a_i & ⟨i⟩_m)", q, { a: { 1: 5, 2: 6 } }, { 1: { 1: "1" }, 2: { 2: "2" } })
}

// ---------- Λi.(a_i & Σj.b_{j,i?}), b a different collection ----------
// inner: G = asfun(b)
// outer: G = leaf(a) & 1 & 1, z = leaf(a)
{
  let q = rh`{ *i: a.*i & sum(b.*j.*i?) }`
  run("Λi.(a_i & Σj.b_{j,i?}), b = α'", q, { a: alpha1, b: alpha1 }, { 0: 4, 1: 3, 5: 0 })
  run("Λi.(a_i & Σj.b_{j,i?}), b = {}", q, { a: { 0: 1, 1: 2 }, b: {} }, { 0: 0, 1: 0 })
  run("Λi.(a_i & Σj.b_{j,i?}), b = {0: {}}", q, { a: { 0: 1, 1: 2 }, b: { 0: {} } }, { 0: 0, 1: 0 })
  run("Λi.(a_i & Σj.b_{j,i?}), b = {0: {1: 5}}", q, { a: { 0: 1, 1: 2 }, b: { 0: { 1: 5 } } }, { 0: 0, 1: 5 })
}
