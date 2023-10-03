import { api } from "../../core.js"
import { data } from "../data/toy.js" // load the data

let query = {
    "total": api.sum("data.*.value"),
    "data.*.key1": {
        "total": api.sum("data.*.value"),
        "data.*.key2": api.sum("data.*.value")
    }
}
let exec = api.compile(query)
let res = exec({data})
console.log(res)