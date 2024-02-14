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
test("testCycles2", () => {
  let data = [{ key: "A", val: 10}, {key: "B", val: 20 }]
  let other = { A: 0 }
  let q1 = { "data.*A.key" : rh`data.*A.val` }
  let query = rh`${q1} | sum .*`

  let func = compile(query)
  let res = func({data, other})

  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)
  // console.log(res)

  // XXX Design decision here: other[data.*A.key] does not
  // count as filter on *A -- it's in its own reification
  // context (sum)

  expect(res).toEqual([30])
})


// iterating over a temporary result, cycle/wrong order
test("testCycles3", () => {
  let data = [{ key: "A", val: 10}, {key: "B", val: 20 }]
  let other = { A: 1 }
  let q1 = { "data.*A.key" : rh`data.*A.val` }
  let query = rh`${q1} | sum(other.*) + (sum .*)`

  // PENDING -- need to implement reordering

  // let func = compile(query)

  // console.log(func.explain.pseudo)
  // console.log(func.explain.code)

  // let res = func({data, other})
  // console.log(res)

  // XXX Design decision here: other[data.*A.key] does not
  // count as filter on *A -- it's in its own reification
  // context (sum)

  // expect(res).toEqual([30])
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

