const { rh, api } = require('../src/rhyme')
const { compile } = require('../src/simple-eval')
const { typing, types } = require('../src/typing')

// point to the data directory
let dataDir = "cgen-sql/data/SF10"
let outDir = "bench/out/tpch"

let settings = {
  backend: "c-new",
  schema: types.never,
  outDir,
  hashSize: 16777216,
  enableOptimizations: false,
  format: "csv"
}

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
    l_returnflag: types.char,
    l_linestatus: types.char,
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
    o_orderstatus: types.char,
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

async function q1() {
  let cond = rh`${lineitem}.*.l_shipdate <= 19980902`

  let lineitem1 = rh`{
    l_returnflag: single ${lineitem}.*.l_returnflag,
    l_linestatus: single ${lineitem}.*.l_linestatus,
    sum_qty: sum ${lineitem}.*.l_quantity,
    sum_base_price: sum ${lineitem}.*.l_extendedprice,
    sum_disc_price: sum (${lineitem}.*.l_extendedprice * (1 - ${lineitem}.*.l_discount)),
    sum_charge: sum (${lineitem}.*.l_extendedprice * (1 - ${lineitem}.*.l_discount) * (1 + ${lineitem}.*.l_tax)),
    count_l_quantity: count ${lineitem}.*.l_quantity,
    count_l_extendedprice: count ${lineitem}.*.l_extendedprice,
    sum_l_discount: sum ${lineitem}.*.l_discount,
    count_l_discount: count ${lineitem}.*.l_discount,
    count_order: count ${lineitem}.*.l_orderkey
  } | group [${cond} & ${lineitem}.*.l_returnflag, ${lineitem}.*.l_linestatus]`

  let lineitem2 = rh`[{
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
  let query = rh`sort ${lineitem2} "l_returnflag" 0 "l_linestatus" 0`

  await compile(query, { ...settings, outFile: "q1", hashSize: 8, arraySize: 4 })
}

async function q2() {
  let region1 = rh`single ${region}.*r1.r_regionkey | group (${region}.*r1.r_name == "EUROPE" & ${region}.*r1.r_regionkey)`

  let nation1 = rh`{
    r_regionkey: single ${region1}.(${nation}.*n1.n_regionkey),
    n_nationkey: single ${nation}.*n1.n_nationkey,
    n_name: single ${nation}.*n1.n_name
  } | group (${region1}.(${nation}.*n1.n_regionkey) & ${nation}.*n1.n_nationkey)`

  let supplier1 = rh`{
    n_name: single ${nation1}.(${supplier}.*s1.s_nationkey).n_name,
    s_suppkey: single ${supplier}.*s1.s_suppkey,
    s_name: single ${supplier}.*s1.s_name,
    s_address: single ${supplier}.*s1.s_address,
    s_phone: single ${supplier}.*s1.s_phone,
    s_acctbal: single ${supplier}.*s1.s_acctbal,
    s_comment: single ${supplier}.*s1.s_comment
  } | group (${nation1}.(${supplier}.*s1.s_nationkey) & ${supplier}.*s1.s_suppkey)`

  // let joinCond = rh`${supplier1}.(${partsupp}.*ps1.ps_suppkey).*s2.s_suppkey == ${partsupp}.*ps1.ps_suppkey`
  let partsupp1 = rh`min ${partsupp}.*ps1.ps_supplycost | group (${supplier1}.(${partsupp}.*ps1.ps_suppkey) & ${partsupp}.*ps1.ps_partkey)`

  let part1 = rh`{
    p_partkey: single ${part}.*p1.p_partkey,
    p_mfgr: single ${part}.*p1.p_mfgr,
    min_cost: single ${partsupp1}.(${part}.*p1.p_partkey)
  } | group (${partsupp1}.(${part}.*p1.p_partkey) && ${part}.*p1.p_size == 15 && (like ${part}.*p1.p_type ".*BRASS") & ${part}.*p1.p_partkey)`

  let joinCond2 = rh`${part1}.(${partsupp}.*ps2.ps_partkey) && ${part1}.(${partsupp}.*ps2.ps_partkey).min_cost == ${partsupp}.*ps2.ps_supplycost`
  let partsupp2 = rh`[${joinCond2} & {
    s_acctbal: ${supplier1}.(${partsupp}.*ps2.ps_suppkey).s_acctbal,
    s_name: ${supplier1}.(${partsupp}.*ps2.ps_suppkey).s_name,
    n_name: ${supplier1}.(${partsupp}.*ps2.ps_suppkey).n_name,
    p_partkey: ${partsupp}.*ps2.ps_partkey,
    p_mfgr: ${part1}.(${partsupp}.*ps2.ps_partkey).p_mfgr,
    s_address: ${supplier1}.(${partsupp}.*ps2.ps_suppkey).s_address,
    s_phone: ${supplier1}.(${partsupp}.*ps2.ps_suppkey).s_phone,
    s_comment: ${supplier1}.(${partsupp}.*ps2.ps_suppkey).s_comment
  }]`

  let query = rh`sort ${partsupp2} "s_acctbal" 1 "n_name" 0 "s_name" 0 "p_partkey" 0`

  await compile(query, { ...settings, outFile: "q2", arraySize: 8092, limit: 100 })
}

async function q3() {
  let customer1 = rh`single ${customer}.*c1.c_custkey | group (${customer}.*c1.c_mktsegment == "BUILDING" & ${customer}.*c1.c_custkey)`

  let orders1 = rh`{
    o_orderdate: single ${orders}.*o1.o_orderdate,
    o_shippriority: single ${orders}.*o1.o_shippriority
  } | group (${customer1}.(${orders}.*o1.o_custkey) && ${orders}.*o1.o_orderdate < 19950315 & ${orders}.*o1.o_orderkey)`

  let cond = rh`${orders1}.(${lineitem}.*l1.l_orderkey) && ${lineitem}.*l1.l_shipdate > 19950315`
  let lineitem1 = rh`{
    l_orderkey: ${lineitem}.*l1.l_orderkey,
    revenue: sum (${lineitem}.*l1.l_extendedprice * (1 - ${lineitem}.*l1.l_discount)),
    o_orderdate: ${orders1}.(${lineitem}.*l1.l_orderkey).o_orderdate,
    o_shippriority: ${orders1}.(${lineitem}.*l1.l_orderkey).o_shippriority
  } | group [${cond} & ${lineitem}.*l1.l_orderkey,
    ${orders1}.(${lineitem}.*l1.l_orderkey).o_orderdate,
    ${orders1}.(${lineitem}.*l1.l_orderkey).o_shippriority
  ]`

  let query = rh`sort ${lineitem1} "revenue" 1 "o_orderdate" 0`

  await compile(query, { ...settings, outFile: "q3", limit: 10 })
}

async function q4() {
  let countR = rh`count ${lineitem}.*l.l_orderkey | group (${lineitem}.*l.l_commitdate < ${lineitem}.*l.l_receiptdate) & ${lineitem}.*l.l_orderkey`

  let cond = rh`19930701 <= ${orders}.*.o_orderdate && ${orders}.*.o_orderdate < 19931001`

  let countL = rh`{
    o_orderpriority: single ${orders}.*.o_orderpriority,
    order_count: count ${orders}.*.o_orderkey
  } | group (${countR}.(${orders}.*.o_orderkey) && ${cond}) & ${orders}.*.o_orderpriority`
  let query = rh`sort ${countL} "o_orderpriority" 0`

  await compile(query, { ...settings, outFile: "q4" })
}

// optimize group-bys
async function q5() {
  let region1 = rh`single ${region}.*r1.r_regionkey | (group ${region}.*r1.r_name == "ASIA" & ${region}.*r1.r_regionkey)`
  let nation1 = rh`{
    n_nationkey: single ${nation}.*n1.n_nationkey,
    n_name: single ${nation}.*n1.n_name
  } | group ${region1}.(${nation}.*n1.n_regionkey) & ${nation}.*n1.n_nationkey`

  let customer1 = rh`{
    n_nationkey: single ${nation1}.(${customer}.*c1.c_nationkey).n_nationkey,
    n_name: single ${nation1}.(${customer}.*c1.c_nationkey).n_name
  } | group ${nation1}.(${customer}.*c1.c_nationkey) & ${customer}.*c1.c_custkey`

  let orders1 = rh`{
    n_nationkey: single ${customer1}.(${orders}.*o1.o_custkey).n_nationkey,
    n_name: single ${customer1}.(${orders}.*o1.o_custkey).n_name
  } | group (${customer1}.(${orders}.*o1.o_custkey) && 19940101 <= ${orders}.*o1.o_orderdate && ${orders}.*o1.o_orderdate < 19950101) & ${orders}.*o1.o_orderkey`

  let supplier1 = rh`single ${supplier}.*s1.s_nationkey | group ${supplier}.*s1.s_suppkey`

  let cond = rh`${orders1}.(${lineitem}.*l1.l_orderkey) && ${orders1}.(${lineitem}.*l1.l_orderkey).n_nationkey == ${supplier1}.(${lineitem}.*l1.l_suppkey)`
  let lineitem1 = rh`{
    n_name: ${orders1}.(${lineitem}.*l1.l_orderkey).n_name,
    revenue: sum (${lineitem}.*l1.l_extendedprice * (1 - ${lineitem}.*l1.l_discount))
  } | group ${cond} & ${orders1}.(${lineitem}.*l1.l_orderkey).n_name`

  let query = rh`sort ${lineitem1} "revenue" 1`

  await compile(query, { ...settings, outFile: "q5" })
}

async function q6() {
  let cond1 = rh`19940101 <= ${lineitem}.*.l_shipdate && ${lineitem}.*.l_shipdate < 19950101`
  let cond2 = rh`0.05 <= ${lineitem}.*.l_discount && ${lineitem}.*.l_discount <= 0.07`
  let cond3 = rh`${lineitem}.*.l_quantity < 24`

  let cond = rh`${cond1} && ${cond2} && ${cond3}`

  let query = rh`sum (${cond}) & (${lineitem}.*.l_extendedprice * ${lineitem}.*.l_discount)`

  await compile(query, { ...settings, outFile: "q6" })
}

async function q7() {
  let cond1 = rh`${nation}.*n1.n_name == "FRANCE" && ${nation}.*n2.n_name == "GERMANY" || ${nation}.*n1.n_name == "GERMANY" && ${nation}.*n2.n_name == "FRANCE"`
  let nation1 = rh`{
    supp_nation: single ${nation}.*n1.n_name,
    cust_nation: single ${nation}.*n2.n_name,
    n1key: single ${nation}.*n1.n_nationkey
  } | group ${cond1} & ${nation}.*n2.n_nationkey`

  let customer1 = rh`{
    supp_nation: single ${nation1}.(${customer}.*c1.c_nationkey).supp_nation,
    cust_nation: single ${nation1}.(${customer}.*c1.c_nationkey).cust_nation,
    n1key: single ${nation1}.(${customer}.*c1.c_nationkey).n1key
  } | group ${nation1}.(${customer}.*c1.c_nationkey) & ${customer}.*c1.c_custkey`

  let orders1 = rh`{
    supp_nation: single ${customer1}.(${orders}.*o1.o_custkey).supp_nation,
    cust_nation: single ${customer1}.(${orders}.*o1.o_custkey).cust_nation,
    n1key: single ${customer1}.(${orders}.*o1.o_custkey).n1key
  } | group ${customer1}.(${orders}.*o1.o_custkey) & ${orders}.*o1.o_orderkey`

  let supplier1 = rh`single ${supplier}.*s1.s_nationkey | group ${supplier}.*s1.s_suppkey`

  let cond2 = rh`${orders1}.(${lineitem}.*l1.l_orderkey) && ${lineitem}.*l1.l_shipdate >= 19950101 && ${lineitem}.*l1.l_shipdate <= 19961231 && ${supplier1}.(${lineitem}.*l1.l_suppkey) == ${orders1}.(${lineitem}.*l1.l_orderkey).n1key`

  let lineitem1 = rh`{
    supp_nation: single ${orders1}.(${lineitem}.*l1.l_orderkey).supp_nation,
    cust_nation: single ${orders1}.(${lineitem}.*l1.l_orderkey).cust_nation,
    l_year: year ${lineitem}.*l1.l_shipdate,
    revenue: sum (${lineitem}.*l1.l_extendedprice * (1 - ${lineitem}.*l1.l_discount))
  } | group [
    ${cond2} & ${orders1}.(${lineitem}.*l1.l_orderkey).supp_nation,
    ${orders1}.(${lineitem}.*l1.l_orderkey).cust_nation,
    (year ${lineitem}.*l1.l_shipdate)
  ]`

  let query = rh`sort ${lineitem1} "supp_nation" 0 "cust_nation" 0 "l_year" 0`

  await compile(query, { ...settings, outFile: "q7" })
}

async function q8() {
  let region1 = rh`single ${region}.*r1.r_regionkey | group ${region}.*r1.r_name == "AMERICA" & ${region}.*r1.r_regionkey`
  let nation1 = rh`single ${nation}.*n1.n_nationkey | group ${region1}.(${nation}.*n1.n_regionkey) & ${nation}.*n1.n_nationkey`

  let part1 = rh`single ${part}.*p1.p_partkey | group ${part}.*p1.p_type == "ECONOMY ANODIZED STEEL" & ${part}.*p1.p_partkey`

  let lineitem1 = rh`[{
    l_suppkey: ${lineitem}.*l1.l_suppkey,
    l_extendedprice: ${lineitem}.*l1.l_extendedprice,
    l_discount: ${lineitem}.*l1.l_discount
  }] | group ${part1}.(${lineitem}.*l1.l_partkey) & ${lineitem}.*l1.l_orderkey`

  let orders1 = rh`[{
    l_suppkey: ${lineitem1}.(${orders}.*o1.o_orderkey).*l2.l_suppkey,
    l_extendedprice: ${lineitem1}.(${orders}.*o1.o_orderkey).*l2.l_extendedprice,
    l_discount: ${lineitem1}.(${orders}.*o1.o_orderkey).*l2.l_discount,
    o_orderdate: ${orders}.*o1.o_orderdate
  }] | group ${lineitem1}.(${orders}.*o1.o_orderkey) && ${orders}.*o1.o_orderdate >= 19950101 && ${orders}.*o1.o_orderdate <= 19961231 & ${orders}.*o1.o_custkey`

  let customer1 = rh`[{
    l_extendedprice: ${orders1}.(${customer}.*c1.c_custkey).*o2.l_extendedprice,
    l_discount: ${orders1}.(${customer}.*c1.c_custkey).*o2.l_discount,
    o_orderdate: ${orders1}.(${customer}.*c1.c_custkey).*o2.o_orderdate
  }] | group ${orders1}.(${customer}.*c1.c_custkey) && ${nation1}.(${customer}.*c1.c_nationkey) & ${orders1}.(${customer}.*c1.c_custkey).*o2.l_suppkey`

  let nation2 = rh`single ${nation}.*n2.n_name | group ${nation}.*n2.n_nationkey`

  let sumTotal = rh`sum (${customer1}.(${supplier}.*s1.s_suppkey).*c2.l_extendedprice * (1 - ${customer1}.(${supplier}.*s1.s_suppkey).*c2.l_discount))`

  let cond = rh`${nation2}.(${supplier}.*s1.s_nationkey) == "BRAZIL"`
  let sumBrazil = rh`sum (${cond} & ${customer1}.(${supplier}.*s1.s_suppkey).*c2.l_extendedprice * (1 - ${customer1}.(${supplier}.*s1.s_suppkey).*c2.l_discount))`

  let supplier1 = rh`{
    year: (year ${customer1}.(${supplier}.*s1.s_suppkey).*c2.o_orderdate),
    mkt_share: (${sumBrazil} / ${sumTotal})
  } | group ${customer1}.(${supplier}.*s1.s_suppkey) & (year ${customer1}.(${supplier}.*s1.s_suppkey).*c2.o_orderdate)`

  let query = rh`sort ${supplier1} "year" 0`

  await compile(query, { ...settings, outFile: "q8" })
}

async function q9() {
  let nation1 = rh`single ${nation}.*n1.n_name | group ${nation}.*n1.n_nationkey`

  let supplier1 = rh`{
    s_suppkey: single ${supplier}.*s1.s_suppkey,
    n_name: single ${nation1}.(${supplier}.*s1.s_nationkey)
  } | group ${supplier}.*s1.s_suppkey`

  let part1 = rh`single ${part}.*p1.p_partkey | group (like ${part}.*p1.p_name ".*green.*") & ${part}.*p1.p_partkey`

  let partsupp1 = rh`[{
    s_suppkey: ${supplier1}.(${partsupp}.*ps1.ps_suppkey).s_suppkey,
    n_name: ${supplier1}.(${partsupp}.*ps1.ps_suppkey).n_name,
    ps_supplycost: ${partsupp}.*ps1.ps_supplycost
  }] | group ${part1}.(${partsupp}.*ps1.ps_partkey) & ${partsupp}.*ps1.ps_partkey`

  let joinCond = rh`${partsupp1}.(${lineitem}.*l1.l_partkey).*ps2.s_suppkey == ${lineitem}.*l1.l_suppkey`
  let lineitem1 = rh`[{
    nation: ${partsupp1}.(${lineitem}.*l1.l_partkey).*ps2.n_name,
    ps_supplycost: ${partsupp1}.(${lineitem}.*l1.l_partkey).*ps2.ps_supplycost,
    l_quantity: ${lineitem}.*l1.l_quantity,
    l_extendedprice: ${lineitem}.*l1.l_extendedprice,
    l_discount: ${lineitem}.*l1.l_discount
  }] | group ${partsupp1}.(${lineitem}.*l1.l_partkey) && ${joinCond} & ${lineitem}.*l1.l_orderkey`

  let amount = rh`${lineitem1}.(${orders}.*o1.o_orderkey).*l2.l_extendedprice * (1 - ${lineitem1}.(${orders}.*o1.o_orderkey).*l2.l_discount) - ${lineitem1}.(${orders}.*o1.o_orderkey).*l2.ps_supplycost * ${lineitem1}.(${orders}.*o1.o_orderkey).*l2.l_quantity`
  let orders1 = rh`{
    nation: single ${lineitem1}.(${orders}.*o1.o_orderkey).*l2.nation,
    o_year: (year ${orders}.*o1.o_orderdate),
    sum_profit: sum ${amount}
  } | group [
    ${lineitem1}.(${orders}.*o1.o_orderkey) & ${lineitem1}.(${orders}.*o1.o_orderkey).*l2.nation,
    (year ${orders}.*o1.o_orderdate)
  ]`

  let query = rh`sort ${orders1} "nation" 0 "o_year" 1`

  await compile(query, { ...settings, outFile: "q9" })
}

async function q10() {
  let nation1 = rh`single ${nation}.*n1.n_name | group ${nation}.*n1.n_nationkey`
  let orders1 = rh`[${orders}.*o1.o_orderkey] | group (${orders}.*o1.o_orderdate >= 19931001 && ${orders}.*o1.o_orderdate < 19940101) & ${orders}.*o1.o_custkey`

  let customer1 = rh`[{
      n_name: ${nation1}.(${customer}.*c1.c_nationkey),
      o_orderkey: ${orders1}.(${customer}.*c1.c_custkey).*o2,
      c_custkey: ${customer}.*c1.c_custkey,
      c_name: ${customer}.*c1.c_name,
      c_address: ${customer}.*c1.c_address,
      c_phone: ${customer}.*c1.c_phone,
      c_acctbal: ${customer}.*c1.c_acctbal,
      c_comment: ${customer}.*c1.c_comment
    }] | group ${orders1}.(${customer}.*c1.c_custkey) & ${orders1}.(${customer}.*c1.c_custkey).*o2`

  let cond = rh`${lineitem}.*l1.l_returnflag == 82`
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
    ${customer1}.(${lineitem}.*l1.l_orderkey) & ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.c_custkey,
    ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.c_name,
    ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.c_acctbal,
    ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.c_phone,
    ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.n_name,
    ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.c_address,
    ${customer1}.(${lineitem}.*l1.l_orderkey).*c2.c_comment
  ]`

  let query = rh`sort ${lineitem1} "revenue" 1`

  await compile(query, { ...settings, outFile: "q10", limit: 20 })
}

async function q11() {
  let nation1 = rh`single ${nation}.*n1.n_nationkey | group ${nation}.*n1.n_name == "GERMANY" & ${nation}.*n1.n_nationkey`

  let supplier1 = rh`{
    n_nationkey: single ${nation1}.(${supplier}.*s1.s_nationkey),
    s_suppkey: single ${supplier}.*s1.s_suppkey
  } | group ${nation1}.(${supplier}.*s1.s_nationkey) & ${supplier}.*s1.s_suppkey`

  let cond = rh`${supplier1}.(${partsupp}.*ps1.ps_suppkey)`
  let sum = rh`(sum (${cond} & (${partsupp}.*ps1.ps_supplycost * ${partsupp}.*ps1.ps_availqty))) * 0.0001`

  let partsupp1 = rh`{
    ps_partkey: single ${partsupp}.*ps1.ps_partkey,
    sum: sum? (${partsupp}.*ps1.ps_supplycost * ${partsupp}.*ps1.ps_availqty)
  } | group ${supplier1}.(${partsupp}.*ps1.ps_suppkey).s_suppkey == ${partsupp}.*ps1.ps_suppkey & ${partsupp}.*ps1.ps_partkey`

  let partsupp2 = rh`[${partsupp1}.*.sum > ${sum} & {
    ps_partkey: ${partsupp1}.*.ps_partkey,
    value: ${partsupp1}.*.sum
  }]`

  let query = rh`sort ${partsupp2} "value" 1`

  await compile(query, { ...settings, outFile: "q11" })
}

async function q12() {
  let orders1 = rh`single ${orders}.*o1.o_orderpriority | group ${orders}.*o1.o_orderkey`

  let cond1 = rh`${lineitem}.*l1.l_shipmode == "MAIL" || ${lineitem}.*l1.l_shipmode == "SHIP"`
  let cond2 = rh`${lineitem}.*l1.l_commitdate < ${lineitem}.*l1.l_receiptdate`
  let cond3 = rh`${lineitem}.*l1.l_shipdate < ${lineitem}.*l1.l_commitdate`
  let cond4 = rh`${lineitem}.*l1.l_receiptdate >= 19940101 && ${lineitem}.*l1.l_receiptdate < 19950101`

  let cond = rh`${cond1} && ${cond2} && ${cond3} && ${cond4}`

  let cond5 = rh`${orders1}.(${lineitem}.*l1.l_orderkey) == "1-URGENT" || ${orders1}.(${lineitem}.*l1.l_orderkey) == "2-HIGH"`
  let cond6 = rh`${orders1}.(${lineitem}.*l1.l_orderkey) != "1-URGENT" && ${orders1}.(${lineitem}.*l1.l_orderkey) != "2-HIGH"`

  let lineitem1 = rh`{
    l_shipmode: single ${lineitem}.*l1.l_shipmode,
    high_line_count: count ${cond5} & ${lineitem}.*l1,
    low_line_count: count ${cond6} & ${lineitem}.*l1
  } | group ${cond} & ${lineitem}.*l1.l_shipmode`

  let query = rh`sort ${lineitem1} "l_shipmode" 0`

  await compile(query, { ...settings, outFile: "q12" })
}

async function q13() {
  let cond = rh`isUndef (like ${orders}.*o1.o_comment ".*special.*requests.*")`
  let orders1 = rh`[${orders}.*o1.o_orderkey] | group ${cond} & ${orders}.*o1.o_custkey`

  let customer1 = rh`count ${orders1}.(${customer}.*c1.c_custkey).*o2 | group ${customer}.*c1.c_custkey`

  let customer2 = rh`{
    c_count: single ${customer1}.*c2,
    custdist: count ${customer1}.*c2
  } | group ${customer1}.*c2`

  let query = rh`sort ${customer2} "custdist" 1 "c_count" 1`

  await compile(query, { ...settings, outFile: "q13" })
}

async function q14() {
  let cond1 = rh`${lineitem}.*l1.l_shipdate >= 19950901 && ${lineitem}.*l1.l_shipdate < 19951001`
  let lineitem1 = rh`[{
    l_extendedprice: ${lineitem}.*l1.l_extendedprice,
    l_discount: ${lineitem}.*l1.l_discount
  }] | group ${cond1} & ${lineitem}.*l1.l_partkey`

  let cond2 = rh`like ${part}.*p1.p_type "PROMO.*"`

  let revenue = rh`${lineitem1}.(${part}.*p1.p_partkey).*l2.l_extendedprice * (1 - ${lineitem1}.(${part}.*p1.p_partkey).*l2.l_discount)`
  let sum1 = rh`sum (${cond2} & ${revenue})`
  let sum2 = rh`sum (${revenue})`

  let query = rh`100 * ${sum1} / ${sum2}`

  await compile(query, { ...settings, outFile: "q14" })
}

async function q15() {
  let supplier1 = rh`{
    s_name: single ${supplier}.*s1.s_name,
    s_address: single ${supplier}.*s1.s_address,
    s_phone: single ${supplier}.*s1.s_phone
  } | group ${supplier}.*s1.s_suppkey`

  let cond1 = rh`${lineitem}.*l1.l_shipdate >= 19960101 && ${lineitem}.*l1.l_shipdate < 19960401`
  let sumMap = rh`{
    supplier_no: ${lineitem}.*l1.l_suppkey,
    total_revenue: sum (${lineitem}.*l1.l_extendedprice * (1 - ${lineitem}.*l1.l_discount))
  } | group ${cond1} & ${lineitem}.*l1.l_suppkey`

  let maxRevenue = rh`max ${sumMap}.*max.total_revenue`

  let query = rh`[${sumMap}.*.total_revenue == ${maxRevenue} & {
    s_suppkey: ${sumMap}.*.supplier_no,
    s_name: ${supplier1}.(${sumMap}.*.supplier_no).s_name,
    s_address: ${supplier1}.(${sumMap}.*.supplier_no).s_address,
    s_phone: ${supplier1}.(${sumMap}.*.supplier_no).s_phone,
    total_revenue: ${sumMap}.*.total_revenue
  }]`

  await compile(query, { ...settings, outFile: "q15" })
}

async function q16() {
  let supplier1 = rh`count ((like ${supplier}.*s1.s_comment ".*Customer.*Complaints.*") & ${supplier}.*s1) | group ${supplier}.*s1.s_suppkey`

  let partsupp1 = rh`[${partsupp}.*ps1.ps_suppkey] | group ${supplier1}.(${partsupp}.*ps1.ps_suppkey) == 0 & ${partsupp}.*ps1.ps_partkey`

  let cond1 = rh`${part}.*p1.p_brand != "Brand#45" && (isUndef (like ${part}.*p1.p_type "MEDIUM POLISHED.*"))`
  let cond2 = rh`${part}.*p1.p_size == 42 || ${part}.*p1.p_size == 14 || ${part}.*p1.p_size == 23 || ${part}.*p1.p_size == 45 ||
                 ${part}.*p1.p_size == 19 || ${part}.*p1.p_size == 3 || ${part}.*p1.p_size == 36 || ${part}.*p1.p_size == 9`

  let cond = rh`${partsupp1}.(${part}.*p1.p_partkey) && ${cond1} && ${cond2}`

  let part1 = rh`{
    p_brand: single ${part}.*p1.p_brand,
    p_type: single ${part}.*p1.p_type,
    p_size: single ${part}.*p1.p_size,
    ps_suppkey: single ${partsupp1}.(${part}.*p1.p_partkey).*ps2
  } | group [
    ${cond} & ${part}.*p1.p_brand,
    ${part}.*p1.p_type,
    ${part}.*p1.p_size,
    ${partsupp1}.(${part}.*p1.p_partkey).*ps2
  ]`

  let part2 = rh`{
    p_brand: single ${part1}.*p2.p_brand,
    p_type: single ${part1}.*p2.p_type,
    p_size: single ${part1}.*p2.p_size,
    supplier_cnt: count ${part1}.*p2.ps_suppkey
  } | group [
    ${part1}.*p2.p_brand,
    ${part1}.*p2.p_type,
    ${part1}.*p2.p_size
  ]`

  let query = rh`sort ${part2} "supplier_cnt" 1 "p_brand" 0 "p_type" 0 "p_size" 0`

  await compile(query, { ...settings, outFile: "q16" })
}

async function q17() {
  let part1 = rh`single ${part}.*p1.p_partkey | group (${part}.*p1.p_brand == "Brand#23" && ${part}.*p1.p_container == "MED BOX") & ${part}.*p1.p_partkey`

  let avgMap = rh`single 0.2 * sum(${lineitem}.*l1.l_quantity) / count(${lineitem}.*l1.l_quantity) | group ${lineitem}.*l1.l_partkey`

  let cond = rh`${part1}.(${lineitem}.*l2.l_partkey) && ${lineitem}.*l2.l_quantity < ${avgMap}.(${lineitem}.*l2.l_partkey)`
  let query = rh`(sum (${cond} & ${lineitem}.*l2.l_extendedprice)) / 7.0`

  await compile(query, { ...settings, outFile: "q17" })
}

async function q18() {
  let customer1 = rh`{
    c_custkey: single ${customer}.*c1.c_custkey,
    c_name: single ${customer}.*c1.c_name
  } | group ${customer}.*c1.c_custkey`

  let lineitem1 = rh`{
    l_orderkey: single ${lineitem}.*l1.l_orderkey,
    sum: sum ${lineitem}.*l1.l_quantity
  } | group ${lineitem}.*l1.l_orderkey`

  let lineitem2 = rh`[{
    l_orderkey: ${lineitem1}.*l2.l_orderkey,
    sum: ${lineitem1}.*l2.sum
  }] | group ${lineitem1}.*l2.sum > 300 & ${lineitem1}.*l2.l_orderkey`

  let orders1 = rh`{
    o_orderkey: single ${lineitem2}.(${orders}.*o1.o_orderkey).*l3.l_orderkey,
    c_custkey: single ${customer1}.(${orders}.*o1.o_custkey).c_custkey,
    c_name: single ${customer1}.(${orders}.*o1.o_custkey).c_name,
    o_totalprice: single ${orders}.*o1.o_totalprice,
    o_orderdate: single ${orders}.*o1.o_orderdate
  } | group ${lineitem2}.(${orders}.*o1.o_orderkey) & ${orders}.*o1.o_orderkey`

  let lineitem3 = rh`{
    c_name: single ${orders1}.(${lineitem}.*l4.l_orderkey).c_name,
    c_custkey: single ${orders1}.(${lineitem}.*l4.l_orderkey).c_custkey,
    o_orderkey: single ${orders1}.(${lineitem}.*l4.l_orderkey).o_orderkey,
    o_orderdate: single ${orders1}.(${lineitem}.*l4.l_orderkey).o_orderdate,
    o_totalprice: single ${orders1}.(${lineitem}.*l4.l_orderkey).o_totalprice,
    sum_l_quantity: sum (${lineitem}.*l4.l_quantity)
  } | group [
    ${orders1}.(${lineitem}.*l4.l_orderkey) & ${orders1}.(${lineitem}.*l4.l_orderkey).c_name,
    ${orders1}.(${lineitem}.*l4.l_orderkey).c_custkey,
    ${orders1}.(${lineitem}.*l4.l_orderkey).o_orderkey,
    ${orders1}.(${lineitem}.*l4.l_orderkey).o_orderdate,
    ${orders1}.(${lineitem}.*l4.l_orderkey).o_totalprice
  ]`

  let query = rh`sort ${lineitem3} "o_totalprice" 1 "o_orderdate" 0`

  await compile(query, { ...settings, outFile: "q18", limit: 100 })
}

async function q19Old() {
  let part1 = rh`{
    p_brand: single ${part}.*p1.p_brand,
    p_size: single ${part}.*p1.p_size,
    p_container: single ${part}.*p1.p_container
  } | group ${part}.*p1.p_size >= 1 & ${part}.*p1.p_partkey`

  let condLineitem1 = rh`${lineitem}.*l1.l_shipmode == "AIR" || ${lineitem}.*l1.l_shipmode == "AIR REG"`
  let condLineitem2 = rh`${lineitem}.*l1.l_shipinstruct == "DELIVER IN PERSON"`

  let condLineitem = rh`${condLineitem1} && ${condLineitem2}`

  let pBrand = rh`${part1}.(${lineitem}.*l1.l_partkey).p_brand`
  let pSize = rh`${part1}.(${lineitem}.*l1.l_partkey).p_size`
  let pContainer = rh`${part1}.(${lineitem}.*l1.l_partkey).p_container`

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

  let cond = rh`${condLineitem} && ${part1}.(${lineitem}.*l1.l_partkey) && (${condA} || ${condB} || ${condC})`

  let query = rh`sum (${cond} & (${lineitem}.*l1.l_extendedprice * (1 - ${lineitem}.*l1.l_discount)))`

  await compile(query, { ...settings, outFile: "q19" })
}

async function q19() {
  let condLineitem1 = rh`${lineitem}.*l1.l_shipmode == "AIR" || ${lineitem}.*l1.l_shipmode == "AIR REG"`
  let condLineitem2 = rh`${lineitem}.*l1.l_shipinstruct == "DELIVER IN PERSON"`

  let condLineitem = rh`${condLineitem1} && ${condLineitem2}`

  let lineitem1 = rh`[{
    l_quantity: ${lineitem}.*l1.l_quantity,
    l_extendedprice: ${lineitem}.*l1.l_extendedprice,
    l_discount: ${lineitem}.*l1.l_discount
  }] | group ${condLineitem} & ${lineitem}.*l1.l_partkey`

  let pBrand = rh`${part}.*p1.p_brand`
  let pSize = rh`${part}.*p1.p_size`
  let pContainer = rh`${part}.*p1.p_container`

  let lQuantity = rh`${lineitem1}.(${part}.*p1.p_partkey).*l2.l_quantity`
  let lExtendedPrice = rh`${lineitem1}.(${part}.*p1.p_partkey).*l2.l_extendedprice`
  let lDiscount = rh`${lineitem1}.(${part}.*p1.p_partkey).*l2.l_discount`

  let condA1 = rh`${pBrand} == "Brand#12"`
  let condA2 = rh`${pContainer} == "SM CASE" || ${pContainer} == "SM BOX" || ${pContainer} == "SM PACK" || ${pContainer} == "SM PKG"`
  let condA3 = rh`${lQuantity} <= 11 && ${lQuantity} >= 1`
  let condA4 = rh`${pSize} <= 5`

  let condA = rh`${condA4} && ${condA3} && ${condA1} && ${condA2}`

  let condB1 = rh`${pBrand} == "Brand#23"`
  let condB2 = rh`${pContainer} == "MED BAG" || ${pContainer} == "MED BOX" || ${pContainer} == "MED PKG" || ${pContainer} == "MED PACK"`
  let condB3 = rh` ${lQuantity} <= 20 && ${lQuantity} >= 10`
  let condB4 = rh`${pSize} <= 10`

  let condB = rh`${condB4} && ${condB3} && ${condB1} && ${condB2}`

  let condC1 = rh`${pBrand} == "Brand#34"`
  let condC2 = rh`${pContainer} == "LG CASE" || ${pContainer} == "LG BOX" || ${pContainer} == "LG PACK" || ${pContainer} == "LG PKG"`
  let condC3 = rh`${lQuantity} <= 30 && ${lQuantity} >= 20`
  let condC4 = rh`${pSize} <= 15`

  let condC = rh`${condC4} && ${condC3} && ${condC1} && ${condC2}`

  let cond = rh`${part}.*p1.p_size >= 1 && (${condA} || ${condB} || ${condC})`

  let query = rh`sum ((${cond} & ${lExtendedPrice} * (1 - ${lDiscount})))`

  await compile(query, { ...settings, outFile: "q19" })
}

async function q20() {
  let nation1 = rh`single ${nation}.*n1.n_nationkey | group ${nation}.*n1.n_name == "CANADA" & ${nation}.*n1.n_nationkey`
  
  let part1 = rh`count ((like ${part}.*p1.p_name "forest.*") & ${part}.*p1) | group ${part}.*p1.p_partkey`
  let partsupp1 = rh`[{
    ps_suppkey: ${partsupp}.*ps1.ps_suppkey,
    ps_availqty: ${partsupp}.*ps1.ps_availqty
  }] | group ${part1}.(${partsupp}.*ps1.ps_partkey) > 0 & ${partsupp}.*ps1.ps_partkey`

  let cond1 = rh`${lineitem}.*l1.l_shipdate >= 19940101 && ${lineitem}.*l1.l_shipdate < 19950101`
  let lineitem1 = rh`{
    l_partkey: single (${lineitem}.*l1.l_partkey),
    l_suppkey: single (${lineitem}.*l1.l_suppkey),
    sum: sum? (${lineitem}.*l1.l_quantity)
  } | group [${cond1} & ${lineitem}.*l1.l_partkey, ${lineitem}.*l1.l_suppkey]`

  let cond2 = rh`${partsupp1}.(${lineitem1}.*l2.l_partkey).*ps2.ps_suppkey == ${lineitem1}.*l2.l_suppkey`
  let cond3 = rh`${partsupp1}.(${lineitem1}.*l2.l_partkey).*ps2.ps_availqty > 0.5 * ${lineitem1}.*l2.sum`
  let lineitem2 = rh`count (${lineitem1}.*l2) | group (${partsupp1}.(${lineitem1}.*l2.l_partkey) && ${cond2} && ${cond3}) & ${partsupp1}.(${lineitem1}.*l2.l_partkey).*ps2.ps_suppkey`

  let cond4 = rh`${nation1}.(${supplier}.*s1.s_nationkey) && ${nation1}.(${supplier}.*s1.s_nationkey) == ${supplier}.*s1.s_nationkey`
  let cond5 = rh`${lineitem2}.(${supplier}.*s1.s_suppkey)`

  let supplier1 = rh`{
    s_name: ${supplier}.*s1.s_name,
    s_address: ${supplier}.*s1.s_address
  } | group [(${cond4} && ${cond5}) & ${supplier}.*s1.s_name, ${supplier}.*s1.s_address]`

  let query = rh`sort ${supplier1} "s_name" 0`

  await compile(query, { ...settings, outFile: "q20" })
}

async function q21() {
  let nation1 = rh`single ${nation}.*n1.n_nationkey | group ${nation}.*n1.n_name == "SAUDI ARABIA" & ${nation}.*n1.n_nationkey`
  let supplier1 = rh`single ${supplier}.*s1.s_name | group ${nation1}.(${supplier}.*s1.s_nationkey) & ${supplier}.*s1.s_suppkey`

  let cond1 = rh`${lineitem}.*l1.l_receiptdate > ${lineitem}.*l1.l_commitdate`
  let lineitem1 = rh`[{
    s_name: ${supplier1}.(${lineitem}.*l1.l_suppkey),
    l_suppkey: ${lineitem}.*l1.l_suppkey
  }] | group ${supplier1}.(${lineitem}.*l1.l_suppkey) && ${cond1} & ${lineitem}.*l1.l_orderkey`

  let lineitem2 = rh`[${lineitem}.*l1.l_suppkey] | group ${lineitem}.*l1.l_orderkey`

  let cond2 = rh`${lineitem}.*l1.l_receiptdate > ${lineitem}.*l1.l_commitdate`
  let lineitem3 = rh`[${cond2} & ${lineitem}.*l1.l_suppkey] | group ${lineitem}.*l1.l_orderkey`

  let condL2 = rh`${lineitem2}.(${orders}.*o1.o_orderkey).*l5 != ${lineitem1}.(${orders}.*o1.o_orderkey).*l4.l_suppkey`
  let condL3 = rh`${lineitem3}.(${orders}.*o1.o_orderkey).*l6 != ${lineitem1}.(${orders}.*o1.o_orderkey).*l4.l_suppkey`

  let count = rh`{
    countL2: count (${condL2} & ${orders}.*o1),
    countL3: count (${condL3} & ${orders}.*o1)
  } | group ${orders}.*o1.o_orderstatus == 70 & ${orders}.*o1.o_orderkey`

  let cond = rh`${count}.(${orders}.*o2.o_orderkey) && ${count}.(${orders}.*o2.o_orderkey).countL2 != 0 && ${count}.(${orders}.*o2.o_orderkey).countL3 == 0`
  let orders2 = rh`{
    s_name: single (${lineitem1}.(${orders}.*o2.o_orderkey).*l7.s_name),
    numwait: count (${orders}.*o2.o_orderkey)
  } | group (${orders}.*o2.o_orderstatus == 70 && ${cond} && ${lineitem1}.(${orders}.*o2.o_orderkey)) & ${lineitem1}.(${orders}.*o2.o_orderkey).*l7.s_name`

  let query = rh`sort ${orders2} "numwait" 1 "s_name" 0`

  await compile(query, { ...settings, outFile: "q21", limit: 100 })
}

async function q22() {
  let cond1 = rh`${customer}.*c1.c_acctbal > 0`
  let cond2 = rh`(substr ${customer}.*c1.c_phone 0 2) == "13" || (substr ${customer}.*c1.c_phone 0 2) == "31" ||
                 (substr ${customer}.*c1.c_phone 0 2) == "23" || (substr ${customer}.*c1.c_phone 0 2) == "29" ||
                 (substr ${customer}.*c1.c_phone 0 2) == "30" || (substr ${customer}.*c1.c_phone 0 2) == "18" ||
                 (substr ${customer}.*c1.c_phone 0 2) == "17"`

  let cond3 = rh`${cond1} && ${cond2}`
  let customer1 = rh`(sum (${cond3} & ${customer}.*c1.c_acctbal)) / (count (${cond3} & ${customer}.*c1.c_acctbal))`

  let orders1 = rh`count ${orders}.*o1 | group ${orders}.*o1.o_custkey`

  let cond4 = rh`${customer}.*c2.c_acctbal > ${customer1}`
  let cond5 = rh`(substr ${customer}.*c2.c_phone 0 2) == "13" || (substr ${customer}.*c2.c_phone 0 2) == "31" ||
                  (substr ${customer}.*c2.c_phone 0 2) == "23" || (substr ${customer}.*c2.c_phone 0 2) == "29" ||
                  (substr ${customer}.*c2.c_phone 0 2) == "30" || (substr ${customer}.*c2.c_phone 0 2) == "18" ||
                  (substr ${customer}.*c2.c_phone 0 2) == "17"`

  let cond6 = rh`(isUndef ${orders1}.(${customer}.*c2.c_custkey)) && ${cond4} && ${cond5}`
  let customer2 = rh`{
    cntrycode: single (substr ${customer}.*c2.c_phone 0 2),
    count_order: count? ${customer}.*c2,
    totalacctbal: sum? ${customer}.*c2.c_acctbal
  } | group (${cond6} & (substr ${customer}.*c2.c_phone 0 2))`

  let query = rh`sort ${customer2} "cntrycode" 0`

  await compile(query, { ...settings, outFile: "q22" })
}

q1()
q2()
q3()
q4()
q5()
q6()
q7()
q8()
q9()
q10()
q11()
q12()
q13()
q14()
q15()
q16()
q17()
q18()
q19()
q20()
q21()
q22()
