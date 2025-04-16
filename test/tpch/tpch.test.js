const { rh, api } = require('../../src/rhyme')
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

let regionSchema = typing.objBuilder()
  .add(typing.createKey(types.u32), typing.createSimpleObject({
    r_regionkey: types.i32,
    r_name: types.string,
    r_comment: types.string,
  })).build()

let supplierSchema = typing.objBuilder()
  .add(typing.createKey(types.u32), typing.createSimpleObject({
    s_suppkey: types.i32,
    s_name: types.string,
    s_address: types.string,
    s_nationkey: types.i32,
    s_phone: types.string,
    s_acctbal: types.f64,
    s_comment: types.string,
  })).build()

let customerFile = `"${dataDir}/customer.tbl"`
let lineitemFile = `"${dataDir}/lineitem.tbl"`
let nationFile = `"${dataDir}/nation.tbl"`
let ordersFile = `"${dataDir}/orders.tbl"`
let regionFile = `"${dataDir}/region.tbl"`
let supplierFile = `"${dataDir}/supplier.tbl"`

let customer = rh`loadTBL ${customerFile} ${customerSchema}`
let lineitem = rh`loadTBL ${lineitemFile} ${lineitemSchema}`
let nation = rh`loadTBL ${nationFile} ${nationSchema}`
let orders = rh`loadTBL ${ordersFile} ${ordersSchema}`
let region = rh`loadTBL ${regionFile} ${regionSchema}`
let supplier = rh`loadTBL ${supplierFile} ${supplierSchema}`

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

  let query1 = rh`{
    l_returnflag: ${lineitem}.*.l_returnflag,
    l_linestatus: ${lineitem}.*.l_linestatus,
    sum_qty: sum (${cond} & ${lineitem}.*.l_quantity),
    sum_base_price: sum (${cond} & ${lineitem}.*.l_extendedprice),
    sum_disc_price: sum (${cond} & (${lineitem}.*.l_extendedprice * (1 - ${lineitem}.*.l_discount))),
    sum_charge: sum (${cond} & (${lineitem}.*.l_extendedprice * (1 - ${lineitem}.*.l_discount) * (1 + ${lineitem}.*.l_tax))),
    avg_qty: (sum (${cond} & ${lineitem}.*.l_quantity)) / (count (${cond} & ${lineitem}.*.l_quantity)),
    avg_price: (sum (${cond} & ${lineitem}.*.l_extendedprice)) / (count (${cond} & ${lineitem}.*.l_extendedprice)),
    avg_disc: (sum (${cond} & ${lineitem}.*.l_discount)) / (count (${cond} & ${lineitem}.*.l_discount)),
    count_order: count (${cond} & ${lineitem}.*.l_orderkey)
  } | group [${lineitem}.*.l_returnflag, ${lineitem}.*.l_linestatus]`

  let query = rh`sort "l_returnflag" 0 "l_linestatus" 0 ${query1}`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q1", schema: types.never, enableOptimizations: false })
  let res = await func()

  expect(res).toBe(`A|F|37734107.0000|56586554400.7299|53758257134.8651|55909065222.8256|25.5220|38273.1297|0.0500|1478493|
N|F|991417.0000|1487504710.3800|1413082168.0541|1469649223.1944|25.5165|38284.4678|0.0501|38854|
N|O|74476040.0000|111701729697.7356|106118230307.6122|110367043872.4921|25.5022|38249.1180|0.0500|2920374|
R|F|37719753.0000|56568041380.9045|53741292684.6038|55889619119.8297|25.5058|38250.8546|0.0500|1478870|
`)
})

test("q3", async () => {
  let customer1 = rh`[${customer}.*c1.c_mktsegment == "BUILDING" & ${customer}.*c1.c_custkey] | group ${customer}.*c1.c_custkey`

  let orders1 = rh`[
    ${orders}.*o1.o_orderdate < 19950315 & {
      c: ${customer1}.(${orders}.*o1.o_custkey).*c2,
      o_orderkey: ${orders}.*o1.o_orderkey,
      o_custkey: ${orders}.*o1.o_custkey,
      o_orderdate: ${orders}.*o1.o_orderdate,
      o_shippriority: ${orders}.*o1.o_shippriority
    }
  ] | group ${orders}.*o1.o_orderkey`

  let cond = rh`${lineitem}.*l1.l_shipdate > 19950315`
  let lineitem1 = rh`{
    l_orderkey: (${cond} & ${lineitem}.*l1.l_orderkey),
    revenue: sum (${cond} & (${lineitem}.*l1.l_extendedprice * (1 - ${lineitem}.*l1.l_discount))),
    o_orderdate: (${cond} & ${orders1}.(${lineitem}.*l1.l_orderkey).*o2.o_orderdate),
    o_shippriority: (${cond} & ${orders1}.(${lineitem}.*l1.l_orderkey).*o2.o_shippriority)
  } | group [${lineitem}.*l1.l_orderkey, ${orders1}.(${lineitem}.*l1.l_orderkey).*o2.o_orderdate, ${orders1}.(${lineitem}.*l1.l_orderkey).*o2.o_shippriority]`

  let query = rh`sort "revenue" 1 "o_orderdate" 0 ${lineitem1}`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q3", schema: types.never, enableOptimizations: false, limit: 10 })
  let res = await func()

  expect(res).toBe(`2456423|406181.0111|1995-03-05|0|
3459808|405838.6989|1995-03-04|0|
492164|390324.0610|1995-02-19|0|
1188320|384537.9359|1995-03-09|0|
2435712|378673.0558|1995-02-26|0|
4878020|378376.7952|1995-03-12|0|
5521732|375153.9215|1995-03-13|0|
2628192|373133.3094|1995-02-22|0|
993600|371407.4595|1995-03-05|0|
2300070|367371.1452|1995-03-13|0|
`)
})

test("q4", async () => {
  let countR = rh`count (${lineitem}.*l.l_commitdate < ${lineitem}.*l.l_receiptdate) & ${lineitem}.*l.l_orderkey | group ${lineitem}.*l.l_orderkey`

  let cond = rh`19930701 <= ${orders}.*.o_orderdate && ${orders}.*.o_orderdate < 19931001`

  let countL = rh`{
    o_orderpriority: ${orders}.*.o_orderpriority,
    order_count: count ((${cond} && ${countR}.(${orders}.*.o_orderkey) > 0) & ${orders}.*.o_orderkey)
  } | group ${orders}.*.o_orderpriority`
  let query = rh`sort "o_orderpriority" 0 ${countL}`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q4", schema: types.never, enableOptimizations: false })
  let res = await func()

  expect(res).toBe(`1-URGENT|10594|
2-HIGH|10476|
3-MEDIUM|10410|
4-NOT SPECIFIED|10556|
5-LOW|10487|
`)
})

test("q5", async () => {
  let region1 = rh`[${region}.*r1.r_name == "ASIA" & ${region}.*r1.r_regionkey] | group ${region}.*r1.r_regionkey`
  let nation1 = rh`[
    {
      r: ${region1}.(${nation}.*n1.n_regionkey).*r2,
      n_nationkey: ${nation}.*n1.n_nationkey,
      n_name: ${nation}.*n1.n_name
    }
  ] | group ${nation}.*n1.n_nationkey`

  let customer1 = rh`[
    {
      n_nationkey: ${nation1}.(${customer}.*c1.c_nationkey).*n2.n_nationkey,
      n_name: ${nation1}.(${customer}.*c1.c_nationkey).*n2.n_name
    }
  ] | group ${customer}.*c1.c_custkey`

  let orders1 = rh`[
    (19940101 <= ${orders}.*o1.o_orderdate && ${orders}.*o1.o_orderdate < 19950101) & {
      n_nationkey: ${customer1}.(${orders}.*o1.o_custkey).*c2.n_nationkey,
      n_name: ${customer1}.(${orders}.*o1.o_custkey).*c2.n_name
    }
  ] | group ${orders}.*o1.o_orderkey`

  let supplier1 = rh`[
    ${supplier}.*s1.s_nationkey
  ] | group ${supplier}.*s1.s_suppkey`

  let cond = rh`${orders1}.(${lineitem}.*l1.l_orderkey).*o2.n_nationkey == ${supplier1}.(${lineitem}.*l1.l_suppkey).*s2`
  let lineitem1 = rh`{
    n_name: (${cond} & ${orders1}.(${lineitem}.*l1.l_orderkey).*o2.n_name),
    revenue: sum (${cond} & (${lineitem}.*l1.l_extendedprice * (1 - ${lineitem}.*l1.l_discount)))
  } | group ${orders1}.(${lineitem}.*l1.l_orderkey).*o2.n_name`

  let query = rh`sort "revenue" 1 ${lineitem1}`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q5", schema: types.never, enableOptimizations: false })
  let res = await func()

  expect(res).toBe(`INDONESIA|55502041.1697|
VIETNAM|55295086.9967|
CHINA|53724494.2566|
INDIA|52035512.0002|
JAPAN|45410175.6954|
`)
})

test("q6", async () => {
  let cond1 = rh`19940101 <= ${lineitem}.*.l_shipdate && ${lineitem}.*.l_shipdate < 19950101`
  let cond2 = rh`0.05 <= ${lineitem}.*.l_discount && ${lineitem}.*.l_discount <= 0.07`
  let cond3 = rh`${lineitem}.*.l_quantity < 24`

  let cond = rh`${cond1} && ${cond2} && ${cond3}`

  let query = rh`sum (${cond}) & (${lineitem}.*.l_extendedprice * ${lineitem}.*.l_discount)`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q6", schema: types.never })
  let res = await func()

  expect(res).toBe("123141078.2283\n")
})