#include "rhyme-sql.h"
#include <sys/time.h>

typedef int (*__compar_fn_t)(const void *, const void *);

struct tmp4_value {
    char *o_orderpriority_str;
    int o_orderpriority_len;
    int count;
};

int32_t comp(struct tmp4_value* a, struct tmp4_value* b) {
    return -compare_str2(a->o_orderpriority_str, a->o_orderpriority_len, b->o_orderpriority_str, b->o_orderpriority_len);
}

int main() {
    struct timeval timeval0;
    gettimeofday(&timeval0, NULL);
    long t0 = timeval0.tv_sec * 1000000L + timeval0.tv_usec;
    // init hashmap for tmp2
    // keys of tmp2
    int32_t *tmp2_keys0 = (int32_t *)malloc(sizeof(int32_t) * 16777216);
    // key count for tmp2
    int tmp2_key_count = 0;
    // hash table for tmp2
    int *tmp2_htable = (int *)malloc(sizeof(int) * 16777216);
    // init hash table entries to -1 for tmp2
    for (int i = 0; i < 16777216; i++) tmp2_htable[i] = -1;
    // values of tmp2
    uint32_t *tmp2_values = (uint32_t *)malloc(sizeof(uint32_t) * 16777216);
    // init hashmap for tmp4
    // keys of tmp4
    char **tmp4_keys_str0 = (char **)malloc(sizeof(char *) * 16777216);
    int *tmp4_keys_len0 = (int *)malloc(sizeof(int) * 16777216);
    // key count for tmp4
    int tmp4_key_count = 0;
    // hash table for tmp4
    int *tmp4_htable = (int *)malloc(sizeof(int) * 16777216);
    // init hash table entries to -1 for tmp4
    for (int i = 0; i < 16777216; i++) tmp4_htable[i] = -1;
    // values of tmp4
    struct tmp4_value *tmp4_values = (struct tmp4_value *)malloc(sizeof(struct tmp4_value) * 16777216);
    // char **tmp4_o_orderpriority_str = (char **)malloc(sizeof(char *) * 16777216);
    // int *tmp4_o_orderpriority_len = (int *)malloc(sizeof(int) * 16777216);
    // uint32_t *tmp4_count = (uint32_t *)malloc(sizeof(uint32_t) * 16777216);
    // loading input file: cgen-sql/data/SF1/orders.tbl
    const char *tmp_str0 = "cgen-sql/data/SF1/orders.tbl";
    int fd0 = open(tmp_str0, 0);
    if (fd0 == -1) {
        fprintf(stderr, "Unable to open file %s\n", tmp_str0);
        return 1;
    }
    int n0 = fsize(fd0);
    char *file0 = mmap(0, n0, PROT_READ, MAP_FILE | MAP_SHARED, fd0, 0);
    close(fd0);
    // loading input file: cgen-sql/data/SF1/lineitem.tbl
    const char *tmp_str1 = "cgen-sql/data/SF1/lineitem.tbl";
    int fd1 = open(tmp_str1, 0);
    if (fd1 == -1) {
        fprintf(stderr, "Unable to open file %s\n", tmp_str1);
        return 1;
    }
    int n1 = fsize(fd1);
    char *file1 = mmap(0, n1, PROT_READ, MAP_FILE | MAP_SHARED, fd1, 0);
    close(fd1);
    struct timeval timeval1;
    gettimeofday(&timeval1, NULL);
    long t1 = timeval1.tv_sec * 1000000L + timeval1.tv_usec;
    int i0 = 0;
    // generator: *l <- loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)
    while (1) {
        if (i0 >= n1) break;
        // reading column l_orderkey
        int32_t file1_xl_l_orderkey = 0;
        while (file1[i0] != '|') {
            // extract integer
            file1_xl_l_orderkey = file1_xl_l_orderkey * 10 + file1[i0] - '0';
            i0++;
        }
        i0++;
        // reading column l_partkey
        while (file1[i0] != '|') i0++;
        i0++;
        // reading column l_suppkey
        while (file1[i0] != '|') i0++;
        i0++;
        // reading column l_linenumber
        while (file1[i0] != '|') i0++;
        i0++;
        // reading column l_quantity
        while (file1[i0] != '|') i0++;
        i0++;
        // reading column l_extendedprice
        while (file1[i0] != '|') i0++;
        i0++;
        // reading column l_discount
        while (file1[i0] != '|') i0++;
        i0++;
        // reading column l_tax
        while (file1[i0] != '|') i0++;
        i0++;
        // reading column l_returnflag
        while (file1[i0] != '|') i0++;
        i0++;
        // reading column l_linestatus
        while (file1[i0] != '|') i0++;
        i0++;
        // reading column l_shipdate
        i0 += 11;
        // reading column l_commitdate
        int file1_xl_l_commitdate = (((((((file1[i0] * 10 + file1[i0 + 1]) * 10 + file1[i0 + 2]) * 10 + file1[i0 + 3]) * 10 + file1[i0 + 5]) * 10 + file1[i0 + 6]) * 10 + file1[i0 + 8]) * 10 + file1[i0 + 9]) - 533333328;
        i0 += 11;
        // reading column l_receiptdate
        int file1_xl_l_receiptdate = (((((((file1[i0] * 10 + file1[i0 + 1]) * 10 + file1[i0 + 2]) * 10 + file1[i0 + 3]) * 10 + file1[i0 + 5]) * 10 + file1[i0 + 6]) * 10 + file1[i0 + 8]) * 10 + file1[i0 + 9]) - 533333328;
        i0 += 11;
        // reading column l_shipinstruct
        while (file1[i0] != '|') i0++;
        i0++;
        // reading column l_shipmode
        while (file1[i0] != '|') i0++;
        i0++;
        // reading column l_comment
        while (file1[i0] != '|') i0++;
        i0++;
        i0++;
        // generator: K1 <- mkset(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[*l][l_orderkey])
        {
            // singleton value here
            // init and update tmp2[undefined] = tmp4[]
            unsigned long hash0 = 0;
            unsigned long tmp_hash0 = (unsigned long)file1_xl_l_orderkey;
            hash0 *= 41;
            hash0 += tmp_hash0;
            unsigned long pos0 = hash0 & 16777215;
            while (tmp2_htable[pos0] != -1 && (tmp2_keys0[tmp2_htable[pos0]] != file1_xl_l_orderkey)) {
                pos0 = (pos0 + 1) & 16777215;
            }
            int key_pos0 = tmp2_htable[pos0];
            if (key_pos0 == -1) {
                key_pos0 = tmp2_key_count;
                tmp2_key_count++;
                tmp2_htable[pos0] = key_pos0;
                tmp2_keys0[key_pos0] = file1_xl_l_orderkey;
                // init tmp2[K1] = count(and(lessThan(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[*l][l_commitdate], loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[*l][l_receiptdate]), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[*l][l_orderkey]))
                tmp2_values[key_pos0] = 0;
            }
            // update tmp2[K1] = count(and(lessThan(loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[*l][l_commitdate], loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[*l][l_receiptdate]), loadInput('tbl', cgen-sql/data/SF1/lineitem.tbl)[*l][l_orderkey]))
            if ((file1_xl_l_commitdate < file1_xl_l_receiptdate)) {
                tmp2_values[key_pos0] += 1;
            }
        }
    }
    int i1 = 0;
    // generator: D0 <- loadInput('tbl', cgen-sql/data/SF1/orders.tbl)
    while (1) {
        if (i1 >= n0) break;
        // reading column o_orderkey
        int32_t file0_D0_o_orderkey = 0;
        while (file0[i1] != '|') {
            // extract integer
            file0_D0_o_orderkey = file0_D0_o_orderkey * 10 + file0[i1] - '0';
            i1++;
        }
        i1++;
        // reading column o_custkey
        while (file0[i1] != '|') i1++;
        i1++;
        // reading column o_orderstatus
        while (file0[i1] != '|') i1++;
        i1++;
        // reading column o_totalprice
        while (file0[i1] != '|') i1++;
        i1++;
        // reading column o_orderdate
        int file0_D0_o_orderdate = (((((((file0[i1] * 10 + file0[i1 + 1]) * 10 + file0[i1 + 2]) * 10 + file0[i1 + 3]) * 10 + file0[i1 + 5]) * 10 + file0[i1 + 6]) * 10 + file0[i1 + 8]) * 10 + file0[i1 + 9]) - 533333328;
        i1 += 11;
        // reading column o_orderpriority
        int file0_D0_o_orderpriority_start = i1;
        while (file0[i1] != '|') i1++;
        int file0_D0_o_orderpriority_end = i1;
        i1++;
        // reading column o_clerk
        while (file0[i1] != '|') i1++;
        i1++;
        // reading column o_shippriority
        while (file0[i1] != '|') i1++;
        i1++;
        // reading column o_comment
        while (file0[i1] != '|') i1++;
        i1++;
        i1++;
        // generator: K2 <- mkset(loadInput('tbl', cgen-sql/data/SF1/orders.tbl)[D0][o_orderpriority])
        {
            // singleton value here
            // init and update tmp4[undefined] = tmp4[]
            unsigned long hash1 = 0;
            unsigned long tmp_hash1 = hash(file0 + file0_D0_o_orderpriority_start, file0_D0_o_orderpriority_end - file0_D0_o_orderpriority_start);
            hash1 *= 41;
            hash1 += tmp_hash1;
            unsigned long pos1 = hash1 & 16777215;
            while (tmp4_htable[pos1] != -1 && (compare_str2(tmp4_keys_str0[tmp4_htable[pos1]], tmp4_keys_len0[tmp4_htable[pos1]], file0 + file0_D0_o_orderpriority_start, file0_D0_o_orderpriority_end - file0_D0_o_orderpriority_start) != 0)) {
                pos1 = (pos1 + 1) & 16777215;
            }
            int key_pos1 = tmp4_htable[pos1];
            if (key_pos1 == -1) {
                key_pos1 = tmp4_key_count;
                tmp4_key_count++;
                tmp4_htable[pos1] = key_pos1;
                tmp4_keys_str0[key_pos1] = file0 + file0_D0_o_orderpriority_start;
                tmp4_keys_len0[key_pos1] = file0_D0_o_orderpriority_end - file0_D0_o_orderpriority_start;
                // init tmp4[K2] = count(and(andAlso(andAlso(lessThanOrEqual(19930701, loadInput('tbl', cgen-sql/data/SF1/orders.tbl)[D0][o_orderdate]), lessThan(loadInput('tbl', cgen-sql/data/SF1/orders.tbl)[D0][o_orderdate], 19931001)), greaterThan(tmp2[][loadInput('tbl', cgen-sql/data/SF1/orders.tbl)[D0][o_orderkey]], 0)), loadInput('tbl', cgen-sql/data/SF1/orders.tbl)[D0][o_orderkey]))
                tmp4_values[key_pos1].count = 0;
            }
            // update tmp4[K2] = single(loadInput('tbl', cgen-sql/data/SF1/orders.tbl)[D0][o_orderpriority])
            tmp4_values[key_pos1].o_orderpriority_str = file0 + file0_D0_o_orderpriority_start;
            tmp4_values[key_pos1].o_orderpriority_len = file0_D0_o_orderpriority_end - file0_D0_o_orderpriority_start;
            // update tmp4[K2] = count(and(andAlso(andAlso(lessThanOrEqual(19930701, loadInput('tbl', cgen-sql/data/SF1/orders.tbl)[D0][o_orderdate]), lessThan(loadInput('tbl', cgen-sql/data/SF1/orders.tbl)[D0][o_orderdate], 19931001)), greaterThan(tmp2[][loadInput('tbl', cgen-sql/data/SF1/orders.tbl)[D0][o_orderkey]], 0)), loadInput('tbl', cgen-sql/data/SF1/orders.tbl)[D0][o_orderkey]))
            unsigned long hash2 = 0;
            unsigned long tmp_hash2 = (unsigned long)file0_D0_o_orderkey;
            hash2 *= 41;
            hash2 += tmp_hash2;
            unsigned long pos2 = hash2 & 16777215;
            while (tmp2_htable[pos2] != -1 && (tmp2_keys0[tmp2_htable[pos2]] != file0_D0_o_orderkey)) {
                pos2 = (pos2 + 1) & 16777215;
            }
            int key_pos2 = tmp2_htable[pos2];
            if ((((19930701 <= file0_D0_o_orderdate) && (file0_D0_o_orderdate < 19931001)) && (tmp2_values[key_pos2] > 0))) {
                tmp4_values[key_pos1].count += 1;
            }
        }
    }
    // sort
    qsort(tmp4_values, tmp4_key_count, sizeof(struct tmp4_value), (__compar_fn_t)comp);
    // print hashmap
    for (int key_pos = 0; key_pos < tmp4_key_count; key_pos++) {
        // print value
        print(tmp4_values[key_pos].o_orderpriority_str, tmp4_values[key_pos].o_orderpriority_len);
        print("|", 1);
        printf("%u", tmp4_values[key_pos].count);
        print("|", 1);
        print("\n", 1);
    }
    struct timeval timeval2;
    gettimeofday(&timeval2, NULL);
    long t2 = timeval2.tv_sec * 1000000L + timeval2.tv_usec;
    fprintf(stderr, "Timing:\n\tInitializaton:\t%ld μs\n\tRuntime:\t%ld μs\n\tTotal:\t\t%ld μs\n", t1 - t0, t2 - t1, t2 - t0);
    return 0;
}