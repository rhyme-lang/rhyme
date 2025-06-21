const { api } = require('../../src/rhyme')
const { rh } = require('../../src/parser')
const { typing, types, props, typeSyms } = require("../../src/typing");

let dataSchema = typing.parseType`{
    u32?: {
        key: A | B,
        value: f64
    }
}`;

let otherSchema = dataSchema;

let schema = {data: dataSchema};

let countrySchema = typing.parseType`{
    u32?: {
        region: string,
        country: string,
        city: string,
        population: u16
    }
}`;

let regionSchema = typing.parseType`{
    u32?: {
        region: string,
        country: string
    }
}`;

// Typing check helper function.
// Take in human-writeable schema and check its similarity to type.
let expectTypeSimilarity = (type, schema) => {
    if (schema === undefined)
        return undefined;
    if(typeof schema === "string" || typeof type === "string") {
        expect(type).toBe(schema);
        return;
    }
    if (typeof schema !== "object")
        throw new Error("Unknown type: " + schema);
    switch (schema.typeSym) {
        case undefined:
            expect(type.typeSym).toBe(typeSyms.object);
            if (Object.keys(schema).length == 0) {
                expect(type).toStrictEqual(typing.createSimpleObject({}));
                return;
            }
            let keys = [];
            for (let obj = type; obj.objParent != null; obj = obj.objParent) {
                if (typeof obj.objKey === "string")
                    keys.push(obj.objKey);
            }
            for (let key of Object.keys(schema)) {
                // TODO: Add support for checking type of key.
                if (key == "*") {
                    for (let obj = type; obj.objParent != null; obj = obj.objParent) {
                        if (typeof obj.objKey !== "string")
                            expectTypeSimilarity(obj.objValue, schema[key]);
                    }
                    continue;
                }
                if (keys.indexOf(key) == -1)
                    expect("Unable to find key " + key).toBe(false);
                keys = keys.filter(elem => elem != key);
                for (let obj = type; obj.objParent != null; obj = obj.objParent) {
                    if (obj.objKey === key)
                        expectTypeSimilarity(obj.objValue, schema[key]);
                }
            }
            expect(keys).toStrictEqual([]);
            return;
        default:
            expect(type).toBe(schema);
        // TODO: Possibly add support for union types and other types?
    }
}

test("intLitTest", () => {
    let func = api.compile(api.plus(1, 63), types.never);
    expect(func.explain2.resultType).toStrictEqual({
        type: types.i16,
        props: []
    });
})

test("plainSumTest", () => {
    let query = api.sum("data.*.value")
    let func = api.compile(query, schema)
    expect(func.explain2.resultType.type).toBe(types.f64);
})

test("plainSumTest", () => {
    let query = {"data.*A.key": api.sum("other.*A.value")};
    let func = api.compile(query, {data: dataSchema, other: otherSchema});
    let type = func.explain2.resultType.type;
    // No nothing or errors propogated.
    expect(func.explain2.resultType.props).toStrictEqual([]);
    expectTypeSimilarity(type, {
        "*": types.f64
    });
})

test("type-double-generator", () => {
    let query = api.first("other.*A.*B");
    let func = api.compile(query, {data: dataSchema, other: otherSchema});
    let type = func.explain2.resultType.type;
    // No nothing or errors propogated.
    expect(func.explain2.resultType.props).toStrictEqual([]);
    // Must be object keyed by A u B, with values of u8.
    expect(type).toStrictEqual(typing.createUnion(types.f64, typing.createUnion("A", "B")));
})

test("plainAverageTest", () => {
    let query = api.div(api.sum("data.*.value"), api.count("data.*.value"))
    let func = api.compile(query, schema)
    let type = func.explain2.resultType.type;
    expect(func.explain2.resultType.props).toStrictEqual([]);
    expect(type).toBe(types.f64);
})


test("uncorrelatedAverageTest", () => {
    let query = api.div(api.sum("data.*A.value"), api.count("data.*B.value"))
    let func = api.compile(query, schema)
    let type = func.explain2.resultType.type;
    expect(func.explain2.resultType.props).toStrictEqual([]);
    expect(type).toBe(types.f64);
})

test("groupByTest", () => {
    let query = {
        total: api.sum("data.*.value"),
        "data.*.key": api.sum("data.*.value"),
    }
    let func = api.compile(query, schema)
    let type = func.explain2.resultType.type;
    // No nothing or errors propogated.
    expect(func.explain2.resultType.props).toStrictEqual([]);
    expectTypeSimilarity(type, {
        "total": types.f64,
        "*": types.f64
    });
})

test("groupByAverageTest", () => {
    let avg = p => api.div(api.sum(p), api.count(p))
    let query = {
        total: api.sum("data.*.value"),
        "data.*.key": avg("data.*.value"),
    }
    let func = api.compile(query, schema)
    let type = func.explain2.resultType.type;
    // No nothing or errors propogated.
    expect(func.explain2.resultType.props).toStrictEqual([]);
    expectTypeSimilarity(type, {
        "total": types.f64,
        "*": types.f64
    });
})


test("groupByRelativeSum", () => {
    let query = {
        total: api.sum("data.*.value"),
        "data.*.key": api.fdiv(api.sum("data.*.value"), api.sum("data.*B.value"))
    }
    let func = api.compile(query, schema);
    let type = func.explain2.resultType.type;
    // No nothing or errors propogated.
    expect(func.explain2.resultType.props).toStrictEqual([]);
    expectTypeSimilarity(type, {
        "total": types.f64,
        "*": types.f64
    });
})

test("nestedGroupAggregateTest", () => {
    let query = {
        total: api.sum("data.*.population"),
        "data.*.region": {
            total: api.sum("data.*.population"),
            "data.*.city": api.sum("data.*.population")
        },
    }
    let func = api.compile(query, {data: countrySchema})
    let type = func.explain2.resultType.type;
    // No nothing or errors propogated.
    expect(func.explain2.resultType.props).toStrictEqual([]);
    expectTypeSimilarity(type, {
        total: types.u16,
        "*": {
            total: types.u16,
            "*": types.u16
        }
    });
})

test("joinSimpleTest1", () => {
    let q1 = {
        "other.*O.country": "other.*O.region"
    }
    let query = {
        "data.*.city": {
            country: "data.*.country",
            region: api.get(q1,"data.*.country")
        }
    }
    let func = api.compile(query, {data: countrySchema, other: regionSchema})
    let type = func.explain2.resultType.type;
    // No nothing or errors propogated.
    expect(func.explain2.resultType.props).toStrictEqual([]);
    expectTypeSimilarity(type, {
        "*": {
            country: types.string,
            region: types.string
        }
    });
})

test("joinSimpleTest1B", () => { // use explicit 'single' aggregation
    let q1 = {
        "other.*O.country": api.single("other.*O.region")
    }
    let query = {
        "data.*.city": {
            country: api.single("data.*.country"),
            region: api.single(api.get(q1,"data.*.country"))
        }
    }
    let func = api.compile(query, {data: countrySchema, other: regionSchema})
    let type = func.explain2.resultType.type;
    // No nothing or errors propogated.
    expect(func.explain2.resultType.props).toStrictEqual([]);
    expectTypeSimilarity(type, {
        "*": {
            country: types.string,
            region: types.string
        }
    });
})

test("joinSimpleTest2", () => {
    let q1 = {
        "other.*O.country": "other.*O.region"
    }
    let query = {
        "-": api.merge(api.get(q1, "data.*.country"), {
            "data.*.city": api.sum("data.*.population")
        }),
    }
    let func = api.compile(query, {data: countrySchema, other: regionSchema})
    let type = func.explain2.resultType.type;
    // No nothing or errors propogated.
    expect(func.explain2.resultType.props).toStrictEqual([]);
    expectTypeSimilarity(type, {
        "*": {
            "*": types.u16
        }
    })
})

test("joinWithAggrTest", () => {
    let q1 = {
        "other.*O.country": "other.*O.region"
    }
    let query = {
        total: api.sum("data.*.population"),
        "-": api.merge(api.get(q1, "data.*.country"), {
            total: api.sum("data.*.population"),
            "data.*.city": api.sum("data.*.population")
        }),
    }
    let func = api.compile(query, {data: countrySchema, other: regionSchema})
    let type = func.explain2.resultType.type;
    // No nothing or errors propogated.
    expect(func.explain2.resultType.props).toStrictEqual([]);
    expectTypeSimilarity(type, {
        total: types.u16,
        "*": {
            total: types.u16,
            "*": types.u16
        }
    });
})

test("udfTest", () => {
    let data = [
        { item: "iPhone", price: 1200 },
        { item: "Galaxy", price: 800 },
    ]
    let udf = {
        formatDollar: p => "$" + p + ".00"
    }
    let query = [{
        item: "data.*.item",
        price: api.apply("udf.formatDollar", "data.*.price")
    }]
    let func = api.compile(query, {
        data: {
            "-": typing.keyval(types.u32, {
                item: types.string,
                price: types.u32
            })
        },
        udf: {
            formatDollar: typing.createFunction(types.string, types.u32)
        }
    })
    let type = func.explain2.resultType.type;
    // No nothing or errors propogated.
    expect(func.explain2.resultType.props).toStrictEqual([]);
    expectTypeSimilarity(type, {
        "*": {
            item: types.string,
            price: types.string
        }
    });
})

test("arrayTest1", () => {
    let query4 = api.sum(api.sum("data.*.value"))
    let func = api.compile(query4, {data: dataSchema})
    
    let type = func.explain2.resultType.type;
    // No nothing or errors propogated.
    expect(func.explain2.resultType.props).toStrictEqual([]);
    expect(type).toBe(types.f64);
})

test("arrayTest2", () => {
    let query1 = api.array(api.array("data.*.value"))
    let query2 = api.array(api.sum("data.*.value"))
    let query2A = api.array({ v: api.sum("data.*.value") })
    // TODO: Figure out what join is.
    //let query3 = api.join(api.array("data.*.value"))
    let query4 = api.sum(api.sum("data.*.value"))

    let func = api.compile({ query1, query2, query2A, /* query3, */ query4 }, {data: dataSchema});
    let type = func.explain2.resultType.type;
    // No nothing or errors propogated.
    expect(func.explain2.resultType.props).toStrictEqual([]);
    expectTypeSimilarity(type, {
        query1: {
            "*": {
                "*": types.f64
            }
        },
        query2: {
            "*": types.f64
        },
        query2A: {
            "*": {v: types.f64}
        },
        //query3: types.f64,
        query4: types.f64
    });
})

// TODO: Figure out what flatten is.

/*test("arrayTest3", () => {
    let query = { "data.*.key": ["Extra1", { foo: "data.*.value" }, "Extra2"] }
    let func = api.compile(query, {data: dataSchema})
    let type = func.explain2.resultType.type;
    // No nothing or errors propogated.
    expect(func.explain2.resultType.props).toStrictEqual([]);
    expectTypeSimilarity(type, {
        "*": {
            "*": types.string
        }
    });
})

test("arrayTest4", () => {
    let query = { "data.*.key": [{ v1: "data.*.value" }, { v2: "data.*.value" }] }
    let func = api.compile(query)
    let res = func({ data })
    let expected = {
      "A": [{"v1": 10},{"v1": 30},{"v2": 10},{"v2": 30}],
      "B": [{"v1": 20},{"v2": 20}]}
    expect(res).toEqual(expected)
})

// test manual zip and flatten patterns for nested array traversal
test("arrayTest5Zip", () => {
    let query = { "data.*.key": [api.get({ v1: "data.*.value", v2: "data.*.value" },"*A")] }
    let func = api.compile(query)
    let res = func.c1({ data }) // NOTE: c2 behaves differently now (see test below)
    let expected = {
      "A": [10, 10, 30, 30],
      "B": [20, 20]}
    expect(res).toEqual(expected)
})
*/
// c2 needs an explicit var *D pulled out to the right level
test("arrayTest5ZipB", () => {
    let query = { "data.*D.key": [api.and("*D", api.get({ v1: "data.*D.value", v2: "data.*D.value" },"*A"))] }
    let func = api.compile(query, {data: dataSchema})
    let type = func.explain2.resultType.type;
    // No nothing or errors propogated.
    expect(func.explain2.resultType.props).toStrictEqual([]);
    expectTypeSimilarity(type, {
        "*": {
            "*": types.f64
        }
    })
})

test("arrayTest6Flatten", () => {
    let query0 = { "data.*.key": {v1:["data.*.value"], v2:["data.*.value"]} }
    let query = { "*k": [api.get(api.get(api.get(query0,"*k"), "*A"), "*B")] }
    let func = api.compile(query, {data: dataSchema})
    let type = func.explain2.resultType.type;
    // No nothing or errors propogated.
    expect(func.explain2.resultType.props).toStrictEqual([]);
    expectTypeSimilarity(type, {
        "*": {
            "*": types.f64
        }
    })
})

test("arrayTest7Eta", () => {
    let query0 = { "data.*.key": ["data.*.value"] }
    let query = { "*k": api.get(query0,"*k") }
    //let func0 = api.compile(query0)
    let func = api.compile(query, {data: dataSchema})
    let type = func.explain2.resultType.type;
    // No nothing or errors propogated.
    expect(func.explain2.resultType.props).toStrictEqual([]);
    expectTypeSimilarity(type, {
        "*": {
            "*": types.f64
        }
    })
})