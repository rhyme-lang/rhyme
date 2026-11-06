let { rh, api } = require("../src/rhyme");
let { runtime: rt } = require("../src/simple-runtime")

let run = (name, q, inp, explain = false) => {
  try {
    let f = api.compile(q)
    if (explain) {
      console.log(f.explain.pseudo)
      console.log(f.explain.code)
    }
    console.log(name.padEnd(36), JSON.stringify(f(inp)))
  } catch (e) {
    console.log(name.padEnd(36), "ERROR:", String(e.message).split("\n")[0])
  }
}

// ---------- Data (rhyme_examples.v) ----------

let alpha = { 0: { 1: 3 }, 1: { 2: 4 } }
let alpha1 = { 0: { 1: 3 }, 1: { 0: 4 }, 5: {} }
let A = [[0, 1, 2], [], [10, 11, 12]]
let d = [{ key: 7, val: 10 }, { key: 11, val: 5 }, { key: 7, val: 30 }]
let d1 = [{ key: 7, val: 10 }, { key: 11 }, { key: 7, val: 30 }] // d', no value 5

// section 3, table 1

// tabulation on empty object or number
// here we simulate the translation that gives a default based on the shape
// result: {} / 5
run("Lam_i.a_i on {}", rh`(group? *i a.*i) || (.a)`, { a: {} })
run("Lam_i.a_i on 5", rh`(group? *i a.*i) || (.a)`, { a: 5 })
run("Lam_i.a_i on 5 with update", rh`(update .a *i a.*i) || (.a)`, { a: 5 })

// row sums
// inner sum gets a default
// result: {"0":3,"1":0,"2":33}
run("row sums", rh`group? *i (sum A.*i.*j)`, { A })

// copy
// inner group gets a default
// result: {"0":{"0":0,"1":1,"2":2},"1":{},"2":{"0":10,"1":11,"2":12}}
run("copy1", rh`group? *i (group *j A.*i.*j)`, { A })

// copy
// inner group gets a simulated default
// result: {"0":{"0":0,"1":1,"2":2},"1":{},"2":{"0":10,"1":11,"2":12}}
run("copy2",
  rh`group? *i ((group? *j a.*i.*j) || .a.*i)`,
  { a: { 0: 5, 1: { 1: 1, 2: 2 } } })

// inner group gets a simulated default
// result: {"0":5}
run("Lam_i.Lam_j.a_i,j & b_i,j",
  rh`group? *i ((group? *j a.*i.*j & b.*i.*j) || .a.*i)`,
  { a: { 0: 5, 1: 6 }, b: { 0: 5, 2: 6 } })

// result: 0
run("Sum_i.a_i & bot", rh`sum (a.*i & a.foo)`, { a: alpha })

// result: 0
run("Sum_j.a_j,9", rh`sum (a.*j.9)`, { a: alpha })

// result: {} / 7
run("Lam_i.a_i =? 5", rh`group *i (a.*i == 5)`, { a: { 1: 7 } })
run("Lam_i.a_i =? 5", rh`(group? *i (a.*i == 5)) || .a`, { a: 7 })

// column sums
// result: {"1":3,"2":4} / {} / bot
run("column sums", rh`group? *i (sum a.*j.*i)`, { a: alpha })
run("column sums", rh`group *i (sum a.*j.*i)`, { a: { 0: {} } })
run("column sums", rh`group? *i (sum a.*j.*i)`, { a: {} })

// result: {"0":4,"1":3} / {"0":4,"1":3,"5":0}
run("Lam_i.(a_i & Sum_j.a_j,i)", rh`group? *i (a.*i & (sum a.*j.*i))`, { a: alpha1 })
run("Lam_i.(a_i & Sum_j.a_j,i?)", rh`group? *i (a.*i & (sum a.*j.*i?))`, { a: alpha1 })

// result: bot / bot
run("diagonal", rh`group? *i a.*i.*i`, { a: {} })
run("diagonal", rh`group? *i a.*i.*i`, { a: { 0: { 1: 7 } } })

// result: {} / {}
run("diagonal with filter", rh`group *i a.*i.*i?`, { a: {} })
run("diagonal with filter", rh`group *i a.*i.*i?`, { a: { 0: { 1: 7 } } })

// result: {"7":40,"11":5} / {"7":40,"11":0} / bot
run("group-by", rh`group? *k (sum singleton(a.*i.key).*k & a.*i.val )`, { a: d })
run("group-by", rh`group? *k (sum singleton(a.*i.key).*k & a.*i.val )`, { a: d1 })
run("group-by", rh`group? *k (sum singleton(a.*i.key).*k & a.*i.val )`, { a: {} })

// result: {"1":{"1":"1"},"2":{"2":"2"}}
run("Lam_m.Lam_i.(a_i & <i>_m)",
  rh`group? *m (group? *i (a.*i & singleton(*i).*m))`,
  { a: { 1: 5, 2: 6 } })
