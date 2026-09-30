// The c-new backend, replicating test/original/tensors.test.js query for
// query. Test names, einsum annotations and expected values are kept identical
// so the two can be read side by side.
//
// The original's inline tensors are byte-identical to the json files loaded
// below, so the queries carry over with only the input binding changed: c-new
// has no `inp` object, so everything goes through loadJSON with types.unknown,
// which also drives the general-JSON path.
//
// This suite covers shapes the other cnew suites do not: iteration three deep
// (*i.*j.*k), contraction over a variable that is bound rather than free
// (matmul's *k), and the same variable twice in one path (diagonal's *i.*i).
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
let outDir = "out/cnew/tensors"

beforeAll(async () => {
  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })
})

// build the C runtime up front, so the first query does not pay for it
beforeAll(prepareRuntime, 60000)

// sample tensors for testing
// A: 2x2
let matA = rh`loadJSON "./data/json/tensors/matA.json" ${types.unknown}`
let batchedMatA = rh`loadJSON "./data/json/tensors/batchedMatA.json" ${types.unknown}`

// B: 2x3
let matB = rh`loadJSON "./data/json/tensors/matB.json" ${types.unknown}`
let batchedMatB = rh`loadJSON "./data/json/tensors/batchedMatB.json" ${types.unknown}`

let vecA = rh`loadJSON "./data/json/tensors/vecA.json" ${types.unknown}`
let vecB = rh`loadJSON "./data/json/tensors/vecB.json" ${types.unknown}`

test("transpose", async () => {
  let query = rh`{ *j: { *i: ${matB}.*i.*j } }`
  let func = await compileCCrossCheck(query, { outDir, outFile: "transpose" })

  expect(await func()).toEqual({ 0: { 0: 1, 1: 4 }, 1: { 0: 2, 1: 5 }, 2: { 0: 3, 1: 6 } })
})

test("sum", async () => {
  let query = rh`sum(${matB}.*i.*j)`
  let func = await compileCCrossCheck(query, { outDir, outFile: "sum" })

  expect(await func()).toEqual(21)
})

test("columnSum", async () => {
  // einsum: "ij->j"
  let query = rh`{ *j: sum(${matB}.*i.*j) }`
  let func = await compileCCrossCheck(query, { outDir, outFile: "columnSum" })

  expect(await func()).toEqual({ 0: 5, 1: 7, 2: 9 })
})

test("rowSum", async () => {
  // einsum: "ij->i"
  let query = rh`{ *i: sum(${matB}.*i.*j) }`
  let func = await compileCCrossCheck(query, { outDir, outFile: "rowSum" })

  expect(await func()).toEqual({ 0: 6, 1: 15 })
})

test("matmul", async () => {
  // einsum: "ik,kj->ij"
  let query = rh`{ *i: { *j: sum(${matA}.*i.*k * ${matB}.*k.*j) } }`
  let func = await compileCCrossCheck(query, { outDir, outFile: "matmul" })

  expect(await func()).toEqual({ 0: { 0: 9, 1: 12, 2: 15 }, 1: { 0: 19, 1: 26, 2: 33 } })
})

test("hadamard", async () => {
  // einsum: "ij,ij->ij"
  let query = rh`{ *i: { *j: ${matA}.*i.*j * ${matA}.*i.*j } }`
  let func = await compileCCrossCheck(query, { outDir, outFile: "hadamard" })

  expect(await func()).toEqual({ 0: { 0: 1, 1: 4 }, 1: { 0: 9, 1: 16 } })
})

test("dotProduct", async () => {
  let query = rh`sum(${vecA}.*i * ${vecB}.*i)`
  let func = await compileCCrossCheck(query, { outDir, outFile: "dotProduct" })

  expect(await func()).toEqual(10)
})

test("batchedMatmul", async () => {
  // einsum: ijk,ikl->ijl
  let query = rh`{ *i: { *j: { *l: sum(${batchedMatA}.*i.*j.*k * ${batchedMatB}.*i.*k.*l) } } }`
  let func = await compileCCrossCheck(query, { outDir, outFile: "batchedMatmul" })

  expect(await func()).toEqual({
    0: { 0: { 0: 9, 1: 12, 2: 15 }, 1: { 0: 19, 1: 26, 2: 33 } },
    1: { 0: { 0: 95, 1: 106, 2: 117 }, 1: { 0: 129, 1: 144, 2: 159 } }
  })
})

test("diagonal", async () => {
  // einsum: ii -> i
  let query = rh`{ *i: ${matA}.*i.*i }`
  let func = await compileCCrossCheck(query, { outDir, outFile: "diagonal" })

  expect(await func()).toEqual({ 0: 1, 1: 4 })
})
