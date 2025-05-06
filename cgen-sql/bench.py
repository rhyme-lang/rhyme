import os
import subprocess
import re

import matplotlib.pyplot as plt
import numpy as np

N = 5

rhyme = []
flare = []

for i in range(1, 23):
    rhyme_exec = "q" + str(i)
    flare_exec = "tpch" + str(i) + "_1"

    rhyme_out = rhyme_exec + ".out"
    flare_out = flare_exec + ".out"

    print("running rhyme generated query " + rhyme_exec)
    os.system(f"./{rhyme_exec} > /dev/null 2>&1")

    sum = 0
    for _ in range(N):
        result = subprocess.run([f"./{rhyme_exec}"], capture_output=True, text=True)
        time = re.findall("[0-9]+", result.stderr)
        print(time)
        sum += int(time[1])
    rhyme.append(sum / N)

    print("running flare generated query " + flare_exec)
    os.system(f"./{flare_exec} > /dev/null 2>&1")

    sum = 0
    for _ in range(N):
        result = subprocess.run([f"./{flare_exec}"], capture_output=True, text=True)
        time = re.findall("[0-9]+", result.stderr)
        print(time)
        sum += int(time[1])
    flare.append(sum / N)

# Query labels
queries = np.arange(1, 23)  # 1 to 22

# Bar width and positions
bar_width = 0.35
x = np.arange(len(queries))

# Plot
plt.figure(figsize=(12, 6))
plt.bar(x - bar_width/2, rhyme, bar_width, label='Rhyme')
plt.bar(x + bar_width/2, flare, bar_width, label='Flare')

# Formatting
plt.xlabel('TPC-H Query')
plt.ylabel('Runtime (microseconds)')
plt.title('Rhyme vs Flare Runtime on TPC-H Queries')
plt.xticks(x, [f'Q{i}' for i in queries], rotation=45)
plt.legend()
plt.tight_layout()
plt.grid(axis='y', linestyle='--', alpha=0.7)

plt.savefig('plot.jpeg', format='jpeg')
