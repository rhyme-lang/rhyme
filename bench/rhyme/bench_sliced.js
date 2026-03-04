const { rh, api } = require("../../src/rhyme")
const { compile } = require("../../src/simple-eval")
const { typing, types } = require("../../src/typing")
const { runtime: rt } = require("../../src/simple-runtime")

let settings = {
  newCodegen: true
}

let udf = {
  substr: (s, l, r) => s.substring(l, r),
  limit: (arr, n) => arr.slice(0, n),
  size: o => Object.keys(o).length
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
// let commits = rh`loadNDJSON "cgen-sql/data/commits/commits.json" ${schema}`

let dataDir = "./cgen-sql/data/commits/sliced/"

let runQuery = (func) => {
  const N = 5
  let time = []
  for (let i = 0; i < N; i++) {
    rt.reset()
    let start = performance.now()
    let res = func({ udf })
    let end = performance.now()
    console.error("Time elapsed: " + (end - start) + " ms")
    time.push(end - start)
  }
  console.log("median: " + time.sort()[2])
}

function q1(file) {
  console.log("==============================")
  console.log("Q1")
  console.log("==============================")

  let t1 = performance.now()

  let commits = rh`loadNDJSON ${file} ${schema}`

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

let args = process.argv

let n = args[2]

q1('"' + dataDir + `commits_${n}.json` + '"')
