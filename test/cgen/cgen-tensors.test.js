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

let matSchema = typing.parseType({
  "-": typing.keyval(key, {
    "-": typing.keyval(key, types.i32)
  })
})

let matA = rh`loadJSON "./cgen-sql/json/tensors/matA.json" ${matSchema}`
// let batchedMatA = rh`loadJSON "./cgen-sql/json/tensors/batchedMatA.json" ${otherSchema}`

let matB = rh`loadJSON "./cgen-sql/json/tensors/matB.json" ${matSchema}`
// let batchedMatB = rh`loadJSON "./cgen-sql/json/tensors/other.json" ${otherSchema}`

test("transpose", async () => {
  let query = { "*j": { "*i": rh`${matB}.*i.*j` } }

  let func = await compile(query, { backend: "c-new", outDir, outFile: "transpose" })
  let res = await func()

  let expected = { 0: { 0: 1, 1: 4 }, 1: { 0: 2, 1: 5 }, 2: { 0: 3, 1: 6 } }

  expect(JSON.parse(res)).toEqual(expected)
})
