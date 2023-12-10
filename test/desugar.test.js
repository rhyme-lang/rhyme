const { parse, desugar, rh } = require('../src/parser')
const { api } = require('../src/rhyme')

function ast_ident(a) {
    return { xxpath: "ident", xxparam: a }
}
function ast_raw(a) {
    return { xxpath: "raw", xxparam: a }
}
function ast_plus(a,b) {
    return { xxpath: "plus", xxparam: [a,b] }
}
function ast_get(a,b) {
    return { xxpath: "get", xxparam: [a,b] }
}
function ast_apply(a,b) {
    return { xxpath: "apply", xxparam: [a,b] }
}


test("pipeTest1", () => {
  let input = { foo: { bar: { baz: { boom: 7 } } } }
  let q0 = rh`input.foo`
  let q1 = rh`input | .foo`
  let q2 = rh`.input | .foo`
  let q3 = rh`.input | get(foo)`

  let q1d = desugar(q1)
  let q2d = desugar(q2)
  let q3d = desugar(q2)

  expect(q1d).toEqual(q0)
  expect(q2d).toEqual(q0)
  expect(q3d).toEqual(q0)

  let func = api.compile(q0)
  let res = func({input})
  expect(res).toBe(input.foo)
})


test("pipeTest2", () => {
  let input = { foo: { bar: { baz: { boom: 7 } } } }
  let q0 = rh`input.foo.bar.baz.boom`
  let q1 = rh`.input | .foo.bar | .baz.boom`
  let q2 = rh`.input | get(foo) | .bar | get(baz) | .boom`

  let q1d = desugar(q1)
  let q2d = desugar(q2)

  expect(q1d).toEqual(q0)
  expect(q2d).toEqual(q0)

  let func = api.compile(q0)
  let res = func({input})
  expect(res).toBe(7)
})


test("pipeTest3", () => {
  let input = { foo:  7 }
  let q0 = rh`sum(input.foo)`
  let q1 = rh`input | .foo | sum`
  let q2 = rh`input | sum(.foo)`
  let q3 = rh`input | (.foo | sum)`

  q0 = desugar(q0)

  let q1d = desugar(q1)
  let q2d = desugar(q2)
  let q3d = desugar(q3)

  expect(q1d).toEqual(q0)
  expect(q2d).toEqual(q0)
  expect(q3d).toEqual(q0)

  let func = api.compile(q0)
  let res = func({input})
  expect(res).toBe(7)
})


