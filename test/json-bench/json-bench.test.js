const { rh, api } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')
const { typing, types } = require('../../src/typing')
const fs = require("fs")
const os = require('child_process')

let outDir = "cgen-sql/out/json-bench"

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

beforeAll(async () => {
  try {
    await sh(`rm -rf ${outDir}`)
    await sh(`mkdir -p ${outDir}`)
    await sh(`cp cgen-sql/rhyme-sql.h ${outDir}`)
  } catch (error) {
    console.log(error)
  }
})

let u32Key = typing.createKey(types.u32)

let schema = typing.parseType({
  "-": typing.keyval(u32Key, {
    did: types.string,
    time_us: types.u64,
    kind: types.string,
    commit: {
      rev: types.string,
      operation: types.string,
      collection: types.string,
      rkey: types.string,
      record: types.unknown,
      cid: types.string
    }
  })
})

let bluesky = rh`loadNDJSON "cgen-sql/data/bluesky/file_0001.json" ${schema}`

let settings = {
  backend: "c-new",
  schema: types.never,
  outDir,
  hashSize: 524288,
  enableOptimizations: false,
  format: "csv"
}

test("q1", async () => {
  let group = rh`{
    ${bluesky}.*A.commit.collection: {
      event: single(${bluesky}.*A.commit.collection),
      count: count(${bluesky}.*A)
    }
  }`

  let query = rh`sort ${group} "count" 1`

  let func = await compile(query, { ...settings, outFile: "q1" })
  let res = await func()

  console.log(res)
})

test("q2", async () => {
  let cond = rh`${bluesky}.*A.kind == "commit" && ${bluesky}.*A.commit.operation == "create"`

  let countDistinct = rh`{
    ${bluesky}.*A.commit.collection: {
      event: single(${cond} & ${bluesky}.*A.commit.collection),
      count: count(${cond} & ${bluesky}.*A),
      dids: {
        ${bluesky}.*A.did: count?(${cond} & ${bluesky}.*A.did)
      }
    }
  }`

  let group = rh`{
    event: single ${countDistinct}.*B.event,
    count: single ${countDistinct}.*B.count,
    users: count ${countDistinct}.*B.dids.*C
  } | group ${countDistinct}.*B.event`

  let query = rh`sort ${group} "count" 1`

  let func = await compile(query, { ...settings, outFile: "q2" })
  let res = await func()

  console.log(res)
})
