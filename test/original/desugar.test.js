const { parse, rh } = require('../../src/parser')
const { desugar } = require('../../src/desugar')
const { api } = require('../../src/rhyme')

/*
function ast_ident(a) {
    return { xxkey: "ident", xxop: a }
}
function ast_raw(a) {
    return { xxkey: "raw", xxop: a }
}
function ast_plus(a,b) {
    return { xxkey: "plus", xxparam: [a,b] }
}
function ast_get(a,b) {
    if (!b)
      return { xxkey: "get", xxparam: [a] }
    return { xxkey: "get", xxparam: [a,b] }
}
function ast_apply(a,b) {
    return { xxkey: "apply", xxparam: [a,b] }
}*/


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
  let q0d = desugar(q0.rhyme_ast)
  let q1d = desugar(q1.rhyme_ast)
  let q2d = desugar(q2.rhyme_ast)
  let q3d = desugar(q2.rhyme_ast)
  let q4d = desugar(q2.rhyme_ast)

  expect(q0d).toEqual(q0.rhyme_ast)
  expect(q1d).toEqual(q1.rhyme_ast)
  expect(q2d).toEqual(q2.rhyme_ast)
  expect(q3d).toEqual(q3.rhyme_ast)
  expect(q4d).toEqual(q4.rhyme_ast)

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

  let q0d = desugar(q0.rhyme_ast)
  let q1d = desugar(q1.rhyme_ast)
  let q2d = desugar(q2.rhyme_ast)
  let q3d = desugar(q3.rhyme_ast)

  expect(q0d).toEqual(q0.rhyme_ast)
  expect(q1d).toEqual(q1.rhyme_ast)
  expect(q2d).toEqual(q2.rhyme_ast)
  expect(q3d).toEqual(q3.rhyme_ast)

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

  let q1d = desugar(q1.rhyme_ast)
  let q2d = desugar(q2.rhyme_ast)
  let q3d = desugar(q3.rhyme_ast)
  let q4d = desugar(q4.rhyme_ast)
  let q5d = desugar(q5.rhyme_ast)
  let q6d = desugar(q6.rhyme_ast)
  let q7d = desugar(q7.rhyme_ast)

  expect(q1d).toEqual(q1.rhyme_ast)
  expect(q2d).toEqual(q2.rhyme_ast)
  expect(q3d).toEqual(q3.rhyme_ast)
  expect(q4d).toEqual(q4.rhyme_ast)
  expect(q5d).toEqual(q5.rhyme_ast)
  expect(q6d).toEqual(q6.rhyme_ast)
  expect(q7d).toEqual(q7.rhyme_ast)

  let func = api.compile(q0)
  let res = func({input})
  expect(res).toBe(7)
})


test("callTest1", () => {

  let q0 = rh`a(b)(c)(d)`
  let q1 = rh`a b c d`
  
  let e = {
    xxkey: 'apply',
    xxparam: [
      { xxkey: 'ident', xxop: 'a' },
      { xxkey: 'ident', xxop: 'b' },
      { xxkey: 'ident', xxop: 'c' },
      { xxkey: 'ident', xxop: 'd' }
    ]
  }

  expect(q1.rhyme_ast).toEqual(e)

  expect(q1).toEqual(q0)

  let q0d = desugar(q0.rhyme_ast)
  let q1d = desugar(q1.rhyme_ast)

  expect(q0d).toEqual(q0.rhyme_ast)
  expect(q1d).toEqual(q1.rhyme_ast)
})


test("letTest1", () => {

  let q0 = rh`7`
  let q1 = rh`let x = 7; x`

  expect(q1).toEqual(q0)

  let q1d = desugar(q1.rhyme_ast)

  expect(q1d).toEqual(q1.rhyme_ast)

  let func = api.compile(q1)
  let res = func({})
  expect(res).toBe(7)
})


test("letTest2", () => {

  let input = { foo:  7 }
  let q0 = rh`input.foo`
  let q1 = rh`let x = input; x.foo`
  
  expect(q1).toEqual(q0)

  let q1d = desugar(q1.rhyme_ast)

  expect(q1d).toEqual(q1.rhyme_ast)

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

  let q1d = desugar(q1.rhyme_ast)
  let q2d = desugar(q2.rhyme_ast)
  let q3d = desugar(q3.rhyme_ast)
  let q4d = desugar(q4.rhyme_ast)

  expect(q1d).toEqual(q1.rhyme_ast)
  expect(q2d).toEqual(q2.rhyme_ast)
  expect(q3d).toEqual(q3.rhyme_ast)
  expect(q4d).toEqual(q4.rhyme_ast)

  let func = api.compile(q1)
  let res = func({input})
  expect(res).toBe(7)
})


test("lambdaTest2", () => {

  let input = { foo:  7 }
  let q0 = rh`3 + 4`
  let q1 = rh`(fn x (fn y x+y)) 3 4`
  
  expect(q1).toEqual(q0)

  let q1d = desugar(q1.rhyme_ast)

  expect(q1d).toEqual(q1.rhyme_ast)

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

test("arrayTest0", () => {

  let input = {}

  let q1 = []
  let q2 = rh`[]`
  
  let func1 = api.compile(q1)
  let func2 = api.compile(q2)
  let res1 = func1({input})
  let res2 = func1({input})
  expect(res2).toEqual(res1)
})

test("arrayTest1", () => {

  let input = {}

  let q1 = [1,2,3]
  let q2 = rh`[1, 2, 3]`
  
  let func1 = api.compile(q1)
  let func2 = api.compile(q2)
  let res1 = func1({input})
  let res2 = func1({input})
  expect(res2).toEqual(res1)
})

test("objectTest0", () => {

  let input = {}

  let q1 = {}
  let q2 = rh`{}`
  
  let func1 = api.compile(q1)
  let func2 = api.compile(q2)
  let res1 = func1({input})
  let res2 = func1({input})
  expect(res2).toEqual(res1)
})

test("objectTest1", () => {

  let input = {}

  let q1 = {a:1, b:2, c:3}
  let q2 = rh`{a:1, b:2, c:3}`
  
  let func1 = api.compile(q1)
  let func2 = api.compile(q2)
  let res1 = func1({input})
  let res2 = func1({input})
  expect(res2).toEqual(res1)
})


test("letTest3", () => {

  let input = { foo:  7 }
  let q0 = rh`{all: [1,2,3]}`
  let q1 = rh`let x = [1,2,3]
              {all: x}`
  
  expect(q1).toEqual(q0)

  let q1d = desugar(q1.rhyme_ast)

  expect(q1d).toEqual(q1.rhyme_ast)

  let func = api.compile(q0)
  let res = func({input})
  expect(res).toEqual({all: [1,2,3]})
})


test("letTest4", () => {

  let input = { foo:  7 }
  let q0 = rh`{all: [1,2,3]}`
  let q1 = rh`let f x y z = [x,y,z]
              {all: f 1 2 3}`
  
  expect(q1).toEqual(q0)

  let q1d = desugar(q1.rhyme_ast)

  expect(q1d).toEqual(q1.rhyme_ast)

  let func = api.compile(q0)
  let res = func({input})
  expect(res).toEqual({all: [1,2,3]})
})

