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

let hasCuda = false
try {
  os.execSync('nvcc --version', { stdio: 'ignore' })
  hasCuda = true
} catch (e) {}
let testCuda = (name, fn) => (hasCuda ? test : test.skip)(name, fn, 10000)

let outDir = "cgen-sql/out/tensors"

beforeAll(async () => {
  await sh(`rm -rf ${outDir}`)
  await sh(`mkdir -p ${outDir}`)
  // await sh(`cp cgen-sql/yyjson.h ${outDir}`)
})

let key = typing.createKey(types.u32)

let matSchema = typing.parseType({
  "-": typing.keyval(key, {
    "-": typing.keyval(key, types.u32)
  })
})

let matSchema1 = typing.createVec("dense", types.u32, 2, types.u32)

// let batchedMatSchema = typing.parseType({
//   "-": typing.keyval(key, {
//     "-": typing.keyval(key, {
//       "-": typing.keyval(key, types.u32)
//     })
//   })
// })

let batchedMatSchema = typing.createVec("dense", types.u32, 3, types.u32)

let sparseMatSchema = typing.createSparseMat(types.u32, types.u32)

let sparseVecSchema = typing.createSparseVec(types.u32, types.u32)


let vecSchema = typing.parseType({
  "-": typing.keyval(key, key, types.u32)
})

let vecSchema1 = typing.createVec("dense", types.u32, 1, types.u32)

let matA = rh`loadJSON "./cgen-sql/json/tensors/matA.json" ${matSchema1}`
let batchedMatA = rh`loadJSON "./cgen-sql/json/tensors/batchedMatA.json" ${batchedMatSchema}`

let matB = rh`loadJSON "./cgen-sql/json/tensors/matB.json" ${matSchema1}`
let batchedMatB = rh`loadJSON "./cgen-sql/json/tensors/batchedMatB.json" ${batchedMatSchema}`

let matC = rh`loadJSON "./cgen-sql/json/tensors/matC.json" ${matSchema1}`

let vecA = rh`loadJSON "./cgen-sql/json/tensors/vecA.json" ${vecSchema1}`
let vecB = rh`loadJSON "./cgen-sql/json/tensors/vecB.json" ${vecSchema1}`

let sparseMat1 = rh`loadJSON "./cgen-sql/json/tensors/sparseMat1.json" ${sparseMatSchema}`
let denseMat3x2 = rh`loadJSON "./cgen-sql/json/tensors/denseMat3x2.json" ${matSchema1}`

test("transpose", async () => {
  let query = { "*j": { "*i": rh`${matB}.*i.*j` } }

  let func = await compile(query, { backend: "c", outDir, outFile: "transpose" })
  let res = await func()

  let expected = { 0: { 0: 1, 1: 4 }, 1: { 0: 2, 1: 5 }, 2: { 0: 3, 1: 6 } }

  expect(JSON.parse(res)).toEqual(expected)
})

test("sum", async () => {
  let query = rh`sum ${matB}.*i.*j`

  let func = await compile(query, { backend: "c", outDir, outFile: "sum" })
  let res = await func()

  let expected = 21
  expect(JSON.parse(res)).toEqual(expected)
})

test("columnSum", async () => {
  let query = rh`{*j: sum ${matB}.*i.*j}`

  let func = await compile(query, { backend: "c", outDir, outFile: "columnSum" })
  let res = await func()

  let expected = { 0: 5, 1: 7, 2: 9 }
  expect(JSON.parse(res)).toEqual(expected)
})

test("rowSum", async () => {
  let query = rh`{*i: sum ${matB}.*i.*j}`

  let func = await compile(query, { backend: "c", outDir, outFile: "columnSum" })
  let res = await func()

  let expected = { 0: 6, 1: 15 }
  expect(JSON.parse(res)).toEqual(expected)
})

test("matmul", async () => {
  let query = rh`{*i: {*j: sum(${matA}.*i.*k * ${matB}.*k.*j)}}`

  let func = await compile(query, { backend: "c", outDir, outFile: "matmul" })
  let res = await func()

  let expected = { 0: { 0: 9, 1: 12, 2: 15 }, 1: { 0: 19, 1: 26, 2: 33 } }
  expect(JSON.parse(res)).toEqual(expected)
})

testCuda("matmulCuda", async () => {
  let query = rh`{*i: {*j: sum(${matA}.*i.*k * ${matB}.*k.*j)}}`

  let func = await compile(query, { backend: "cuda", outDir, outFile: "matmul", enableOptimizations: false })
  let res = await func()

  let expected = { 0: { 0: 9, 1: 12, 2: 15 }, 1: { 0: 19, 1: 26, 2: 33 } }
  expect(JSON.parse(res)).toEqual(expected)
})

testCuda("matmulCuda1", async () => {
  let mulAA = rh`{*i0: {*j0: sum(${matA}.*i0.*k0 * ${matA}.*k0.*j0)}}`

  let query = rh`{*i1: {*j1: sum(${mulAA}.*i1.*k1 * ${matB}.*k1.*j1)}}`

  let func = await compile(query, { backend: "cuda", outDir, outFile: "matmulCuda1", enableOptimizations: false })
  let res = await func()

  let expected = { 0: { 0: 47, 1: 64, 2: 81 }, 1: { 0: 103, 1: 140, 2: 177 } }
  expect(JSON.parse(res)).toEqual(expected)
})

testCuda("matmulCuda2", async () => {
  // matmulCuda test with flipped order
  let query = rh`{*i: {*j: sum(${matB}.*k.*j * ${matA}.*i.*k)}}`
  let func = await compile(query, { backend: "cuda", outDir, outFile: "matmul", enableOptimizations: false })
  let res = await func()

  let expected = { 0: { 0: 9, 1: 12, 2: 15 }, 1: { 0: 19, 1: 26, 2: 33 } }
  expect(JSON.parse(res)).toEqual(expected)
})

testCuda("fullGemmCuda", async () => {
  // need to add support for translation
  // alpha * A@B + beta * C_in
  let query = rh`{*i: {*j: 2.0 * sum(${matA}.*i.*k * ${matB}.*k.*j) + 3.0 * ${matC}.*i.*j}}`
  
  let func = await compile(query, { backend: "cuda", outDir, outFile: "fullGemm", enableOptimizations: false })
  let res = await func()

  let expected = { 0: { 0: 21, 1: 27, 2: 33 }, 1: { 0: 41, 1: 55, 2: 69 } }
  expect(JSON.parse(res)).toEqual(expected)
})

testCuda("scaledMatmulCuda", async () => {
  let query = rh`{*i: {*j: 2.0 * sum(${matA}.*i.*k * ${matB}.*k.*j)}}`

  let func = await compile(query, { backend: "cuda", outDir, outFile: "matmul", enableOptimizations: false })
  let res = await func()

  let expected = { 0: { 0: 18, 1: 24, 2: 30 }, 1: { 0: 38, 1: 52, 2: 66 } }
  expect(JSON.parse(res)).toEqual(expected)
})

testCuda("sparseMatmulCuda", async () => {
  let query = rh`{*i: {*j: sum(${sparseMat1}.*i.*k * ${denseMat3x2}.*k.*j)}}`
            // rh`matmul(....)
  let func = await compile(query, { backend: "cuda", outDir, outFile: "sparseMatmul", enableOptimizations: false })
  let res = await func()

  let expected = { 0: { 0: 5, 1: 10 }, 1: { 0: 24, 1: 32 }, 2: { 0: 13, 1: 18 } }
  expect(JSON.parse(res)).toEqual(expected)
})


test("hadamard", async () => {
  let query = rh`{*i: {*j: ${matA}.*i.*j * ${matA}.*i.*j}}`

  let func = await compile(query, { backend: "c", outDir, outFile: "hadamard" })
  let res = await func()

  let expected = { 0: { 0: 1, 1: 4 }, 1: { 0: 9, 1: 16 } }
  expect(JSON.parse(res)).toEqual(expected)
})

test("dotProduct", async () => {
  let query = rh`sum(${vecA}.*i * ${vecB}.*i)`

  let func = await compile(query, { backend: "c", outDir, outFile: "dotProduct" })
  let res = await func()

  let expected = 10
  expect(JSON.parse(res)).toEqual(expected)
})

testCuda("dotProductCuda", async () => {
  let query = rh`sum(${vecA}.*i * ${vecB}.*i)`

  let func = await compile(query, { backend: "cuda", outDir, outFile: "dotProductCuda", enableOptimizations: false })
  let res = await func()

  let expected = 10
  expect(JSON.parse(res)).toEqual(expected)
})

test("batchedMatmul", async () => {
  let query = rh`{*i: {*j: {*l: sum(${batchedMatA}.*i.*j.*k * ${batchedMatB}.*i.*k.*l)}}}`

  let func = await compile(query, { backend: "c", outDir, outFile: "batchedMatmul", enableOptimizations: false })
  let res = await func()

  let expected = { 0: { 0: { 0: 9, 1: 12, 2: 15 }, 1: { 0: 19, 1: 26, 2: 33 } }, 1: { 0: { 0: 95, 1: 106, 2: 117 }, 1: { 0: 129, 1: 144, 2: 159 } } }
  expect(JSON.parse(res)).toEqual(expected)
})

testCuda("batchedMatmulCuda", async () => {
  let query = rh`{*i: {*j: {*l: sum(${batchedMatA}.*i.*j.*k * ${batchedMatB}.*i.*k.*l)}}}`

  let func = await compile(query, { backend: "cuda", outDir, outFile: "batchedMatmulCuda", enableOptimizations: false })
  let res = await func()

  let expected = { 0: { 0: { 0: 9, 1: 12, 2: 15 }, 1: { 0: 19, 1: 26, 2: 33 } }, 1: { 0: { 0: 95, 1: 106, 2: 117 }, 1: { 0: 129, 1: 144, 2: 159 } } }
  expect(JSON.parse(res)).toEqual(expected)
})

// Not supported
// test("diagonal", async () => {
//   let query = rh`{*i: ${matA}.*i.*i}`

//   let func = await compile(query, { backend: "c", outDir, outFile: "diagonal" })
//   let res = await func()

//   let expected = {0: 1, 1: 4}
//   expect(JSON.parse(res)).toEqual(expected)
// })
