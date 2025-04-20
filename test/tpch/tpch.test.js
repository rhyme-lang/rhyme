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

test("q7", async () => {
  let query = rh`[{
    n_name: ${nation}.*n1.n_name,
    n_nationkey: ${nation}.*n1.n_nationkey
  }]`

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q7", schema: types.never })
  let res = await func()

  console.log(res)
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

  let func = await compile(query, { backend: "c-sql-new", outDir, outFile: "q10", schema: types.never, limit: 20 })
  let res = await func()

  expect(res).toBe(`57040|Customer#000057040|734235.2455|632.8700|JAPAN|Eioyzjf4pp|22-895-641-3466|sits. slyly regular requests sleep alongside of the regular inst|
143347|Customer#000143347|721002.6948|2557.4700|EGYPT|1aReFYv,Kw4|14-742-935-3718|ggle carefully enticing requests. final deposits use bold, bold pinto beans. ironic, idle re|
60838|Customer#000060838|679127.3077|2454.7700|BRAZIL|64EaJ5vMAHWJlBOxJklpNc2RJiWE|12-913-494-9813| need to boost against the slyly regular account|
101998|Customer#000101998|637029.5667|3790.8900|UNITED KINGDOM|01c9CILnNtfOQYmZj|33-593-865-6378|ress foxes wake slyly after the bold excuses. ironic platelets are furiously carefully bold theodolites|
125341|Customer#000125341|633508.0860|4983.5100|GERMANY|S29ODD6bceU8QSuuEJznkNaK|17-582-695-5962|arefully even depths. blithely even excuses sleep furiously. foxes use except the dependencies. ca|
25501|Customer#000025501|620269.7849|7725.0400|ETHIOPIA|  W556MXuoiaYCCZamJI,Rn0B4ACUGdkQ8DZ|15-874-808-6793|he pending instructions wake carefully at the pinto beans. regular, final instructions along the slyly fina|
115831|Customer#000115831|596423.8672|5098.1000|FRANCE|rFeBbEEyk dl ne7zV5fDrmiq1oK09wV7pxqCgIc|16-715-386-3788|l somas sleep. furiously final deposits wake blithely regular pinto b|
84223|Customer#000084223|594998.0239|528.6500|UNITED KINGDOM|nAVZCs6BaWap rrM27N 2qBnzc5WBauxbA|33-442-824-8191| slyly final deposits haggle regular, pending dependencies. pending escapades wake |
54289|Customer#000054289|585603.3918|5583.0200|IRAN|vXCxoCsU0Bad5JQI ,oobkZ|20-834-292-4707|ely special foxes are quickly finally ironic p|
39922|Customer#000039922|584878.1134|7321.1100|GERMANY|Zgy4s50l2GKN4pLDPBU8m342gIw6R|17-147-757-8036|y final requests. furiously final foxes cajole blithely special platelets. f|
6226|Customer#000006226|576783.7606|2230.0900|UNITED KINGDOM|8gPu8,NPGkfyQQ0hcIYUGPIBWc,ybP5g,|33-657-701-3391|ending platelets along the express deposits cajole carefully final |
922|Customer#000000922|576767.5333|3869.2500|GERMANY|Az9RFaut7NkPnc5zSD2PwHgVwr4jRzq|17-945-916-9648|luffily fluffy deposits. packages c|
147946|Customer#000147946|576455.1320|2030.1300|ALGERIA|iANyZHjqhyy7Ajah0pTrYyhJ|10-886-956-3143|ithely ironic deposits haggle blithely ironic requests. quickly regu|
115640|Customer#000115640|569341.1933|6436.1000|ARGENTINA|Vtgfia9qI 7EpHgecU1X|11-411-543-4901|ost slyly along the patterns; pinto be|
73606|Customer#000073606|568656.8578|1785.6700|JAPAN|xuR0Tro5yChDfOCrjkd2ol|22-437-653-6966|he furiously regular ideas. slowly|
110246|Customer#000110246|566842.9815|7763.3500|VIETNAM|7KzflgX MDOq7sOkI|31-943-426-9837|egular deposits serve blithely above the fl|
142549|Customer#000142549|563537.2368|5085.9900|INDONESIA|ChqEoK43OysjdHbtKCp6dKqjNyvvi9|19-955-562-2398|sleep pending courts. ironic deposits against the carefully unusual platelets cajole carefully express accounts.|
146149|Customer#000146149|557254.9865|1791.5500|ROMANIA|s87fvzFQpU|29-744-164-6487| of the slyly silent accounts. quickly final accounts across the |
52528|Customer#000052528|556397.3509|551.7900|ARGENTINA|NFztyTOR10UOJ|11-208-192-3205| deposits hinder. blithely pending asymptotes breach slyly regular re|
23431|Customer#000023431|554269.5360|3381.8600|ROMANIA|HgiV0phqhaIa9aydNoIlb|29-915-458-2654|nusual, even instructions: furiously stealthy n|
`)
})
