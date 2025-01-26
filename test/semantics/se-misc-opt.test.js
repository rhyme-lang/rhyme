const { api, rh } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')


let data = {
    A: { key: "U", value: 40 },
    B: { key: "U", value: 20 },
    C: { key: "V", value: 10 },
}

let other = {
    A: { value: 100 },
    B: { value: 400 },
    D: { value: 200 },
}



test("dceUnusedAgg", () => {
  let query =  rh`(count other.*D) &
  (array data.*D.value)`

  // generated code should:
  // - eliminate 'count': result unused, can't be 'undefined'
  // - preserve filter 'other.*D'

  let func = compile(query)

  // console.log(func.explain.ir.deps)
  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)

  let res = func({data, other})

  expect(res).toEqual([40, 20])
})

test("dceUnusedAgg2", () => {
  let query =  rh`((count? other.*D) &
  (array data.*D.value)) || "empty"`

  // XXX operator precedence | < & < || < && -- change this?

  // generated code should:
  // - cannot statically eliminate 'count?': might be empty
  //    - can change to 'any' -- don't care about numeric result
  // - preserve filter 'other.*D'

  let func = compile(query)

  // console.log(func.explain.ir.deps)
  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)

  let res1 = func({data, other})
  let res2 = func({data, other: {}})

  expect(res1).toEqual([40, 20])
  expect(res2).toEqual("empty")
})


test("constFoldKey", () => {
  let query =  rh`(count (mkset "key").*K) &
  (group *K (array data.*D.value))`

  // XXX should work for both 'mkset' and 'singleton'

  // generated code should:
  // - replace K -> "key"
  // - eliminate 'count' (dce)

  let func = compile(query)

  // console.log(func.explain.ir.deps)
  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)

  let res = func({data, other})

  expect(res).toEqual({ key: [40, 20, 10] })
})


test("fuseLoopVars", () => {
  let query =  rh`(sum data.*A.value) + (sum data.*B.value)`

  // generated code should:
  // - fuse *A, *B: they traverse the same prefix,
  //   and do not have any cross-dependencies

  let func = compile(query)

  // console.log(func.explain.ir.deps)
  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)

  let res = func({data, other})

  expect(res).toEqual(140)
})

