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
      commit: {
        author: {
          name: string,
          date: string
        },
        committer: {
          name: string,
          date: string
        }
      }
    }
  }
}`)
let commits = rh`loadNDJSON "cgen-sql/data/linux_commits/commits.json" ${schema}`

async function q1() {
  let query = rh`sort {
    ${commits}.*i.*j.commit.author.name: {
      name: single ${commits}.*i.*j.commit.author.name,
      total_commits: count ${commits}.*i.*j,
      monthly_activity: {
        (substr ${commits}.*i.*j.commit.author.date 0 7): {
          count: count ${commits}.*i.*j,
        }
      }
    }
  } "total_commits" 1`

  await compile(query, { ...settings, outFile: "q1" })
}

async function q2() {
  let query = rh`sort {
    (substr ${commits}.*i.*j.commit.committer.date 0 7): {
      month: (substr ${commits}.*i.*j.commit.committer.date 0 7),
      total_commits: count ${commits}.*i.*j,
      author_activity: {
        ${commits}.*i.*j.commit.author.name: count ${commits}.*i.*j
      }
    }
  } "month" 0`

  await compile(query, { ...settings, outFile: "q2" })
}

q1()
// q2()
