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
  hashSize: 65536,
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
let commits = rh`loadNDJSON "cgen-sql/data/commits/commits.json" ${schema}`

async function q1() {
  // author name -> year -> month -> commits
  let query = rh`sort {
    ${commits}.*i.*j.commit.author.name: {
      email: single ${commits}.*i.*j.commit.author.email,
      total_commits: count ${commits}.*i.*j,
      yearly_activity: {
        (substr ${commits}.*i.*j.commit.author.date 0 4): {
          total_commits: count ${commits}.*i.*j,
          monthly_activity: {
            (substr ${commits}.*i.*j.commit.author.date 0 7): {
              total_commits: count ${commits}.*i.*j
            }
          }
        }
      }
    }
  } "total_commits" 1`

  await compile(query, {
    ...settings, outFile: "q1",
    hashSize: 65536,
    nestedHashSize: 64,
    limit: 5
  })
}

async function q2() {
  // author name -> committer name -> commits
  let query = rh`sort {
    ${commits}.*i.*j.commit.author.name: {
      email: single ${commits}.*i.*j.commit.author.email,
      total_commits: count ${commits}.*i.*j,
      self_committed: count (${commits}.*i.*j.commit.committer.name == ${commits}.*i.*j.commit.author.name) & ${commits}.*i.*j,
      committed_by_others: {
        (${commits}.*i.*j.commit.committer.name != ${commits}.*i.*j.commit.author.name) & ${commits}.*i.*j.commit.committer.name: {
          email: single ${commits}.*i.*j.commit.committer.email,
          commits: count ${commits}.*i.*j
        }
      }
    }
  } "total_commits" 1`

  await compile(query, {
    ...settings, outFile: "q2",
    hashSize: 65536,
    nestedHashSize: 1024,
    limit: 5
  })
}

async function q3() {
  // Commit hour of day -> number of unique authors
  let phase1 = rh`{
    (substr ${commits}.*i.*j.commit.author.date 11 13): {
      hour: single (substr ${commits}.*i.*j.commit.author.date 11 13),
      total_commits: count ${commits}.*i.*j,
      unique_authors: {
        ${commits}.*i.*j.commit.author.name: count ${commits}.*i.*j
      }
    }
  }`

  let query = rh`sort {
    ${phase1}.*count.hour: {
      total_commits: single ${phase1}.*count.total_commits,
      unique_authors: length ${phase1}.*count.unique_authors
    }
  } "unique_authors" 1`

  await compile(query, {
    ...settings, outFile: "q3",
    hashSize: 64,
    nestedHashSize: 8192
  })
}

async function q4() {
  // Commit hour of day -> number of unique authors
  let query = rh`sort {
    ${commits}.*i.*j.commit.author.name: {
      email: single ${commits}.*i.*j.commit.author.email,
      total_commits: count ${commits}.*i.*j,
      merge_commits: count (length ${commits}.*i.*j.parents) > 1 & ${commits}.*i.*j
    }
  } "merge_commits" 1`

  await compile(query, {
    ...settings, outFile: "q4",
    hashSize: 65536,
    limit: 20
  })
}

// count()
q1()
q2()
q3()
q4()
