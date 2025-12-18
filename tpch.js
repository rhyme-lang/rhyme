const { rh, api } = require('./src/rhyme')
const { compile } = require('./src/simple-eval')
const { typing, types } = require('./src/typing')

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
  } | group [${cond} & ${lineitem}.*.l_returnflag, ${cond} & ${lineitem}.*.l_linestatus]`

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

  let func = await compile(query, { ...settings, outFile: "q1" })
  let res = await func()

  console.log(res)
}

q1()