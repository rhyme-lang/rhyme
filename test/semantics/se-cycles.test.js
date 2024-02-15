const { api, pipe } = require('../../src/rhyme')
const { rh, parse } = require('../../src/parser')
const { compile } = require('../../src/simple-eval')




// *A depends on *B
test("testCycles0", () => {
  let data = { A: 10, B: 20, C: 30 }
  let other = { U: { A: 100 }, V: { A:200 } }
  let query = rh`sum(data.*A) + sum(other.*B.*A)`

  let func = compile(query)
  let res = func({data, other})

  // console.log(func.explain.pseudo)

  expect(res).toEqual([320]) // (10 + 100) + (10 + 200)
})

// *A depends on *B with *B in global scope
test("testCycles1", () => {
  let data = { A: 10, B: 20, C: 30 }
  let other = { 10: { A: 100, B:200 }, 20: { A:300 } }
  let query = rh`sum(data.*A) + *B + sum(other.*B.*A)`

  let func = compile(query)
  let res = func({data, other})

  // console.log(func.explain.pseudo)

  // 10+20 + 10 + 100+200 = 340
  // 10 + 20 + 300 = 330

  expect(res).toEqual([340, 330])
})


// iterating over a temporary result
test("testCycles2-0", () => {
  let data = [{ key: "A", val: 10}, { key: "A", val: 30}, {key: "B", val: 20 }]
  let other = { A: 0 }
  let q1 = { "data.*A.key" : rh`sum data.*A.val` }
  let query = rh`${q1}.*`
  // let query = q1

  let func = compile(query)
  let res = func({data, other})

  // console.log(func.explain.code)
  // console.log(res)

  expect(res).toEqual([40, 20])
})


// iterating over a temporary result
test("testCycles2-1", () => {
  let data = [{ key: "A", val: 10}, { key: "A", val: 30}, {key: "B", val: 20 }]
  let other = { A: 0 }
  let q1 = { "data.*A.key" : rh`data.*A.val` }
  let query = rh`${q1}.*`

  let func = compile(query)
  let res = func({data, other})

  // console.log(func.explain.ir.deps)
  // console.log(func.explain.ir.transdeps)
  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)
  // console.log(res)

  expect(res).toEqual([10,30,20])
})

// iterating over a temporary result
test("testCycles2-1", () => {
  let data = [{ key: "A", val: 10}, { key: "A", val: 30}, {key: "B", val: 20 }]
  let other = { A: 0 }
  let q1 = { "data.*A.key" : rh`data.*A.val` }
  let query = rh`sum ${q1}.*`

  let func = compile(query)
  let res = func({data, other})

  // console.log(func.explain.ir.deps)
  // console.log(func.explain.ir.transdeps)
  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)
  // console.log(res)

  expect(res).toEqual([60])
})




// iterating over a temporary result
test("testCycles3-0", () => {
  let data = [{ key: "A", val: 10}, { key: "A", val: 30}, {key: "B", val: 20 }]
  let other = { A: 1 }
  let q1 = { "data.*A.key" : rh`sum data.*A.val` }
  let query = rh`(other.*) + (${q1}.*)`

  let func = compile(query)

  let res = func({data, other})
  // console.log(res)

  // XXX Design decision here: other[data.*A.key] does not
  // count as filter on *A -- it's in its own reification
  // context (sum)

  expect(res).toEqual([41])
})

test("testCycles3-1", () => {
  let data = [{ key: "A", val: 10}, { key: "A", val: 30}, {key: "B", val: 20 }]
  let other = { A: 1 }
  let q1 = { "data.*A.key" : rh`data.*A.val` }
  let query = rh`(other.*) + (${q1}.*)`

  // Here the groupby does not eliminate *A, so 
  // other.* produces multiple values

  let func = compile(query)

  let res = func({data, other})

  expect(res).toEqual([11,31])
})

test("testCycles3-2", () => {
  let data = [{ key: "A", val: 10}, { key: "A", val: 30}, {key: "B", val: 20 }]
  let other = { A: 1 }
  let q1 = { "data.*A.key" : rh`data.*A.val` }
  let query = rh`sum(other.*) + sum(${q1}.*)`

  // NOTE: this case relies on reordering (topological sort)

  // What's going on? The groupby does not have a sum so it
  // produces a mapping *A -> key -> val. Thus, "other.*"
  // is a mapping indexed by *A. Thus, * depends on *A, so "sum(other.*)" must 
  // run last.

  let func = compile(query)

  // console.log(func.explain.ir.order)
  // console.log(func.explain.ir.deps)
  // console.log(func.explain.ir.transdeps)
  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)


  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)

  let res = func({data, other})
  // console.log(res)

  // XXX Design decision here: other[data.*A.key] does not
  // count as filter on *A -- it's in its own reification
  // context (sum)

  expect(res).toEqual([42])
})


// a direct cycle between tmp statements
test("testCycle4", () => {
  let data = { A: 10, B: 20, C: 30 }
  let other = { 60: { A: 1000 }, 10: { A:200 } }
  let query = rh`(other.(sum(data.*A))).*A`

  // XXXX PROPER CYCLE between statements
  // -- not sure if/how this can work in general

  // let func = compile(query)

  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)

  // let res = func({data, other})
  // console.log(res)

  // expect(res).toEqual([320]) // (10 + 100) + (10 + 200)
})




// dependent filter
test("testXRec1", () => {
  let data = [{ key: "A", val: 10}, {key: "B", val: 20 }]
  let other = { A: 0 }
  let query = rh`sum(data.*A.val) + sum(other.(data.*A.key))`

  let func = compile(query)
  let res = func({data, other})

  // console.log(func.explain.code)

  // XXX Design decision here: other[data.*A.key] does not
  // count as filter on *A -- it's in its own reification
  // context (sum)

  expect(res).toEqual([30])
})





// TODO: iterate over assignments!
// prevent cycles

