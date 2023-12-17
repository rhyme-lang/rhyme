const { api } = require('../src/rhyme')
const { rh } = require('../src/parser')

// some sample data for testing
let data = [
    { key: "A", value: 10 },
    { key: "B", value: 20 },
    { key: "A", value: 30 }
]

let countryData = [
    { region: "Asia", country: "Japan", city: "Tokyo", population: 30 },
    { region: "Asia", country: "China", city: "Beijing", population: 20 },
    { region: "Europe", country: "France", city: "Paris", population: 10 },
    { region: "Europe", country: "UK", city: "London", population: 10 },
]

let regionData = [
    { region: "Asia", country: "Japan" },
    { region: "Asia", country: "China" },
    { region: "Europe", country: "France" },
    { region: "Europe", country: "UK" },
]

test("plainSortTest1", () => {
    function order(as) {
        let idx = as.map((x,i)=>i)
        return idx.sort((ix,iy) => as[ix]-as[iy])
    }
    let udf = { order }
    let permutation = api.apply("udf.order", ["countryData.*.population"])
    let query = [rh`countryData[${permutation}.*S].city`]
    let res = api.compile(query)({ countryData, udf })
    let expected = ["Paris", "London", "Beijing", "Tokyo"]
    expect(res).toEqual(expected)
})

test("plainSortTest2", () => {
    function order(as) {
        let idx = as.map((x,i)=>i)
        return idx.sort((ix,iy) => as[ix]-as[iy])
    }
    let udf = { order }

    function sorted(as) {
        let permutation = api.apply("udf.order", [as])
        return api.get(permutation,"*S") // XXX: needs to be a fresh sym!
    }

    let query = [rh`countryData[${sorted("countryData.*.population")}].city`]

    let res = api.compile(query)({ countryData, udf })
    let expected = ["Paris", "London", "Beijing", "Tokyo"]
    expect(res).toEqual(expected)
})

