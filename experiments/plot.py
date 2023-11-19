import sys
import pandas as pd

raw_log = sys.argv[1]

with open(raw_log, 'r') as f:
    data = {} # case -> query -> time (ms)

    curr_case = ""
    curr_query = ""
    curr_load_times = []
    curr_query_times = []

    def addResult(case, query, load_times, query_times):
        if case not in data:
            data[case] = {}
        assert query not in data[case]
        if load_times == []:
            data[case][query] = query_times
        else:
            total_times = []
            for i in range(len(load_times)):
                total_times.append(load_times[i] + query_times[i])
            data[case][query] = total_times

    for line in f:
        # Running case=ours query=q1
        if line.startswith("Running case="):
            if curr_case != "":
                addResult(curr_case, curr_query, curr_load_times, curr_query_times)
            curr_case = line.split("=")[1].split()[0]
            curr_query = line.split("=")[2].split()[0]
            curr_load_times = []
            curr_query_times = []

        # Load Time: 651ms
        elif line.startswith("Load Time:"):
            curr_load_times.append(int(line.split(":")[1].split("ms")[0]))

        # Query Time: 148ms
        elif line.startswith("Query Time:"):
            curr_query_times.append(int(line.split(":")[1].split("ms")[0]))

        # also query time 
        # [ExecTime] 2559
        elif line.startswith("[ExecTime]"):
            curr_query_times.append(int(line.split("]")[1]))

        # also query time
        # Elapsed time: 15018 ms
        elif line.startswith("Elapsed time:"):
            curr_query_times.append(int(line.split(":")[1].split("ms")[0]))

    addResult(curr_case, curr_query, curr_load_times, curr_query_times)

    caseMap = {"rumble": "Rumble", "ours": "Rhyme (ours)", "jq": "JQ"}
    queryMap = {"q1": "Q1", "q2": "Q2", "q3":"Q3"}

    import numpy as np

    # create a pandas dataframe: (case, query, mean time, std time)
    df = pd.DataFrame(columns=["case", "query", "mean", "std"])
    for case in data:
        for query in data[case]:
            std = np.std(data[case][query])
            mean = np.mean(data[case][query])
            # conver to seconds
            mean /= 1000
            df = df.append({"case": caseMap[case], "query": queryMap[query], "mean": mean, "std": std}, ignore_index=True)
    
    print(df)

    # I want to plot query -> system -> mean time
    # so I need to pivot the table
    std_df = df.pivot(index="query", columns="case", values="std")
    df = df.pivot(index="query", columns="case", values="mean")

    caseOrder = ["JQ", "Rumble", "Rhyme (ours)"]
    df = df[caseOrder]
    std_df = std_df[caseOrder]

    print(df)

    import matplotlib.pyplot as plt

    # set legend font size
    plt.rcParams["legend.fontsize"] = 14
    # set y ticks font size
    plt.rcParams["ytick.labelsize"] = 14
    # set y label font size
    plt.rcParams["axes.labelsize"] = 14

    # plot
    # df.plot(kind="bar", width=0.8, rot=0, yerr=std_df, fontsize=14, ecolor="black")
    df.plot(kind="bar", width=0.8, rot=0, fontsize=14, ylabel="Running Time (s)")

    # y axis log scale
    # plt.yscale("log")
    # plt.ylim(bottom=1)

    # x labels rotation
    plt.xticks(rotation=0)
    # hide x axis name
    plt.xlabel(None)

    # add grid lines
    plt.grid(axis="y")
    # set size
    plt.gcf().set_size_inches(7, 5)

    # hide label from legend
    plt.legend(title=None)
    

    plt.savefig("plot.png")
    plt.savefig("plot.pdf")


