import { api } from "../../core.js"
import { data } from "../data/data1M.js"

let query = {
    "total": api.sum("data.*.value"),
    "data.*.key1": api.sum("data.*.value"),
}
let exec = api.compile(query)

let start = Date.now()
let res = exec({data})
let end = Date.now()
let elapsed = end - start
console.log(elapsed + "ms")

console.log(res)