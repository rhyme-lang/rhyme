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

let outDir = "cgen-sql/out/cuda"

beforeAll(async () => {
  await sh(`rm -rf ${outDir}`)
  await sh(`mkdir -p ${outDir}`)
})

test("plainTest", async () => {
  let query = rh`1`

  try {
    let func = await compile(query, { backend: "cuda", outDir, outFile: "plainTest" })
    let res = await func()
  } catch (e) {
    console.log(e)
  }

  // console.log(res)
  // expect(JSON.parse(res)).toEqual(1)
})

