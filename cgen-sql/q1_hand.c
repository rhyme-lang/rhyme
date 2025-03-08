#include "rhyme-sql.h"
int main() {
    int D0;
    // loading input file: /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl
    const char *tmp_str0 = "/home/ran/projects/tpch-dbgen/SF1/lineitem.tbl";
    int fd0 = open(tmp_str0, 0);
    if (fd0 == -1) {
        fprintf(stderr, "Unable to open file %s\n", tmp_str0);
        return 1;
    }
    int n0 = fsize(fd0);
    char *file0 = mmap(0, n0, PROT_READ, MAP_FILE | MAP_SHARED, fd0, 0);
    close(fd0);
    // init hashmap for tmp12
    // keys of tmp12
    char **tmp12_keys_str0 = (char **)malloc(sizeof(char *) * 256);
    int *tmp12_keys_len0 = (int *)malloc(sizeof(int) * 256);
    char **tmp12_keys_str1 = (char **)malloc(sizeof(char *) * 256);
    int *tmp12_keys_len1 = (int *)malloc(sizeof(int) * 256);
    // key count for tmp12
    int tmp12_key_count = 0;
    // hash table for tmp12
    int *tmp12_htable = (int *)malloc(sizeof(int) * 256);
    // init hash table entries to -1 for tmp12
    for (int i = 0; i < 256; i++) tmp12_htable[i] = -1;
    // values of tmp12
    double *tmp12_sum_qty = (double *)malloc(sizeof(double) * 256);
    double *tmp12_sum_base_price = (double *)malloc(sizeof(double) * 256);
    double *tmp12_sum_disc_price = (double *)malloc(sizeof(double) * 256);
    double *tmp12_sum_charge = (double *)malloc(sizeof(double) * 256);
    double *tmp12_avg_qty = (double *)malloc(sizeof(double) * 256);
    double *tmp12_avg_price = (double *)malloc(sizeof(double) * 256);
    double *tmp12_avg_disc = (double *)malloc(sizeof(double) * 256);
    uint32_t *tmp12_count_order = (uint32_t *)malloc(sizeof(uint32_t) * 256);
    // values of tmp0
    double *tmp0_values = (double *)malloc(sizeof(double) * 256);
    // values of tmp4
    uint32_t *tmp4_values = (uint32_t *)malloc(sizeof(uint32_t) * 256);
    // values of tmp1
    double *tmp1_values = (double *)malloc(sizeof(double) * 256);
    // values of tmp6
    uint32_t *tmp6_values = (uint32_t *)malloc(sizeof(uint32_t) * 256);
    // values of tmp8
    double *tmp8_values = (double *)malloc(sizeof(double) * 256);
    // values of tmp9
    uint32_t *tmp9_values = (uint32_t *)malloc(sizeof(uint32_t) * 256);
    int i0 = 0;
    // generator: D0 <- loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)
    D0 = -1;
    while (1) {
        D0++;
        if (i0 >= n0) break;
        // reading column l_orderkey
        int32_t file0_D0_l_orderkey = 0;
        while (file0[i0] != '|') {
            // extract integer
            if (file0[i0] >= '0' && file0[i0] <= '9') {
                file0_D0_l_orderkey *= 10;
                file0_D0_l_orderkey += file0[i0] - '0';
            }
            i0++;
        }
        i0++;
        // reading column l_partkey
        while (file0[i0] != '|') {
            i0++;
        }
        i0++;
        // reading column l_suppkey
        while (file0[i0] != '|') {
            i0++;
        }
        i0++;
        // reading column l_linenumber
        while (file0[i0] != '|') {
            i0++;
        }
        i0++;
        // reading column l_quantity
        int integer3 = 0;
        int frac3 = 0;
        int scale3 = 1;
        while (file0[i0] != '|' && file0[i0] != '.') {
            // extract integer part
            integer3 *= 10;
            integer3 += file0[i0] - '0';
            i0++;
        }
        if (file0[i0] == '.') {
            i0++;
            while (file0[i0] != '|') {
                // extract fractional part
                frac3 *= 10;
                frac3 += file0[i0] - '0';
                scale3 *= 10;
                i0++;
            }
        }
        double file0_D0_l_quantity = integer3 + (double)frac3 / scale3;
        i0++;
        // reading column l_extendedprice
        int integer2 = 0;
        int frac2 = 0;
        int scale2 = 1;
        while (file0[i0] != '|' && file0[i0] != '.') {
            // extract integer part
            integer2 *= 10;
            integer2 += file0[i0] - '0';
            i0++;
        }
        if (file0[i0] == '.') {
            i0++;
            while (file0[i0] != '|') {
                // extract fractional part
                frac2 *= 10;
                frac2 += file0[i0] - '0';
                scale2 *= 10;
                i0++;
            }
        }
        double file0_D0_l_extendedprice = integer2 + (double)frac2 / scale2;
        i0++;
        // reading column l_discount
        int integer1 = 0;
        int frac1 = 0;
        int scale1 = 1;
        while (file0[i0] != '|' && file0[i0] != '.') {
            // extract integer part
            integer1 *= 10;
            integer1 += file0[i0] - '0';
            i0++;
        }
        if (file0[i0] == '.') {
            i0++;
            while (file0[i0] != '|') {
                // extract fractional part
                frac1 *= 10;
                frac1 += file0[i0] - '0';
                scale1 *= 10;
                i0++;
            }
        }
        double file0_D0_l_discount = integer1 + (double)frac1 / scale1;
        i0++;
        // reading column l_tax
        int integer0 = 0;
        int frac0 = 0;
        int scale0 = 1;
        while (file0[i0] != '|' && file0[i0] != '.') {
            // extract integer part
            integer0 *= 10;
            integer0 += file0[i0] - '0';
            i0++;
        }
        if (file0[i0] == '.') {
            i0++;
            while (file0[i0] != '|') {
                // extract fractional part
                frac0 *= 10;
                frac0 += file0[i0] - '0';
                scale0 *= 10;
                i0++;
            }
        }
        double file0_D0_l_tax = integer0 + (double)frac0 / scale0;
        i0++;
        // reading column l_returnflag
        int file0_D0_l_returnflag_start = i0;
        while (file0[i0] != '|') {
            i0++;
        }
        int file0_D0_l_returnflag_end = i0;
        i0++;
        // reading column l_linestatus
        int file0_D0_l_linestatus_start = i0;
        while (file0[i0] != '|') {
            i0++;
        }
        int file0_D0_l_linestatus_end = i0;
        i0++;
        // reading column l_shipdate
        int32_t file0_D0_l_shipdate = 0;
        while (file0[i0] != '|') {
            // extract integer
            if (file0[i0] >= '0' && file0[i0] <= '9') {
                file0_D0_l_shipdate *= 10;
                file0_D0_l_shipdate += file0[i0] - '0';
            }
            i0++;
        }
        i0++;
        // reading column l_commitdate
        while (file0[i0] != '|') {
            i0++;
        }
        i0++;
        // reading column l_receiptdate
        while (file0[i0] != '|') {
            i0++;
        }
        i0++;
        // reading column l_shipinstruct
        while (file0[i0] != '|') {
            i0++;
        }
        i0++;
        // reading column l_shipmode
        while (file0[i0] != '|') {
            i0++;
        }
        i0++;
        // reading column l_comment
        while (file0[i0] != '|') {
            i0++;
        }
        i0++;
        i0++;
        unsigned long hash0 = 0;
        unsigned long tmp_hash0 = hash(file0 + file0_D0_l_returnflag_start, file0_D0_l_returnflag_end - file0_D0_l_returnflag_start);
        hash0 *= 41;
        hash0 += tmp_hash0;
        unsigned long tmp_hash1 = hash(file0 + file0_D0_l_linestatus_start, file0_D0_l_linestatus_end - file0_D0_l_linestatus_start);
        hash0 *= 41;
        hash0 += tmp_hash1;
        // generator: K1 <- mkset(combine(loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_returnflag], loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_linestatus]))
        {
            // singleton value here
            unsigned long pos0 = hash0 & 255;
            while (tmp12_htable[pos0] != -1 && (compare_str2(tmp12_keys_str0[tmp12_htable[pos0]], tmp12_keys_len0[tmp12_htable[pos0]], file0 + file0_D0_l_returnflag_start, file0_D0_l_returnflag_end - file0_D0_l_returnflag_start) != 0 || compare_str2(tmp12_keys_str1[tmp12_htable[pos0]], tmp12_keys_len1[tmp12_htable[pos0]], file0 + file0_D0_l_linestatus_start, file0_D0_l_linestatus_end - file0_D0_l_linestatus_start) != 0)) {
                pos0 = (pos0 + 1) & 255;
            }
            int key_pos0 = tmp12_htable[pos0];
            if (key_pos0 == -1) {
                key_pos0 = tmp12_key_count;
                tmp12_key_count++;
                tmp12_htable[pos0] = key_pos0;
                tmp12_keys_str0[key_pos0] = file0 + file0_D0_l_returnflag_start;
                tmp12_keys_len0[key_pos0] = file0_D0_l_returnflag_end - file0_D0_l_returnflag_start;
                tmp12_keys_str1[key_pos0] = file0 + file0_D0_l_linestatus_start;
                tmp12_keys_len1[key_pos0] = file0_D0_l_linestatus_end - file0_D0_l_linestatus_start;
                tmp12_sum_qty[key_pos0] = 0;
                tmp12_sum_base_price[key_pos0] = 0;
                tmp12_sum_disc_price[key_pos0] = 0;
                tmp12_sum_charge[key_pos0] = 0;
                tmp12_count_order[key_pos0] = 0;
                tmp0_values[key_pos0] = 0;
                tmp4_values[key_pos0] = 0;
                tmp1_values[key_pos0] = 0;
                tmp6_values[key_pos0] = 0;
                tmp8_values[key_pos0] = 0;
                tmp9_values[key_pos0] = 0;
            }
            // update tmp0[K1] = sum(and(lessThanOrEqual(loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_quantity]))
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp0_values[key_pos0] += file0_D0_l_quantity;
            }
            // update tmp4[K1] = count(and(lessThanOrEqual(loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_quantity]))
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp4_values[key_pos0] += 1;
            }
            // update tmp1[K1] = sum(and(lessThanOrEqual(loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_extendedprice]))
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp1_values[key_pos0] += file0_D0_l_extendedprice;
            }
            // update tmp6[K1] = count(and(lessThanOrEqual(loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_extendedprice]))
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp6_values[key_pos0] += 1;
            }
            // update tmp8[K1] = sum(and(lessThanOrEqual(loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_discount]))
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp8_values[key_pos0] += file0_D0_l_discount;
            }
            // update tmp9[K1] = count(and(lessThanOrEqual(loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', /home/ran/projects/tpch-dbgen/SF1/lineitem.tbl)[D0][l_discount]))
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp9_values[key_pos0] += 1;
            }
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp12_sum_qty[key_pos0] += file0_D0_l_quantity;
            }
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp12_sum_base_price[key_pos0] += file0_D0_l_extendedprice;
            }
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp12_sum_disc_price[key_pos0] += (file0_D0_l_extendedprice * (1 - file0_D0_l_discount));
            }
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp12_sum_charge[key_pos0] += ((file0_D0_l_extendedprice * (1 - file0_D0_l_discount)) * (1 + file0_D0_l_tax));
            }
            tmp12_avg_qty[key_pos0] = ((double)((double)tmp0_values[key_pos0]) / (double)tmp4_values[key_pos0]);
            tmp12_avg_price[key_pos0] = ((double)((double)tmp1_values[key_pos0]) / (double)tmp6_values[key_pos0]);
            tmp12_avg_disc[key_pos0] = ((double)((double)tmp8_values[key_pos0]) / (double)tmp9_values[key_pos0]);
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp12_count_order[key_pos0] += 1;
            }
        }
    }
    // print hashmap
    for (int i = 0; i < tmp12_key_count; i++) {
        int key_pos = i;
        // print key
        print(tmp12_keys_str0[key_pos], tmp12_keys_len0[key_pos]);
        print("|", 1);
        print(tmp12_keys_str1[key_pos], tmp12_keys_len1[key_pos]);
        print("|", 1);
        // print value
        printf("%.4lf", tmp12_sum_qty[key_pos]);
        print("|", 1);
        printf("%.4lf", tmp12_sum_base_price[key_pos]);
        print("|", 1);
        printf("%.4lf", tmp12_sum_disc_price[key_pos]);
        print("|", 1);
        printf("%.4lf", tmp12_sum_charge[key_pos]);
        print("|", 1);
        printf("%.4lf", tmp12_avg_qty[key_pos]);
        print("|", 1);
        printf("%.4lf", tmp12_avg_price[key_pos]);
        print("|", 1);
        printf("%.4lf", tmp12_avg_disc[key_pos]);
        print("|", 1);
        printf("%u", tmp12_count_order[key_pos]);
        print("|", 1);
        print("\n", 1);
    }
    return 0;
}