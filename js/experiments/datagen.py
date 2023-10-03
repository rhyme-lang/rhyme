import os
import random

num_records = 10000
# generate a json lines dataset with {key1: v1, key2: v2, value: v3}

jsonPath = "data/data.json"
jsPath = "data/data.js"

# create data/ if not exists
if not os.path.exists("data"):
    os.mkdir("data")

keys = ["A", "B", "C", "D"]
valLower = 0
valUpper = 100

with open(jsonPath, "w") as f1:
    with open(jsPath, "w") as f2:
        f2.write("export let data = [\n")
        for i in range(num_records):
            key1 = random.choice(keys)
            key2 = random.choice(keys)
            value = random.randint(valLower, valUpper)
            f1.write(f'{{"key1": "{key1}", "key2": "{key2}", "value": {value}}}\n')
            f2.write(f'{{"key1": "{key1}", "key2": "{key2}", "value": {value}}},\n')
        f2.write("];\n")
        