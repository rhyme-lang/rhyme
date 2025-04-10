#include "rhyme-sql.h"
typedef int (*__compar_fn_t)(const void *, const void *);
char **tmp14_l_returnflag_str;
int *tmp14_l_returnflag_len;
char **tmp14_l_linestatus_str;
int *tmp14_l_linestatus_len;
int compare_func0(int *key_pos1, int *key_pos2) {
    int tmp_cmp0 = compare_str2(tmp14_l_returnflag_str[*key_pos1], tmp14_l_returnflag_len[*key_pos1], tmp14_l_returnflag_str[*key_pos2], tmp14_l_returnflag_len[*key_pos2]);
    if (tmp_cmp0 != 0) {
        return tmp_cmp0;
    }
    int tmp_cmp1 = compare_str2(tmp14_l_linestatus_str[*key_pos1], tmp14_l_linestatus_len[*key_pos1], tmp14_l_linestatus_str[*key_pos2], tmp14_l_linestatus_len[*key_pos2]);
    return tmp_cmp1;
}
int main() {
    struct timeval timeval0;
    gettimeofday(&timeval0, NULL);
    long t0 = timeval0.tv_sec * 1000000L + timeval0.tv_usec;
    // values of tmp2
    double *tmp2_values = (double *)malloc(sizeof(double) * 16777216);
    // values of tmp6
    uint32_t *tmp6_values = (uint32_t *)malloc(sizeof(uint32_t) * 16777216);
    // values of tmp3
    double *tmp3_values = (double *)malloc(sizeof(double) * 16777216);
    // values of tmp8
    uint32_t *tmp8_values = (uint32_t *)malloc(sizeof(uint32_t) * 16777216);
    // values of tmp10
    double *tmp10_values = (double *)malloc(sizeof(double) * 16777216);
    // values of tmp11
    uint32_t *tmp11_values = (uint32_t *)malloc(sizeof(uint32_t) * 16777216);
    // init hashmap for tmp14
    // keys of tmp14
    char **tmp14_keys_str0 = (char **)malloc(sizeof(char *) * 16777216);
    int *tmp14_keys_len0 = (int *)malloc(sizeof(int) * 16777216);
    char **tmp14_keys_str1 = (char **)malloc(sizeof(char *) * 16777216);
    int *tmp14_keys_len1 = (int *)malloc(sizeof(int) * 16777216);
    // key count for tmp14
    int tmp14_key_count = 0;
    // hash table for tmp14
    int *tmp14_htable = (int *)malloc(sizeof(int) * 16777216);
    // init hash table entries to -1 for tmp14
    for (int i = 0; i < 16777216; i++) tmp14_htable[i] = -1;
    // values of tmp14
    tmp14_l_returnflag_str = (char **)malloc(sizeof(char *) * 16777216);
    tmp14_l_returnflag_len = (int *)malloc(sizeof(int) * 16777216);
    tmp14_l_linestatus_str = (char **)malloc(sizeof(char *) * 16777216);
    tmp14_l_linestatus_len = (int *)malloc(sizeof(int) * 16777216);
    double *tmp14_sum_qty = (double *)malloc(sizeof(double) * 16777216);
    double *tmp14_sum_base_price = (double *)malloc(sizeof(double) * 16777216);
    double *tmp14_sum_disc_price = (double *)malloc(sizeof(double) * 16777216);
    double *tmp14_sum_charge = (double *)malloc(sizeof(double) * 16777216);
    double *tmp14_avg_qty = (double *)malloc(sizeof(double) * 16777216);
    double *tmp14_avg_price = (double *)malloc(sizeof(double) * 16777216);
    double *tmp14_avg_disc = (double *)malloc(sizeof(double) * 16777216);
    uint32_t *tmp14_count_order = (uint32_t *)malloc(sizeof(uint32_t) * 16777216);
    // loading input file: cgen-sql/data/SF1/lineitem.tbl
    const char *tmp_str0 = "cgen-sql/data/SF1/lineitem.tbl";
    int fd0 = open(tmp_str0, 0);
    if (fd0 == -1) {
        fprintf(stderr, "Unable to open file %s\n", tmp_str0);
        return 1;
    }
    int n0 = fsize(fd0);
    char *file0 = mmap(0, n0, PROT_READ, MAP_FILE | MAP_SHARED, fd0, 0);
    close(fd0);
    struct timeval timeval1;
    gettimeofday(&timeval1, NULL);
    long t1 = timeval1.tv_sec * 1000000L + timeval1.tv_usec;
    int i0 = 0;
    // generator: D0 <- loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)
    while (1) {
        if (i0 >= n0) break;
        // reading column l_orderkey
        int32_t file0_D0_l_orderkey = 0;
        while (file0[i0] != '|') {
            // extract integer
            file0_D0_l_orderkey = file0_D0_l_orderkey * 10 + file0[i0] - '0';
            i0++;
        }
        i0++;
        // reading column l_partkey
        while (file0[i0] != '|') i0++;
        i0++;
        // reading column l_suppkey
        while (file0[i0] != '|') i0++;
        i0++;
        // reading column l_linenumber
        while (file0[i0] != '|') i0++;
        i0++;
        // reading column l_quantity
        long number3 = 0;
        long scale3 = 1;
        while (file0[i0] != '.' && file0[i0] != '|') {
            // extract integer part
            number3 = number3 * 10 + file0[i0] - '0';
            i0++;
        }
        if (file0[i0] == '.') {
            i0++;
            while (file0[i0] != '|') {
                // extract fractional part
                number3 = number3 * 10 + file0[i0] - '0';
                scale3 = scale3 * 10;
                i0++;
            }
        }
        double file0_D0_l_quantity = (double)number3 / scale3;
        i0++;
        // reading column l_extendedprice
        long number2 = 0;
        long scale2 = 1;
        while (file0[i0] != '.' && file0[i0] != '|') {
            // extract integer part
            number2 = number2 * 10 + file0[i0] - '0';
            i0++;
        }
        if (file0[i0] == '.') {
            i0++;
            while (file0[i0] != '|') {
                // extract fractional part
                number2 = number2 * 10 + file0[i0] - '0';
                scale2 = scale2 * 10;
                i0++;
            }
        }
        double file0_D0_l_extendedprice = (double)number2 / scale2;
        i0++;
        // reading column l_discount
        long number1 = 0;
        long scale1 = 1;
        while (file0[i0] != '.' && file0[i0] != '|') {
            // extract integer part
            number1 = number1 * 10 + file0[i0] - '0';
            i0++;
        }
        if (file0[i0] == '.') {
            i0++;
            while (file0[i0] != '|') {
                // extract fractional part
                number1 = number1 * 10 + file0[i0] - '0';
                scale1 = scale1 * 10;
                i0++;
            }
        }
        double file0_D0_l_discount = (double)number1 / scale1;
        i0++;
        // reading column l_tax
        long number0 = 0;
        long scale0 = 1;
        while (file0[i0] != '.' && file0[i0] != '|') {
            // extract integer part
            number0 = number0 * 10 + file0[i0] - '0';
            i0++;
        }
        if (file0[i0] == '.') {
            i0++;
            while (file0[i0] != '|') {
                // extract fractional part
                number0 = number0 * 10 + file0[i0] - '0';
                scale0 = scale0 * 10;
                i0++;
            }
        }
        double file0_D0_l_tax = (double)number0 / scale0;
        i0++;
        // reading column l_returnflag
        int file0_D0_l_returnflag_start = i0;
        while (file0[i0] != '|') i0++;
        int file0_D0_l_returnflag_end = i0;
        i0++;
        // reading column l_linestatus
        int file0_D0_l_linestatus_start = i0;
        while (file0[i0] != '|') i0++;
        int file0_D0_l_linestatus_end = i0;
        i0++;
        // reading column l_shipdate
        int file0_D0_l_shipdate = (((((((file0[i0] * 10 + file0[i0 + 1]) * 10 + file0[i0 + 2]) * 10 + file0[i0 + 3]) * 10 + file0[i0 + 5]) * 10 + file0[i0 + 6]) * 10 + file0[i0 + 8]) * 10 + file0[i0 + 9]) - 533333328;
        i0 += 11;
        // reading column l_commitdate
        i0 += 11;
        // reading column l_receiptdate
        i0 += 11;
        // reading column l_shipinstruct
        while (file0[i0] != '|') i0++;
        i0++;
        // reading column l_shipmode
        while (file0[i0] != '|') i0++;
        i0++;
        // reading column l_comment
        while (file0[i0] != '|') i0++;
        i0++;
        i0++;
        // generator: K1 <- mkset(combine(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_returnflag], loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_linestatus]))
        {
            // singleton value here
            // init and update tmp14 = {}{ K1: mkTuple(l_returnflag, tmp0[K1], l_linestatus, tmp1[K1], sum_qty, tmp2[K1], sum_base_price, tmp3[K1], sum_disc_price, tmp4[K1], sum_charge, tmp5[K1], avg_qty, tmp7[K1], avg_price, tmp9[K1], avg_disc, tmp12[K1], count_order, tmp13[K1]) } / mkset(combine(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_returnflag], loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_linestatus]))[K1]
            unsigned long hash0 = 0;
            unsigned long tmp_hash0 = hash(file0 + file0_D0_l_returnflag_start, file0_D0_l_returnflag_end - file0_D0_l_returnflag_start);
            hash0 *= 41;
            hash0 += tmp_hash0;
            unsigned long tmp_hash1 = hash(file0 + file0_D0_l_linestatus_start, file0_D0_l_linestatus_end - file0_D0_l_linestatus_start);
            hash0 *= 41;
            hash0 += tmp_hash1;
            unsigned long pos0 = hash0 & 16777215;
            while (tmp14_htable[pos0] != -1 && (compare_str2(tmp14_keys_str0[tmp14_htable[pos0]], tmp14_keys_len0[tmp14_htable[pos0]], file0 + file0_D0_l_returnflag_start, file0_D0_l_returnflag_end - file0_D0_l_returnflag_start) != 0 || compare_str2(tmp14_keys_str1[tmp14_htable[pos0]], tmp14_keys_len1[tmp14_htable[pos0]], file0 + file0_D0_l_linestatus_start, file0_D0_l_linestatus_end - file0_D0_l_linestatus_start) != 0)) {
                pos0 = (pos0 + 1) & 16777215;
            }
            int key_pos0 = tmp14_htable[pos0];
            if (key_pos0 == -1) {
                key_pos0 = tmp14_key_count;
                tmp14_key_count++;
                if (tmp14_key_count == 16777216) {
                    fprintf(stderr, "hashmap size reached its full capacity");
                    return 1;
                }
                tmp14_htable[pos0] = key_pos0;
                tmp14_keys_str0[key_pos0] = file0 + file0_D0_l_returnflag_start;
                tmp14_keys_len0[key_pos0] = file0_D0_l_returnflag_end - file0_D0_l_returnflag_start;
                tmp14_keys_str1[key_pos0] = file0 + file0_D0_l_linestatus_start;
                tmp14_keys_len1[key_pos0] = file0_D0_l_linestatus_end - file0_D0_l_linestatus_start;
                // init tmp14[K1][sum_qty] = sum(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_quantity]))
                tmp14_sum_qty[key_pos0] = 0;
                // init tmp14[K1][sum_base_price] = sum(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_extendedprice]))
                tmp14_sum_base_price[key_pos0] = 0;
                // init tmp14[K1][sum_disc_price] = sum(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), times(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_extendedprice], minus(1, loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_discount]))))
                tmp14_sum_disc_price[key_pos0] = 0;
                // init tmp14[K1][sum_charge] = sum(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), times(times(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_extendedprice], minus(1, loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_discount])), plus(1, loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_tax]))))
                tmp14_sum_charge[key_pos0] = 0;
                // init tmp14[K1][count_order] = count(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_orderkey]))
                tmp14_count_order[key_pos0] = 0;
                // init tmp2[K1] = sum(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_quantity]))
                tmp2_values[key_pos0] = 0;
                // init tmp6[K1] = count(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_quantity]))
                tmp6_values[key_pos0] = 0;
                // init tmp3[K1] = sum(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_extendedprice]))
                tmp3_values[key_pos0] = 0;
                // init tmp8[K1] = count(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_extendedprice]))
                tmp8_values[key_pos0] = 0;
                // init tmp10[K1] = sum(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_discount]))
                tmp10_values[key_pos0] = 0;
                // init tmp11[K1] = count(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_discount]))
                tmp11_values[key_pos0] = 0;
            }
            // update tmp2[K1][sum_qty] = sum(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_quantity]))
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp2_values[key_pos0] += file0_D0_l_quantity;
            }
            // update tmp6[K1] = count(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_quantity]))
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp6_values[key_pos0] += 1;
            }
            // update tmp3[K1][sum_base_price] = sum(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_extendedprice]))
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp3_values[key_pos0] += file0_D0_l_extendedprice;
            }
            // update tmp8[K1] = count(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_extendedprice]))
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp8_values[key_pos0] += 1;
            }
            // update tmp10[K1] = sum(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_discount]))
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp10_values[key_pos0] += file0_D0_l_discount;
            }
            // update tmp11[K1] = count(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_discount]))
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp11_values[key_pos0] += 1;
            }
            // update tmp14[K1][l_returnflag] = single(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_returnflag])
            tmp14_l_returnflag_str[key_pos0] = file0 + file0_D0_l_returnflag_start;
            tmp14_l_returnflag_len[key_pos0] = file0_D0_l_returnflag_end - file0_D0_l_returnflag_start;
            // update tmp14[K1][l_linestatus] = single(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_linestatus])
            tmp14_l_linestatus_str[key_pos0] = file0 + file0_D0_l_linestatus_start;
            tmp14_l_linestatus_len[key_pos0] = file0_D0_l_linestatus_end - file0_D0_l_linestatus_start;
            // update tmp14[K1][sum_qty] = sum(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_quantity]))
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp14_sum_qty[key_pos0] += file0_D0_l_quantity;
            }
            // update tmp14[K1][sum_base_price] = sum(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_extendedprice]))
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp14_sum_base_price[key_pos0] += file0_D0_l_extendedprice;
            }
            // update tmp14[K1][sum_disc_price] = sum(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), times(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_extendedprice], minus(1, loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_discount]))))
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp14_sum_disc_price[key_pos0] += (file0_D0_l_extendedprice * (1 - file0_D0_l_discount));
            }
            // update tmp14[K1][sum_charge] = sum(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), times(times(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_extendedprice], minus(1, loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_discount])), plus(1, loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_tax]))))
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp14_sum_charge[key_pos0] += ((file0_D0_l_extendedprice * (1 - file0_D0_l_discount)) * (1 + file0_D0_l_tax));
            }
            // update tmp14[K1][avg_qty] = single(fdiv(tmp2[K1], tmp6[K1]))
            tmp14_avg_qty[key_pos0] = ((double)tmp2_values[key_pos0] / (double)tmp6_values[key_pos0]);
            // update tmp14[K1][avg_price] = single(fdiv(tmp3[K1], tmp8[K1]))
            tmp14_avg_price[key_pos0] = ((double)tmp3_values[key_pos0] / (double)tmp8_values[key_pos0]);
            // update tmp14[K1][avg_disc] = single(fdiv(tmp10[K1], tmp11[K1]))
            tmp14_avg_disc[key_pos0] = ((double)tmp10_values[key_pos0] / (double)tmp11_values[key_pos0]);
            // update tmp14[K1][count_order] = count(and(lessThanOrEqual(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_shipdate], 19980902), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[D0][l_orderkey]))
            if ((file0_D0_l_shipdate <= 19980902)) {
                tmp14_count_order[key_pos0] += 1;
            }
        }
    }
    // qsort(tmp14_values, tmp14_key_count, sizeof(struct tmp14_value), (__compar_fn_t)compare_func0);
    int *tmp14 = (int*)malloc(sizeof(int) * tmp14_key_count);
    for (int i = 0; i < tmp14_key_count; i++) tmp14[i] = i;
    qsort(tmp14, tmp14_key_count, sizeof(int), (__compar_fn_t)compare_func0);
    // print hashmap
    for (int i = 0; i < tmp14_key_count; i++) {
        int key_pos = tmp14[i];
        // print value
        print(tmp14_l_returnflag_str[key_pos], tmp14_l_returnflag_len[key_pos]);
        print("|", 1);
        print(tmp14_l_linestatus_str[key_pos], tmp14_l_linestatus_len[key_pos]);
        print("|", 1);
        printf("%.4lf", tmp14_sum_qty[key_pos]);
        print("|", 1);
        printf("%.4lf", tmp14_sum_base_price[key_pos]);
        print("|", 1);
        printf("%.4lf", tmp14_sum_disc_price[key_pos]);
        print("|", 1);
        printf("%.4lf", tmp14_sum_charge[key_pos]);
        print("|", 1);
        printf("%.4lf", tmp14_avg_qty[key_pos]);
        print("|", 1);
        printf("%.4lf", tmp14_avg_price[key_pos]);
        print("|", 1);
        printf("%.4lf", tmp14_avg_disc[key_pos]);
        print("|", 1);
        printf("%u", tmp14_count_order[key_pos]);
        print("|", 1);
        print("\n", 1);
    }
    struct timeval timeval2;
    gettimeofday(&timeval2, NULL);
    long t2 = timeval2.tv_sec * 1000000L + timeval2.tv_usec;
    fprintf(stderr, "Timing:\n\tInitializaton:\t%ld μs\n\tRuntime:\t%ld μs\n\tTotal:\t\t%ld μs\n", t1 - t0, t2 - t1, t2 - t0);
    return 0;
}