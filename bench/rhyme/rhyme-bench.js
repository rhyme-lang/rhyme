const { rh, api } = require("../../src/rhyme")
const { compile } = require("../../src/simple-eval")
const { typing, types } = require("../../src/typing")
const { runtime: rt } = require("../../src/simple-runtime")
const fs = require('fs')

async function* streamNDJSON(path) {
  const rl = require('readline').createInterface({
    input: fs.createReadStream(path, { highWaterMark: 64 * 1024 * 1024 }),
    crlfDelay: Infinity
  })
  for await (const line of rl) {
    if (line) yield JSON.parse(line)
  }
}

let q1Func = async inp => {
  let tmp = {}
  rt.init(tmp, 7)((() => ({})))
  for await (let xi of streamNDJSON("cgen-sql/data/commits/commits.json")) {
    for (let xj in xi) {
      for (let K2 in [xi]?.[xj]?.["commit"]?.["author"]?.["name"]) {
        rt.update(tmp, 0, K2)(rt.stateful.single([xi]?.[xj]?.["commit"]?.["author"]?.["name"]))
        rt.update(tmp, 1, K2)(rt.stateful.first([xi]?.[xj]?.["commit"]?.["author"]?.["email"]))
        rt.init(tmp, 2, K2)(rt.stateful.count_init)
        rt.init(tmp, 6, K2)((() => ({})))
        rt.update(tmp, 2, K2)(rt.stateful.count(1))
        for (let K1 in rt.singleton(rt.pure.apply(inp?.["udf"]?.["substr"], [xi]?.[xj]?.["commit"]?.["author"]?.["date"], 0, 4))) {
          rt.init(tmp, 3, K2, K1)(rt.stateful.count_init)
          rt.init(tmp, 5, K2, K1)((() => ({})))
          rt.update(tmp, 3, K2, K1)(rt.stateful.count(1))
          for (let K0 in rt.singleton(rt.pure.apply(inp?.["udf"]?.["substr"], [xi]?.[xj]?.["commit"]?.["author"]?.["date"], 0, 7))) {
            rt.init(tmp, 4, K2, K1, K0)(rt.stateful.count_init)
            rt.update(tmp, 4, K2, K1, K0)(rt.stateful.count(1))
            rt.update(tmp, 5, K2, K1)(rt.stateful.update([K0], rt.pure.mkTuple("total_commits", tmp?.[4]?.[K2]?.[K1]?.[K0])))
          }
          rt.update(tmp, 6, K2)(rt.stateful.update([K1], rt.pure.mkTuple("total_commits", tmp?.[3]?.[K2]?.[K1], "monthly_activity", tmp?.[5]?.[K2]?.[K1])))
        }
        rt.update(tmp, 7)(rt.stateful.update([K2], rt.pure.mkTuple("name", tmp?.[0]?.[K2], "email", tmp?.[1]?.[K2], "total_commits", tmp?.[2]?.[K2], "yearly_activity", tmp?.[6]?.[K2])))
      }
    }
  }
  return rt.pure.apply(inp?.["udf"]?.["limit"], rt.pure.sort(tmp?.[7], "total_commits", 1), 5)
}

let settings = {
  newCodegen: true
}

let udf = {
  substr: (s, l, r) => s.substring(l, r),
  limit: (arr, n) => arr.slice(0, n),
  size: o => Object.keys(o).length,
  streamNDJSON
}

let schema = typing.parseType(`{
  *u32: {
    *u32: {
      sha: string,
      commit: {
        author: {
          name: string,
          date: string
        },
        committer: {
          name: string,
          date: string
        }
      },
      parents: {
        *u32: unknown
      }
    }
  }
}`)
let commits = rh`loadNDJSON "cgen-sql/data/commits/commits.json" ${schema}`

let runQuery = (func) => {
  const N = 5
  let time = []
  for (let i = 0; i < N; i++) {
    if (reset) rt.reset()
    let start = performance.now()
    let res = func({ udf })
    let end = performance.now()
    console.error("Time elapsed: " + (end - start) + " ms")
    time.push(end - start)
  }
  console.log("median: " + time.sort()[2])
}

let runQueryAsync = async (func) => {
  const N = 5
  let time = []
  for (let i = 0; i < N; i++) {
    if (reset) rt.reset()
    let start = performance.now()
    let res = await func({ udf })
    let end = performance.now()
    console.error("Time elapsed: " + (end - start) + " ms")
    time.push(end - start)
  }
  console.log("median: " + time.sort()[2])
}

function q1() {
  console.log("==============================")
  console.log("Q1")
  console.log("==============================")

  let t1 = performance.now()

  // author name -> year -> month -> commits
  let query = rh`udf.limit (sort {
    ${commits}.*i.*j.commit.author.name: {
      name: single ${commits}.*i.*j.commit.author.name,
      email: first ${commits}.*i.*j.commit.author.email,
      total_commits: count ${commits}.*i.*j,
      yearly_activity: {
        (udf.substr ${commits}.*i.*j.commit.author.date 0 4): {
          total_commits: count ${commits}.*i.*j,
          monthly_activity: {
            (udf.substr ${commits}.*i.*j.commit.author.date 0 7): {
              total_commits: count ${commits}.*i.*j
            }
          }
        }
      }
    }
  } "total_commits" 1) 5`

  let func = compile(query, settings)

  let t2 = performance.now()
  console.error("Compilation: " + (t2 - t1) + " ms")

  let res = func({ udf })

  runQuery(func)
}

function q2() {
  console.log("==============================")
  console.log("Q2")
  console.log("==============================")

  let t1 = performance.now()

  // author name -> committer name -> commits
  let query = rh`udf.limit (sort {
    ${commits}.*i.*j.commit.author.name: {
      name: single ${commits}.*i.*j.commit.author.name,
      email: first ${commits}.*i.*j.commit.author.email,
      total_commits: count ${commits}.*i.*j,
      self_committed: count (${commits}.*i.*j.commit.committer.name == ${commits}.*i.*j.commit.author.name) & ${commits}.*i.*j,
      committed_by_others: {
        (${commits}.*i.*j.commit.committer.name != ${commits}.*i.*j.commit.author.name) & ${commits}.*i.*j.commit.committer.name: {
          email: first ${commits}.*i.*j.commit.committer.email,
          commits: count ${commits}.*i.*j
        }
      }
    }
  } "total_commits" 1) 5`

  let func = compile(query, settings)

  let t2 = performance.now()
  console.error("Compilation: " + (t2 - t1) + " ms")

  let res = func({ udf })

  runQuery(func)
}

function q3() {
  console.log("==============================")
  console.log("Q3")
  console.log("==============================")

  let t1 = performance.now()

  // Commit hour of day -> number of unique authors
  let phase1 = rh`{
    (udf.substr ${commits}.*i.*j.commit.author.date 11 13): {
      hour: single (udf.substr ${commits}.*i.*j.commit.author.date 11 13),
      total_commits: count ${commits}.*i.*j,
      unique_authors: {
        ${commits}.*i.*j.commit.author.name: count ${commits}.*i.*j
      }
    }
  }`

  let query = rh`sort {
    ${phase1}.*count.hour: {
      hour: single ${phase1}.*count.hour,
      total_commits: single ${phase1}.*count.total_commits,
      unique_authors: udf.size ${phase1}.*count.unique_authors
    }
  } "unique_authors" 1`

  let func = compile(query, settings)

  let t2 = performance.now()
  console.error("Compilation: " + (t2 - t1) + " ms")

  let res = func({ udf })

  runQuery(func)
}

function q4() {
  console.log("==============================")
  console.log("Q4")
  console.log("==============================")

  let t1 = performance.now()

  let query = rh`udf.limit (sort {
    ${commits}.*i.*j.commit.author.name: {
      name: single ${commits}.*i.*j.commit.author.name,
      email: first ${commits}.*i.*j.commit.author.email,
      total_commits: count ${commits}.*i.*j,
      merge_commits: count (udf.size ${commits}.*i.*j.parents) > 1 & ${commits}.*i.*j
    }
  } "merge_commits" 1) 20`

  let func = compile(query, settings)

  let t2 = performance.now()
  console.error("Compilation: " + (t2 - t1) + " ms")

  let res = func({ udf })

  runQuery(func)
}

let args = process.argv

let q = Number(args[2])
let reset = args[3]

// count()
switch (q) {
  case 0:
    runQueryAsync(q1Func)
    break
  case 1:
    q1()
    break
  case 2:
    q2()
    break
  case 3:
    q3()
    break
  case 4:
    q4()
    break
  default:
    q1()
    q2()
    q3()
    q4()
}
