// The c-new backend, replicating test/original/advanced.test.js query for
// query. Test names and expected values are kept identical so the two can be
// read side by side.
//
// Its `data` is byte-identical to data/json/basic/data.json, so the queries
// carry over with only the input binding changed: the original names inputs
// through the `inp` object, and c-new has none, so everything goes through
// loadJSON with types.unknown -- which also drives the general-JSON path.
//
// compileCCrossCheck runs each query on the js pipeline and on c-new and
// asserts they agree; the expect() that follows pins the value, so a change
// that moves both backends together is still caught.

const { rh } = require('../../src/rhyme')
const { types } = require('../../src/typing')
const { compileCCrossCheck } = require('../utils')

const fs = require('fs/promises')
const { prepareRuntime } = require('../../src/cgen/codegen')

// Its own directory: jest runs test files in parallel workers, so sharing one
// with the other cnew suites would race their beforeAll wiping it.
let outDir = "out/cnew/advanced"

beforeAll(async () => {
  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })
})

// build the C runtime up front, so the first query does not pay for it
beforeAll(prepareRuntime, 60000)

let data = rh`loadJSON "./data/json/basic/data.json" ${types.unknown}`

test("decorrelation1", async () => {
  let query = rh`{
    total: sum(${data}.*A.value),
    ${data}.*.key: {
      my_total: sum(${data}.*.value),
      full_total: sum(${data}.*B.value)
    }
  }`
  let func = await compileCCrossCheck(query, { outDir, outFile: "decorrelation1" })

  expect(await func()).toEqual({
    total: 60,
    A: { my_total: 40, full_total: 60 },
    B: { my_total: 20, full_total: 60 }
  })
})

test("decorrelation2", async () => {
  let query = rh`{
    total: sum(${data}.*.value),
    ${data}.*.key: sum(${data}.*.value) / sum(${data}.*B.value)
  }`
  let func = await compileCCrossCheck(query, { outDir, outFile: "decorrelation2" })

  expect(await func()).toEqual({
    total: 60,
    A: 0.6666666666666666,
    B: 0.3333333333333333
  })
})

// the following set of tests works with emitting repeated iterators logic
// (explicitly hoisted versions works fine as expected without that)
test("nestedIterators1", async () => {
  let query = rh`{
    total: sum(${data}.*A.value),
    ${data}.*.key: {
      my_total: sum(${data}.*.value),
      ${data}.*B.key: sum(${data}.*B.value)
    }
  }`
  let func = await compileCCrossCheck(query, { outDir, outFile: "nestedIterators1" })

  expect(await func()).toEqual({
    total: 60,
    A: { my_total: 40, A: 40, B: 20 },
    B: { my_total: 20, A: 40, B: 20 }
  })
})

test("nestedIterators1-explicitlyHoisted", async () => {
  let aggr = rh`{ ${data}.*O.key: sum(${data}.*O.value) }`
  let query = rh`{
    total: sum(${data}.*.value),
    ${data}.*.key: {
      my_total: ${aggr}.(${data}.*.key),
      ${data}.*B.key: ${aggr}.(${data}.*B.key)
    }
  }`
  let func = await compileCCrossCheck(query, { outDir, outFile: "nestedIterators1Hoisted" })

  expect(await func()).toEqual({
    total: 60,
    A: { my_total: 40, A: 40, B: 20 },
    B: { my_total: 20, A: 40, B: 20 }
  })
})

test("nestedIterators2", async () => {
  // cannot simply use nested loops, "data.*A.value" should be fully computed
  // before computing inner
  let query = rh`{
    ${data}.*A.key: {
      ${data}.*B.key: sum(${data}.*A.value) / sum(${data}.*B.value)
    }
  }`
  let func = await compileCCrossCheck(query, { outDir, outFile: "nestedIterators2" })

  expect(await func()).toEqual({
    A: { A: 1, B: 2 },
    B: { A: 0.5, B: 1 }
  })
})

test("nestedIterators2-explicitlyHoisted", async () => {
  let aggr = rh`{ ${data}.*.key: sum(${data}.*.value) }`
  let query = rh`{
    ${data}.*A.key: {
      ${data}.*B.key: ${aggr}.(${data}.*A.key) / ${aggr}.(${data}.*B.key)
    }
  }`
  let func = await compileCCrossCheck(query, { outDir, outFile: "nestedIterators2Hoisted" })

  expect(await func()).toEqual({
    A: { A: 1, B: 2 },
    B: { A: 0.5, B: 1 }
  })
})

test("nestedIterators3", async () => {
  let aggr = rh`{ ${data}.*.key: sum(${data}.*.value) }`
  let query = rh`{
    ${data}.*A.key: {
      total: sum(${data}.*A.value),
      ${data}.*B.key: {
        total: sum(${data}.*B.value),
        ratio: ${aggr}.(${data}.*A.key) / ${aggr}.(${data}.*B.key)
      }
    }
  }`
  let func = await compileCCrossCheck(query, { outDir, outFile: "nestedIterators3" })

  expect(await func()).toEqual({
    A: { total: 40, A: { total: 40, ratio: 1 }, B: { total: 20, ratio: 2 } },
    B: { total: 20, A: { total: 40, ratio: 0.5 }, B: { total: 20, ratio: 1 } }
  })
})

test("nestedIterators3-explicitlyHoisted", async () => {
  let aggr = rh`{ ${data}.*.key: sum(${data}.*.value) }`
  // the hoisted 'total' pulls the computation out, which produces the correct
  // result without relying on repeated iterators
  let query = rh`{
    ${data}.*A.key: {
      total: ${aggr}.(${data}.*A.key),
      ${data}.*B.key: {
        total: ${aggr}.(${data}.*B.key),
        ratio: ${aggr}.(${data}.*A.key) / ${aggr}.(${data}.*B.key)
      }
    }
  }`
  let func = await compileCCrossCheck(query, { outDir, outFile: "nestedIterators3Hoisted" })

  expect(await func()).toEqual({
    A: { total: 40, A: { ratio: 1, total: 40 }, B: { ratio: 2, total: 20 } },
    B: { total: 20, A: { ratio: 0.5, total: 40 }, B: { ratio: 1, total: 20 } }
  })
})
