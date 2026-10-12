// Type definitions: the base types, the symbols tagging compound types, and
// the tuple properties. Plain data with no dependencies, so that both
// typing.js and prettyprint.js can build on it.

let types = {}
let typeSyms = {}
let props = {}
exports.types = types;
exports.typeSyms = typeSyms;
exports.props = props;


let createType = (str) => {
    typeSyms[str] = str;
    types[str] = {typeSym: str};
};

createType("any"); // Supertype of every type. Set of all possible values
createType("never"); // Subtype of every type. Empty set.
createType("unknown"); // Castable to any type. Propagates error if casting is not guaranteed to succeed.

createType("nothing"); // TODO: Add type for front-end, to specify the nothing property.

createType("boolean");
createType("string"); // All string literal types are a subset of this type.

createType("u8");
createType("u16");
createType("u32");
createType("u64");
// u8 <: u16 <: u32 <: u64 (subtypes)

createType("i8");
createType("i16");
createType("i32");
createType("i64");
// i8 <: i16 <: i32 <: i64

createType("f32");
createType("f64");
// f32 <: f64
//types["emptyObject"] = [];

createType("date");
createType("char");

props["nothing"] = "nothing";
props["error"] = "error";

// u8 <: i16, u16 <: i32, u32 <: i64
// Implicitly or explicitly convert signed to unsigned, and unsigned to same-size signed when needed?
// And also consider conversion between floats and integers.

typeSyms["object"] = "object"; // {}{K: V}{K2: V2}...
typeSyms["intersect"] = "intersect"; // arg1 n arg2 n arg3 ...
typeSyms["union"] = "union"; // arg1 U arg2 U arg3 ...
typeSyms["dynkey"] = "dynkey"; // wrapped arg is subtype of arg
typeSyms["function"] = "function"; // (p1, p2, ...) -> r1
typeSyms["tagged_type"] = "tagged_type"; // object with a specialized interface to it used by codegen.
typeSyms["keyval"] = "keyval"; // Not a proper type. Used for constructing types easier.

// Type hierarchy order: (Top to bottom level)
// - Unions
// - Intersections
// - TaggedTypes
// - Base Types
// -- Then inside any base types (e.g. K_n(T) ), the hierarchy restarts for said inner types.
