if __name__ == "__main__":
    num_keys = 2
    num_values = 10
    import random
    import json

    # format in 10M, 1k, etc. form
    def format(num):
        num_str = str(num)
        if len(num_str) > 6:
            return num_str[:-6] + "M"
        if len(num_str) > 3:
            return num_str[:-3] + "k"
        return num_str
    
    fname = f"data/data_{format(num_values)}_{format(num_keys)}.jsonl"
    fname_array = f"data/data_array_{format(num_values)}_{format(num_keys)}.jsonl"

    keys = []
    for i in range(num_keys):
        keys.append("x" + str(i))

    # generate num_keys random words
    with open(fname, "w") as f:
        with open(fname_array, "w") as f_array:
            f_array.write("[\n")
            for i in range(num_values-1):
                key = keys[random.randint(0, num_keys - 1)]
                value = random.randint(0, 100)
                f.write(json.dumps({"key": str(key), "value": value}) + "\n")
                f_array.write(json.dumps({"key": str(key), "value": value}) + ",\n")
            # last line
            key = keys[random.randint(0, num_keys - 1)]
            value = random.randint(0, 100)
            f.write(json.dumps({"key": str(key), "value": value}) + "\n")
            f_array.write(json.dumps({"key": str(key), "value": value}) + "\n")
            f_array.write("]\n")
