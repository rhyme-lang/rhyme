const { parse, rh } = require('../../src/parser')
const { desugar } = require('../../src/desugar')
const { api } = require('../../src/rhyme')

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
  let q4 = rh`.input | get foo`

  expect(q1).toEqual(q0)
  expect(q2).toEqual(q0)
  expect(q3).toEqual(q0)
  expect(q4).toEqual(q0)

  // sanity: desugar is idempotent
  let q0d = desugar(q0)
  let q1d = desugar(q1)
  let q2d = desugar(q2)
  let q3d = desugar(q2)
  let q4d = desugar(q2)

  expect(q0d).toEqual(q0)
  expect(q1d).toEqual(q1)
  expect(q2d).toEqual(q2)
  expect(q3d).toEqual(q3)
  expect(q4d).toEqual(q4)

  let func = api.compile(q0)
  let res = func({input})
  expect(res).toBe(input.foo)
})


test("pipeTest2", () => {
  let input = { foo: { bar: { baz: { boom: 7 } } } }
  let q0 = rh`input.foo.bar.baz.boom`
  let q1 = rh`.input | .foo.bar | .baz.boom`
  let q2 = rh`.input | get(foo) | .bar | get(baz) | .boom`
  
  let q3 = rh`.input | get foo  | .bar | get baz  | .boom`

  expect(q1).toEqual(q0)
  expect(q2).toEqual(q0)
  expect(q3).toEqual(q0)

  let q0d = desugar(q0)
  let q1d = desugar(q1)
  let q2d = desugar(q2)
  let q3d = desugar(q3)

  expect(q0d).toEqual(q0)
  expect(q1d).toEqual(q1)
  expect(q2d).toEqual(q2)
  expect(q3d).toEqual(q3)

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

  let q4 = rh`input | sum .foo`
  let q5 = rh`input | (get foo | sum)`
  let q6 = rh`(input | get foo) | sum`
  let q7 = rh`sum input.foo`
  
  expect(q1).toEqual(q0)
  expect(q2).toEqual(q0)
  expect(q3).toEqual(q0)
  expect(q4).toEqual(q0)
  expect(q5).toEqual(q0)
  expect(q6).toEqual(q0)
  expect(q7).toEqual(q0)

  let q1d = desugar(q1)
  let q2d = desugar(q2)
  let q3d = desugar(q3)
  let q4d = desugar(q4)
  let q5d = desugar(q5)
  let q6d = desugar(q6)
  let q7d = desugar(q7)

  expect(q1d).toEqual(q1)
  expect(q2d).toEqual(q2)
  expect(q3d).toEqual(q3)
  expect(q4d).toEqual(q4)
  expect(q5d).toEqual(q5)
  expect(q6d).toEqual(q6)
  expect(q7d).toEqual(q7)

  let func = api.compile(q0)
  let res = func({input})
  expect(res).toBe(7)
})


test("callTest1", () => {

  let q0 = rh`a(b)(c)(d)`
  let q1 = rh`a b c d`
  
  let e = {
    xxpath: 'apply',
    xxparam: [
      { xxpath: 'ident', xxparam: 'a' },
      { xxpath: 'ident', xxparam: 'b' },
      { xxpath: 'ident', xxparam: 'c' },
      { xxpath: 'ident', xxparam: 'd' }
    ]
  }

  expect(q1).toEqual(e)

  expect(q1).toEqual(q0)

  let q0d = desugar(q0)
  let q1d = desugar(q1)

  expect(q0d).toEqual(q0)
  expect(q1d).toEqual(q1)
})


test("letTest1", () => {

  let q0 = rh`7`
  let q1 = rh`let x 7 x`

  expect(q1).toEqual(q0)

  let q1d = desugar(q1)

  expect(q1d).toEqual(q1)

  let func = api.compile(q1)
  let res = func({})
  expect(res).toBe(7)
})


test("letTest2", () => {

  let input = { foo:  7 }
  let q0 = rh`input.foo`
  let q1 = rh`let x input x.foo`
  
  expect(q1).toEqual(q0)

  let q1d = desugar(q1)

  expect(q1d).toEqual(q1)

  let func = api.compile(q1)
  let res = func({input})
  expect(res).toBe(7)
})


test("lambdaTest1", () => {

  let input = { foo:  7 }
  let q0 = rh`input.foo`

  let q1 = rh`(fn x x.foo) input`
  let q2 = rh`input | fn x x.foo`

  let q3 = rh`.foo input`
  let q4 = rh`input | .foo`
  
  expect(q1).toEqual(q0)
  expect(q2).toEqual(q0)
  expect(q3).toEqual(q0)
  expect(q4).toEqual(q0)

  let q1d = desugar(q1)
  let q2d = desugar(q2)
  let q3d = desugar(q3)
  let q4d = desugar(q4)

  expect(q1d).toEqual(q1)
  expect(q2d).toEqual(q2)
  expect(q3d).toEqual(q3)
  expect(q4d).toEqual(q4)

  let func = api.compile(q1)
  let res = func({input})
  expect(res).toBe(7)
})


test("lambdaTest2", () => {

  let input = { foo:  7 }
  let q0 = rh`3 + 4`
  let q1 = rh`(fn x (fn y x+y)) 3 4`
  
  expect(q1).toEqual(q0)

  let q1d = desugar(q1)

  expect(q1d).toEqual(q1)

  let func = api.compile(q1)
  let res = func({input})
  expect(res).toBe(7)
})


// The following test cases for
// array and object syntax won't
// produce identical parse trees
// after desugaring.
//
// We test semantic equivalence
// instead.

test("arrayTest1", () => {

  let input = {}

  let q1 = [rh`1`, rh`2`, rh`3`]
  let q2 = rh`[1, 2, 3]`
  
  let func1 = api.compile(q1)
  let func2 = api.compile(q2)
  let res1 = func1({input})
  let res2 = func1({input})
  expect(res2).toEqual(res1)
})


