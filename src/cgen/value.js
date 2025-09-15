// C value representation:
// Primitive value: { schema, val }
// String: { schema, val: { str, len } }
// Array: { schema, val: { dataCount, arr }, tag: "array" }
// HashMap: { schema, val, tag: "hashMap" }
// HashMap value (can be either primitive or string): { schema, val, tag: "hashMapValue" }
// HashMap bucket: { schema, val: { dataCount, bucketCount, buckets, valArray, valSchema }, tag: "hashMapBucket" }
// Object: { schema: [...], val: { <key>: <val>, ... }, tag: "object" }
// File input: { schema, val: mappedFile, tag: "inputFile" }
// C values will have a keyPos property if it is a result from hash lookup
//
// C values could have the optional "cond" property
// The value is not valid (evaluates to undefined) if cond is true

const TAG = {
  ARRAY: "array",
  HASHMAP: "hashmap",
  HASHMAP_VALUE: "hashmap_value",
  HASHMAP_BUCKET: "hashmap_bucket",
  OBJECT: "object",
  CSV_FILE: "csv",
  JSON: "json",
}

let value = {}

value.primitive = (schema, val, tag, cond, keyPos) => ({ schema, val, tag, cond, keyPos })

value.string = (schema, str, len, tag, cond, keyPos) => ({ schema, val: { str, len }, tag, cond, keyPos })

value.hashmap = (schema, sym, htable, count, keys, cond, keyPos) => ({ schema, val: { sym, htable, count, keys }, tag: TAG.HASHMAP, cond, keyPos })

module.exports = {
  TAG,
  value
}
