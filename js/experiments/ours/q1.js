import { api } from "../../core.js"
import { data } from "../data/toy.js" // load the data

let query = api.sum("data.*.value")
let exec = api.compile(query)
let res = exec({data})
console.log(res)