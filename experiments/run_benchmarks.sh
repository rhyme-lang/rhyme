#!/bin/bash

nruns=5
mkdir bench_logs

queries=("q1" "q2" "q3")

# point all stdout and stderr to a file
# log filename format month_day_hour_minute_second (e.g. 12_25_15_30_59)
logfilename=$(date +%m_%d_%H_%M_%S)
exec > >(tee -ia "bench_logs/run_benchmark_$logfilename.log") 2>&1

RUMBLE_JAR_PATH=/scratch1/dataset/apps/rumbledb-1.21.0-standalone.jar

# run ours
for query in "${queries[@]}"
do
    echo "Running case=ours query=$query"
    cd ours
    for i in $(seq 1 $nruns)
    do
        echo "Run $i"
        node $query.js
    done
    cd -
done

# run rumble
for query in "${queries[@]}"
do
    echo "Running case=rumble query=$query"
    cd jsoniq
    for i in $(seq 1 $nruns)
    do
        echo "Run $i"
        java -jar $RUMBLE_JAR_PATH --parallel-execution no run $query.xq --log-path log
        cat log
    done
    cd -
done

# run jq
for query in "${queries[@]}"
do
    echo "Running case=jq query=$query"
    cd jq
    for i in $(seq 1 $nruns)
    do
        echo "Run $i"
        # find elapsed time in milisecond
        start=$(date +%s%3N)
        bash $query.jq
        end=$(date +%s%3N)
        echo "Elapsed time: $((end-start)) ms"
    done
    cd -
done