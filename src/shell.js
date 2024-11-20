const { rh } = require('./parser');
const { api } = require('./rhyme');
const { types, typing } = require('./typing');
const simpleEval = require('./simple-eval');
const parser = require('./parser');
const readline = require('node:readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

let generateSchema = (q) => {
    if (typeof q === "string")
        return q;
    if (typeof q === "number") {
        if (Math.round(q) == q) {
            return types.i64;
        }
        return types.f64;
    }
    let keyvals = [];
    for (let key of Object.keys(q)) {
        keyvals.push([generateSchema(key), generateSchema(q[key])]);
    }
    return keyvals;
}

(async () => {
    let backend = "js";
    let queryData = [
        { key: "A", value: 10 },
        { key: "B", value: 20 },
        { key: "A", value: 30 }
    ];
    let quit = false
    while (!quit) {
        await (new Promise((resolve, rej) => {
            rl.question(backend + `> `, async (query_str) => {
                if (query_str.startsWith("#")) {
                    let cmdArgs = query_str.split(" ");
                    if (cmdArgs[0] == "#help") {
                        console.log("#help, #setdata, #setbackend, #q, #quit ");
                        resolve();
                        return;
                    } else if (cmdArgs[0] == "#setbackend") {
                        if (cmdArgs.length == 1) {
                            console.log("Invalid number of arguments.")
                        } else if (cmdArgs[1] == "c" || cmdArgs[1] == "cpp" || cmdArgs[1] == "c-sql" || cmdArgs[1] == "js") {
                            backend = cmdArgs[1];
                        } else {
                            console.log("Invalid backend. Valid types are: js, c, cpp, c-sql")
                        }
                    } else if (cmdArgs[0] == "#setdata") {
                        if (cmdArgs.length == 1) {
                            console.log("Invalid number of arguments.")
                            resolve();
                            return;
                        }
                        let js = query_str.substring("#setdata ".length);
                        queryData = eval(js);
                        console.log(queryData);
                    } else if (cmdArgs[0] == "#quit" || cmdArgs[0] == "#q") {
                        quit = true;
                    } else {
                        console.log("Unknown command: " + cmdArgs[0] + ". Use #help to see available commands");
                    }
                    resolve();
                    return;
                }
                try {
                    let query = parser.parse(query_str);
                    let func;
                    if (backend == "c" || backend == "cpp" || backend == "c-sql") {
                        func = simpleEval.compile(query, {backend: backend, schema: generateSchema({data: queryData})});
                        console.log(await func({data: queryData}));
                    } else {
                        func = api.compile(query);
                        console.log(func({data: queryData}));
                    }
                } catch(e) {
                    console.error(e);
                }
                resolve();
                return;
            });
        }));
    }
    process.exit();
})();