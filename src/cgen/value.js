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
  COMBINED_KEY: "combined_key",
  NESTED_HASHMAP: "nested_hashap"
}

let value = {}

value.primitive = (schema, val, tag, cond, keyPos) => ({
  schema, val, tag, cond, keyPos
})

value.json = (schema, val, cond, keyPos) => ({
  schema, val, tag: TAG.JSON, cond, keyPos
})

value.string = (schema, str, len, tag, cond, keyPos) => ({
  schema, val: { str, len }, tag, cond, keyPos
})

value.hashmap = (schema, sym, htable, count, keys, cond, keyPos) => ({
  schema, val: { sym, htable, count, keys, values: {} }, tag: TAG.HASHMAP, cond, keyPos
})

value.nestedHashMap = (schema, htables, counts, keys, cond, keyPos) => ({
  schema, val: { htables, counts, keys, values: {} }, tag: TAG.NESTED_HASHMAP, cond, keyPos
})

value.array = (schema, sym, count, cond) => ({
  schema, val: { sym, count }, tag: TAG.ARRAY, cond
})

module.exports = {
  TAG,
  value
}
