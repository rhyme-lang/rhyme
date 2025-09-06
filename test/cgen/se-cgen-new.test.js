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

let dataSchema = typing.objBuilder().add(typing.createKey(types.i32), types.i32).build()

test("cppNewCodegenTest", async () => {
  let data = rh`loadJSON "./cgen/data.json" ${dataSchema}`
  let query = rh`sum ${data}.*`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "cppNewCodegenTest" })

  let res = await func()
  console.log(res)
}, 10000)
