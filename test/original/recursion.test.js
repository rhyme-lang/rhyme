const { api } = require('../../src/rhyme')
const { rh } = require('../../src/parser')

// some sample data for testing
let data = [
    { key: "A", value: 10 },
    { key: "B", value: 20 },
    { key: "A", value: 30 }
]

test("fact1", () => {

    // n * fact(n-1)

    let arg = n => ({ data: { n }, udf: ".udf"})
    let query = rh`data.n * (udf.func ${arg("data.n - 1")})`

    let func = api.compile(query)
    let f2 = x => x.data.n ? func(x) : 1 // external stopping condition

    let input = {
        data: { n: 4 },
        udf: { func: f2 }
    }

    let res = func(input)

    expect(res).toEqual(24)
})


test("fact2", () => {

    // use && and || to guard effects:

    // (n * fact(n != 0 && n-1)) || 1

    let arg = n => ({ data: { n }, udf: ".udf"})
    let query = rh`udf.orElse (data.n * (udf.func (udf.andAlso (udf.ne data.n 0) ${arg("data.n - 1")}))) 1`

    let udf = {
        andAlso: (a,b) => a && b,
        orElse: (a,b) => a || b,
        ne: (a,b) => a != b,
    }

    let func = api.compile(query)
    let f2 = x => x && func(x)

    let input = {
        data: { n: 4 },
        udf: { func: f2, ...udf }
    }

    let res = func(input)

    expect(res).toEqual(24)
})
