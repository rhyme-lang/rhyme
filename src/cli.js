#!/usr/bin/env -S node

const { api } = require('./rhyme');
const parser = require('./parser');

const fs = require('node:fs');
const readline = require('node:readline');

(async () => {

    // mode of operation: do we have a file/query given as arg?
    if (process.argv.length < 3 || process.argv[2] == "-h" || process.argv[2] == "--help") {
        console.log("usage: rhyme [file | query] args*")
        return
    }

    // TODO: process other options here (e.g. choice of backend, ...)

    try {
        // are we dealing with a filename (xxx.rh) or an inline query?
        let file = process.argv[2]
        let query_str
        if (file.endsWith(".rh")) {
            query_str = fs.readFileSync(process.argv[2]).toString()
        } else {
            query_str = file
        }

        // are we receiving piped input data? 
        // (TODO: assuming JSON for now, make it more flexible ...)
        let stdin = undefined
        if (!process.stdin.isTTY) {
            const rl = readline.createInterface({
                input: process.stdin,
            });

            let buf = []
            for await (let line of rl) {
                // process a line at a time
                buf.push(line)
            }
            stdin = buf.join("\n")
            stdin = JSON.parse(stdin)
        }

        // compile and run
        let query = parser.parse(query_str);
        let func = api.compileC2(query);
        let input = {
            argv: process.argv.slice(3),
            argv0: file,
            stdin: stdin
        }
        console.log(JSON.stringify(func(input), null, 2))
    } catch(e) {
        console.error(e)
    }

})();