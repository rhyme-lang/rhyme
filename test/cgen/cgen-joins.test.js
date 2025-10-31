const { api, rh } = require('../../src/rhyme')
const { compile } = require('../../src/simple-eval')
const { typing, types } = require('../../src/typing')

const os = require('child_process')

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

let outDir = "cgen-sql/out/joins"

beforeAll(async () => {
  await sh(`rm -rf ${outDir}`)
  await sh(`mkdir -p ${outDir}`)
  await sh(`cp cgen-sql/yyjson.h ${outDir}`)
})

let customerSchema = typing.parseType("{*u32: {id: i16, name: string}}")
let ordersSchema = typing.parseType("{*u32: {id: i16, item: string, customerId: i16}}")
let dummySchema = typing.parseType("{*u32: u32}")

let customers = rh`loadJSON "./cgen-sql/json/joins/customers.json" ${customerSchema}`
let orders = rh`loadJSON "./cgen-sql/json/joins/orders.json" ${ordersSchema}`
let dummy = rh`loadJSON "./cgen-sql/json/joins/dummy.json" ${dummySchema}`

  let innerJoinExpected = [
  { custId: 1, name: 'customer1', orderId: 1, orderitem: 'order1' },
  { custId: 1, name: 'customer1', orderId: 3, orderitem: 'order3' },
  { custId: 3, name: 'customer3', orderId: 2, orderitem: 'order2' },
  { custId: 3, name: 'customer3', orderId: 5, orderitem: 'order5' },
  { custId: 5, name: 'customer5', orderId: 4, orderitem: 'order4' }
]
let leftJoinExpected = [
  { custId: 1, name: 'customer1', orderId: 1, orderitem: 'order1' },
  { custId: 1, name: 'customer1', orderId: 3, orderitem: 'order3' },
  { custId: 2, name: 'customer2', orderId: 0, orderitem: "null" },
  { custId: 3, name: 'customer3', orderId: 2, orderitem: 'order2' },
  { custId: 3, name: 'customer3', orderId: 5, orderitem: 'order5' },
  { custId: 4, name: 'customer4', orderId: 0, orderitem: "null" },
  { custId: 5, name: 'customer5', orderId: 4, orderitem: 'order4' }
]
let fullOuterJoinExpected = [
  { custId: 1, name: 'customer1', orderId: 1, orderitem: 'order1' },
  { custId: 1, name: 'customer1', orderId: 3, orderitem: 'order3' },
  { custId: 2, name: 'customer2', orderId: 0, orderitem: "null" },
  { custId: 3, name: 'customer3', orderId: 2, orderitem: 'order2' },
  { custId: 3, name: 'customer3', orderId: 5, orderitem: 'order5' },
  { custId: 4, name: 'customer4', orderId: 0, orderitem: "null" },
  { custId: 5, name: 'customer5', orderId: 4, orderitem: 'order4' },
  { custId: 0, name: "null", orderId: 6, orderitem: 'order6' }
]

test("innerJoin1", async () => {
  let phase1 = rh`{
    ${orders}.*o1.customerId: [{
      id: ${orders}.*o1.id,
      item: ${orders}.*o1.item
    }]
  }`
  let phase2 = rh`[{
    custId: ${customers}.*c.id,
    name: ${customers}.*c.name,
    orderId: ${phase1}.(${customers}.*c.id).*o2.id,
    orderitem: ${phase1}.(${customers}.*c.id).*o2.item
  }]`

  let func = await compile(phase2, { backend: "c-new", outDir, outFile: "innerJoin1" })
  let res = await func()

  expect(JSON.parse(res)).toEqual(innerJoinExpected)
})

test("leftOuterJoin", async () => {
  let orderDefault = rh`[{ id: 0, item: "null" }]`

  let phase1 = rh`{
    ${orders}.*o1.customerId: [{
      id: ${orders}.*o1.id,
      item: ${orders}.*o1.item
    }]
  }`
  let phase2 = rh`[{
    custId: ${customers}.*c.id,
    name: ${customers}.*c.name,
    orderId: (${phase1}.(${customers}.*c.id) || ${orderDefault}).*o2.id,
    orderitem: (${phase1}.(${customers}.*c.id) || ${orderDefault}).*o2.item
  }]`

  let func = await compile(phase2, { backend: "c-new", outDir, outFile: "leftOuterJoin", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual(leftJoinExpected)
})

test("fullOuterJoin", async () => {
  let customerDefault = rh`[{ id: 0, name: "null" }]`
  let orderDefault = rh`[{ id: 0, item: "null" }]`

  let phase1 = rh`{
    ${customers}.*c1.id: single ${customers}.*c1.id,
    ${orders}.*o1.customerId: single ${orders}.*o1.customerId
  }`

  let ordersMap = rh`{
    ${orders}.*o1.customerId: [{
      id: ${orders}.*o1.id,
      item: ${orders}.*o1.item
    }]
  }`

  let customersMap = rh`{
    ${customers}.*c1.id: [{
      id: ${customers}.*c1.id,
      name: ${customers}.*c1.name
    }]
  }`

  let phase2 = rh`[{
    custId: (${customersMap}.(${phase1}.*) || ${customerDefault}).*.id,
    name: (${customersMap}.(${phase1}.*) || ${customerDefault}).*.name,
    orderId: (${ordersMap}.(${phase1}.*) || ${orderDefault}).*.id,
    orderitem: (${ordersMap}.(${phase1}.*) || ${orderDefault}).*.item
  }]`

  let func = await compile(phase2, { backend: "c-new", outDir, outFile: "fullOuterJoin", enableOptimizations: false })
  let res = await func()

  expect(JSON.parse(res)).toEqual(fullOuterJoinExpected)
})
