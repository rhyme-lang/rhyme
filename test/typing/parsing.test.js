const { typing, types, typeSyms } = require("../../src/typing");

// Typing check helper function. Taken from ./basic-type.test.js
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
            expect(type).toStrictEqual(schema);
        // TODO: Possibly add support for union types and other types?
    }
}

test("basic-u8", () => {
    expect(typing.parseType("u8")).toBe(types.u8);
})

test("basic-string", () => {
    expect(typing.parseType("string")).toBe(types.string);
})

test("basic-obj", () => {
    let type = typing.parseType("{ u8?: u8 }");
    expectTypeSimilarity(type, {
        "*": types.u8
    });
})

test("basic-arr", () => {
    let type = typing.parseType("[ u8 ]");
    expectTypeSimilarity(type, {
        "*": types.u8
    });
})

test("basic-function", () => {
    let type = typing.parseType("(u16) => u8");
    expect(type).toStrictEqual(typing.createFunction(types.u8, types.u16));
})

test("basic-function2", () => {
    let type = typing.parseType("(u16, string) => u8");
    expect(type).toStrictEqual(typing.createFunction(types.u8, types.u16, types.string));
})

test("basic-function3", () => {
    let type = typing.parseType("(u16, (u8) => u64) => u8");
    expect(type).toStrictEqual(typing.createFunction(types.u8, types.u16, typing.createFunction(types.u64, types.u8)));
})

test("basic-string", () => {
    let type = typing.parseType(`"string"`);
    expect(type).toBe("string");
})

test("js-syntax", () => {
    let type = typing.parseType`(string) => ${types.u8}`;
    expect(type).toStrictEqual(typing.createFunction(types.u8, types.string));
})

test("complex-query-input", () => {
    let type = typing.parseType`{
        udf: {
            toNum: (string) => u8
        }, data: [{
            region: string,
            country: string,
            city: string,
            population: u8
        }]
    }`;
    expectTypeSimilarity(typing.parseType(type), {
        udf: {
            toNum: typing.createFunction(types.u8, types.string)
        },
        data: {
            "*": {
                region: types.string,
                country: types.string,
                city: types.string,
                population: types.u8,
            }
        }
    })
})

test("complex-holes", () => {
    let type = typing.parseType`{
        udf: {
            toNum: ${typing.createFunction(types.u8, types.string)}
        }, ${"data"}: {
            ${"u8"}?: {
                region: string,
                country: string,
                city: ${types.string},
                population: u8
            }
        }
    }`;
    expectTypeSimilarity(typing.parseType(type), {
        udf: {
            toNum: typing.createFunction(types.u8, types.string)
        },
        data: {
            "*": {
                region: types.string,
                country: types.string,
                city: types.string,
                population: types.u8,
            }
        }
    })
})

test("obj-construction", () => {
    let t1 = typing.parseType`{}`;
    expect(t1.typeSym).toBe(typeSyms.object);
    expect(t1.objKey).toBe(null);
    let t2 = typing.parseType`unknown & {}`;
    expect(t2.typeSym).toBe(typeSyms.unknown);
    let t3 = typing.parseType`unknown & {key: value}`;
    expect(t3.typeSym).toBe(typeSyms.object);
    expect(t3.objParent.typeSym).toBe(typeSyms.unknown);
})

/*
// TODO: New type system doesn't allow for guaranteed inner joins.
test("complex-reuse-keys", () => {
    let type = typing.parseType`{
        data: {
            *u8=A: {
                key: string,
                value: u8
            }
        }, other: {
            *A: {
                key: string,
                other: u8
            }
        }
    }`;
    expectTypeSimilarity(typing.parseType(type), {
        data: {
            "*": {
                key: types.string,
                value: types.u8
            }
        },
        other: {
            "*": {
                key: types.string,
                other: types.u8
            }
        }
    })
})
*/