import os
import random

def generate_data(num_records):
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
    jqPath = "data/data" + num_string + ".jq"

    # create data/ if not exists
    if not os.path.exists("data"):
        os.mkdir("data")

    keys = ["A", "B", "C", "D"]
    valLower = 0
    valUpper = 100

    with open(jsonPath, "w") as f1:
        with open(jsPath, "w") as f2:
            with open(jqPath, "w") as f3:
                f2.write("export let data = [\n")
                f3.write("[\n")
                for i in range(num_records):
                    key1 = random.choice(keys)
                    key2 = random.choice(keys)
                    value = random.randint(valLower, valUpper)
                    f1.write(f'{{"key1": "{key1}", "key2": "{key2}", "value": {value}}}\n')
                    f2.write(f'{{"key1": "{key1}", "key2": "{key2}", "value": {value}}},\n')
                    f3.write(f'{{"key1": "{key1}", "key2": "{key2}", "value": {value}}},\n')
                f2.write("];\n")
                f3.write("]\n")
num_recs = [10**4, 10**5, 10**6, 10**7]
for num_rec in num_recs:
    generate_data(num_rec)