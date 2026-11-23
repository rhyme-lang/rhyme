// JAX acceleration (settings.accel = "jax"): the dense tensor-algebra parts of
// a query run in a JAX worker, the rest as JS loops. Every query is checked
// against the plain JS backend.
//
// Needs a python with jax: $RHYME_JAX_PYTHON, else python3. Skipped if absent
// -- unless RHYME_JAX_PYTHON is set, then a python without jax is an error.

const { rh } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')
const { typing, types } = require('../../src/typing')
const bridge = require('../../src/jax/bridge')

let jax = bridge.check()
if (!jax.ok && process.env.RHYME_JAX_PYTHON)
  throw new Error("RHYME_JAX_PYTHON is set, but " + jax.error)
let testJax = jax.ok ? test : test.skip

afterAll(() => bridge.stop())

let dense = dim => typing.createVec("dense", types.u32, dim, types.f64)
let schemaOf = dims => typing.parseType(Object.fromEntries(
  Object.entries(dims).map(([k, d]) => [k, d ? dense(d) : types.unknown])))

// deterministic pseudo-random data
let seed = 1
let rnd = (...shape) => shape.length == 0
  ? (seed = (seed * 16807) % 2147483647) % 10 - 3
  : Array.from({ length: shape[0] }, () => rnd(...shape.slice(1)))

// compile both ways, compare, and return what was offloaded
let check = (query, dims, input) => {
  let schema = schemaOf(dims)
  let expected = compile(query, { schema })(input)
  let f = compile(query, { schema, accel: "jax" })
  expect(f(input)).toEqual(expected)
  return f.explain
}

let users = n => Array.from({ length: n }, (_, u) => ({ name: "u" + u, team: "t" + (u % 3) }))

describe("dense queries run fully in jax", () => {
  let fully = explain => {
    expect(explain.code).not.toContain("rt.entries")
    expect(explain.accel.members.size).toBe(explain.ir.assignments.length)
  }

  testJax("matmul", () => {
    let e = check(rh`{*i: {*j: sum(A.*i.*k * B.*k.*j)}}`, { A: 2, B: 2 }, { A: rnd(3, 4), B: rnd(4, 5) })
    fully(e)
    expect(e.accel.src).toContain("jnp.einsum")
    console.log(rnd(3, 4))
  })

  testJax("batched matmul", () => {
    fully(check(rh`{*b: {*i: {*j: sum(A.*b.*i.*k * B.*b.*k.*j)}}}`, { A: 3, B: 3 },
      { A: rnd(2, 3, 4), B: rnd(2, 4, 2) }))
  })

  testJax("transpose", () => {
    fully(check(rh`{*j: {*i: A.*i.*j}}`, { A: 2 }, { A: rnd(3, 4) }))
  })

  testJax("row normalize", () => {
    let A = rnd(3, 4).map(r => r.map(x => Math.abs(x) + 1))
    fully(check(rh`{*i: {*j: A.*i.*j / (sum A.*i.*k)}}`, { A: 2 }, { A }))
  })

  testJax("outer product", () => {
    fully(check(rh`{*i: {*j: x.*i * y.*j}}`, { x: 1, y: 1 }, { x: rnd(3), y: rnd(4) }))
  })

  testJax("dot product of different lengths", () => {
    // the domain of *i is the intersection of the keys: the shorter length
    fully(check(rh`sum(x.*i * y.*i)`, { x: 1, y: 1 }, { x: rnd(5), y: rnd(3) }))
  })

  testJax("reductions over nothing", () => {
    // *i is a result key, so each sum sees exactly one element (bnd = [])
    fully(check(rh`{*i: sum data.*i}`, { data: 1 }, { data: [1, 2, 3] }))
    fully(check(rh`{*i: max data.*i}`, { data: 1 }, { data: rnd(4) }))
    fully(check(rh`{*i: {*j: sum A.*i.*j}}`, { A: 2 }, { A: rnd(3, 2) }))
  })

  testJax("column max and total", () => {
    fully(check(rh`{*j: max A.*i.*j}`, { A: 2 }, { A: rnd(3, 4) }))
    fully(check(rh`sum A.*i.*j`, { A: 2 }, { A: rnd(3, 4) }))
  })

})

testJax("rows of a matrix stay in JS (references to the input rows)", () => {
  let A = rnd(3, 4)
  let e = check(rh`{*i: A.*i}`, { A: 2 }, { A })
  expect(e.accel.members.size).toBe(0)
})

describe("mixed queries: jax for the tensor part, js for the rest", () => {
  testJax("contraction under a group-by is pushed down", () => {
    let e = check(rh`{users.*u.team: sum(A.*u.*k * w.*k)}`, { A: 2, w: 1, users: 0 },
      { users: users(7), A: rnd(7, 5), w: rnd(5) })
    expect(e.accel.src).toContain('jnp.einsum("ab,b->a"')
    expect(e.code).toContain("accel.run(inp, tmp)")
    expect(e.code).toContain('inp?.["users"]') // the group-by stays in JS
  })

  testJax("matmul rows grouped by name", () => {
    let e = check(rh`{users.*u.name: {*j: sum(A.*u.*k * B.*k.*j)}}`, { A: 2, B: 2, users: 0 },
      { users: users(4), A: rnd(4, 3), B: rnd(3, 5) })
    expect(e.accel.src).toContain('jnp.einsum("ac,cb->ab"')
  })

  testJax("max of row scores per team", () => {
    check(rh`{users.*u.team: max(A.*u.*k * w.*k)}`, { A: 2, w: 1, users: 0 },
      { users: users(6), A: rnd(6, 4), w: rnd(4) })
  })

  testJax("fewer users than rows", () => {
    // *u ranges over users and A: the join happens in JS, at T.*u
    check(rh`{users.*u.team: sum(A.*u.*k * w.*k)}`, { A: 2, w: 1, users: 0 },
      { users: users(3), A: rnd(6, 4), w: rnd(4) })
  })
})

describe("queries without dense parts are unchanged", () => {
  testJax("group by over json", () => {
    let e = check(rh`{data.*r.k: sum data.*r.v}`, { data: 0 },
      { data: [{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "a", v: 3 }] })
    expect(e.accel.members.size).toBe(0)
    expect(e.code).not.toContain("accel.run")
  })

  testJax("no schema", () => {
    let f = compile(rh`sum(x.*i * y.*i)`, { accel: "jax" })
    expect(f({ x: [1, 2], y: [3, 4] })).toBe(11)
    expect(f.explain.accel.members.size).toBe(0)
  })
})

test("accel needs the js backend", () => {
  expect(() => compile(rh`sum x.*i`, { accel: "jax", newCodegen: true })).toThrow(/js backend/)
  expect(() => compile(rh`sum x.*i`, { accel: "tpu" })).toThrow(/unknown accel/)
})
