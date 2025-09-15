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

let data = rh`loadJSON "./cgen-sql/json/data.json" ${types.unknown}`
let other = rh`loadJSON "./cgen-sql/json/other.json" ${types.unknown}`
let nested = rh`loadJSON "./cgen-sql/json/nested.json" ${types.unknown}`

let data1 = {
  A: { key: "U", value: 40 },
  B: { key: "U", value: 20 },
  C: { key: "V", value: 10 },
}

let other1 = {
  A: { value: 100 },
  B: { value: 400 },
  D: { value: 200 },
}

//
// ----- Tests from se-basic.test.js
//

test("testScalar1", async () => {
  let query = rh`sum ${data}.*.value`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testScalar1" })
  let res = await func()

  expect(JSON.parse(res)).toEqual(70)
}, 10000)

// test("testZipScalar2", async () => {
//   let query = rh`${data}.*A.value + ${other}.*A.value | group *A`

//   let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "testScalar2" })
//   let res = await func({ data1, other1 })

//   expect(JSON.parse(res)).toEqual({A:140, B:420})

// }, 10000)
