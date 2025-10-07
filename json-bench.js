const { rh, api } = require("./src/rhyme")
const { compile } = require("./src/simple-eval")
const { typing, types } = require("./src/typing")
const { runtime: rt } = require("./src/simple-runtime")
const fs = require("fs")
const readline = require("readline")

let bluesky = rh`loadNDJSON "./cgen-sql/data/bluesky/file_0001.json" ${types.unknown}`

let q1 = () => {
  let group = rh`{
    ${bluesky}.*A.commit.collection || "(null)": {
      event: single(${bluesky}.*A.commit.collection || "(null)"),
      count: count(${bluesky}.*A)
    }
  }`

  let query = rh`sort ${group} "count" 1`

  let func = compile(query)
  let res = func()

  console.log(res)
}

let q2 = () => {
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
  let res = func()

  console.log(res)
}

let q3 = () => {
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

  let func = compile(group)
  let res = func({ udf })

  console.log(res)
}

let q4 = () => {
  let cond1 = rh`${bluesky}.*A.kind == "commit" && ${bluesky}.*A.commit.operation == "create"`
  let cond2 = rh`${bluesky}.*A.commit.collection == "app.bsky.feed.post"`

  let cond = rh`${cond1} && ${cond2}`

  let group = rh`{
    ${bluesky}.*A.did: {
      first_post_date: min?(${cond} & (${bluesky}.*A.time_us)),
      userid: single(${cond} & ${bluesky}.*A.did)
    }
  }`

  let query = rh`sort ${group} "first_post_date" 0`

  let func = compile(query)
  let res = func()

  console.log(Object.values(res).slice(0, 3))
}

let q5 = () => {
  let cond1 = rh`${bluesky}.*A.kind == "commit" && ${bluesky}.*A.commit.operation == "create"`
  let cond2 = rh`${bluesky}.*A.commit.collection == "app.bsky.feed.post"`

  let cond = rh`${cond1} && ${cond2}`

  let group = rh`{
    ${bluesky}.*A.did: {
      userid: single(${cond} & ${bluesky}.*A.did),
      activity_span: max?(${cond} & (${bluesky}.*A.time_us)) - min?(${cond} & (${bluesky}.*A.time_us))
    }
  }`

  let query = rh`sort ${group} "activity_span" 1`

  let func = compile(query)
  let res = func()

  console.log(Object.values(res).slice(0, 3))
}

q1()
q2()
q3()
q4()
q5()
