// The typed mirror of cnew-basic.test.js: the same queries against the same
// data, but with every input given a schema instead of types.unknown.
//
// That is the whole point of the file. cnew-basic drives c-new's general-JSON
// path, where every value is a boxed rh_val; with a schema the backend takes
// the specialized path instead -- native C scalars, borrowed (const char*, int)
// strings, yyjson accessors in place of rh_get -- and none of that has any
// coverage otherwise. Two bugs found by hand in that path (an unbound
// `assignments` in argIsNative, and re-deriving a loop element by index rather
// than using the one the loop already bound) were both invisible to the
// untyped suites.
//
// The schemas are the ones test/cgen/cgen-basic.test.js uses for backend "c",
// so a query that behaves differently here than there is a c-new bug rather
// than a modelling difference.
//
// compileCCrossCheck runs each query on the js pipeline and on c-new and
// asserts they agree; the expect() that follows pins the value.

const { api, rh } = require('../../src/rhyme')
const { typing, types } = require('../../src/typing')
const { compileCCrossCheck } = require('../utils')

const fs = require('fs/promises')
const { prepareRuntime } = require('../../src/cgen/codegen')

// Its own directory: jest runs test files in parallel workers, so sharing one
// with the other cnew suites would race their beforeAll wiping it.
let outDir = "out/cnew/basic-typed"

beforeAll(async () => {
  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })
})

// build the C runtime up front, so the first query does not pay for it
beforeAll(prepareRuntime, 60000)

let key = typing.createKey(types.u32)

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

let data = rh`loadJSON "./data/json/basic/data.json" ${dataSchema}`
let country = rh`loadJSON "./data/json/basic/country.json" ${countrySchema}`
let region = rh`loadJSON "./data/json/basic/region.json" ${regionSchema}`

test("plainSumTest", async () => {
  let query = rh`sum(${data}.*A.value)`
  let func = await compileCCrossCheck(query, { outDir, outFile: "plainSumTest" })

  expect(await func()).toEqual(60)
})

test("plainAverageTest", async () => {
  let query = api.fdiv(api.sum(rh`${data}.*.value`), api.count(rh`${data}.*.value`))
  let func = await compileCCrossCheck(query, { outDir, outFile: "plainAverageTest" })

  expect(await func()).toEqual(20)
})

test("uncorrelatedAverageTest", async () => {
  let query = api.fdiv(api.sum(rh`${data}.*A.value`), api.count(rh`${data}.*B.value`))
  let func = await compileCCrossCheck(query, { outDir, outFile: "uncorrelatedAverageTest" })

  expect(await func()).toEqual(20)
})

// test("groupByTest", async () => {
//   let query = rh`{
//     total: sum(${data}.*.value),
//     ${data}.*.key: sum(${data}.*.value)
//   }`
//   let func = await compileCCrossCheck(query, { outDir, outFile: "groupByTest" })

//   expect(await func()).toEqual({ total: 60, A: 40, B: 20 })
// })

// test("groupByAverageTest", async () => {
//   let avg = p => api.div(api.sum(p), api.count(p))
//   let query = rh`{
//     total: sum(${data}.*.value),
//     ${data}.*.key: ${avg(rh`${data}.*.value`)}
//   }`
//   let func = await compileCCrossCheck(query, { outDir, outFile: "groupByAverageTest" })

//   expect(await func()).toEqual({ total: 60, A: 20, B: 20 })
// })

// test("groupByRelativeSum", async () => {
//   let query = rh`{
//     total: sum(${data}.*.value),
//     ${data}.*.key: sum(${data}.*.value) / sum(${data}.*B.value)
//   }`
//   let func = await compileCCrossCheck(query, { outDir, outFile: "groupByRelativeSum" })

//   expect(await func()).toEqual({ total: 60, A: 0.6666666666666666, B: 0.3333333333333333 })
// })

// test("nestedGroupAggregateTest", async () => {
//   let query = rh`{
//     ${country}.*.region: {
//       ${country}.*.city: sum(${country}.*.population)
//     }
//   }`
//   let func = await compileCCrossCheck(query, { outDir, outFile: "nestedGroupAggregateTest" })

//   expect(await func()).toEqual({
//     Asia: { Beijing: 20, Tokyo: 30 },
//     Europe: { London: 10, Paris: 10 }
//   })
// })

// test("joinSimpleTest1", async () => {
//   let q1 = rh`{
//     ${region}.*O.country: ${region}.*O.region
//   }`
//   let query = rh`{
//     ${country}.*.city: {
//       country: ${country}.*.country,
//       region: ${q1}.(${country}.*.country)
//     }
//   }`
//   let func = await compileCCrossCheck(query, { outDir, outFile: "joinSimpleTest1" })

//   expect(await func()).toEqual({
//     Beijing: { country: "China", region: "Asia" },
//     Paris: { country: "France", region: "Europe" },
//     London: { country: "UK", region: "Europe" },
//     Tokyo: { country: "Japan", region: "Asia" }
//   })
// })

// test("joinSimpleTest1B", async () => {
//   // use explicit 'single' aggregation
//   let q1 = rh`{
//     ${region}.*O.country: single ${region}.*O.region
//   }`
//   let query = rh`{
//     ${country}.*.city: {
//       country: single ${country}.*.country,
//       region: single ${q1}.(${country}.*.country)
//     }
//   }`
//   let func = await compileCCrossCheck(query, { outDir, outFile: "joinSimpleTest1B" })

//   expect(await func()).toEqual({
//     Beijing: { country: "China", region: "Asia" },
//     Paris: { country: "France", region: "Europe" },
//     London: { country: "UK", region: "Europe" },
//     Tokyo: { country: "Japan", region: "Asia" }
//   })
// })

// test("joinSimpleTest2", async () => {
//   let q1 = rh`{
//     ${region}.*O.country: ${region}.*O.region
//   }`
//   let query = rh`{
//     ${q1}.(${country}.*.country) : {
//       ${country}.*.city: sum ${country}.*.population
//     }
//   }`
//   let func = await compileCCrossCheck(query, { outDir, outFile: "joinSimpleTest2" })

//   expect(await func()).toEqual({
//     Asia: { Beijing: 20, Tokyo: 30 },
//     Europe: { London: 10, Paris: 10 }
//   })
// })

// test("joinWithAggrTest", async () => {
//   let q1 = rh`{
//     ${region}.*O.country: ${region}.*O.region
//   }`
//   // SELECT SUM(country.population) FROM country JOIN region ON region.country = country.country GROUP BY region.region
//   let query = rh`{
//     ${q1}.(${country}.*.country): sum ${country}.*.population
//   }`
//   let func = await compileCCrossCheck(query, { outDir, outFile: "joinWithAggrTest" })

//   expect(await func()).toEqual({ Asia: 50, Europe: 20 })
// })

// // c-new rejects apply nodes: a udf is a JS closure, and there is nothing to
// // pass one through to a compiled C program.
// test.failing("udfTest", async () => {
//   let udfData = rh`loadJSON "./data/json/basic/udf.json" ${types.unknown}`
//   let query = [{
//     item: rh`${udfData}.*.item`,
//     price: api.apply("udf.formatDollar", rh`${udfData}.*.price`)
//   }]
//   let func = await compileCCrossCheck(query, { outDir, outFile: "udfTest" })
// })

// test("arrayTest1", async () => {
//   let query = rh`sum(sum(${data}.*.value))`
//   let func = await compileCCrossCheck(query, { outDir, outFile: "arrayTest1" })

//   expect(await func()).toEqual(60)
// })

// test("arrayTest2", async () => {
//   let query1 = api.array(api.array(rh`${data}.*.value`))
//   let query2 = api.array(api.sum(rh`${data}.*.value`))
//   let query2A = api.array({ v: api.sum(rh`${data}.*.value`) })
//   let query3 = api.join(api.array(rh`${data}.*.value`))
//   let query4 = api.sum(api.sum(rh`${data}.*.value`))

//   let query = { query1, query2, query2A, query3, query4 }
//   let func = await compileCCrossCheck(query, { outDir, outFile: "arrayTest2" })

//   expect(await func()).toEqual({
//     query1: [[10, 20, 30]],
//     query2: [60],
//     query2A: [{ v: 60 }],
//     query3: "10,20,30",
//     query4: 60
//   })
// })

// // this was the failing test from https://tiarkrompf.github.io/notes/?/js-queries/aside24
// test("arrayTest3", async () => {
//   let query = rh`{ ${data}.*.key: ["Extra1", { foo: ${data}.*.value }, "Extra2"] }`
//   let func = await compileCCrossCheck(query, { outDir, outFile: "arrayTest3" })

//   expect(await func()).toEqual({
//     A: ["Extra1", { foo: 10 }, { foo: 30 }, "Extra2"],
//     B: ["Extra1", { foo: 20 }, "Extra2"]
//   })
// })

// test("arrayTest4", async () => {
//   let query = rh`{ ${data}.*.key: [{ v1: ${data}.*.value }, { v2: ${data}.*.value }] }`
//   let func = await compileCCrossCheck(query, { outDir, outFile: "arrayTest4" })

//   expect(await func()).toEqual({
//     A: [{ v1: 10 }, { v1: 30 }, { v2: 10 }, { v2: 30 }],
//     B: [{ v1: 20 }, { v2: 20 }]
//   })
// })

// // test manual zip and flatten patterns for nested array traversal
// //
// // The one query here where the two backends disagree, so it checks each
// // against its own value rather than going through the crosscheck. c-new
// // reproduces c2_new exactly: the iteration domain is D0,K3,*A but only *A,K3
// // are iterated, and simple-loopgen.js:108 projects that pair set down and
// // dedups it before traversing, while new-codegen.js -- which c-new schedules
// // with -- has no PROJECT/TRAVERSE, so D0 stays in scope and each K3 is visited
// // once per row. Adding projection to new-codegen makes these two converge, and
// // fixes the js newCodegen backend at the same time.
// //
// // Neither value is the original's {A: [10,10,30,30]}: that is c1's scoping,
// // and c2 needs *D pulled out to the right level to reach it, which is what
// // arrayTest5ZipB below does. The original never compared them -- it calls
// // func.c1 directly rather than the crosscheck wrapper.
// test("arrayTest5Zip", async () => {
//   let zip = rh`{ v1: ${data}.*.value, v2: ${data}.*.value }`
//   let query = rh`{ ${data}.*.key: [${zip}.*A] }`
//   let func = await compileCCrossCheck(query, { outDir, outFile: "arrayTest5Zip" })

//   expect(func.c2()).toEqual({ A: [30, 30], B: [20, 20] })
//   expect(await func.cnew()).toEqual({ A: [30, 30, 30, 30], B: [20, 20] })
// })

// // c2 needs an explicit var *D pulled out to the right level
// test("arrayTest5ZipB", async () => {
//   let zip = rh`{ v1: ${data}.*D.value, v2: ${data}.*D.value }`
//   let query = rh`{ ${data}.*D.key: [*D & ${zip}.*A] }`
//   let func = await compileCCrossCheck(query, { outDir, outFile: "arrayTest5ZipB" })

//   expect(await func()).toEqual({ A: [10, 10, 30, 30], B: [20, 20] })
// })

// test("arrayTest6Flatten", async () => {
//   let query0 = rh`{ ${data}.*.key: { v1: [${data}.*.value], v2: [${data}.*.value] } }`
//   let query = { "*k": [api.get(api.get(api.get(query0, "*k"), "*A"), "*B")] }
//   let func = await compileCCrossCheck(query, { outDir, outFile: "arrayTest6Flatten" })

//   expect(await func()).toEqual({ A: [10, 30, 10, 30], B: [20, 20] })
// })

// test("arrayTest7Eta", async () => {
//   let query0 = rh`{ ${data}.*.key: [${data}.*.value] }`
//   let query = { "*k": api.get(query0, "*k") }
//   let func = await compileCCrossCheck(query, { outDir, outFile: "arrayTest7Eta" })

//   expect(await func()).toEqual({ A: [10, 30], B: [20] })
// })
