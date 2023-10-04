import { api } from "../../core.js"
import { data, loadStartT} from "../data/data1M.js"

let loadTime = Date.now() - loadStartT
console.log("Load Time: " + loadTime + "ms")

let query = {
    "total": api.sum("data.*.value"),
    "data.*.key1": {
        "total": api.sum("data.*.value"),
        "data.*.key2": api.sum("data.*.value")
    }
}
let exec = api.compile(query)

let start = Date.now()
let res = exec({data})
let end = Date.now()
let elapsed = end - start
console.log("Query Time: " + elapsed + "ms")

console.log(res)