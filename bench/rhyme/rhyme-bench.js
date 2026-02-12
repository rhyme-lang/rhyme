const { rh, api } = require("../../src/rhyme")
const { compile } = require("../../src/simple-eval")
const { typing, types } = require("../../src/typing")
const { runtime: rt } = require("../../src/simple-runtime")

let outDir = "bench/out/rhyme-bench"

let settings = {
  backend: "c-new",
  schema: types.never,
  outDir,
  enableOptimizations: false,
  hashSize: 16777216,
  nestedHashSize: 2048
}

let schema = typing.parseType(`
{
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
let commits = rh`loadNDJSON "cgen-sql/data/linux_commits/commits.json" ${schema}`

async function count() {
  let query = rh`count ${commits}.*i.*j`

  await compile(query, { ...settings, outFile: "count" })
}

async function q1() {
  // Commit hour of day -> number of commits
  let query = rh`sort {
    (substr ${commits}.*i.*j.commit.author.date 11 13): {
      total_commits: count ${commits}.*i.*j
    }
  } "total_commits" 1`

  await compile(query, { ...settings, outFile: "q1" })
}

async function q2() {
  // Author name -> commit month -> number of commits
  let query = rh`sort {
    ${commits}.*i.*j.commit.author.name: {
      email: single ${commits}.*i.*j.commit.author.email,
      total_commits: count ${commits}.*i.*j,
      monthly_activity: {
        (substr ${commits}.*i.*j.commit.author.date 0 7): {
          total_commits: count ${commits}.*i.*j,
          merge: count ((length ${commits}.*i.*j.parents) > 1) & ${commits}.*i.*j,
          direct: count ((length ${commits}.*i.*j.parents) <= 1) & ${commits}.*i.*j
        }
      }
    }
  } "total_commits" 1`

  await compile(query, { ...settings, outFile: "q2", limit: 10 })
}

async function q3() {
  // Month -> author name -> number of commits
  let q1 = rh`{
    (substr ${commits}.*i.*j.commit.author.date 0 4): {
      total_commits: count ${commits}.*i.*j,
      monthly_activity: {
        (substr ${commits}.*i.*j.commit.author.date 0 7): {
          hour_heatmap: {
            (substr ${commits}.*i.*j.commit.author.date 11 13): count ${commits}.*i.*j
          }
        }
      }
    }
  }`

  await compile(q1, {
    ...settings, outFile: "q3",
    hashSize: 64,
    nestedHashSize: 64
  })
}

// count()
q1()
q2()
q3()
