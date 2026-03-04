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

let bluesky = rh`loadNDJSON "cgen-sql/data/bluesky/bluesky.json" ${schema}`

let settings = {
  backend: "c-new",
  schema: types.never,
  outDir,
  enableOptimizations: false,
  format: "csv",
  preload: true,
  arraySize: 10000000
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

async function q2() {
  let cond = rh`${bluesky}.*A.kind == "commit" && ${bluesky}.*A.commit.operation == "create"`

  let countDistinct = rh`{
    ${cond} & ${bluesky}.*A.commit.collection: {
      event: single(${bluesky}.*A.commit.collection),
      count: count(${bluesky}.*A),
      dids: {
        ${cond} & ${bluesky}.*A.did: count(${bluesky}.*A.did)
      }
    }
  }`

  let group = rh`{
    event: single ${countDistinct}.*B.event,
    count: single ${countDistinct}.*B.count,
    users: count ${countDistinct}.*B.dids.*C
  } | group ${countDistinct}.*B.event`

  let query = rh`sort ${group} "count" 1`

  let func = await compile(query, { ...settings, outFile: "q2", nestedHashSize: 1048576 })
}

async function q3() {
  let cond1 = rh`${bluesky}.*A.kind == "commit" && ${bluesky}.*A.commit.operation == "create"`
  let cond2 = rh`${bluesky}.*A.commit.collection == "app.bsky.feed.post" || ${bluesky}.*A.commit.collection == "app.bsky.feed.repost" || ${bluesky}.*A.commit.collection == "app.bsky.feed.like"`

  let cond = rh`${cond1} && ${cond2}`

  let group = rh`{
    [${cond} & ${bluesky}.*A.commit.collection, hour ${bluesky}.*A.time_us]: {
      event: single(${bluesky}.*A.commit.collection),
      hour_of_day: single(hour ${bluesky}.*A.time_us),
      count: count(${bluesky}.*A)
    }
  }`

  let query = rh`sort ${group} "hour_of_day" 0 "count" 1`

  let func = await compile(query, { ...settings, outFile: "q3" })
}

async function q4() {
  let cond1 = rh`${bluesky}.*A.kind == "commit" && ${bluesky}.*A.commit.operation == "create"`
  let cond2 = rh`${bluesky}.*A.commit.collection == "app.bsky.feed.post"`

  let cond = rh`${cond1} && ${cond2}`

  let group = rh`{
    ${cond} & ${bluesky}.*A.did: {
      user_id: single(${bluesky}.*A.did),
      first_post_date: min(${bluesky}.*A.time_us)
    }
  }`

  let query = rh`sort ${group} "first_post_date" 0`

  let func = await compile(query, { ...settings, outFile: "q4", hashSize: 1048576, limit: 3 })
}

async function q5() {
  let cond1 = rh`${bluesky}.*A.kind == "commit" && ${bluesky}.*A.commit.operation == "create"`
  let cond2 = rh`${bluesky}.*A.commit.collection == "app.bsky.feed.post"`

  let cond = rh`${cond1} && ${cond2}`

  let group = rh`{
    ${cond} & ${bluesky}.*A.did: {
      user_id: single(${bluesky}.*A.did),
      activity_span: (max(${bluesky}.*A.time_us) - min(${bluesky}.*A.time_us)) / 1000
    }
  }`

  let query = rh`sort ${group} "activity_span" 1`

  let func = await compile(query, { ...settings, outFile: "q5", hashSize: 1048576, limit: 3 })
}

q1()
q2()
q3()
q4()
q5()
