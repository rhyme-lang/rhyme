// #include "rhyme-sql.h"
#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <math.h>
#include <sys/time.h>
#include <stdlib.h>
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

#ifndef MAP_FILE
#define MAP_FILE MAP_SHARED
#endif
int fsize(int fd) {
    struct stat stat;
    int res = fstat(fd, &stat);
    return stat.st_size;
}
int main() {
    struct timeval timeval0;
    gettimeofday(&timeval0, NULL);
    long t0 = timeval0.tv_sec * 1000000L + timeval0.tv_usec;
    // loading input file: /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl
    const char *tmp_str0 = "/home/ran/projects/tpch-dbgen/SF1/lineitem.tbl";
    int fd0 = open(tmp_str0, 0);
    if (fd0 == -1) {
        fprintf(stderr, "Unable to open file %s\n", tmp_str0);
        return 1;
    }
    int n0 = fsize(fd0);
    char *file0 = mmap(0, n0, PROT_READ, MAP_FILE | MAP_SHARED, fd0, 0);
    // close(fd0);
    struct timeval timeval1;
    gettimeofday(&timeval1, NULL);
    long t1 = timeval1.tv_sec * 1000000L + timeval1.tv_usec;
    // init tmp0 = sum(and(andAlso(andAlso(andAlso(lessThanOrEqual(19940101, loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_shipdate]), lessThan(loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_shipdate], 19950101)), andAlso(lessThanOrEqual(0.05, loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_discount]), lessThanOrEqual(loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_discount], 0.07))), lessThan(loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_quantity], 24)), times(loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_extendedprice], loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_discount])))
    double tmp0;
    tmp0 = 0;
    int i0 = 0;
    // generator: D0 <- loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)
    while (1) {
        if (i0 >= n0) break;
        // reading column l_orderkey
        while (file0[i0] != '|') i0 = i0 + 1;
        i0 = i0 + 1;
        // reading column l_partkey
        while (file0[i0] != '|') i0 = i0 + 1;
        i0 = i0 + 1;
        // reading column l_suppkey
        while (file0[i0] != '|') i0 = i0 + 1;
        i0 = i0 + 1;
        // reading column l_linenumber
        while (file0[i0] != '|') i0 = i0 + 1;
        i0 = i0 + 1;
        // reading column l_quantity
        long number2 = 0;
        long scale2 = 1;
        while (file0[i0] != '.' && file0[i0] != '|') {
            // extract integer part
            number2 = number2 * 10 + file0[i0] - '0';
            i0 = i0 + 1;
        }
        if (file0[i0] == '.') {
            i0 = i0 + 1;
            while (file0[i0] != '|') {
                // extract fractional part
                number2 = number2 * 10 + file0[i0] - '0';
                scale2 = scale2 * 10;
                i0 = i0 + 1;
            }
        }
        // double file0_D0_l_quantity = ((double)number2 / scale2);
        i0 = i0 + 1;
        // reading column l_extendedprice
        long number1 = 0;
        long scale1 = 1;
        while (file0[i0] != '.' && file0[i0] != '|') {
            // extract integer part
            number1 = number1 * 10 + file0[i0] - '0';
            i0 = i0 + 1;
        }
        if (file0[i0] == '.') {
            i0 = i0 + 1;
            while (file0[i0] != '|') {
                // extract fractional part
                number1 = number1 * 10 + file0[i0] - '0';
                scale1 = scale1 * 10;
                i0 = i0 + 1;
            }
        }
        i0 = i0 + 1;
        // reading column l_discount
        long number0 = 0;
        long scale0 = 1;
        while (file0[i0] != '.' && file0[i0] != '|') {
            // extract integer part
            number0 = number0 * 10 + file0[i0] - '0';
            i0 = i0 + 1;
        }
        if (file0[i0] == '.') {
            i0 = i0 + 1;
            while (file0[i0] != '|') {
                // extract fractional part
                number0 = number0 * 10 + file0[i0] - '0';
                scale0 = scale0 * 10;
                i0 = i0 + 1;
            }
        }
        i0 = i0 + 1;
        // reading column l_tax
        while (file0[i0] != '|') i0 = i0 + 1;
        i0 = i0 + 1;
        // reading column l_returnflag
        while (file0[i0] != '|') i0 = i0 + 1;
        i0 = i0 + 1;
        // reading column l_linestatus
        while (file0[i0] != '|') i0 = i0 + 1;
        i0 = i0 + 1;
        // reading column l_shipdate
        int32_t file0_D0_l_shipdate = (((((((file0[i0] * 10 + file0[i0 + 1]) * 10 + file0[i0 + 2]) * 10 + file0[i0 + 3]) * 10 + file0[i0 + 5]) * 10 + file0[i0 + 6]) * 10 + file0[i0 + 8]) * 10 + file0[i0 + 9]) - 533333328;
        i0 += 11;
        // reading column l_commitdate
        i0 += 11;
        // reading column l_receiptdate
        i0 += 11;
        // reading column l_shipinstruct
        while (file0[i0] != '|') i0 = i0 + 1;
        i0 = i0 + 1;
        // reading column l_shipmode
        while (file0[i0] != '|') i0 = i0 + 1;
        i0 = i0 + 1;
        // reading column l_comment
        while (file0[i0] != '|') i0 = i0 + 1;
        i0 = i0 + 1;
        i0 = i0 + 1;
        // update tmp0 = sum(and(andAlso(andAlso(andAlso(lessThanOrEqual(19940101, loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_shipdate]), lessThan(loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_shipdate], 19950101)), andAlso(lessThanOrEqual(0.05, loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_discount]), lessThanOrEqual(loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_discount], 0.07))), lessThan(loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_quantity], 24)), times(loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_extendedprice], loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_discount])))
        if (((((19940101 <= file0_D0_l_shipdate) && (file0_D0_l_shipdate < 19950101)) && ((0.05 <= ((double)number0 / scale0)) && (((double)number0 / scale0) <= 0.07))) && (((double)number2 / scale2) < 24))) {
            tmp0 += (((double)number1 / scale1) * ((double)number0 / scale0));
        }
    }
    printf("%.4lf\n", ((double)tmp0));
    struct timeval timeval2;
    gettimeofday(&timeval2, NULL);
    long t2 = timeval2.tv_sec * 1000000L + timeval2.tv_usec;
    fprintf(stderr, "Timing:\n\tInitializaton:\t%ld μs\n\tRuntime:\t%ld μs\n\tTotal:\t\t%ld μs\n", t1 - t0, t2 - t1, t2 - t0);
    return 0;
}