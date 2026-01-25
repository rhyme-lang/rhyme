const { rh, api } = require("../../src/rhyme")
const { compile } = require("../../src/simple-eval")
const { typing, types } = require("../../src/typing")
const { runtime: rt } = require("../../src/simple-runtime")

let bluesky = rh`loadNDJSON "./cgen-sql/data/bluesky/file_0001.json" ${types.unknown}`

let runQuery = (func, data, limit) => {
  const N = 11
  for (let i = 0; i < N; i++) {
    let start = performance.now()
    let res = func(data)
    if (limit) res = Object.values(res).slice(0, limit)
    console.log(res)
    let end = performance.now()
    console.error("Time elapsed: " + (end - start) + " ms")
  }
}

let q1 = () => {
  rt.reset()

  let group = rh`{
    ${bluesky}.*A.commit.collection || "(null)": {
      event: single(${bluesky}.*A.commit.collection || "(null)"),
      count: count(${bluesky}.*A)
    }
  }`

  let query = rh`sort ${group} "count" 1`

  let func = compile(query, { newCodegen: true })

  console.log("Running Q1")
  runQuery(func)
}

let q2 = () => {
  rt.reset()

  let cond = rh`${bluesky}.*A.kind == "commit" && ${bluesky}.*A.commit.operation == "create"`

  let countDistinct = rh`{
    ${cond} & ${bluesky}.*A.commit.collection: {
      event: single(${cond} & (${bluesky}.*A.commit.collection)),
      count: count?(${cond} & ${bluesky}.*A),
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

  let func = compile(query)
  runQuery(func)
}

let q3 = () => {
  rt.reset()

  let udf = {
    extractHour: (time) => {
      const date = new Date(time / 1000);
      return date.getUTCHours()
    },
    encode: (a, b) => {
      return a + ":" + b
    }
  }

  let cond1 = rh`${bluesky}.*A.kind == "commit" && ${bluesky}.*A.commit.operation == "create"`
  let cond2 = rh`${bluesky}.*A.commit.collection == "app.bsky.feed.post" || ${bluesky}.*A.commit.collection == "app.bsky.feed.repost" || ${bluesky}.*A.commit.collection == "app.bsky.feed.like"`

  let cond = rh`${cond1} && ${cond2}`

  let group = rh`{
    ${cond} & (udf.encode ${bluesky}.*A.commit.collection (udf.extractHour ${bluesky}.*A.time_us)): {
      event: single (${cond} & ${bluesky}.*A.commit.collection),
      hour_of_day: single (${cond} & (udf.extractHour ${bluesky}.*A.time_us)),
      count: count?(${cond} & ${bluesky}.*A)
    }
  }`

  let query = rh`sort ${group} "hour_of_day" 0 "event" 0`

  let func = compile(query)
  runQuery(func, { udf })
}

let q4 = () => {
  rt.reset()

  let cond1 = rh`${bluesky}.*A.kind == "commit" && ${bluesky}.*A.commit.operation == "create"`
  let cond2 = rh`${bluesky}.*A.commit.collection == "app.bsky.feed.post"`

  let cond = rh`${cond1} && ${cond2}`

  let group = rh`{
    ${bluesky}.*A.did: {
      first_post_date: min?(${cond} & (${bluesky}.*A.time_us)),
      user_id: single(${cond} & ${bluesky}.*A.did)
    }
  }`

  let query = rh`sort ${group} "first_post_date" 0`

  console.log("Running Q4")
  let func = compile(query)
  let res = func()
  runQuery(func, {}, 3)
}

let q5 = () => {
  rt.reset()

  let cond1 = rh`${bluesky}.*A.kind == "commit" && ${bluesky}.*A.commit.operation == "create"`
  let cond2 = rh`${bluesky}.*A.commit.collection == "app.bsky.feed.post"`

  let cond = rh`${cond1} && ${cond2}`

  let group = rh`{
    ${bluesky}.*A.did: {
      user_id: single(${cond} & ${bluesky}.*A.did),
      activity_span: max?(${cond} & (${bluesky}.*A.time_us)) - min?(${cond} & (${bluesky}.*A.time_us))
    }
  }`

  let query = rh`sort ${group} "activity_span" 1`

  console.log("Running Q5")
  let func = compile(query)
  runQuery(func, {}, 3)
}

q1()
q2()
q3()
q4()
q5()
