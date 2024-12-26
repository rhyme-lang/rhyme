const { api } = require('../../src/rhyme')
const { rh } = require('../../src/parser')

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

function order(as) {
    let idx = as.map((x,i)=>i)
    return idx.sort((ix,iy) => as[ix]-as[iy])
}

let udf = { order }

function sorted(as) {
    let permutation = api.apply("udf.order", [as])
    return api.get(permutation,"*S")
    // XXX: needs to be a fresh sym? not quite, should be specific
    // enough so that sorted(as) can be CSE'd for repeated as
    // (but what about context -- i.e. one in group, other total?)
    // XXX: should work with modified semantics of *!
}


test("plainSortTest1", () => {
    let permutation = api.apply("udf.order", ["countryData.*.population"])
    let query = [rh`countryData.(${permutation}.*S).city`]

    let res = api.compile(query)({ countryData, udf })
    let expected = ["Paris", "London", "Beijing", "Tokyo"]
    expect(res).toEqual(expected)
})


test("plainSortTest2", () => {
    let query = [rh`countryData.${sorted("countryData.*.population")}.city`]

    let func = api.compile(query)
    let res = func({ countryData, udf })
    let expected = ["Paris", "London", "Beijing", "Tokyo"]
    expect(res).toEqual(expected)
})

test("plainSortTest3", () => {
    let sp = sorted("countryData.*D.population")
    let query = api.group(rh`countryData.${sp}.population`, rh`countryData.${sp}.city`)

    let func = api.compile(query)
    let res = func({ countryData, udf })
    let expected = [["Paris",10], ["London",10], ["Beijing",20], ["Tokyo",30]]
    expect(Object.entries(res)).toEqual(expected) // order matters!
})

