const { rh, api } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')
const { typing, types } = require('../../src/typing')

// point to the data directory
let outDir = "bench/out/json-bench"

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

let bluesky = rh`loadNDJSON "cgen-sql/data/bluesky/bluesky_cleaned.json" ${schema}`

let settings = {
  backend: "c-new",
  schema: types.never,
  outDir,
  enableOptimizations: false,
  format: "csv"
}

async function q1() {
  let group = rh`{
    ${bluesky}.*A.commit.collection || "(null)": {
      event: single(${bluesky}.*A.commit.collection || "(null)"),
      count: count(${bluesky}.*A)
    }
  }`

  let query = rh`sort ${group} "count" 1`

  let func = await compile(query, { ...settings, outFile: "q1" })
}

q1()
