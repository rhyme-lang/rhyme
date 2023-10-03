import { api } from "../../core.js"
import { data } from "../data/data1M.js" // load the data

let total = api.sum("data.*A.value")
let totalPerKey1 = {
    "data.*A.key1": api.sum("data.*A.value")
}

let query = {
    "total": api.get(total),
    "data.*.key1": {
        "totalProportion": api.fdiv(api.get(totalPerKey1, "data.*.key1"), api.get(total)),
        "data.*.key2": api.fdiv(api.sum("data.*.value"), api.get(totalPerKey1, "data.*.key1"))
    }
}
let exec = api.compile(query)

let start = Date.now()
let res = exec({data})
let end = Date.now()
let elapsed = end - start
console.log(elapsed + "ms")

console.log(res)