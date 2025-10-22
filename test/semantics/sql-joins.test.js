const { rh } = require("../../src/rhyme")
const { compile } = require("../../src/simple-eval")

let orders = [
  { id: 1, description: "order1", customerID: 1 },
  { id: 2, description: "order2", customerID: 3 },
  { id: 3, description: "order3", customerID: 1 },
  { id: 4, description: "order4", customerID: 5 },
  { id: 5, description: "order5", customerID: 3 },
  { id: 6, description: "order6", customerID: 100 }
]
let customers = [
  { id: 1, name: "customer1" },
  { id: 2, name: "customer2" },
  { id: 3, name: "customer3" },
  { id: 4, name: "customer4" },
  { id: 5, name: "customer5" }
]

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

test("innerJoin1", () => {
  let phase1 = rh`{
    orders.*o1.customerID: [{
      id: orders.*o1.id,
      description: orders.*o1.description
    }]
  }`
  let phase2 = rh`[{
    custID: customers.*c.id,
    name: customers.*c.name,
    orderID: ${phase1}.(customers.*c.id).*o2.id,
    orderDesc: ${phase1}.(customers.*c.id).*o2.description
  }]`

  let func = compile(phase2)
  let res = func({ orders, customers })

  expect(res).toEqual(innerJoinExpected)
})

test("innerJoin2", () => {
  let ordersMap = rh`{
    orders.*o1.customerID: [{
      id: orders.*o1.id,
      description: orders.*o1.description
    }]
  }`

  let customersMap = rh`{
    customers.*c1.id: [{
      id: customers.*c1.id,
      name: customers.*c1.name
    }]
  }`

  let phase2 = rh`[{
    custID: (${customersMap}.*A || .customerDefault).*.id,
    name: (${customersMap}.*A || .customerDefault).*.name,
    orderID: (${ordersMap}.*A || .orderDefault).*.id,
    orderDesc: (${ordersMap}.*A || .orderDefault).*.description
  }]`

  let func = compile(phase2)
  let res = func({
    orders,
    customers,
    orderDefault: [{ id: null, description: null }],
    customerDefault: [{ id: null, name: null }]
  })

  expect(res).toEqual(innerJoinExpected)
})

test("leftJoin1", () => {
  let phase1 = rh`{
    orders.*o1.customerID: [{
      id: orders.*o1.id,
      description: orders.*o1.description
    }]
  }`
  let phase2 = rh`[{
    custID: customers.*c.id,
    name: customers.*c.name,
    orderID: (${phase1}.(customers.*c.id) || .orderDefault).*o2.id,
    orderDesc: (${phase1}.(customers.*c.id) || .orderDefault).*o2.description
  }]`

  let func = compile(phase2)
  let res = func({
    orders,
    customers,
    orderDefault: [{ id: null, description: null }]
  })

  expect(res).toEqual(leftJoinExpected)
})

test("leftJoin2", () => {
  let ordersMap = rh`{
    orders.*o1.customerID: [{
      id: orders.*o1.id,
      description: orders.*o1.description
    }]
  }`

  let customersMap = rh`{
    customers.*c1.id: [{
      id: customers.*c1.id,
      name: customers.*c1.name
    }]
  }`

  let phase2 = rh`[{
    custID: (${customersMap}.*A || .customerDefault).*.id,
    name: (${customersMap}.*A || .customerDefault).*.name,
    orderID: (${ordersMap}.*A? || .orderDefault).*.id,
    orderDesc: (${ordersMap}.*A? || .orderDefault).*.description
  }]`

  let func = compile(phase2)
  let res = func({
    orders,
    customers,
    orderDefault: [{ id: null, description: null }],
    customerDefault: [{ id: null, name: null }]
  })

  expect(res).toEqual(leftJoinExpected)
})

test("leftJoinAlter", () => {
  let phase1 = rh`{
    orders.*o1.customerID: [{
      id: orders.*o1.id,
      description: orders.*o1.description
    }]
  }`
  let phase2 = rh`[{
    custID: customers.*c.id,
    name: customers.*c.name,
    order: ${phase1}.(customers.*c.id) || .null
  }]`

  let func = compile(phase2)
  let res = func({
    orders,
    customers,
    null: null
  })
})

test("fullOuterJoin1", () => {
  // Manually build the projection
  let phase1 = rh`{
    orders.*o1.customerID: single orders.*o1.customerID,
    customers.*c1.id: single customers.*c1.id
  }`

  let ordersMap = rh`{
    orders.*o1.customerID: [{
      id: orders.*o1.id,
      description: orders.*o1.description
    }]
  }`

  let customersMap = rh`{
    customers.*c1.id: [{
      id: customers.*c1.id,
      name: customers.*c1.name
    }]
  }`

  let phase2 = rh`[{
    custID: (${customersMap}.(${phase1}.*) || .customerDefault).*.id,
    name: (${customersMap}.(${phase1}.*) || .customerDefault).*.name,
    orderID: (${ordersMap}.(${phase1}.*) || .orderDefault).*.id,
    orderDesc: (${ordersMap}.(${phase1}.*) || .orderDefault).*.description
  }]`

  let func = compile(phase2)
  let res = func({
    orders,
    customers,
    orderDefault: [{ id: null, description: null }],
    customerDefault: [{ id: null, name: null }],
  })

  expect(res).toEqual(fullOuterJoinExpected)
})

test("fullOuterJoin2", () => {
  let ordersMap = rh`{
    orders.*o1.customerID: [{
      id: orders.*o1.id,
      description: orders.*o1.description
    }]
  }`

  let customersMap = rh`{
    customers.*c1.id: [{
      id: customers.*c1.id,
      name: customers.*c1.name
    }]
  }`

  let phase2 = rh`[{
    custID: (${customersMap}.*A? || .customerDefault).*.id,
    name: (${customersMap}.*A? || .customerDefault).*.name,
    orderID: (${ordersMap}.*A? || .orderDefault).*.id,
    orderDesc: (${ordersMap}.*A? || .orderDefault).*.description
  }]`

  let func = compile(phase2)
  let res = func({
    orders,
    customers,
    orderDefault: [{ id: null, description: null }],
    customerDefault: [{ id: null, name: null }]
  })

  expect(res).toEqual(fullOuterJoinExpected)
})

test("leftJoinIncorrect", () => {
  let phase1 = rh`{
    orders.*o1.customerID: [{
      id: orders.*o1.id,
      description: orders.*o1.description
    }]
  }`
  // Incorrect, still an inner join
  let phase2 = rh`[{
    custID: customers.*c.id,
    name: customers.*c.name,
    orderID: ${phase1}.(customers.*c.id).*o2.id || .null,
    orderDesc: ${phase1}.(customers.*c.id).*o2.description || .null
  }]`

  let func = compile(phase2)
  let res = func({
    orders,
    customers,
    null: null
  })

  expect(res).toEqual(innerJoinExpected)
})
