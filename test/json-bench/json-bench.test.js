const { rh, api } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')
const { typing, types } = require('../../src/typing')
const fs = require("fs")
const os = require('child_process')

let outDir = "cgen-sql/out/json-bench"

let answersDir = "cgen-sql/answers/json-bench"

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
    await sh(`cp cgen-sql/rhyme-c.h ${outDir}`)
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
    ${bluesky}.*A.commit.collection || "(null)": {
      event: single(${bluesky}.*A.commit.collection || "(null)"),
      count: count(${bluesky}.*A)
    }
  }`

  let query = rh`sort ${group} "count" 1`

  let func = await compile(query, { ...settings, outFile: "q1" })
  let res = await func()

  let answer = fs.readFileSync(`${answersDir}/q1.out`).toString()
  expect(res).toBe(answer)
})

test("q2", async () => {
  let cond = rh`${bluesky}.*A.kind == "commit" && ${bluesky}.*A.commit.operation == "create"`

  let countDistinct = rh`{
    ${cond} & ${bluesky}.*A.commit.collection: {
      event: single(${bluesky}.*A.commit.collection),
      count: count(${bluesky}.*A),
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

  let answer = fs.readFileSync(`${answersDir}/q2.out`).toString()
  expect(res).toBe(answer)
})

test("q3", async () => {
  let cond1 = rh`${bluesky}.*A.kind == "commit" && ${bluesky}.*A.commit.operation == "create"`
  let cond2 = rh`${bluesky}.*A.commit.collection == "app.bsky.feed.post" || ${bluesky}.*A.commit.collection == "app.bsky.feed.repost" || ${bluesky}.*A.commit.collection == "app.bsky.feed.like"`

  let cond = rh`${cond1} && ${cond2}`

  let group = rh`{
    ${cond} & ${bluesky}.*A.commit.collection: {
      event: single(${bluesky}.*A.commit.collection),
      time: single(${bluesky}.*A.time_us),
      count: count?(${bluesky}.*A)
    }
  }`

  let query = rh`sort ${group} "count" 1`

  let func = await compile(query, { ...settings, outFile: "q3" })
  let res = await func()

  let answer = fs.readFileSync(`${answersDir}/q3.out`).toString()
  expect(res).toBe(answer)
})

test("q4", async () => {
  let cond1 = rh`${bluesky}.*A.kind == "commit" && ${bluesky}.*A.commit.operation == "create"`
  let cond2 = rh`${bluesky}.*A.commit.collection == "app.bsky.feed.post"`

  let cond = rh`${cond1} && ${cond2}`

  let group = rh`{
    ${cond} & ${bluesky}.*A.did: {
      user_id: single(${bluesky}.*A.did),
      first_post_date: min?(${bluesky}.*A.time_us)
    }
  }`

  let query = rh`sort ${group} "first_post_date" 0`

  let func = await compile(group, { ...settings, outFile: "q4", limit: 3 })
  let res = await func()

  let answer = fs.readFileSync(`${answersDir}/q4.out`).toString()
  expect(res).toBe(answer)
})

test("q5", async () => {
  let cond1 = rh`${bluesky}.*A.kind == "commit" && ${bluesky}.*A.commit.operation == "create"`
  let cond2 = rh`${bluesky}.*A.commit.collection == "app.bsky.feed.post"`

  let cond = rh`${cond1} && ${cond2}`

  let group = rh`{
    ${cond} & ${bluesky}.*A.did: {
      user_id: single(${bluesky}.*A.did),
      activity_span: (max?(${bluesky}.*A.time_us) - min?(${bluesky}.*A.time_us)) / 1000
    }
  }`

  let query = rh`sort ${group} "activity_span" 1`

  let func = await compile(query, { ...settings, outFile: "q5", limit: 3 })
  let res = await func()

  let answer = fs.readFileSync(`${answersDir}/q5.out`).toString()
  expect(res).toBe(answer)
})
