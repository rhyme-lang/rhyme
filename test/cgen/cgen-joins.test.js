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

let customerSchema = typing.parseType("{*u32: {id: u32, name: string}}")
let ordersSchema = typing.parseType("{*u32: {id: u32, description: string, customerID: u32}}")
let dummySchema = types.u32

let customers = rh`loadJSON "./cgen-sql/json/joins/customers.json" ${customerSchema}`
let orders = rh`loadJSON "./cgen-sql/json/joins/orders.json" ${ordersSchema}`
let dummy = rh`loadJSON "./cgen-sql/json/joins/dummy.json" ${dummySchema}`

let innerJoinExpected = [
  { custID: 1, name: 'customer1', orderID: 1, orderDesc: 'order1' },
  { custID: 1, name: 'customer1', orderID: 3, orderDesc: 'order3' },
  { custID: 3, name: 'customer3', orderID: 2, orderDesc: 'order2' },
  { custID: 3, name: 'customer3', orderID: 5, orderDesc: 'order5' },
  { custID: 5, name: 'customer5', orderID: 4, orderDesc: 'order4' }
]
let leftJoinExpected = [
  { custID: 1, name: 'customer1', orderID: 1, orderDesc: 'order1' },
  { custID: 1, name: 'customer1', orderID: 3, orderDesc: 'order3' },
  { custID: 2, name: 'customer2', orderID: null, orderDesc: null },
  { custID: 3, name: 'customer3', orderID: 2, orderDesc: 'order2' },
  { custID: 3, name: 'customer3', orderID: 5, orderDesc: 'order5' },
  { custID: 4, name: 'customer4', orderID: null, orderDesc: null },
  { custID: 5, name: 'customer5', orderID: 4, orderDesc: 'order4' }
]
let fullOuterJoinExpected = [
  { custID: 1, name: 'customer1', orderID: 1, orderDesc: 'order1' },
  { custID: 1, name: 'customer1', orderID: 3, orderDesc: 'order3' },
  { custID: 2, name: 'customer2', orderID: null, orderDesc: null },
  { custID: 3, name: 'customer3', orderID: 2, orderDesc: 'order2' },
  { custID: 3, name: 'customer3', orderID: 5, orderDesc: 'order5' },
  { custID: 4, name: 'customer4', orderID: null, orderDesc: null },
  { custID: 5, name: 'customer5', orderID: 4, orderDesc: 'order4' },
  { custID: null, name: null, orderID: 6, orderDesc: 'order6' }
]

test("innerJoin1", async () => {
  let phase1 = rh`{
    ${orders}.*o1.customerID: [{
      id: ${orders}.*o1.id,
      description: ${orders}.*o1.description
    }]
  }`
  let phase2 = rh`[{
    custID: ${customers}.*c.id,
    name: ${customers}.*c.name,
    orderID: ${phase1}.(${customers}.*c.id).*o2.id,
    orderDesc: ${phase1}.(${customers}.*c.id).*o2.description
  }]`

  let func = await compile(phase2, { backend: "c-new", outDir, outFile: "innerJoin1" })
  let res = await func()

  expect(JSON.parse(res)).toEqual(innerJoinExpected)
})

test("tmp", async () => {
  let dummy = rh`[0]`
  let orderDefault = rh`{
    id: ${dummy}.*,
    description: "null"
  } | group ${dummy}.*`

  let func = await compile(orderDefault, { backend: "c-new", outDir, outFile: "tmp", enableOptimizations: false })
  let res = await func()

  console.log(JSON.parse(res))
})
