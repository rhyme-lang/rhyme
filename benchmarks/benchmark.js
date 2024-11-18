const { compile } = require('../src/simple-eval')
const { rh } = require('../src/parser')
const { typing, types } = require('../src/typing')

const DATA_SIZE = 10000000
const DATA_FILE = "./cgen-sql/bench.csv"

const MAX_INT1 = 1024
const MAX_INT2 = 10

const MAX_DISTINCT_STR = 256
const MAX_DISTINCT_INT = 256

let fs = require("fs")

let generateData = () => {
  let stringMap = {}
  let intMap = {}

  let getRandomString = (length) => {
    if (Object.keys(stringMap).length >= MAX_DISTINCT_STR) {
      let strs = Object.keys(stringMap)
      return strs[Math.floor(Math.random() * strs.length)]
    }

    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    let res = "";
    for (let i = 0; i < length; i++) {
      res += characters.charAt(Math.floor(Math.random() * characters.length))
    }

    stringMap[res] = true
    return res
  }

  let getRandomInt1 = () => {
    if (Object.keys(intMap).length >= MAX_DISTINCT_INT) {
      let ints = Object.keys(intMap)
      return ints[Math.floor(Math.random() * ints.length)]
    }

    let res = Math.floor(Math.random() * MAX_INT1)
    intMap[res] = true
    return res
  }

  let getRandomInt2 = () => {
    let res = Math.floor(Math.random() * MAX_INT2)
    return res
  }

  let file = fs.createWriteStream(DATA_FILE, { flags: 'w' })

  let schema = "str_col,int_col1,int_col2"
  file.write(schema + "\n");

  for (let i = 0; i < DATA_SIZE; i++) {
    if ((i + 1) % 100000 == 0) {
      console.log("Generating row: " + (i + 1))
    }
    let str = getRandomString(16)
    let int1 = getRandomInt1()
    let int2 = getRandomInt2()
    let line = `${str},${int1},${int2}`

    file.write(line + "\n");
  }

  file.close()
}

let benchRhymeQuery = async (query, printRes) => {
  let start = performance.now()
  let func = compile(query, { backend: "c-sql-new", outDir: "./cgen-sql/out", outFile: "bench.c", schema: types.nothing })
  let res = await func()
  let end = performance.now()

  if (printRes) {
    console.log(res)
  }

  return end - start
}

let benchAll = async () => {
  let schema = typing.objBuilder()
    .add(typing.createKey(types.u32), typing.createSimpleObject({
      str_col: types.string,
      int_col1: types.i32,
      int_col2: types.i32,
    })).build()
  let csv = rh`loadCSV "./cgen-sql/bench.csv" ${schema}`

  let q1 = rh`sum ${csv}.*.int_col2`
  let time1 = await benchRhymeQuery(q1, false)
  console.log("Time elapsed:", time1, "ms")

  let q2 = rh`count ${csv}.*.int_col1 | group ${csv}.*.str_col`
  let time2 = await benchRhymeQuery(q2, false)
  console.log("Time elapsed:", time2, "ms")

  let q3 = rh`count ${csv}.*.str_col | group ${csv}.*.int_col1`
  let time3 = await benchRhymeQuery(q3, false)
  console.log("Time elapsed:", time3, "ms")
}

// generateData()
benchAll().then(() => {
  console.log("done!")
})