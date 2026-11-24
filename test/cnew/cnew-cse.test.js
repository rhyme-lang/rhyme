// Common subexpressions in the c-new emitter (src/c-codegen.js).
//
// These drive emitCodeLowLevelC directly with hand-built loopgen statements,
// so they check the generated C text only -- nothing is compiled. The
// invalidation cases (kills) cannot be reached from queries today, since
// loopgen reads a tmp only after the nest that writes it, but the emitter must
// not depend on that.

const { emitCodeLowLevelC } = require('../../src/c-codegen')
const { setEmitPseudoState } = require('../../src/prettyprint')

// IR builders, in the shapes loopgen produces
let v = op => ({ key: "var", op })
let k = op => ({ key: "const", op })
let input = { key: "input", op: "inp" }
let get = (a, b) => ({ key: "get", arg: [a, b] })
let ref = i => ({ key: "ref", op: i })
let sum = (x, fre) => ({ key: "stateful", op: "sum", mode: "reluctant", arg: [x], fre })
let update = (i, q) => ({ key: "update", arg: [ref(i), q] })
let loop = (x, i, g, body) => ({ key: "for", arg: [x, i, g], body })

let data = get(input, k("data"))
let other = get(input, k("other"))

let emit = (loops, settings = {}, assignments = [{ fre: ["K"] }, { fre: ["K"] }, { fre: ["K"] }]) => {
  let ir = { settings, filters: [], assignments }
  setEmitPseudoState(ir) // for the comments, which pretty-print the statements
  return emitCodeLowLevelC(loops, ir)
}

let count = (code, s) => code.split(s).length - 1

test("a get is computed once per block, and reused by nested blocks", () => {
  // for K in data: two updates both read data[K].value
  let x = get(get(data, v("K")), k("value"))
  let code = emit([loop("K", 0, data, [
    update(1, sum(x, ["K"])),
    update(2, sum(x, ["K"])),
  ])])
  // data is read once, at the top; data[K] is the loop's gen0
  expect(count(code, `rh_get(inp, rh_strv("data", 4))`)).toBe(1)
  expect(count(code, `rh_get(gen0, rh_strv("value", 5))`)).toBe(1)
  // cse: false: one read per use
  let off = emit([loop("K", 0, data, [
    update(1, sum(x, ["K"])),
    update(2, sum(x, ["K"])),
  ])], { cse: false })
  expect(count(off, `rh_strv("value", 5)`)).toBe(2)
})

test("a write to a tmp invalidates reads through tmps", () => {
  // tmp0[K] read, tmp0 written, tmp0[K] read again: the second read must not
  // reuse the first
  let code = emit([loop("K", 0, data, [
    update(1, sum(ref(0), ["K"])),
    update(0, sum(get(data, v("K")), ["K"])),
    update(2, sum(ref(0), ["K"])),
  ])])
  expect(count(code, "rh_get(tmp0, K)")).toBe(2)
})

test("a write to another tmp keeps reads through a tmp", () => {
  // tmp1 written between two reads of tmp0[K]: one read
  let code = emit([loop("K", 0, data, [
    update(1, sum(ref(0), ["K"])),
    update(2, sum(ref(0), ["K"])),
  ])])
  expect(count(code, "rh_get(tmp0, K)")).toBe(1)
})

// tmp<i>[fre] = e0 { vars: e2 }: an object update (rt.deepUpdate)
let objUpdate = (i, e0, vars, e2, mode) => ({
  key: "update", arg: [ref(i), { key: "update", mode, fre: ["K"],
    arg: [e0, { key: "pure", op: "vars", arg: vars.map(v), vars }, e2] }],
})

test("an update that may alias another tmp's maps kills every read through a tmp", () => {
  let reads = (...writes) => count(emit([loop("K", 0, data, [
    update(1, sum(ref(0), ["K"])),
    ...writes,
    update(2, sum(ref(0), ["K"])),
  ])]), "rh_get(tmp0, K)")
  let base = ref(1), val = get(get(data, v("K")), k("value"))
  // one level below a copy of e0: writes into the copy only
  expect(reads(objUpdate(2, base, ["K"], val))).toBe(1)
  // two levels: the nested map is shared with e0's source
  expect(reads(objUpdate(2, base, ["K", "K"], val))).toBe(2)
  // inplace: the slot is e0's map itself
  expect(reads(objUpdate(2, base, ["K"], val, "inplace"))).toBe(2)
  // a fresh e0 ({}) aliases nothing, however deep
  expect(reads(objUpdate(2, k({}), ["K", "K"], val))).toBe(1)
})

test("a loop that writes a tmp invalidates reads made before it", () => {
  // tmp0[K] read in the outer body, then an inner loop reads it before
  // writing it: from the inner loop's second iteration on, the outer read is
  // stale, so the inner one must read again
  let code = emit([loop("K", 0, data, [
    update(1, sum(ref(0), ["K"])),
    loop("J", 1, other, [
      update(2, sum(ref(0), ["K"])),
      update(0, sum(get(other, v("J")), ["K"])),
    ]),
  ])])
  expect(count(code, "rh_get(tmp0, K)")).toBe(2)
})

test("a loop's gen stands for a get only until its source is written", () => {
  // for K in tmp0: tmp0[K] is gen0 until tmp0 is written
  let code = emit([loop("K", 0, ref(0), [
    update(1, sum(get(ref(0), v("K")), ["K"])),
    update(0, sum(get(data, v("K")), ["K"])),
    update(2, sum(get(ref(0), v("K")), ["K"])),
  ])], {}, [{ fre: [] }, { fre: ["K"] }, { fre: ["K"] }])
  expect(count(code, "rh_get(tmp0, K)")).toBe(1) // the second; the first is gen0
  expect(code).toContain("rh_stateful_sum(*p1, gen0)")
})

let ifIn = (x, i, g, body) => ({ key: "if", arg: [x, i, g], body })

test("an if reuses a get already computed as its gen", () => {
  // other[K] read by an update, then `if K in other`: one rh_get, and the if's
  // gen is that local rather than a new gen1
  let code = emit([loop("K", 0, data, [
    update(1, sum(get(other, v("K")), ["K"])),
    ifIn("K", 1, other, [update(2, sum(get(other, v("K")), ["K"]), ["K"])]),
  ])])
  expect(count(code, ", K)")).toBe(1)
  expect(code).not.toContain("gen1")
})

test("sibling ifs on one filter each declare their gen in their own block", () => {
  let body = () => ifIn("K", 1, other, [update(2, sum(get(other, v("K")), ["K"]))])
  let code = emit([loop("K", 0, data, [body(), body()])])
  expect(count(code, "rh_val gen1 = ")).toBe(2)
  // each declaration opens its own block
  for (let l of code.split("\n").map((l, i, ls) => [l, ls[i - 1]]).filter(([l]) => l.includes("rh_val gen1 =")))
    expect(l[1].trim()).toBe("{")
  // with cse off the gen is still a local, read by the body
  let off = emit([loop("K", 0, data, [body()])], { cse: false })
  expect(count(off, "rh_val gen1 = ")).toBe(1)
  expect(off).toContain("rh_stateful_sum(*p")
})

test("reads that do not go through a tmp survive writes", () => {
  let x = get(get(data, v("K")), k("value"))
  let code = emit([loop("K", 0, data, [
    update(1, sum(x, ["K"])),
    update(0, sum(x, ["K"])),
    update(2, sum(x, ["K"])),
  ])])
  expect(count(code, `rh_strv("value", 5)`)).toBe(1)
})

test("an entry made in a block is not visible after it", () => {
  // sibling loops: each reads data[J].value inside its own block
  let x = get(get(other, v("J")), k("value"))
  let code = emit([
    loop("K", 0, data, [loop("J", 1, other, [update(1, sum(x, ["K"]))])]),
    loop("K", 0, data, [loop("J", 1, other, [update(2, sum(x, ["K"]))])]),
  ])
  expect(count(code, `rh_strv("value", 5)`)).toBe(2)
  // the same holds for the inner generator, read inside each outer block;
  // the outer one is read at the top and shared
  expect(count(code, `rh_get(inp, rh_strv("other", 5))`)).toBe(2)
  expect(count(code, `rh_get(inp, rh_strv("data", 4))`)).toBe(1)
})

test("fresh containers are not shared", () => {
  // two {} constants must stay two maps
  let code = emit([loop("K", 0, data, [
    update(1, sum(get(k({}), v("K")), ["K"])),
    update(2, sum(get(k({}), v("K")), ["K"])),
  ])])
  expect(count(code, "rh_map_new()")).toBe(2)
})
