const { rh } = require("../../src/rhyme")
const { compile } = require("../../src/simple-eval")
const { compileC2CrossCheck } = require("../utils")

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
  { custID: 1, custName: 'customer1', orderID: 1, orderDesc: 'order1' },
  { custID: 1, custName: 'customer1', orderID: 3, orderDesc: 'order3' },
  { custID: 3, custName: 'customer3', orderID: 2, orderDesc: 'order2' },
  { custID: 3, custName: 'customer3', orderID: 5, orderDesc: 'order5' },
  { custID: 5, custName: 'customer5', orderID: 4, orderDesc: 'order4' }
]
let leftJoinExpected = [
  { custID: 1, custName: 'customer1', orderID: 1, orderDesc: 'order1' },
  { custID: 1, custName: 'customer1', orderID: 3, orderDesc: 'order3' },
  { custID: 2, custName: 'customer2', orderID: null, orderDesc: null },
  { custID: 3, custName: 'customer3', orderID: 2, orderDesc: 'order2' },
  { custID: 3, custName: 'customer3', orderID: 5, orderDesc: 'order5' },
  { custID: 4, custName: 'customer4', orderID: null, orderDesc: null },
  { custID: 5, custName: 'customer5', orderID: 4, orderDesc: 'order4' }
]
let fullOuterJoinExpected = [
  { custID: 1, custName: 'customer1', orderID: 1, orderDesc: 'order1' },
  { custID: 1, custName: 'customer1', orderID: 3, orderDesc: 'order3' },
  { custID: 2, custName: 'customer2', orderID: null, orderDesc: null },
  { custID: 3, custName: 'customer3', orderID: 2, orderDesc: 'order2' },
  { custID: 3, custName: 'customer3', orderID: 5, orderDesc: 'order5' },
  { custID: 4, custName: 'customer4', orderID: null, orderDesc: null },
  { custID: 5, custName: 'customer5', orderID: 4, orderDesc: 'order4' },
  { custID: null, custName: null, orderID: 6, orderDesc: 'order6' }
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
    custName: customers.*c.name,
    orderID: ${phase1}.(customers.*c.id).*o2.id,
    orderDesc: ${phase1}.(customers.*c.id).*o2.description
  }]`

  let func = compileC2CrossCheck(phase2)
  let res = func({ orders, customers })

  expect(res).toEqual(innerJoinExpected)
})

test("innerJoin2", () => {
  // NOTE: the result field is 'custName', not 'name'. A constant object key is
  // desugared to a grouping variable via mkset, and canonicalVarName hashes the
  // mkset node, so every literal "name" shares one variable K. With 'name'
  // inside customersMap's records and a result field 'name' around it, the
  // nested K reads as correlated with the outer one and customersMap gets
  // recomputed indexed by "name". Same in the tests below.
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
    custName: (${customersMap}.*A || .customerDefault).*.name,
    orderID: (${ordersMap}.*A || .orderDefault).*.id,
    orderDesc: (${ordersMap}.*A || .orderDefault).*.description
  }]`

  let func = compileC2CrossCheck(phase2)
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
    custName: customers.*c.name,
    orderID: (${phase1}.(customers.*c.id) || .orderDefault).*o2.id,
    orderDesc: (${phase1}.(customers.*c.id) || .orderDefault).*o2.description
  }]`

  let func = compileC2CrossCheck(phase2)
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
    custName: (${customersMap}.*A || .customerDefault).*.name,
    orderID: (${ordersMap}.*A? || .orderDefault).*.id,
    orderDesc: (${ordersMap}.*A? || .orderDefault).*.description
  }]`

  let func = compileC2CrossCheck(phase2)
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
    custName: customers.*c.name,
    order: ${phase1}.(customers.*c.id) || .null
  }]`

  let func = compileC2CrossCheck(phase2)
  let res = func({
    orders,
    customers,
    null: null
  })
})

test("leftJoinAggregate", () => {
  let ordersMap = rh`{
    orders.*o1.customerID: [{
      id: orders.*o1.id
    }]
  }`

  let customersMap = rh`{
    customers.*c1.id: [{
      id: customers.*c1.id
    }]
  }`

  // Aggregate over the optional side, grouped by a key taken from the total
  // side. The group key puts the outer-joined variable in the assignment's
  // 'fre', so this covers the initialization loop as well as the update one --
  // a left join that only collects values does not.
  let phase2 = rh`{
    (${customersMap}.*A).*.id: count((${ordersMap}.*A? || .orderDefault).*.id)
  }`

  let func = compileC2CrossCheck(phase2)
  let res = func({
    orders,
    customers,
    orderDefault: [{ id: null }]
  })

  // customers 2 and 4 have no orders, so they count the single default row
  expect(res).toEqual({ 1: 2, 2: 1, 3: 2, 4: 1, 5: 1 })
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
    custName: (${customersMap}.(${phase1}.*) || .customerDefault).*.name,
    orderID: (${ordersMap}.(${phase1}.*) || .orderDefault).*.id,
    orderDesc: (${ordersMap}.(${phase1}.*) || .orderDefault).*.description
  }]`

  let func = compileC2CrossCheck(phase2)
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
    custName: (${customersMap}.*A? || .customerDefault).*.name,
    orderID: (${ordersMap}.*A? || .orderDefault).*.id,
    orderDesc: (${ordersMap}.*A? || .orderDefault).*.description
  }]`

  // Needs mkTuple, which is off by default. Desugaring these record literals
  // into update chains produces temporaries the filter-ordering solver cannot
  // schedule -- it reports "no suitable generator for variable *A" and then
  // emits a duplicate `let gen13`. The outer-join disjunction is what makes
  // this query, alone in the file, sensitive to the difference.
  //
  // Every generator of *A here is 'maybe'. (newCodegen could not express this
  // union domain and would drop the three outer rows; opt-loopgen handles it.)
  let func = compileC2CrossCheck(phase2, { mkTuple: true })
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
    custName: customers.*c.name,
    orderID: ${phase1}.(customers.*c.id).*o2.id || .null,
    orderDesc: ${phase1}.(customers.*c.id).*o2.description || .null
  }]`

  let func = compileC2CrossCheck(phase2)
  let res = func({
    orders,
    customers,
    null: null
  })

  expect(res).toEqual(innerJoinExpected)
})

// A maybe generator (data.*B.m.*A?) of a variable that also has a strict one
// does not produce its values, so it must not make *A depend on *B: sum(other.*A)
// would otherwise iterate over *B too, and see nothing when data is empty.
test("leftJoinNoDependency", () => {
  let query = rh`{ t: sum(other.*A), w: array(data.*B.m.*A?) }`
  let func = compileC2CrossCheck(query)
  let other = { a: 1, b: 2 }

  expect(func({ other, data: {} })).toEqual({ t: 3, w: [] })
  expect(func({ other, data: { x: { m: { a: 10 } }, y: { m: {} } } })).toEqual({ t: 3, w: [10] })
  expect(func.explain2.ir.vars["*A"].vars).toEqual([])
  console.log(func.explain2.code)
})

// The maybe generator still reads a temp (the group), which the assignment
// using it must wait for -- through its own tmps, not *A's dependencies.
test("leftJoinOnTemp", () => {
  let query = rh`{ t: sum(other.*A), w: array({ data.*B.k: data.*B.v }.x.*A?) }`
  let input = { other: { a: 1, b: 2 }, data: { r1: { k: "x", v: { a: 10 } } } }
  let expected = { t: 3, w: [10] }

  expect(compileC2CrossCheck(query)(input)).toEqual(expected)
  expect(compile(query, { extractAssignmentsLate: true })(input)).toEqual(expected)
})

// sum(x.*A) binds only *A, but *A's generator y.*B.*A depends on *B, whose
// generator reads the group temp: the sum must be scheduled after the group,
// through the transitive var dependencies (not just its own fre/bnd vars).
// The explicit single binds *X inside the group (a bare data.*X.v would leak *X
// into the group's dims and make *B depend on it), so *B depends on nothing.
test("transitiveTempDependency", () => {
  let query = rh`{ w: array(y.*B.*A + { data.*X.k: single data.*X.v }.*B), s: sum(x.*A) }`
  let input = { x: { a: 1, b: 2 }, y: { p: { a: 10 }, q: { b: 20 } }, data: { r: { k: "p", v: 100 } } }
  let expected = { w: [110], s: 1 }

  console.log(compileC2CrossCheck(query).explain2.code)

  expect(compileC2CrossCheck(query)(input)).toEqual(expected)
  expect(compile(query, { extractAssignmentsLate: true })(input)).toEqual(expected)
})
