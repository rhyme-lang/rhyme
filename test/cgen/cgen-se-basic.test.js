const { api, rh } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')
const { typing, types } = require('../../src/typing')

const os = require('child_process')

let sh = (cmd) => {
  return new Promise((resolve, reject) => {
    os.exec(cmd, (err, stdout) => {
      if (err) {
        reject(err)
      } else {
        resolve(stdout)
      }
    })
  })
}

let outDir = "cgen-sql/out/se-basic"

beforeAll(async () => {
  await sh(`rm -rf ${outDir}`)
  await sh(`mkdir -p ${outDir}`)
  // await sh(`cp cgen-sql/yyjson.h ${outDir}`)
})

let key = typing.createKey(types.string)

let dataSchema = typing.parseType({
  "-": typing.keyval(key, {
    key: types.string,
    value: types.u32
  })
})

let otherSchema = typing.parseType({
  "-": typing.keyval(key, {
    value: types.u32
  })
})

let nestedSchema = typing.parseType({
  "-": typing.keyval(key, {
    "-": typing.keyval(key, {
      value: types.u32
    })
  })
})

let data = rh`loadJSON "./cgen-sql/json/se-basic/data.json" ${dataSchema}`
let other = rh`loadJSON "./cgen-sql/json/se-basic/other.json" ${otherSchema}`
let nested = rh`loadJSON "./cgen-sql/json/se-basic/nested.json" ${nestedSchema}`
let nestedB = rh`loadJSON "./cgen-sql/json/se-basic/nestedB.json" ${nestedSchema}`

//
// ----- Tests from se-basic.test.js
//

test("testScalar0", async () => {
  let query = rh`${data}.*A.value | group *A`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testScalar0" })
  let res = await func()

  expect(JSON.parse(res)).toEqual({ A: 40, B: 20, C: 10 })
})

test("testScalar1", async () => {
  let query = rh`sum ${data}.*.value`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testScalar1" })
  let res = await func()

  expect(JSON.parse(res)).toEqual(70)
})

test("testZipScalar2", async () => {
  let query = rh`${data}.*A.value + ${other}.*A.value | group *A`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testZipScalar2" })
  let res = await func()

  expect(JSON.parse(res)).toEqual({ A: 140, B: 420 })
})

test("testZipScalar3", async () => {
  let query = rh`(sum ${data}.*A.value) + (sum ${other}.*A.value)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testZipScalar3" })
  let res = await func()

  expect(JSON.parse(res)).toEqual(560)
})

test("testZipScalar4", async () => {
  let query = rh`((sum ${data}.*A.value) + ${other}.*A.value) | group *A`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testZipScalar4", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual({ A: 140, B: 420 })
})

test("testJoinScalar2", async () => {
  let query = rh`${data}.*A.value + ${other}.*B.value | group*B | group *A`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testJoinScalar2", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual({
    A: { A: 140, B: 440, D: 240 },
    B: { A: 120, B: 420, D: 220 },
    C: { A: 110, B: 410, D: 210 }
  })
})

test("testJoinScalar3", async () => {
  let query = rh`(sum ${data}.*A.value) + (sum ${other}.*B.value)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testJoinScalar3", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual(770)
})

test("testJoinScalar4", async () => {
  let query = rh`(sum ${data}.*A.value) + ${other}.*B.value | group *B`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testJoinScalar4", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual({ A: 170, B: 470, D: 270 })
})

test("testNested0", async () => {
  let query = rh`${nested}.*A.*B.value | group *B | group *A`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testNested0", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual({
    U: { A: 10, B: 20 },
    V: { B: 30, C: 40 },
    W: { D: 50, E: 60 }
  })
})

test("testNested1", async () => {
  let query = rh`sum ${nested}.*A.*B.value`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testNested1" })
  let res = await func()

  expect(JSON.parse(res)).toEqual(210)
})

test("testZipNested2", async () => {
  let query = rh`${nested}.*A.*B.value + ${other}.*B.value | group *B | group *A`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testZipNested2", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual({ // restrict inner to A,B,D
    U: { A: 110, B: 420 },
    V: { B: 430 },
    W: { D: 250 }
  })
})


test("testZipNested3", async () => {
  let query = rh`${nested}.*A.*B.value + ${nestedB}.*C.*B.value | group *C | group *B | group *A`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testZipNested3", enableOptimizations: false })
  let res = await func()

  // result is different from the same test in se-basic since cgen does not have support for group *ANY
  expect(JSON.parse(res)).toEqual({
    U: {}, V: { C: { X: 540, Y: 640 } }, W: {}
  })
})

/* ----- testZipNestedRec3: not supported ----- */
/* ----- testGroup0: not supported ----- */

test("testGroup0-a", async () => {
  let query = rh`{${data}.*.key: array(${data}.*.value)}`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testGroup0-a" })
  let res = await func()

  expect(JSON.parse(res)).toEqual({ U: [40, 20], V: [10] })
})

/* ----- testGroup0-b: not supported ----- */

test("testGroup1", async () => {
  let query = rh`{${data}.*.key: sum(${data}.*.value)}`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testGroup1" })
  let res = await func()

  expect(JSON.parse(res)).toEqual({
    U: 60, V: 10
  })
})

/* ----- testGroup2: not supported ----- */
/* ----- testPrefixSum1: not supported ----- */
/* ----- testGroupPrefixSum1: not supported ----- */

// Does not produce the same result currently
test("testMaybeSum", async () => {
  let emptySchema = typing.parseType({
    "-": typing.keyval(key, types.unknown)
  })
  let data = rh`loadJSON "./cgen-sql/json/se-basic/data_empty.json" ${emptySchema}`

  let query = { A: rh`sum? ${data}.*.value`, B: rh`sum ${data}.*.value` }

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testMaybeSum" })
  let res = await func()

  // In the current impl, the maybe ops are not well supported yet
  expect(JSON.parse(res)).toEqual({ A: 0, B: 0 })
})

/* ----- testOuterJoin_pre1: not supported ----- */
/* ----- testOuterJoin_pre2: not supported ----- */
/* ----- testOuterJoin_pre3: not supported ----- */

/* ----- testLeftOuterJoin: not supported ----- */
/* ----- testFullOuterJoin1: not supported ----- */
/* ----- testFullOuterJoin2: not supported ----- */
/* ----- testFullOuterJoin_other1: not supported ----- */
/* ----- testFullOuterJoin_other2: not supported ----- */

test("testEqualTrue", async () => {
  let query = rh`1 == 1`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testEqualTrue", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual(true)
})

test("testEqualUndefined", async () => {
  let query = rh`1 == 2`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testEqualUndefined", enableOptimizations: false })
  let res = await func()

  // "undefined" is not valid JSON
  expect(res).toEqual("undefined")
})

test("testNotEqualTrue", async () => {
  let query = rh`1 != 2`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testNotEqualTrue", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual(true)
})

test("testNotEqualUndefined", async () => {
  let query = rh`1 != 1`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testNotEqualUndefined", enableOptimizations: false })
  let res = await func()

  expect(res).toEqual("undefined")
})

test("testLessThanTrue", async () => {
  let query = rh`1 < 2`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testLessThanTrue", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual(true)
})

test("testLessThanUndefined", async () => {
  let query = rh`1 < 0`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testLessThanUndefined", enableOptimizations: false })
  let res = await func()

  expect(res).toEqual("undefined")
})

test("testLessThanOrEqualTrue", async () => {
  let query = rh`1 <= 2`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testLessThanOrEqualTrue", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual(true)
})

test("testLessThanOrEqualUndefined", async () => {
  let query = rh`1 <= 0`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testLessThanOrEqualUndefined", enableOptimizations: false })
  let res = await func()

  expect(res).toEqual("undefined")
})

test("testGreaterThanTrue", async () => {
  let query = rh`2 > 1`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testGreaterThanTrue", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual(true)
})

test("testGreaterThanUndefined", async () => {
  let query = rh`0 > 1`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testGreaterThanUndefined", enableOptimizations: false })
  let res = await func()

  expect(res).toEqual("undefined")
})

test("testGreaterThanOrEqualTrue", async () => {
  let query = rh`2 >= 1`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testGreaterThanOrEqualTrue", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual(true)
})

test("testGreaterThanOrEqualUndefined", async () => {
  let query = rh`0 >= 1`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testGreaterThanOrEqualUndefined", enableOptimizations: false })
  let res = await func()

  expect(res).toEqual("undefined")
})

test("testAndTrue", async () => {
  let query = rh`1 == 1 & 2 == 2`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testAndTrue", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual(true)
})

test("testAndUndefined", async () => {
  let query = rh`1 == 1 & 2 == 3`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testAndUndefined", enableOptimizations: false })
  let res = await func()

  expect(res).toEqual("undefined")
})

test("testAndAlsoTrue", async () => {
  let query = rh`1 == 1 && 2 == 2`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testAndAlsoTrue", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual(true)
})

test("testAndAlsoUndefined", async () => {
  let query = rh`1 == 1 && 2 == 3`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testAndAlsoUndefined", enableOptimizations: false })
  let res = await func()

  expect(res).toEqual("undefined")
})

test("testOrElseTrue", async () => {
  let query = rh`1 == 2 || 2 == 2`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testOrElseTrue", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual(true)
})

test("testOrElseUndefined", async () => {
  let query = rh`1 == 2 || 2 == 3`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testOrElseUndefined", enableOptimizations: false })
  let res = await func()

  expect(res).toEqual("undefined")
})

/* ----- testIfElseThenBranch: not supported ----- */
/* ----- testIfElseElseBranch: not supported ----- */
