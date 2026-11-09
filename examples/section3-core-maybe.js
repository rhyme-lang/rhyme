let { rh, api } = require("../src/rhyme");

// Figure 5 of the PLDI'27 draft, translated by hand into the core calculus.
//
// A copy of section3-core.js that writes the filter key x? with Rhyme's
// maybe mode (*x?) instead of (1 & *x). The two agree when x also has a
// strict generator (a lookup on *x without ?), which holds in every row
// here: Rhyme then drops the maybe lookup as a generator (opt-loopgen.js)
// and adds no dependency for it (strictVars in simple-eval.js). If every
// lookup on x is a maybe lookup, Rhyme instead treats them as the
// generators of a full outer join, whereas the paper's x? never grounds x.
//
// The last section adds rows where the filter's prefix ranges over a
// different collection than the generator, which needed the extract1 fix.
//
// Each row applies the translation D of Figure 6 (sections/06-desugar.tex)
// to the surface term, and runs the result in Rhyme using only core
// constructs:
//
//   Λi.t   group? *i t          (no default: ⊥ if empty)
//   Σi.t   sum? t               (no default: ⊥ if empty)
//   t1 ∥ t2, t1 & t2            ||, &
//   asfun t, asnum t            asObj(t), asNum(t)
//   ⟨t⟩                         singleton(t)
//   x?  (= 1 & x)               *x?
//   ⊥                           .bot (a missing input field)
//
// and the derived forms of Figure 6(c):
//
//   leaf(t)  = asnum(t) ∥ (asfun(t) & {})
//   t1 ⊓ t2  = ⟨asnum t1⟩_{t2} ∥ (asfun t1 & asfun t2 & {})
//
// D(Σi.t) = Σi.X ∥ (G_i(X) & 0) and D(Λi.t) = Λi.X ∥ (G_i(X) & z_i(X)),
// where X = D(t). Each row shows the guard G and the default z.
//
// Variables: a Rhyme variable name denotes one variable for the whole
// query, and two loops that use the same name share it (e.g.
// [sum? a.*i, sum? b.*i] joins a and b on *i). The guard Λi.C(X) binds
// its own copy of i, so guards use fresh names (*i1, *j1, ...).

let run = (name, q, inp, expected, explain = false) => {
  let out
  try {
    let f = api.compile(q)
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

let leaf = t => rh`(asNum(${t}) || (asObj(${t}) & {}))`
let meet = (s, t) => rh`(singleton(asNum(${s})).(${t}) || (asObj(${s}) & asObj(${t}) & {}))`

// ---------- Data ----------

let alpha = { 0: { 1: 3 }, 1: { 2: 4 } }
let alpha1 = { 0: { 1: 3 }, 1: { 0: 4 }, 5: {} }
let A = [[0, 1, 2], [], [10, 11, 12]]
let d = [{ key: 7, val: 10 }, { key: 11, val: 5 }, { key: 7, val: 30 }]
let d1 = [{ key: 7, val: 10 }, { key: 11 }, { key: 7, val: 30 }] // d', no value 5

// ---------- Λi.a_i ----------
// C_{i}(a_i) = leaf(a), Z_{i}(a_i) = leaf(a)
// G = leaf(a), z = leaf(a)
{
  let q = rh`(group? *i a.*i) || (${leaf(".a")} & ${leaf(".a")})`
  run("Λi.a_i on {}", q, { a: {} }, {})
  run("Λi.a_i on 5", q, { a: 5 }, 5)
}

// ---------- row sums Λi.Σj.A_{i,j} ----------
// inner: C_{j}(A_{i,j}) = asfun(A_i)                G = asfun(A_i)
// outer: C_{i},{j}(A_{i,j}) = leaf(A), Z = leaf(A)  G = z = leaf(A)
{
  let inner = rh`((sum? A.*i.*j) || (asObj(A.*i) & 0))`
  let q = rh`(group? *i ${inner}) || (${leaf(".A")} & ${leaf(".A")})`
  run("row sums", q, { A }, { 0: 3, 1: 0, 2: 33 })
}

// ---------- copy Λi.Λj.a_{i,j} ----------
// inner: G = z = leaf(a_i); outer: G = z = leaf(a)
{
  let inner = rh`((group? *j a.*i.*j) || (${leaf("a.*i")} & ${leaf("a.*i")}))`
  let q = rh`(group? *i ${inner}) || (${leaf(".a")} & ${leaf(".a")})`
  run("copy A", q, { a: A }, { 0: { 0: 0, 1: 1, 2: 2 }, 1: {}, 2: { 0: 10, 1: 11, 2: 12 } })
  run("copy JSON", q, { a: { 0: 5, 1: { 1: 1, 2: 2 } } }, { 0: 5, 1: { 1: 1, 2: 2 } })
}

// ---------- Λi.Λj.(a_{i,j} & b_{i,j}) ----------
// inner: G = leaf(a_i) & leaf(b_i), z = leaf(a_i) ⊓ leaf(b_i)
// outer: G = leaf(a) & leaf(b),     z = leaf(a) ⊓ leaf(b)
{
  let inner = rh`((group? *j (a.*i.*j & b.*i.*j)) || ((${leaf("a.*i")} & ${leaf("b.*i")}) & ${meet(leaf("a.*i"), leaf("b.*i"))}))`
  let q = rh`(group? *i ${inner}) || ((${leaf(".a")} & ${leaf(".b")}) & ${meet(leaf(".a"), leaf(".b"))})`
  run("deep intersection", q, { a: { 0: 5, 1: 6 }, b: { 0: 5, 2: 6 } }, { 0: 5 })
  // inputs where the hand encoding of section3.js differs from the paper
  run("deep intersection, 5 vs 6", q, { a: { 0: 5 }, b: { 0: 6 } }, {})
  run("deep intersection, maps", q, { a: { 0: { 1: 2 } }, b: { 0: { 3: 2 } } }, { 0: {} })
}

// ---------- Σi.(a_i & ⊥) ----------
// C_{i}(a_i & ⊥) = asfun(a) & 1                     G = asfun(a) & 1
{
  let q = rh`(sum? (a.*i & .bot)) || ((asObj(.a) & 1) & 0)`
  run("Σi.(a_i & ⊥)", q, { a: alpha }, 0)
}

// ---------- Σj.a_{j,9} ----------
// C_{j}(a_{j,9}) = C(a_j) & C(9) = asfun(a) & 1     G = asfun(a) & 1
{
  let q = rh`(sum? a.*j.(9)) || ((asObj(.a) & 1) & 0)`
  run("Σj.a_{j,9}", q, { a: alpha }, 0)
}

// ---------- Λi.(a_i =? 5) = Λi.⟨a_i⟩_5 ----------
// C_{i}(⟨a_i⟩_5) = C(a_i) & C(5) = leaf(a) & 1
// Z_{i}(⟨a_i⟩_5) = leaf(a) ⊓ none = leaf(a)
// G = leaf(a) & 1, z = leaf(a)
{
  let q = rh`(group? *i singleton(a.*i).(5)) || ((${leaf(".a")} & 1) & ${leaf(".a")})`
  run("Λi.(a_i =? 5) on {1: 7}", q, { a: { 1: 7 } }, {})
  run("Λi.(a_i =? 5) on 7", q, { a: 7 }, 7)
}

// ---------- column sums Λi.Σj.a_{j,i} ----------
// inner: a_{j,i} is a generator of the outer i, kept unchanged:
//   C_{j}(a_{j,i}) = a_{j,i} mentions j            G = Λj.a_{j,i}
// outer: C_{i},{j}(a_{j,i}) = leaf(a_j) mentions j:
//   C = Λj.leaf(a_j)                               G = Λj.leaf(a_j)
//   Z = leaf(a_j) mentions j, so none              z = {}
{
  let inner = rh`((sum? a.*j.*i) || ((group? *j1 a.*j1.*i) & 0))`
  let q = rh`(group? *i ${inner}) || ((group? *j2 ${leaf("a.*j2")}) & {})`
  run("column sums on α", q, { a: alpha }, { 1: 3, 2: 4 })
  run("column sums on {0: {}}", q, { a: { 0: {} } }, {})
  run("column sums on {}", q, { a: {} }, undefined)
}

// ---------- Λi.(a_i & Σj.a_{j,i}) ----------
// inner as in the column sums
// outer: C = leaf(a) & Λj.leaf(a_j), Z = leaf(a) ⊓ none = leaf(a)
{
  let inner = rh`((sum? a.*j.*i) || ((group? *j1 a.*j1.*i) & 0))`
  let q = rh`(group? *i (a.*i & ${inner})) || ((${leaf(".a")} & (group? *j2 ${leaf("a.*j2")})) & ${leaf(".a")})`
  run("Λi.(a_i & Σj.a_{j,i})", q, { a: alpha1 }, { 0: 4, 1: 3 })
}

// ---------- Λi.(a_i & Σj.a_{j,i?}) ----------
// inner: a_{j,(1&i)} is a filter: C_{j} = C(a_j) & C(1 & i) = asfun(a)
//   G = asfun(a)
// outer: C_{i},{j} = leaf(a) & (C(a) & 1) = leaf(a) & 1 & 1
//   Z = leaf(a) ⊓ (Z(a) ⊓ none) = leaf(a)          z = leaf(a)
{
  let inner = rh`((sum? a.*j.*i?) || (asObj(.a) & 0))`
  let q = rh`(group? *i (a.*i & ${inner})) || ((${leaf(".a")} & 1 & 1) & ${leaf(".a")})`
  run("Λi.(a_i & Σj.a_{j,i?})", q, { a: alpha1 }, { 0: 4, 1: 3, 5: 0 })
}

// ---------- diagonal Λi.a_{i,i} ----------
// C_{i}(a_{i,i}) = leaf(a_i) mentions i:
//   G = Λi.C_∅(a_{i,i}) = Λi.a_{i,i}, z = {}
{
  let q = rh`(group? *i a.*i.*i) || ((group? *i1 a.*i1.*i1) & {})`
  run("diagonal on {}", q, { a: {} }, undefined)
  run("diagonal on {0: {1: 7}}", q, { a: { 0: { 1: 7 } } }, undefined)
}

// ---------- Λi.a_{i,i?} ----------
// C_{i}(a_{i,(1&i)}) = leaf(a) & 1, Z = leaf(a) ⊓ none = leaf(a)
{
  let q = rh`(group? *i a.*i.*i?) || ((${leaf(".a")} & 1) & ${leaf(".a")})`
  run("diagonal filter on {}", q, { a: {} }, {})
  run("diagonal filter on {0: {1: 7}}", q, { a: { 0: { 1: 7 } } }, {})
}

// ---------- group-by Λk.Σi.(⟨a_{i,key}⟩_k & a_{i,val}) ----------
// inner: ⟨a_{i,key}⟩_k is a generator of the outer k, kept unchanged;
//   C_{i} = ⟨a_{i,key}⟩_k & asfun(a) & 1 mentions i:
//   G = Λi.(⟨a_{i,key}⟩_k & a_i & 1)
// outer: C_{k},{i} = leaf(⟨a_{i,key}⟩) & ... mentions i:
//   G = Λi.(leaf(⟨a_{i,key}⟩) & a_i & 1)
//   Z = leaf(⟨a_{i,key}⟩) mentions i, so none       z = {}
{
  let body = rh`(singleton(a.*i.key).*k & a.*i.val)`
  let inner = rh`((sum? ${body}) || ((group? *i1 (singleton(a.*i1.key).*k & a.*i1 & 1)) & 0))`
  let q = rh`(group? *k ${inner}) || ((group? *i2 (${leaf("singleton(a.*i2.key)")} & a.*i2 & 1)) & {})`
  run("group-by on d", q, { a: d }, { 7: 40, 11: 5 })
  run("group-by on d'", q, { a: d1 }, { 7: 40, 11: 0 })
  run("group-by on {}", q, { a: {} }, undefined)
}

// ---------- Λm.Λi.(a_i & ⟨i⟩_m) ----------
// inner: ⟨i⟩_m is a generator of the outer m, kept unchanged;
//   C_{i} = leaf(a) & ⟨i⟩_m mentions i:  G = Λi.(a_i & ⟨i⟩_m), z = {}
// outer: C_{m},{i} = 1 & leaf(⟨i⟩) mentions i:
//   G = Λi.(a_i & leaf(⟨i⟩)), z = {}
// rhyme's singleton stores the key as a string: { 1: "1" }, not { 1: 1 }
{
  let inner = rh`((group? *i (a.*i & singleton(*i).*m)) || ((group? *i1 (a.*i1 & singleton(*i1).*m)) & {}))`
  let q = rh`(group? *m ${inner}) || ((group? *i2 (a.*i2 & ${leaf("singleton(*i2)")})) & {})`
  run("Λm.Λi.(a_i & ⟨i⟩_m)", q, { a: { 1: 5, 2: 6 } }, { 1: { 1: "1" }, 2: { 2: "2" } })
}

// ---------- Λi.(a_i & Σj.b_{j,i?}), b a different collection ----------
// inner: C_{j}(b_{j,i?}) = C(b_j) & C(i?) = asfun(b)     G = asfun(b)
// outer: C_{i},{j} = leaf(a) & (C(b) & 1) = leaf(a) & 1 & 1
//   Z = leaf(a) ⊓ (Z(b) ⊓ none) = leaf(a)                 z = leaf(a)
// With b = {}, the loop over j never runs. Before the extract1 fix, the
// loop over i was nested in it, so the core group? was empty and the
// default {} fired.
{
  let inner = rh`((sum? b.*j.*i?) || (asObj(.b) & 0))`
  let q = rh`(group? *i (a.*i & ${inner})) || ((${leaf(".a")} & 1 & 1) & ${leaf(".a")})`
  run("Λi.(a_i & Σj.b_{j,i?}), b = α'", q, { a: alpha1, b: alpha1 }, { 0: 4, 1: 3, 5: 0 })
  run("Λi.(a_i & Σj.b_{j,i?}), b = {}", q, { a: { 0: 1, 1: 2 }, b: {} }, { 0: 0, 1: 0 })
  run("Λi.(a_i & Σj.b_{j,i?}), b = {0: {}}", q, { a: { 0: 1, 1: 2 }, b: { 0: {} } }, { 0: 0, 1: 0 })
  run("Λi.(a_i & Σj.b_{j,i?}), b = {0: {1: 5}}", q, { a: { 0: 1, 1: 2 }, b: { 0: { 1: 5 } } }, { 0: 0, 1: 5 })
}
