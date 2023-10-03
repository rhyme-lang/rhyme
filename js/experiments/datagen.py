import os
import random

num_records = 10000000
# generate a json lines dataset with {key1: v1, key2: v2, value: v3}

# convert to 1k, 10k, 100k, 1M, 10M, ..
def number_to_string(num_records):
    if num_records < 1000:
        return str(num_records)
    elif num_records < 1000000:
        return str(num_records // 1000) + "k"
    elif num_records < 1000000000:
        return str(num_records // 1000000) + "M"
    else:
        return str(num_records // 1000000000) + "G"

num_string = number_to_string(num_records)

jsonPath = "data/data" + num_string + ".json"
jsPath = "data/data" + num_string + ".js"

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
