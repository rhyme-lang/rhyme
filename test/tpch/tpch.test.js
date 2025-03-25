const { rh } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')
const { typing, types } = require('../../src/typing')
const fs = require("fs")
const os = require('child_process')

// point to the data directory
let dataDir = "cgen-sql/data/SF1"
let outDir = "cgen-sql/out-tpch"

let customerSchema = typing.objBuilder()
  .add(typing.createKey(types.u32), typing.createSimpleObject({
    c_custkey: types.i32,
    c_name: types.string,
    c_address: types.string,
    c_nationkey: types.i32,
    c_phone: types.string,
    c_acctbal: types.f64,
    c_mktsegment: types.string,
    c_comment: types.string,
  })).build()

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
    l_shipdate: types.date,
    l_commitdate: types.date,
    l_receiptdate: types.date,
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

let regionSchema = typing.objBuilder()
  .add(typing.createKey(types.u32), typing.createSimpleObject({
    r_regionkey: types.i32,
    r_name: types.string,
    r_comment: types.string,
  })).build()

let ordersSchema = typing.objBuilder()
  .add(typing.createKey(types.u32), typing.createSimpleObject({
    o_orderkey: types.i32,
    o_custkey: types.i32,
    o_orderstatus: types.string,
    o_totalprice: types.f64,
    o_orderdate: types.date,
    o_orderpriority: types.string,
    o_clerk: types.string,
    o_shippriority: types.i32,
    o_comment: types.string,
  })).build()

let customerFile = `"${dataDir}/customer.tbl"`
let lineitemFile = `"${dataDir}/lineitem.tbl"`
let nationFile = `"${dataDir}/nation.tbl"`
let regionFile = `"${dataDir}/region.tbl"`
let ordersFile = `"${dataDir}/orders.tbl"`

let customer = rh`loadTBL ${customerFile} ${customerSchema}`
let lineitem = rh`loadTBL ${lineitemFile} ${lineitemSchema}`
let nation = rh`loadTBL ${nationFile} ${nationSchema}`
let region = rh`loadTBL ${regionFile} ${regionSchema}`
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

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q1.c", schema: types.never })
  let res = await func()

  expect(res).toBe(`N|O|74476040.0000|111701729697.7356|106118230307.6122|110367043872.4921|25.5022|38249.1180|0.0500|2920374|
R|F|37719753.0000|56568041380.9045|53741292684.6038|55889619119.8297|25.5058|38250.8546|0.0500|1478870|
A|F|37734107.0000|56586554400.7299|53758257134.8651|55909065222.8256|25.5220|38273.1297|0.0500|1478493|
N|F|991417.0000|1487504710.3800|1413082168.0541|1469649223.1944|25.5165|38284.4678|0.0501|38854|
`)
}, 10 * 1000)

test("q2", async () => {
  let regionKeyToName = rh`${region}.*r.r_name | group ${region}.*r.r_regionkey`
  let query = rh`${regionKeyToName}.(${nation}.*n.n_regionkey) == "EUROPE" & ${nation}.*n.n_name | group ${nation}.*n.n_nationkey`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q2.c", schema: types.never })
  let res = await func()

  console.log(res)
})

test("q4", async () => {
  // TODO: optimize, extremely slow
  let count = rh`count (${lineitem}.*l.l_commitdate < ${lineitem}.*l.l_receiptdate) & ${lineitem}.*l.l_orderkey | group ${lineitem}.*l.l_orderkey`

  let cond = rh`19930701 <= ${orders}.*.o_orderdate && ${orders}.*.o_orderdate < 19931001`

  // TODO: sort the result by o_orderpriority
  let query = rh`count ((${cond} && ${count}.(${orders}.*.o_orderkey) > 0) & ${orders}.*.o_orderkey) | group ${orders}.*.o_orderpriority`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q4.c", schema: types.never })
  let res = await func()

  expect(res).toBe(`5-LOW|10487|
1-URGENT|10594|
4-NOT SPECIFIED|10556|
2-HIGH|10476|
3-MEDIUM|10410|
`)
})

test("q5", async () => {
  let regionKeyToName = rh`${region}.*r.r_name == "ASIA" & ${region}.*r.r_name | group ${region}.*r.r_regionkey`
  let query = rh`${regionKeyToName}.(${nation}.*n.n_regionkey) & ${nation}.*n.n_name | group ${nation}.*n.n_nationkey`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q5.c", schema: types.never })
  let res = await func()

  console.log(res)
})

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