import os
import subprocess
import re

import matplotlib.pyplot as plt
import numpy as np

EXEC_DIR = "./cgen-sql/out/json-bench/"

N = 10

c = []
js = []

for i in range(1, 6):
    rhyme_exec = EXEC_DIR + "q" + str(i)

    print("running c backend query " + rhyme_exec)
    os.system(f"./{rhyme_exec} > /dev/null 2>&1")

    sum = 0
    for _ in range(N):
        result = subprocess.run([f"./{rhyme_exec}"], capture_output=True, text=True)
        # print(result)
        time = re.findall("[0-9]+", result.stderr)
        print(time, int(time[2]) / 1000)
        sum += int(time[2]) / 1000
    c.append(sum / N)

print("running js backend queries")
result = subprocess.run(["node", "./bench/js/json-bench.js"], capture_output=True, text=True)
time = re.findall("[0-9]+.[0-9]+", result.stderr)
print(time, len(time))

for i in range(5):
    start_idx = i * 11
    end_idx = start_idx + 11
    # Get 11 elements, skip the first one, convert to float and average the rest 10
    group = time[start_idx:end_idx]
    avg = np.sum([float(x) for x in group[1:]]) / 10
    js.append(avg)

print(c)
print(js)

# Query labels
queries = np.arange(1, 6)  # 1 to 5

# Bar width and positions
bar_width = 0.35
x = np.arange(len(queries))

# Plot
plt.figure(figsize=(12, 6))
plt.bar(x - bar_width/2, c, bar_width, label='C Backend')
plt.bar(x + bar_width/2, js, bar_width, label='JavaScript Backend')

# Formatting
plt.xlabel('JSONBench Query')
plt.ylabel('Runtime (milliseconds)')
plt.title('Rhyme C vs JavaScript Backend Runtime on JSONBench Queries (1 million rows)')
plt.xticks(x, [f'Q{i}' for i in queries])
plt.legend()
plt.tight_layout()
plt.grid(axis='y', linestyle='--', alpha=0.7)

plt.savefig('json_bench.jpeg', format='jpeg')