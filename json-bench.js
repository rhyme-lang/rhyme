const { rh } = require("./src/rhyme")
const { compile } = require("./src/simple-eval")
const { typing, types } = require("./src/typing")
const { runtime: rt } = require("./src/simple-runtime")
const fs = require("fs")
const readline = require("readline")

let bluesky = rh`loadNDJSON "./cgen-sql/data/bluesky/file_0001.json" ${types.unknown}`

let q1 = async () => {
  let group = rh`{
    ${bluesky}.*A.commit.collection || "(null)": {
      count: count(${bluesky}.*A)
    }
  }`

  let query = rh`sort ${group} "count" 1`

  let func = compile(group)
  {
    let start = performance.now()
    let res = func()
    console.log(res)
    let end = performance.now()

    console.log(`Time elapsed: ${end - start}ms`)
  }
  {
    let start = performance.now()
    let res = func()
    console.log(res)
    let end = performance.now()

    console.log(`Time elapsed: ${end - start}ms`)
  }
  {
    let start = performance.now()
    let res = func()
    console.log(res)
    let end = performance.now()

    console.log(`Time elapsed: ${end - start}ms`)
  }
  {
    let start = performance.now()
    let res = func()
    console.log(res)
    let end = performance.now()

    console.log(`Time elapsed: ${end - start}ms`)
  }
  {
    let start = performance.now()
    let res = func()
    console.log(res)
    let end = performance.now()

    console.log(`Time elapsed: ${end - start}ms`)
  }
}

q1()

// let res = f()
// console.log(res)
