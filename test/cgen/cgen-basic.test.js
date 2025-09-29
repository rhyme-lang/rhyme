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

let key = typing.createKey(types.u32);

let dataSchema = typing.parseType({
  "-": typing.keyval(key, {
    key: types.string,
    value: types.u32
  })
})

let countrySchema = typing.parseType({
  "-": typing.keyval(key, {
    region: types.string,
    country: types.string,
    city: types.string,
    population: types.u32
  })
})

let regionSchema = typing.parseType({
  "-": typing.keyval(key, {
    region: types.string,
    country: types.string,
  })
})

let data = rh`loadJSON "./cgen-sql/json/basic/data.json" ${dataSchema}`

let country = rh`loadJSON "./cgen-sql/json/basic/country.json" ${countrySchema}`
let region = rh`loadJSON "./cgen-sql/json/basic/region.json" ${regionSchema}`

//
// ----- Tests from basic.test.js
//

test("plainSumTest", async () => {
  let query = rh`sum(${data}.*A.value)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "plainSumTest" })
  let res = await func()

  expect(JSON.parse(res)).toEqual(60)
})

test("plainAverageTest", async () => {
  let query = api.fdiv(api.sum(rh`${data}.*.value`), api.count(rh`${data}.*.value`))

  let func = await compile(query, { backend: "c-new", outDir, outFile: "plainAverageTest" })
  let res = await func()

  expect(JSON.parse(res)).toEqual(20)
})

test("uncorrelatedAverageTest", async () => {
  let query = api.fdiv(api.sum(rh`${data}.*A.value`), api.count(rh`${data}.*B.value`))

  let func = await compile(query, { backend: "c-new", outDir, outFile: "uncorrelatedAverageTest" })
  let res = await func()

  expect(JSON.parse(res)).toEqual(20)
})

test("groupByTest", async () => {
  let query = rh`{
    ${data}.*.key: sum(${data}.*.value)
  }`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "uncorrelatedAverageTest", enableOptimizations: false })
  let res = await func()

  // total is currectly ignored but it is constructed in the code
  expect(JSON.parse(res)).toEqual({ "A": 40, "B": 20 })
})

test("groupByAverageTest", async () => {
  let avg = p => api.fdiv(api.sum(p), api.count(p))
  let query = rh`{
    ${data}.*.key: ${avg(rh`${data}.*.value`)}
  }`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "groupByAverageTest", enableOptimizations: false })
  let res = await func()

  // total is currectly ignored but it is constructed in the code
  expect(JSON.parse(res)).toEqual({ "A": 20, "B": 20 })
})

test("groupByRelativeSum", async () => {
  let query = rh`{
    ${data}.*.key: sum(${data}.*.value) / sum(${data}.*B.value)
  }`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "groupByRelativeSum", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual({ "A": 0.6667, "B": 0.3333 })
})

test("nestedGroupAggregateTest", async () => {
  let query = rh`{
    ${country}.*.region: {
      ${country}.*.city: sum(${country}.*.population)
    }
  }`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "nestedGroupAggregateTest", enableOptimizations: false })
  let res = await func()

  let expected = {
    "Asia": { "Beijing": 20, "Tokyo": 30 },
    "Europe": { "London": 10, "Paris": 10 }
  }
  expect(JSON.parse(res)).toEqual(expected)
})

test("joinSimpleTest1", async () => {
  let q1 = rh`{
    ${region}.*O.country: ${region}.*O.region
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
    ${region}.*O.country: single ${region}.*O.region
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

test("joinSimpleTest2", async () => {
  let q1 = rh`{
    ${region}.*O.country: ${region}.*O.region
  }`
  let query = rh`{
    ${q1}.(${country}.*.country) : {
      ${country}.*.city: sum ${country}.*.population
    }
  }`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "joinSimpleTest2", enableOptimizations: false })
  let res = await func()

  let expected = {
    "Asia": { "Beijing": 20, "Tokyo": 30 },
    "Europe": { "London": 10, "Paris": 10 }
  }

  expect(JSON.parse(res)).toEqual(expected)
})

test("joinWithAggrTest", async () => {
  let q1 = rh`{
    ${region}.*O.country: ${region}.*O.region
  }`
  let query = rh`{
    ${q1}.(${country}.*.country) : {
      ${country}.*.city: sum ${country}.*.population
    }
  }`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "joinWithAggrTest", enableOptimizations: false })
  let res = await func()

  let expected = {
    "Asia": { "Beijing": 20, "Tokyo": 30 },
    "Europe": { "London": 10, "Paris": 10 }
  }

  expect(JSON.parse(res)).toEqual(expected)
})

test("arrayTest1", async () => {
  let query = rh`sum(sum(${data}.*.value))`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "arrayTest1", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual(60)
})

test("arrayTest3", async () => {
  let query = rh`{ ${data}.*.key: [{ foo: ${data}.*.value }] }`
  let func = await compile(query, { backend: "c-new", outDir, outFile: "arrayTest3", enableOptimizations: false })
  let res = await func()

  let expected = { A: [{ foo: 10 }, { foo: 30 }], B: [{ foo: 20 }] }
  expect(JSON.parse(res)).toEqual(expected)
})
