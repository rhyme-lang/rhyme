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

let outDir = "cgen-sql/out/"

beforeAll(async () => {
  await sh(`rm -rf ${outDir}`)
  await sh(`mkdir -p ${outDir}`)
  await sh(`cp cgen-sql/yyjson.h ${outDir}`)
})

let key = typing.createKey(types.string);

let dataSchema = typing.parseType({
  "-": typing.keyval(key, {
    key: types.string,
    value: types.u8
  })
})

let countrySchema = typing.parseType({
    "-": typing.keyval(key, {
        region: types.string,
        country: types.string,
        city: types.string,
        population: types.u8
    })
})

let regionSchema = typing.parseType({
    "-": typing.keyval(key, {
        region: types.string,
        country: types.string,
    })
})

let data = rh`loadJSON "./cgen-sql/json/data.json" ${dataSchema}`
let other = rh`loadJSON "./cgen-sql/json/other.json" ${types.unknown}`
let nested = rh`loadJSON "./cgen-sql/json/nested.json" ${types.unknown}`

let country = rh`loadJSON "./cgen-sql/json/country.json" ${countrySchema}`
let region = rh`loadJSON "./cgen-sql/json/region.json" ${regionSchema}`

//
// ----- Tests from basic.test.js
//

test("plainAverageTest", async () => {
  let query = api.fdiv(api.sum(rh`${data}.*.value`), api.count(rh`${data}.*.value`))

  let func = await compile(query, { backend: "c-new", outDir, outFile: "plainAverageTest" })
  let res = await func()

  expect(JSON.parse(res)).toEqual(23.3333)
})

test("uncorrelatedAverageTest", async () => {
  let query = api.fdiv(api.sum(rh`${data}.*A.value`), api.count(rh`${data}.*B.value`))

  let func = await compile(query, { backend: "c-new", outDir, outFile: "uncorrelatedAverageTest" })
  let res = await func()

  expect(JSON.parse(res)).toEqual(23.3333)
})

test("groupByTest", async () => {
  let query = rh`{
    total: sum(${data}.*.value),
    ${data}.*.key: sum(${data}.*.value)
  }`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "uncorrelatedAverageTest", enableOptimizations: false })
  let res = await func()

  // total is currectly ignored but it is constructed in the code
  expect(JSON.parse(res)).toEqual({ "U": 60, "V": 10 })
})

test("groupByAverageTest", async () => {
  let avg = p => api.fdiv(api.sum(p), api.count(p))
  let query = rh`{
    total: sum(${data}.*.value),
    ${data}.*.key: ${avg(rh`${data}.*.value`)}
  }`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "groupByAverageTest", enableOptimizations: false })
  let res = await func()

  // total is currectly ignored but it is constructed in the code
  expect(JSON.parse(res)).toEqual({ "U": 30, "V": 10 })
})

test("groupByRelativeSum", async () => {
  let query = rh`{
    total: sum(${data}.*.value),
    ${data}.*.key: sum(${data}.*.value) / sum(${data}.*B.value)
  }`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "groupByRelativeSum", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual({ "U": 0.8571, "V": 0.1429 })
})

test("nestedGroupAggregateTest", async () => {
  let query = rh`{
    ${country}.*.region: {
      ${country}.*.city: sum(${country}.*.population)
    }
  }`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "nestedGroupAggregateTest", enableOptimizations: false })
  let res = await func()

  console.log(res)
})

test("joinSimpleTest1", async () => {
  let q1 = rh`{
    ${country}.*O.country: ${country}.*O.region
  }`
  let query = rh`{
    ${country}.*.city: {
      country: ${country}.*.country,
      region: ${q1}.(${country}.*.country)
    }
  }`


  let func = await compile(query, { backend: "c-new", outDir, outFile: "joinSimpleTest1", enableOptimizations: false })
  let res = await func()

  let expected = {
    "Beijing": { country: "China", region: "Asia" },
    "Paris": { country: "France", region: "Europe" },
    "London": { country: "UK", region: "Europe" },
    "Tokyo": { country: "Japan", region: "Asia" }
  }

  expect(JSON.parse(res)).toEqual(expected)
})

test("joinSimpleTest1B", async () => {
  let q1 = rh`{
    ${country}.*O.country: single ${country}.*O.region
  }`
  let query = rh`{
    ${country}.*.city: {
      country: single ${country}.*.country,
      region: single ${q1}.(${country}.*.country)
    }
  }`


  let func = await compile(query, { backend: "c-new", outDir, outFile: "joinSimpleTest1B", enableOptimizations: false })
  let res = await func()

  let expected = {
    "Beijing": { country: "China", region: "Asia" },
    "Paris": { country: "France", region: "Europe" },
    "London": { country: "UK", region: "Europe" },
    "Tokyo": { country: "Japan", region: "Asia" }
  }

  expect(JSON.parse(res)).toEqual(expected)
})

test("arrayTest1", async () => {
  let query = rh`sum(sum(${data}.*.value))`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "arrayTest1", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toBe(70)
})

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

/* ----- testZipScalar2: not supported ----- */

test("testZipScalar3", async () => {
  let query = rh`(sum ${data}.*A.value) + (sum ${other}.*A.value)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testZipScalar3" })
  let res = await func()

  expect(JSON.parse(res)).toEqual(560)
})

/* ----- testZipScalar4: not supported ----- */
/* ----- testJoinScalar2: not supported ----- */

test("testJoinScalar3", async () => {
  let query = rh`(sum ${data}.*A.value) + (sum ${other}.*B.value)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testJoinScalar3" })
  let res = await func()

  expect(JSON.parse(res)).toEqual(770)
})

/* ----- testJoinScalar4: not supported ----- */
/* ----- testNested0: not supported ----- */

test("testNested1", async () => {
  let query = rh`sum ${nested}.*A.*B.value`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testNested1" })
  let res = await func()

  expect(JSON.parse(res)).toEqual(210)
})

/* ----- testZipNested2: not supported ----- */
/* ----- testZipNested3: not supported ----- */
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
  let data = rh`loadJSON "./cgen-sql/json/data_empty.json" ${types.unknown}`

  let query = { A: rh`sum? ${data}.*.value`, B: rh`sum ${data}.*.value` }

  let func = await compile(query, { backend: "c-new", outDir, outFile: "testMaybeSum" })
  let res = await func()

  // In the current impl, the maybe ops are not well supported yet
  expect(JSON.parse(res)).toEqual({ A: 0, B: 0 })
})

/* ----- testOuterJoin_pre1: not supported ----- */
/* ----- testOuterJoin_pre2: not supported ----- */
/* ----- testOuterJoin_pre3: not supported. Different || semantic ----- */

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
  expect(JSON.parse(res)).toEqual(false)
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

  expect(JSON.parse(res)).toEqual(false)
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

  expect(JSON.parse(res)).toEqual(false)
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

  expect(JSON.parse(res)).toEqual(false)
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

  expect(JSON.parse(res)).toEqual(false)
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

  expect(JSON.parse(res)).toEqual(false)
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

  expect(JSON.parse(res)).toEqual(false)
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

  expect(JSON.parse(res)).toEqual(false)
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

  expect(JSON.parse(res)).toEqual(false)
})

/* ----- testIfElseThenBranch: not supported ----- */
/* ----- testIfElseElseBranch: not supported ----- */
