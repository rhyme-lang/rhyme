import { api } from '../core.js';
import { expect } from './infra.js';

// running adhoc queries for testing purposes
let query = {
    "total": api.sum("data.*.value")
}

let res = api.compile(query)
console.log(res)