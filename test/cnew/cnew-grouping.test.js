// The c-new backend, replicating test/original/grouping.test.js query for
// query. Test names and expected values are kept identical so the two can be
// read side by side.
//
// The original's inline inputs are byte-identical to the json files loaded
// below, so the queries carry over with only the input binding changed: c-new
// has no `inp` object, so everything goes through loadJSON with types.unknown,
// which also drives the general-JSON path.
//
// subQueryGrouping is the query the original annotates as
//   "This makes tmp[3][*] all point to the same object"
// -- the same class of aliasing rh_map_copy fixes in c-new. It does not pin
// that fix, though: reverting rh_map_copy leaves this whole suite green and
// fails nestedIterators3 in cnew-advanced instead, so c-new must schedule this
// query without the shared initCopy the js pipeline once had.
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
let outDir = "out/cnew/grouping"

beforeAll(async () => {
  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })
})

// build the C runtime up front, so the first query does not pay for it
beforeAll(prepareRuntime, 60000)

let scalars = rh`loadJSON "./data/json/grouping/scalars.json" ${types.unknown}`
let keyvalue = rh`loadJSON "./data/json/grouping/keyvalue.json" ${types.unknown}`
let regions = rh`loadJSON "./data/json/grouping/regions.json" ${types.unknown}`
let nested = rh`loadJSON "./data/json/grouping/nested.json" ${types.unknown}`

test("statelessGrouping", async () => {
  let q1 = rh`{ *A: ${scalars}.*A }`
  let q2 = rh`{ foo: { *A: ${scalars}.*A } }.foo`

  let f1 = await compileCCrossCheck(q1, { outDir, outFile: "statelessGrouping1" })
  let f2 = await compileCCrossCheck(q2, { outDir, outFile: "statelessGrouping2" })

  let e = { A: 10, B: 20, C: 30 }
  expect(await f1()).toEqual(e)
  expect(await f2()).toEqual(e)
})

test("statelessRepeatedGrouping1", async () => {
  let q1 = rh`{ *A: { *A: ${scalars}.*A } }`
  let q2 = rh`{ foo: { *A: { *A: ${scalars}.*A } } }.foo`

  let f1 = await compileCCrossCheck(q1, { outDir, outFile: "statelessRepeatedGrouping1a" })
  let f2 = await compileCCrossCheck(q2, { outDir, outFile: "statelessRepeatedGrouping1b" })

  let e = { A: { A: 10 }, B: { B: 20 }, C: { C: 30 } }
  expect(await f1()).toEqual(e)
  expect(await f2()).toEqual(e)
})

test("statelessRepeatedGrouping2", async () => {
  let q1 = rh`{ ${keyvalue}.*.key: { ${keyvalue}.*.key: ${keyvalue}.*.value } }`
  let q2 = rh`{ foo: { ${keyvalue}.*.key: { ${keyvalue}.*.key: ${keyvalue}.*.value } } }.foo`

  let f1 = await compileCCrossCheck(q1, { outDir, outFile: "statelessRepeatedGrouping2a" })
  let f2 = await compileCCrossCheck(q2, { outDir, outFile: "statelessRepeatedGrouping2b" })

  let e = { A: { A: 10 }, B: { B: 20 }, C: { C: 30 } }
  expect(await f1()).toEqual(e)
  expect(await f2()).toEqual(e)
})

test("statelessRepeatedGrouping3", async () => {
  let q1 = rh`{ ${keyvalue}.*.key: { ${keyvalue}.*.key: 7 } }`
  let q2 = rh`{ foo: { ${keyvalue}.*.key: { ${keyvalue}.*.key: 7 } } }.foo`

  let f1 = await compileCCrossCheck(q1, { outDir, outFile: "statelessRepeatedGrouping3a" })
  let f2 = await compileCCrossCheck(q2, { outDir, outFile: "statelessRepeatedGrouping3b" })

  let e = { A: { A: 7 }, B: { B: 7 }, C: { C: 7 } }
  expect(await f1()).toEqual(e)
  expect(await f2()).toEqual(e)
})

// interaction of array and object construction
test("arrayWithinGrouping", async () => {
  let q0 = rh`{ ${regions}.*.region: { ${regions}.*.name: ${regions}.*.value } }`
  let q1 = rh`{ ${regions}.*.region: [{ name: ${regions}.*.name, value: ${regions}.*.value }] }`
  let q2 = rh`{ ${regions}.*.region: [{ ${regions}.*.name: ${regions}.*.value }] }`

  let f0 = await compileCCrossCheck(q0, { outDir, outFile: "arrayWithinGrouping0" })
  let f1 = await compileCCrossCheck(q1, { outDir, outFile: "arrayWithinGrouping1" })
  let f2 = await compileCCrossCheck(q2, { outDir, outFile: "arrayWithinGrouping2" })

  expect(await f0()).toEqual({
    Europe: { London: 10, Paris: 11, Berlin: 12 },
    Asia: { Beijing: 20, Tokyo: 21, Seoul: 22 }
  })
  expect(await f1()).toEqual({
    Europe: [
      { name: "London", value: 10 },
      { name: "Paris", value: 11 },
      { name: "Berlin", value: 12 }
    ],
    Asia: [
      { name: "Beijing", value: 20 },
      { name: "Tokyo", value: 21 },
      { name: "Seoul", value: 22 }
    ]
  })
  // the original's e2alt: what the pipeline currently produces, not the e2 it
  // notes as arguably more principled
  expect(await f2()).toEqual({
    Europe: [{ London: 10 }, { Paris: 11 }, { Berlin: 12 }],
    Asia: [{ Beijing: 20 }, { Tokyo: 21 }, { Seoul: 22 }]
  })
})

test("subQueryGrouping", async () => {
  let q0 = rh`{ *i: { ${nested}.*i.*j.key: sum(${nested}.*i.*j.val) } }`
  let q1 = rh`{ *q: ${q0}.*q }`

  let f0 = await compileCCrossCheck(q0, { outDir, outFile: "subQueryGrouping0" })
  let f1 = await compileCCrossCheck(q1, { outDir, outFile: "subQueryGrouping1" })

  let expected = {
    0: { A: 30, B: 70 },
    1: { A: 70, B: 30 }
  }
  expect(await f0()).toEqual(expected)
  expect(await f1()).toEqual(expected)
})
