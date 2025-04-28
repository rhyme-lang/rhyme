const { rh, api } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')
const { typing, types } = require('../../src/typing')
const fs = require("fs")
const os = require('child_process')

// point to the data directory
let dataDir = "cgen-sql/data/SF1"
let outDir = "cgen-sql/tpch-out"

let answersDir = "cgen-sql/tpch-answers"

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

let partSchema = typing.objBuilder()
  .add(typing.createKey(types.u32), typing.createSimpleObject({
    p_partkey: types.i32,
    p_name: types.string,
    p_mfgr: types.string,
    p_brand: types.string,
    p_type: types.string,
    p_size: types.i32,
    p_container: types.string,
    p_retailprice: types.f64,
    p_comment: types.string,
  })).build()

let partsuppSchema = typing.objBuilder()
  .add(typing.createKey(types.u32), typing.createSimpleObject({
    ps_partkey: types.i32,
    ps_suppkey: types.i32,
    ps_availqty: types.i32,
    ps_supplycost: types.f64,
    ps_comment: types.string,
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
let partFile = `"${dataDir}/part.tbl"`
let partsuppFile = `"${dataDir}/partsupp.tbl"`
let regionFile = `"${dataDir}/region.tbl"`
let supplierFile = `"${dataDir}/supplier.tbl"`

let customer = rh`loadTBL ${customerFile} ${customerSchema}`
let lineitem = rh`loadTBL ${lineitemFile} ${lineitemSchema}`
let nation = rh`loadTBL ${nationFile} ${nationSchema}`
let orders = rh`loadTBL ${ordersFile} ${ordersSchema}`
let part = rh`loadTBL ${partFile} ${partSchema}`
let partsupp = rh`loadTBL ${partsuppFile} ${partsuppSchema}`
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

  let answer = fs.readFileSync(`${answersDir}/q1.out`).toString()
  expect(res).toBe(answer)
})

test("q1-alt", async () => {
  let cond = rh`${lineitem}.*.l_shipdate <= 19980902`

  let lineitem1 = rh`{
    l_returnflag: ${lineitem}.*.l_returnflag,
    l_linestatus: ${lineitem}.*.l_linestatus,
    sum_qty: sum (${cond} & ${lineitem}.*.l_quantity),
    sum_base_price: sum (${cond} & ${lineitem}.*.l_extendedprice),
    sum_disc_price: sum (${cond} & (${lineitem}.*.l_extendedprice * (1 - ${lineitem}.*.l_discount))),
    sum_charge: sum (${cond} & (${lineitem}.*.l_extendedprice * (1 - ${lineitem}.*.l_discount) * (1 + ${lineitem}.*.l_tax))),
    count_l_quantity: count (${cond} & ${lineitem}.*.l_quantity),
    count_l_extendedprice: count (${cond} & ${lineitem}.*.l_extendedprice),
    sum_l_discount: sum (${cond} & ${lineitem}.*.l_discount),
    count_l_discount: count (${cond} & ${lineitem}.*.l_discount),
    count_order: count (${cond} & ${lineitem}.*.l_orderkey)
  } | group [${lineitem}.*.l_returnflag, ${lineitem}.*.l_linestatus]`

  let lineitem2  = rh`[{
    l_returnflag: ${lineitem1}.*.l_returnflag,
    l_linestatus: ${lineitem1}.*.l_linestatus,
    sum_qty: ${lineitem1}.*.sum_qty,
    sum_base_price: ${lineitem1}.*.sum_base_price,
    sum_disc_price: ${lineitem1}.*.sum_disc_price,
    sum_charge: ${lineitem1}.*.sum_charge,
    avg_qty: (${lineitem1}.*.sum_qty) / (${lineitem1}.*.count_l_quantity),
    avg_price: (${lineitem1}.*.sum_base_price) / (${lineitem1}.*.count_l_extendedprice),
    avg_disc: (${lineitem1}.*.sum_l_discount) / (${lineitem1}.*.count_l_discount),
    count_order: ${lineitem1}.*.count_order
  }]`
  let query = rh`sort "l_returnflag" 0 "l_linestatus" 0 ${lineitem2}`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q1-alt", schema: types.never, enableOptimizations: false })
  let res = await func()

  let answer = fs.readFileSync(`${answersDir}/q1.out`).toString()
  expect(res).toBe(answer)
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

  let answer = fs.readFileSync(`${answersDir}/q3.out`).toString()
  expect(res).toBe(answer)
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

  let answer = fs.readFileSync(`${answersDir}/q4.out`).toString()
  expect(res).toBe(answer)
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

  let answer = fs.readFileSync(`${answersDir}/q5.out`).toString()
  expect(res).toBe(answer)
})

test("q6", async () => {
  let cond1 = rh`19940101 <= ${lineitem}.*.l_shipdate && ${lineitem}.*.l_shipdate < 19950101`
  let cond2 = rh`0.05 <= ${lineitem}.*.l_discount && ${lineitem}.*.l_discount <= 0.07`
  let cond3 = rh`${lineitem}.*.l_quantity < 24`

  let cond = rh`${cond1} && ${cond2} && ${cond3}`

  let query = rh`sum (${cond}) & (${lineitem}.*.l_extendedprice * ${lineitem}.*.l_discount)`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q6", schema: types.never })
  let res = await func()

  let answer = fs.readFileSync(`${answersDir}/q6.out`).toString()
  expect(res).toBe(answer)
})

test("q7", async () => {
  let cond1 = rh`${nation}.*n1.n_name == "FRANCE" && ${nation}.*n2.n_name == "GERMANY" || ${nation}.*n1.n_name == "GERMANY" && ${nation}.*n2.n_name == "FRANCE"`
  let nation1 = rh`[${cond1} & {
    supp_nation: ${nation}.*n1.n_name,
    cust_nation: ${nation}.*n2.n_name,
    n1key: ${nation}.*n1.n_nationkey
  }] | group ${nation}.*n2.n_nationkey`

  let customer1 = rh`[{
    supp_nation: ${nation1}.(${customer}.*c1.c_nationkey).*n3.supp_nation,
    cust_nation: ${nation1}.(${customer}.*c1.c_nationkey).*n3.cust_nation,
    n1key: ${nation1}.(${customer}.*c1.c_nationkey).*n3.n1key
  }] | group ${customer}.*c1.c_custkey`

  let orders1 = rh`[{
    supp_nation: ${customer1}.(${orders}.*o1.o_custkey).*c2.supp_nation,
    cust_nation: ${customer1}.(${orders}.*o1.o_custkey).*c2.cust_nation,
    n1key: ${customer1}.(${orders}.*o1.o_custkey).*c2.n1key
  }] | group ${orders}.*o1.o_orderkey`

  let supplier1 = rh`[
    ${supplier}.*s1.s_nationkey
  ] | group ${supplier}.*s1.s_suppkey`

  let cond2 = rh`${lineitem}.*l1.l_shipdate >= 19950101 && ${lineitem}.*l1.l_shipdate <= 19961231 && ${supplier1}.(${lineitem}.*l1.l_suppkey).*s2 == ${orders1}.(${lineitem}.*l1.l_orderkey).*o2.n1key`

  let lineitem1 = rh`{
    supp_nation: ${cond2} & ${orders1}.(${lineitem}.*l1.l_orderkey).*o2.supp_nation,
    cust_nation: ${cond2} & ${orders1}.(${lineitem}.*l1.l_orderkey).*o2.cust_nation,
    l_year: ${cond2} & (year ${lineitem}.*l1.l_shipdate),
    revenue: sum? (${cond2} & (${lineitem}.*l1.l_extendedprice * (1 - ${lineitem}.*l1.l_discount)))
  } | group [
    ${orders1}.(${lineitem}.*l1.l_orderkey).*o2.supp_nation,
    ${orders1}.(${lineitem}.*l1.l_orderkey).*o2.cust_nation,
    year ${lineitem}.*l1.l_shipdate
  ]`

  let query = rh`sort "supp_nation" 0 "cust_nation" 0 "l_year" 0 ${lineitem1}`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q7", schema: types.never, enableOptimizations: false })
  let res = await func()

  let answer = fs.readFileSync(`${answersDir}/q7.out`).toString()
  expect(res).toBe(answer)
})

test("q8", async () => {
  let region1 = rh`[${region}.*r1.r_name == "AMERICA" & ${region}.*r1.r_regionkey] | group ${region}.*r1.r_regionkey`
  let nation1 = rh`[{
    r: ${region1}.(${nation}.*n1.n_regionkey).*r2,
    n_nationkey: ${nation}.*n1.n_nationkey
  }] | group ${nation}.*n1.n_nationkey`

  let part1 = rh`[${part}.*p1.p_type == "ECONOMY ANODIZED STEEL" & ${part}.*p1.p_partkey] | group ${part}.*p1.p_partkey`

  let lineitem1 = rh`[{
    p_partkey: ${part1}.(${lineitem}.*l1.l_partkey).*p2,
    l_suppkey: ${lineitem}.*l1.l_suppkey,
    l_extendedprice: ${lineitem}.*l1.l_extendedprice,
    l_discount: ${lineitem}.*l1.l_discount
  }] | group ${lineitem}.*l1.l_orderkey`

  let orders1 = rh`[${orders}.*o1.o_orderdate >= 19950101 && ${orders}.*o1.o_orderdate <= 19961231 & {
    l_suppkey: ${lineitem1}.(${orders}.*o1.o_orderkey).*l2.l_suppkey,
    l_extendedprice: ${lineitem1}.(${orders}.*o1.o_orderkey).*l2.l_extendedprice,
    l_discount: ${lineitem1}.(${orders}.*o1.o_orderkey).*l2.l_discount,
    o_orderdate: ${orders}.*o1.o_orderdate
  }] | group ${orders}.*o1.o_custkey`

  let customer1 = rh`[{
    l_suppkey: ${orders1}.(${customer}.*c1.c_custkey).*o2.l_suppkey,
    l_extendedprice: ${orders1}.(${customer}.*c1.c_custkey).*o2.l_extendedprice,
    l_discount: ${orders1}.(${customer}.*c1.c_custkey).*o2.l_discount,
    o_orderdate: ${orders1}.(${customer}.*c1.c_custkey).*o2.o_orderdate,
    n_nationkey: ${nation1}.(${customer}.*c1.c_nationkey).*n3.n_nationkey
  }] | group ${orders1}.(${customer}.*c1.c_custkey).*o2.l_suppkey`

  let nation2 = rh`[{
    n_name: ${nation}.*n2.n_name
  }] | group ${nation}.*n2.n_nationkey`

  let sumTotal = rh`sum (${customer1}.(${supplier}.*s1.s_suppkey).*c2.l_extendedprice * (1 - ${customer1}.(${supplier}.*s1.s_suppkey).*c2.l_discount))`
  
  let cond = rh`${nation2}.(${supplier}.*s1.s_nationkey).*n4.n_name == "BRAZIL"`
  let sumBrazil = rh`sum (${cond} & ${customer1}.(${supplier}.*s1.s_suppkey).*c2.l_extendedprice * (1 - ${customer1}.(${supplier}.*s1.s_suppkey).*c2.l_discount))`

  let supplier1 = rh`{
    year: (year ${customer1}.(${supplier}.*s1.s_suppkey).*c2.o_orderdate),
    mkt_share: (${sumBrazil} / ${sumTotal})
  } | group (year ${customer1}.(${supplier}.*s1.s_suppkey).*c2.o_orderdate)`

  let query = rh`sort "year" 0 ${supplier1}`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q8", schema: types.never, enableOptimizations: false })
  let res = await func()

  let answer = fs.readFileSync(`${answersDir}/q8.out`).toString()
  expect(res).toBe(answer)
})

test("q10", async () => {
  let nation1 = rh`[${nation}.*n1.n_name] | group ${nation}.*n1.n_nationkey`
  let orders1 = rh`[(${orders}.*o1.o_orderdate >= 19931001 && ${orders}.*o1.o_orderdate < 19940101) & ${orders}.*o1.o_orderkey] | group ${orders}.*o1.o_custkey`

  let customer1 = rh`[{
    n_name: ${nation1}.(${customer}.*c1.c_nationkey).*n2,
    o_orderkey: ${orders1}.(${customer}.*c1.c_custkey).*o2,
    c_custkey: ${customer}.*c1.c_custkey,
    c_name: ${customer}.*c1.c_name,
    c_address: ${customer}.*c1.c_address,
    c_phone: ${customer}.*c1.c_phone,
    c_acctbal: ${customer}.*c1.c_acctbal,
    c_comment: ${customer}.*c1.c_comment
  }] | group ${orders1}.(${customer}.*c1.c_custkey).*o2`

  let cond = rh`${lineitem}.*l1.l_returnflag == "R"`
  let lineitem1 = rh`{
    c_custkey: ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.c_custkey,
    c_name: ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.c_name,
    revenue: sum (${cond} & (${lineitem}.*l1.l_extendedprice * (1 - ${lineitem}.*l1.l_discount))),
    c_acctbal: ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.c_acctbal,
    n_name: ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.n_name,
    c_address: ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.c_address,
    c_phone: ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.c_phone,
    c_comment: ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.c_comment
  } | group [
    ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.c_custkey,
    ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.c_name,
    ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.c_acctbal,
    ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.c_phone,
    ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.n_name,
    ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.c_address,
    ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.c_comment
  ]`

  let query = rh`sort "revenue" 1 ${lineitem1}`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q10", schema: types.never, enableOptimizations: false, limit: 20  })
  let res = await func()

  let answer = fs.readFileSync(`${answersDir}/q10.out`).toString()
  expect(res).toBe(answer)
})

test("q11", async () => {
  let nation1 = rh`[${nation}.*n1.n_name == "GERMANY" & ${nation}.*n1.n_nationkey] | group ${nation}.*n1.n_nationkey`

  let supplier1 = rh`[{
    n_nationkey: ${nation1}.(${supplier}.*s1.s_nationkey).*n2,
    s_suppkey: ${supplier}.*s1.s_suppkey
  }] | group ${supplier}.*s1.s_suppkey`

  // redundant condition, just to make *s2 a dependency for the sum
  let cond = rh`${supplier1}.(${partsupp}.*ps1.ps_suppkey).*s2.s_suppkey == ${partsupp}.*ps1.ps_suppkey`
  let sum = rh`(sum (${cond} & (${partsupp}.*ps1.ps_supplycost * ${partsupp}.*ps1.ps_availqty))) * 0.0001`

  let partsupp1 = rh`{
    ps_partkey: single ${cond} & ${partsupp}.*ps1.ps_partkey,
    sum: sum? (${cond} & (${partsupp}.*ps1.ps_supplycost * ${partsupp}.*ps1.ps_availqty))
  } | group ${partsupp}.*ps1.ps_partkey`

  let partsupp2 = rh`[${partsupp1}.*.sum > ${sum} & {
    ps_partkey: ${partsupp1}.*.ps_partkey,
    value: ${partsupp1}.*.sum
  }]`

  let query = rh`sort "value" 1 ${partsupp2}`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q11", schema: types.never, enableOptimizations: false })
  let res = await func()

  let answer = fs.readFileSync(`${answersDir}/q11.out`).toString()
  expect(res).toBe(answer)
})

test("q12", async () => {
  let orders1 = rh`[
    ${orders}.*o1.o_orderpriority
  ] | group ${orders}.*o1.o_orderkey`

  let cond1 = rh`${lineitem}.*l1.l_shipmode == "MAIL" || ${lineitem}.*l1.l_shipmode == "SHIP"`
  let cond2 = rh`${lineitem}.*l1.l_commitdate < ${lineitem}.*l1.l_receiptdate`
  let cond3 = rh`${lineitem}.*l1.l_shipdate < ${lineitem}.*l1.l_commitdate`
  let cond4 = rh`${lineitem}.*l1.l_receiptdate >= 19940101 && ${lineitem}.*l1.l_receiptdate < 19950101`

  let cond = rh`${cond1} && ${cond2} && ${cond3} && ${cond4}`

  let cond5 = rh`${orders1}.(${lineitem}.*l1.l_orderkey).*o2 == "1-URGENT" || ${orders1}.(${lineitem}.*l1.l_orderkey).*o2 == "2-HIGH"`
  let cond6 = rh`${orders1}.(${lineitem}.*l1.l_orderkey).*o2 != "1-URGENT" && ${orders1}.(${lineitem}.*l1.l_orderkey).*o2 != "2-HIGH"`

  let lineitem1 = rh`{
    l_shipmode: (${cond} & ${lineitem}.*l1.l_shipmode),
    high_line_count: count? ((${cond} && ${cond5}) & ${lineitem}.*l1.l_comment),
    low_line_count: count? ((${cond} && ${cond6}) & ${lineitem}.*l1.l_comment)
  } | group ${lineitem}.*l1.l_shipmode`

  let query = rh`sort "l_shipmode" 0 ${lineitem1}`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q12", schema: types.never, enableOptimizations: false })
  let res = await func()

  let answer = fs.readFileSync(`${answersDir}/q12.out`).toString()
  expect(res).toBe(answer)
})

test("q15", async () => {
  let supplier1 = rh`[{
    s_name: ${supplier}.*s1.s_name,
    s_address: ${supplier}.*s1.s_address,
    s_phone: ${supplier}.*s1.s_phone
  }] | group ${supplier}.*s1.s_suppkey`

  let cond1 = rh`${lineitem}.*l1.l_shipdate >= 19960101 && ${lineitem}.*l1.l_shipdate < 19960401`
  let sumMap = rh`{
    supplier_no: ${cond1} & ${lineitem}.*l1.l_suppkey,
    total_revenue: sum (${cond1} & (${lineitem}.*l1.l_extendedprice * (1 - ${lineitem}.*l1.l_discount)))
  } | group ${lineitem}.*l1.l_suppkey`

  let maxRevenue = rh`max ${sumMap}.*max.total_revenue`

  let query = rh`[${sumMap}.*.total_revenue == ${maxRevenue} & {
    s_suppkey: ${sumMap}.*.supplier_no,
    s_name: ${supplier1}.(${sumMap}.*.supplier_no).*s2.s_name,
    s_address: ${supplier1}.(${sumMap}.*.supplier_no).*s2.s_address,
    s_phone: ${supplier1}.(${sumMap}.*.supplier_no).*s2.s_phone,
    total_revenue: ${sumMap}.*.total_revenue
  }]`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q15", schema: types.never, enableOptimizations: false })
  let res = await func()

  let answer = fs.readFileSync(`${answersDir}/q15.out`).toString()
  expect(res).toBe(answer)
})

test("q17", async () => {
  let part1 = rh`[
    (${part}.*p1.p_brand == "Brand#23" && ${part}.*p1.p_container == "MED BOX") & ${part}.*p1.p_partkey
  ] | group ${part}.*p1.p_partkey`

  let avgMap = rh`0.2 * sum(${lineitem}.*l1.l_quantity) / count(${lineitem}.*l1.l_quantity) | group ${lineitem}.*l1.l_partkey`

  let cond = rh`${part1}.(${lineitem}.*l2.l_partkey).*p2 == ${lineitem}.*l2.l_partkey && ${lineitem}.*l2.l_quantity < ${avgMap}.(${lineitem}.*l2.l_partkey)`
  let query = rh`(sum (${cond} & ${lineitem}.*l2.l_extendedprice)) / 7.0`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q17", schema: types.never, enableOptimizations: false })
  let res = await func()

  let answer = fs.readFileSync(`${answersDir}/q17.out`).toString()
  expect(res).toBe(answer)
})

test("q18", async () => {
  let customer1 = rh`[{
    c_custkey: ${customer}.*c1.c_custkey,
    c_name: ${customer}.*c1.c_name
  }] | group ${customer}.*c1.c_custkey`

  let lineitem1 = rh`{
    l_orderkey: single ${lineitem}.*l1.l_orderkey,
    sum: sum ${lineitem}.*l1.l_quantity
  } | group ${lineitem}.*l1.l_orderkey`

  let lineitem2 = rh`[${lineitem1}.*l2.sum > 300 & {
    l_orderkey: ${lineitem1}.*l2.l_orderkey,
    sum: ${lineitem1}.*l2.sum
  }] | group ${lineitem1}.*l2.l_orderkey`

  let orders1 = rh`[{
    o_orderkey: ${lineitem2}.(${orders}.*o1.o_orderkey).*l3.l_orderkey,
    c_custkey: ${customer1}.(${orders}.*o1.o_custkey).*c2.c_custkey,
    c_name: ${customer1}.(${orders}.*o1.o_custkey).*c2.c_name,
    o_totalprice: ${orders}.*o1.o_totalprice,
    o_orderdate: ${orders}.*o1.o_orderdate
  }] | group ${orders}.*o1.o_orderkey`

  let lineitem3 = rh`{
    c_name: single ${orders1}.(${lineitem}.*l4.l_orderkey).*o2.c_name,
    c_custkey: single ${orders1}.(${lineitem}.*l4.l_orderkey).*o2.c_custkey,
    o_orderkey: single ${orders1}.(${lineitem}.*l4.l_orderkey).*o2.o_orderkey,
    o_orderdate: single ${orders1}.(${lineitem}.*l4.l_orderkey).*o2.o_orderdate,
    o_totalprice: single ${orders1}.(${lineitem}.*l4.l_orderkey).*o2.o_totalprice,
    sum_l_quantity: sum (${lineitem}.*l4.l_quantity)
  } | group [
    ${orders1}.(${lineitem}.*l4.l_orderkey).*o2.c_name,
    ${orders1}.(${lineitem}.*l4.l_orderkey).*o2.c_custkey,
    ${orders1}.(${lineitem}.*l4.l_orderkey).*o2.o_orderkey,
    ${orders1}.(${lineitem}.*l4.l_orderkey).*o2.o_orderdate,
    ${orders1}.(${lineitem}.*l4.l_orderkey).*o2.o_totalprice
  ]`

  let query = rh`sort "o_totalprice" 1 "o_orderdate" 0 ${lineitem3}`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q18", schema: types.never, enableOptimizations: false })
  let res = await func()

  let answer = fs.readFileSync(`${answersDir}/q18.out`).toString()
  expect(res).toBe(answer)
})

test("q19", async () => {
  let part1 = rh`[${part}.*p1.p_size >= 1 & {
    p_partkey: ${part}.*p1.p_partkey,
    p_brand: ${part}.*p1.p_brand,
    p_size: ${part}.*p1.p_size,
    p_container: ${part}.*p1.p_container
  }] | group ${part}.*p1.p_partkey`

  let condLineitem1  = rh`${lineitem}.*l1.l_shipmode == "AIR" || ${lineitem}.*l1.l_shipmode == "AIR REG"`
  let condLineitem2 = rh`${lineitem}.*l1.l_shipinstruct == "DELIVER IN PERSON"`

  let condLineitem = rh`${condLineitem1} && ${condLineitem2}`

  let pBrand = rh`${part1}.(${lineitem}.*l1.l_partkey).*p2.p_brand`
  let pSize = rh`${part1}.(${lineitem}.*l1.l_partkey).*p2.p_size`
  let pContainer = rh`${part1}.(${lineitem}.*l1.l_partkey).*p2.p_container`

  let condA1 = rh`${pBrand} == "Brand#12"`
  let condA2 = rh`${pContainer} == "SM CASE" || ${pContainer} == "SM BOX" || ${pContainer} == "SM PACK" || ${pContainer} == "SM PKG"`
  let condA3 = rh`${lineitem}.*l1.l_quantity >= 1 && ${lineitem}.*l1.l_quantity <= 11`
  let condA4 = rh`${pSize} <= 5`

  let condA = rh`${condA1} && ${condA2} && ${condA3} && ${condA4}`

  let condB1 = rh`${pBrand} == "Brand#23"`
  let condB2 = rh`${pContainer} == "MED BAG" || ${pContainer} == "MED BOX" || ${pContainer} == "MED PKG" || ${pContainer} == "MED PACK"`
  let condB3 = rh`${lineitem}.*l1.l_quantity >= 10 && ${lineitem}.*l1.l_quantity <= 20`
  let condB4 = rh`${pSize} <= 10`

  let condB = rh`${condB1} && ${condB2} && ${condB3} && ${condB4}`

  let condC1 = rh`${pBrand} == "Brand#34"`
  let condC2 = rh`${pContainer} == "LG CASE" || ${pContainer} == "LG BOX" || ${pContainer} == "LG PACK" || ${pContainer} == "LG PKG"`
  let condC3 = rh`${lineitem}.*l1.l_quantity >= 20 && ${lineitem}.*l1.l_quantity <= 30`
  let condC4 = rh`${pSize} <= 15`

  let condC = rh`${condC1} && ${condC2} && ${condC3} && ${condC4}`

  let cond = rh`${condLineitem} && (${condA} || ${condB} || ${condC})`

  let query = rh`sum (${cond} & (${lineitem}.*l1.l_extendedprice * (1 - ${lineitem}.*l1.l_discount)))`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q19", schema: types.never, enableOptimizations: false })
  let res = await func()

  let answer = fs.readFileSync(`${answersDir}/q19.out`).toString()
  expect(res).toBe(answer)
})


test("q21", async () => {
  let nation1 = rh`[${nation}.*n1.n_name == "SAUDI ARABIA" & ${nation}.*n1.n_nationkey] | group ${nation}.*n1.n_nationkey`
  let supplier1 = rh`[{
    n_nationkey: ${nation1}.(${supplier}.*s1.s_nationkey).*n2,
    s_name: ${supplier}.*s1.s_name
  }] | group ${supplier}.*s1.s_suppkey`

  let cond1 = rh`${lineitem}.*l1.l_receiptdate > ${lineitem}.*l1.l_commitdate`
  let lineitem1 = rh`[${cond1} & {
    s_name: ${supplier1}.(${lineitem}.*l1.l_suppkey).*s2.s_name,
    l_suppkey: ${lineitem}.*l1.l_suppkey
  }] | group ${lineitem}.*l1.l_orderkey`

  let lineitem2 = rh`[${lineitem}.*l2.l_suppkey] | group ${lineitem}.*l2.l_orderkey`

  let cond2 = rh`${lineitem}.*l3.l_receiptdate > ${lineitem}.*l3.l_commitdate`
  let lineitem3 = rh`[${cond2} & ${lineitem}.*l3.l_suppkey] | group ${lineitem}.*l3.l_orderkey`
  
  let condL2 = rh`${lineitem2}.(${orders}.*o1.o_orderkey).*l5 != ${lineitem1}.(${orders}.*o1.o_orderkey).*l4.l_suppkey`
  let condL3 = rh`${lineitem3}.(${orders}.*o1.o_orderkey).*l6 != ${lineitem1}.(${orders}.*o1.o_orderkey).*l4.l_suppkey`

  let count = rh`{
    countL2: count ((${orders}.*o1.o_orderstatus == "F" && ${condL2}) & ${orders}.*o1.o_orderkey),
    countL3: count ((${orders}.*o1.o_orderstatus == "F" && ${condL3}) & ${orders}.*o1.o_orderkey)
  } | group ${orders}.*o1.o_orderkey`

  let cond = rh`${count}.(${orders}.*o2.o_orderkey).countL2 != 0 && ${count}.(${orders}.*o2.o_orderkey).countL3 == 0`
  let orders2 = rh`{
    s_name: single ((${orders}.*o2.o_orderstatus == "F" && ${cond}) & ${lineitem1}.(${orders}.*o2.o_orderkey).*l7.s_name),
    numwait: count ((${orders}.*o2.o_orderstatus == "F" && ${cond}) & ${orders}.*o2.o_orderkey)
  } | group ${lineitem1}.(${orders}.*o2.o_orderkey).*l7.s_name`

  let query = rh`sort "numwait" 1 "s_name" 0 ${orders2}`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q21", schema: types.never, enableOptimizations: false, limit: 100 })
  let res = await func()

  let answer = fs.readFileSync(`${answersDir}/q21.out`).toString()
  expect(res).toBe(answer)
})
