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

let outDir = "cgen-sql/out/tensors"

beforeAll(async () => {
  await sh(`rm -rf ${outDir}`)
  await sh(`mkdir -p ${outDir}`)
  await sh(`cp cgen-sql/yyjson.h ${outDir}`)
})

let key = typing.createKey(types.u32)

let matSchema = typing.parseType({
  "-": typing.keyval(key, {
    "-": typing.keyval(key, types.u32)
  })
})

let batchedMatSchema = typing.parseType({
  "-": typing.keyval(key, {
    "-": typing.keyval(key, {
      "-": typing.keyval(key, types.u32)
    })
  })
})

let vecSchema = typing.parseType({
  "-": typing.keyval(key, key, types.u32)
})

let matA = rh`loadJSON "./cgen-sql/json/tensors/matA.json" ${matSchema}`
let batchedMatA = rh`loadJSON "./cgen-sql/json/tensors/batchedMatA.json" ${batchedMatSchema}`

let matB = rh`loadJSON "./cgen-sql/json/tensors/matB.json" ${matSchema}`
let batchedMatB = rh`loadJSON "./cgen-sql/json/tensors/batchedMatB.json" ${batchedMatSchema}`

let vecA = rh`loadJSON "./cgen-sql/json/tensors/vecA.json" ${vecSchema}`
let vecB = rh`loadJSON "./cgen-sql/json/tensors/vecB.json" ${vecSchema}`

test("transpose", async () => {
  let query = { "*j": { "*i": rh`${matB}.*i.*j` } }

  let func = await compile(query, { backend: "c-new", outDir, outFile: "transpose" })
  let res = await func()

  let expected = { 0: { 0: 1, 1: 4 }, 1: { 0: 2, 1: 5 }, 2: { 0: 3, 1: 6 } }

  expect(JSON.parse(res)).toEqual(expected)
})

test("sum", async () => {
  let query = rh`sum ${matB}.*i.*j`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "sum" })
  let res = await func()

  let expected = 21
  expect(JSON.parse(res)).toEqual(expected)
})

test("columnSum", async () => {
  let query = rh`{*j: sum ${matB}.*i.*j}`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "columnSum" })
  let res = await func()

  let expected = { 0: 5, 1: 7, 2: 9 }
  expect(JSON.parse(res)).toEqual(expected)
})

test("rowSum", async () => {
  let query = rh`{*i: sum ${matB}.*i.*j}`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "columnSum" })
  let res = await func()

  let expected = { 0: 6, 1: 15 }
  expect(JSON.parse(res)).toEqual(expected)
})

test("matmul", async () => {
  let query = rh`{*i: {*j: sum(${matA}.*i.*k * ${matB}.*k.*j)}}`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "matmul" })
  let res = await func()

  let expected = { 0: { 0: 9, 1: 12, 2: 15 }, 1: { 0: 19, 1: 26, 2: 33 } }
  expect(JSON.parse(res)).toEqual(expected)
})

test("hadamard", async () => {
  let query = rh`{*i: {*j: ${matA}.*i.*j * ${matA}.*i.*j}}`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "hadamard" })
  let res = await func()

  let expected = { 0: { 0: 1, 1: 4 }, 1: { 0: 9, 1: 16 } }
  expect(JSON.parse(res)).toEqual(expected)
})

test("dotProduct", async () => {
  let query = rh`sum(${vecA}.*i * ${vecB}.*i)`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "dotProduct" })
  let res = await func()

  let expected = 10
  expect(JSON.parse(res)).toEqual(expected)
})

test("batchedMatmul", async () => {
  let query = rh`{*i: {*j: {*l: sum(${batchedMatA}.*i.*j.*k * ${batchedMatB}.*i.*k.*l)}}}`

  let func = await compile(query, { backend: "c-new", outDir, outFile: "batchedMatmul", enableOptimizations: false })
  let res = await func()

  let expected = { 0: { 0: { 0: 9, 1: 12, 2: 15 }, 1: { 0: 19, 1: 26, 2: 33 } }, 1: { 0: { 0: 95, 1: 106, 2: 117 }, 1: { 0: 129, 1: 144, 2: 159 } } }
  expect(JSON.parse(res)).toEqual(expected)
})

// Not supported
// test("diagonal", async () => {
//   let query = rh`{*i: ${matA}.*i.*i}`

//   let func = await compile(query, { backend: "c-new", outDir, outFile: "diagonal" })
//   let res = await func()

//   let expected = {0: 1, 1: 4}
//   expect(JSON.parse(res)).toEqual(expected)
// })
