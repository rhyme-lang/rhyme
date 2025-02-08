const { rh } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')
const { typing, types } = require('../../src/typing')
const fs = require("fs")
const os = require('child_process')

let dataDir = "/home/ran/projects/tpch-dbgen/SF1"
let outDir = "cgen-sql/out/tpch"

let lineitemSchema = typing.objBuilder()
  .add(typing.createKey(types.u32), typing.createSimpleObject({
    l_orderkey: types.i64,
    l_partkey: types.i64,
    l_suppkey: types.i64,
    l_linenumber: types.i64,
    l_quantity: types.string,
    l_extendedprice: types.string,
    l_discount: types.string,
    l_tax: types.string,
    l_returnflag: types.string,
    l_linestatus: types.string,
    l_shipdate: types.string,
    l_commitdate: types.string,
    l_receiptdate: types.string,
    l_shipinstruct: types.string,
    l_shipmode: types.string,
    l_comment: types.string,
  })).build()

let nationSchema = typing.objBuilder()
  .add(typing.createKey(types.u32), typing.createSimpleObject({
    n_nationkey: types.i64,
    n_name: types.string,
    n_regionkey: types.i64,
    n_comment: types.string,
  })).build()

let lineitemFile = `"${dataDir}/lineitem.tbl"`
let nationFile = `"${dataDir}/nation.tbl"`

let lineitem = rh`loadTBL ${lineitemFile} ${lineitemSchema}`
let nation = rh`loadTBL ${nationFile} ${nationSchema}`

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
    const stat = fs.statSync(dataDir)
    stat.isDirectory()
    await sh(`rm -rf ${outDir}`)
    await sh(`mkdir -p ${outDir}`)
    await sh(`cp cgen-sql/rhyme-sql.h ${outDir}`)
  } catch (error) {
    console.log(error)
  }
})

test("tmp", async () => {
  let query = rh`print ${nation}.*.n_comment`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "tmp.c", schema: types.never })
  let res = await func()

  console.log(res)
})
