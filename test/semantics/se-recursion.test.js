const { api, rh } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')



test("testEta0", () => {
  let fib = { 0: 1, 1: 1, 2: 2, 3: 3, 4: 5, 5: 8 }

  // let query = { fib: { "*N": rh`(fib.*N)` } } 
  // have to use sum/last! --> generally multiple vals per key

  let query =  {  "*N": rh`fib.*N` } // XXX bug with fib: and no last

  let func = compile(query)

  // console.log(func.explain.ir.deps)
  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)

  let res = func({fib})

  // console.log(res)

  expect(res).toEqual({...fib})
})

test("testEta1", () => {
  let fib = { 0: 1, 1: 1, 2: 2, 3: 3, 4: 5, 5: 8 }

  // let query = { fib: { "*N": rh`(fib.*N)` } } 
  // have to use sum/last! --> generally multiple vals per key

  let query =  { fib: {  "*N": rh`fib.*N` } }

  let func = compile(query)

  // console.log(func.explain.ir.deps)
  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)

  let res = func({fib})

  // console.log(res)

  expect(res).toEqual({fib})
})

test("testRecursion1", () => {
  let fib = { 0: 1, 1: 1 }
  let query = rh`update .fib (*N + 2) (fib.*N + fib.(*N+1))`
  let query1 = { fib: query }
  // annoying: have to use reduction op

  let func = compile(query1)

  // console.dir(func.explain.src, {depth:10})
  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)

  let res = {fib}
  while (!res.fib[5])
    res = func(res)

  // console.log(res)

  expect(res).toEqual({
    fib: { 
      0: 1, 
      1: 1,
      2: 2,
      3: 3,
      4: 5,
      5: 8,
    }
  })

  // possible extensions:
  // - build cutoff into query (e.g. *N < 10)
  // - external convergence loop (monitor changes)
  // - semi-naive evaluation (incrementalize, use delta)

  // other:
  // + reducer in update rhs: can do without? (now: compile error)
  // - deep updates: update data.foo.bar k v

})

