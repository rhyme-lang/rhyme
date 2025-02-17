const { rh } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')
const { typing, types } = require('../../src/typing')
const fs = require("fs")
const os = require('child_process')

const ir = require('../../src/c1-ir')
const newCodegen = require('../../src/new-codegen')

// point to the data directory
let dataDir = "/home/ran/projects/tpch-dbgen/SF1"
let outDir = "cgen-sql/out/tpch"

let lineitemSchema = typing.objBuilder()
  .add(typing.createKey(types.u32), typing.createSimpleObject({
    l_orderkey: types.i32,
    l_partkey: types.i32,
    l_suppkey: types.i32,
    l_linenumber: types.i32,
    l_quantity: types.f64,
    l_extendedprice: types.f64,
    l_discount: types.f64,
    l_tax: types.f64,
    l_returnflag: types.string,
    l_linestatus: types.string,
    l_shipdate: types.i32,
    l_commitdate: types.i32,
    l_receiptdate: types.i32,
    l_shipinstruct: types.string,
    l_shipmode: types.string,
    l_comment: types.string,
  })).build()

let nationSchema = typing.objBuilder()
  .add(typing.createKey(types.u32), typing.createSimpleObject({
    n_nationkey: types.i32,
    n_name: types.string,
    n_regionkey: types.i32,
    n_comment: types.string,
  })).build()

let ordersSchema = typing.objBuilder()
  .add(typing.createKey(types.u32), typing.createSimpleObject({
    o_orderkey: types.i32,
    o_custkey: types.i32,
    o_orderstatus: types.string,
    o_totalprice: types.f64,
    o_orderdate: types.i32,
    o_orderpriority: types.string,
    o_clerk: types.string,
    o_shippriority: types.i32,
    o_comment: types.string,
  })).build()

let lineitemFile = `"${dataDir}/lineitem.tbl"`
let nationFile = `"${dataDir}/nation.tbl"`
let ordersFile = `"${dataDir}/orders.tbl"`

let lineitem = rh`loadTBL ${lineitemFile} ${lineitemSchema}`
let nation = rh`loadTBL ${nationFile} ${nationSchema}`
let orders = rh`loadTBL ${ordersFile} ${ordersSchema}`

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

test("q1", async () => {
  let cond = rh`${lineitem}.*.l_shipdate <= 19980902`

  let query = rh`{
    sum_qty: sum (${cond} & ${lineitem}.*.l_quantity),
    sum_base_price: sum (${cond} & ${lineitem}.*.l_extendedprice),
    sum_disc_price: sum (${cond} & (${lineitem}.*.l_extendedprice * (1 - ${lineitem}.*.l_discount))),
    sum_charge: sum (${cond} & (${lineitem}.*.l_extendedprice * (1 - ${lineitem}.*.l_discount) * (1 + ${lineitem}.*.l_tax))),
    avg_qty: (sum (${cond} & ${lineitem}.*.l_quantity)) / (count (${cond} & ${lineitem}.*.l_quantity)),
    avg_price: (sum (${cond} & ${lineitem}.*.l_extendedprice)) / (count (${cond} & ${lineitem}.*.l_extendedprice)),
    avg_disc: (sum (${cond} & ${lineitem}.*.l_discount)) / (count (${cond} & ${lineitem}.*.l_discount)),
    count_order: count (${cond} & ${lineitem}.*.l_orderkey)
  } | group [${lineitem}.*.l_returnflag, ${lineitem}.*.l_linestatus]`

  let q1 = rh`count (${cond} & ${lineitem}.*.l_orderkey) | group [${lineitem}.*.l_returnflag, ${lineitem}.*.l_linestatus]`
  let func = await compile(q1, { backend: "c-sql-new", outDir, outFile: "q1.c", schema: types.never })
  let res = await func()

  console.log(res)
})

// test("q4", async () => {
//   // TODO: optimize, extremely slow
//   let count = rh`count (${lineitem}.*O.l_commitdate < ${lineitem}.*O.l_receiptdate) & ${lineitem}.*O.l_comment | group (${lineitem}.*O.l_orderkey)`

//   let cond1 = rh`19930701 <= ${orders}.*.o_orderdate && ${orders}.*.o_orderdate < 19931001`

//   // TODO: sort the result by o_orderpriority
//   let query = rh`count ((${cond1} && ${count} > 0) & ${orders}.*.o_orderkey) | group ${orders}.*.o_orderpriority`

//   let q = rh`count ${orders}.*.o_orderkey`

//   let func = await compile(count, { backend: "c-sql-new", outDir, outFile: "q4.c", schema: types.never })
//   let res = await func()

//   console.log(res)
// })

test("q6", async () => {
  let cond1 = rh`19940101 <= ${lineitem}.*.l_shipdate && ${lineitem}.*.l_shipdate < 19950101`
  let cond2 = rh`0.05 <= ${lineitem}.*.l_discount && ${lineitem}.*.l_discount <= 0.07`
  let cond3 = rh`${lineitem}.*.l_quantity < 24`

  let cond = rh`${cond1} && ${cond2} && ${cond3}`

  let query = rh`sum (${cond}) & (${lineitem}.*.l_extendedprice * ${lineitem}.*.l_discount)`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q6.c", schema: types.never })
  let res = await func()

  expect(res).toBe("123141078.2283\n")
})
