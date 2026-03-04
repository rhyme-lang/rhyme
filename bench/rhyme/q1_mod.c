#include "yyjson.h"
#include "rhyme-c.h"
typedef int (*__compar_fn_t)(const void *, const void *);
uint32_t *tmp6_total_commits;
struct tmp4 {
    const char **tmp4_keys_str0;
    int *tmp4_keys_len0;
    int *tmp4_htable;
    int tmp4_key_count;
    uint32_t *tmp4_total_commits;
};
struct tmp5 {
    const char **tmp5_keys_str0;
    int *tmp5_keys_len0;
    int *tmp5_htable;
    int tmp5_key_count;
    uint32_t *tmp5_total_commits;
    struct tmp4 **tmp5_monthly_activity;
};
int compare_func0(int *i, int *j) {
    int tmp_cmp0 = ((tmp6_total_commits[*j] < tmp6_total_commits[*i]) ? -1 : ((tmp6_total_commits[*j] > tmp6_total_commits[*i]) ? 1 : 0));
    return tmp_cmp0;
}
int main(int argc, char **argv) {
    if (argc < 2) {
        return 1;
    }
    struct timeval timeval0;
    gettimeofday(&timeval0, NULL);
    long t0 = ((timeval0.tv_sec * 1000000L) + timeval0.tv_usec);
    // init hashmap for tmp6
    // keys of tmp6
    const char **tmp6_keys_str0 = (const char **)malloc(sizeof(const char *) * 65536);
    int *tmp6_keys_len0 = (int *)malloc(sizeof(int) * 65536);
    // key count for tmp6
    int tmp6_key_count = 0;
    // hash table for tmp6
    int *tmp6_htable = (int *)calloc(65536, sizeof(int));
    // value of tmp6: email
    const char **tmp6_email_str = (const char **)malloc(sizeof(const char *) * 65536);
    int *tmp6_email_len = (int *)malloc(sizeof(int) * 65536);
    uint8_t *tmp6_email_defined = (uint8_t *)calloc(65536, sizeof(uint8_t));
    // value of tmp6: total_commits
    (tmp6_total_commits = (uint32_t *)malloc(sizeof(uint32_t) * 65536));
    struct tmp5 **tmp6_yearly_activity = (struct tmp5 **)malloc(sizeof(struct tmp5 *) * 65536);
    // value of tmp5: total_commits
    // value of tmp4: total_commits
    struct timeval timeval1;
    gettimeofday(&timeval1, NULL);
    long t1 = ((timeval1.tv_sec * 1000000L) + timeval1.tv_usec);
    int fd0 = open(argv[1], 0);
    if ((fd0 == -1)) {
        fprintf(stderr, "Unable to open file %s\n", argv[1]);
        return 1;
    }
    size_t n0 = fsize(fd0);
    char *file_ndjson0 = malloc(sizeof(char) * (n0 + YYJSON_PADDING_SIZE));
    size_t off0 = 0;
    size_t r0;
    while (((off0 < n0) && (r0 = read(fd0, (file_ndjson0 + off0), (n0 - off0))))) {
        (off0 = (off0 + r0));
    }
    memset((file_ndjson0 + n0), 0, YYJSON_PADDING_SIZE);
    close(fd0);
    size_t i0 = 0;
    // generator: *i <- loadInput('ndjson', cgen-sql/data/commits/commits.json)
    for (int xi = 0; i0 < n0; xi++) {
        yyjson_doc *tmp_doc0 = yyjson_read_opts((file_ndjson0 + i0), (n0 - i0), YYJSON_READ_INSITU | YYJSON_READ_STOP_WHEN_DONE, NULL, NULL);
        if (!tmp_doc0) {
            break;
        }
        yyjson_val *xi_gen = yyjson_doc_get_root(tmp_doc0);
        (i0 = (i0 + yyjson_doc_get_read_size(tmp_doc0)));
        // generator: *j <- loadInput('ndjson', cgen-sql/data/commits/commits.json)[*i]
        yyjson_arr_iter iter0 = yyjson_arr_iter_with(xi_gen);
        for (int xj = 0; ; xj++) {
            yyjson_val *xj_gen = yyjson_arr_iter_next(&iter0);
            if (!xj_gen) break;
            yyjson_val *tmp_get6 = yyjson_obj_getn(xj_gen, "commit", 6);
            yyjson_val *tmp_get7 = yyjson_obj_getn(tmp_get6, "author", 6);
            yyjson_val *tmp_get8 = yyjson_obj_getn(tmp_get7, "name", 4);
            // generator: K2 <- mkset(loadInput('ndjson', cgen-sql/data/commits/commits.json)[*i][*j][commit][author][name])
            if (!((((tmp_get6 == NULL) || (tmp_get7 == NULL)) || (tmp_get8 == NULL)) || !yyjson_is_str(tmp_get8))) {
                // singleton value here
                unsigned long hash0 = 0;
                unsigned long tmp_hash0 = hash(yyjson_get_str(tmp_get8), yyjson_get_len(tmp_get8));
                (hash0 = (hash0 + tmp_hash0));
                unsigned long tmp_pos0$ = (hash0 & 65535);
                while (((tmp6_htable[tmp_pos0$] != 0) && (compare_str2(tmp6_keys_str0[tmp6_htable[tmp_pos0$]], tmp6_keys_len0[tmp6_htable[tmp_pos0$]], yyjson_get_str(tmp_get8), yyjson_get_len(tmp_get8)) != 0))) {
                    (tmp_pos0$ = ((tmp_pos0$ + 1) & 65535));
                }
                int key_pos0$ = tmp6_htable[tmp_pos0$];
                if ((key_pos0$ == 0)) {
                    tmp6_key_count++;
                    (key_pos0$ = tmp6_key_count);
                    (tmp6_htable[tmp_pos0$] = key_pos0$);
                    (tmp6_keys_str0[key_pos0$] = yyjson_get_str(tmp_get8));
                    (tmp6_keys_len0[key_pos0$] = yyjson_get_len(tmp_get8));
                    (tmp6_total_commits[key_pos0$] = 0);
                    (tmp6_yearly_activity[key_pos0$] = (struct tmp5 *)malloc(sizeof(struct tmp5) * 1));
                    (tmp6_yearly_activity[key_pos0$]->tmp5_key_count = 0);
                    (tmp6_yearly_activity[key_pos0$]->tmp5_htable = (int *)calloc(64, sizeof(int)));
                    (tmp6_yearly_activity[key_pos0$]->tmp5_keys_str0 = (const char **)malloc(sizeof(const char *) * 64));
                    (tmp6_yearly_activity[key_pos0$]->tmp5_keys_len0 = (int *)malloc(sizeof(int) * 64));
                    (tmp6_yearly_activity[key_pos0$]->tmp5_total_commits = (uint32_t *)malloc(sizeof(uint32_t) * 64));
                    (tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity = (struct tmp4 **)malloc(sizeof(struct tmp4 *) * 64));
                }
                yyjson_val *tmp_get9 = yyjson_obj_getn(xj_gen, "commit", 6);
                yyjson_val *tmp_get10 = yyjson_obj_getn(tmp_get9, "author", 6);
                yyjson_val *tmp_get11 = yyjson_obj_getn(tmp_get10, "email", 5);
                if (!((((tmp_get9 == NULL) || (tmp_get10 == NULL)) || (tmp_get11 == NULL)) || !yyjson_is_str(tmp_get11))) {
                    if (!tmp6_email_defined[key_pos0$]) {
                        (tmp6_email_defined[key_pos0$] = 1);
                        (tmp6_email_str[key_pos0$] = yyjson_get_str(tmp_get11));
                        (tmp6_email_len[key_pos0$] = yyjson_get_len(tmp_get11));
                    }
                }
                (tmp6_total_commits[key_pos0$] = (tmp6_total_commits[key_pos0$] + 1));
                yyjson_val *tmp_get3 = yyjson_obj_getn(xj_gen, "commit", 6);
                yyjson_val *tmp_get4 = yyjson_obj_getn(tmp_get3, "author", 6);
                yyjson_val *tmp_get5 = yyjson_obj_getn(tmp_get4, "date", 4);
                // generator: K1 <- mkset(substr(loadInput('ndjson', cgen-sql/data/commits/commits.json)[*i][*j][commit][author][date], 0, 4))
                if (!((((tmp_get3 == NULL) || (tmp_get4 == NULL)) || (tmp_get5 == NULL)) || !yyjson_is_str(tmp_get5))) {
                    // singleton value here
                    unsigned long hash1 = 0;
                    unsigned long tmp_hash1 = hash((yyjson_get_str(tmp_get5) + 0), (4 - 0));
                    (hash1 = (hash1 + tmp_hash1));
                    unsigned long tmp_pos5$ = (hash1 & 63);
                    while (((tmp6_yearly_activity[key_pos0$]->tmp5_htable[tmp_pos5$] != 0) && (compare_str2(tmp6_yearly_activity[key_pos0$]->tmp5_keys_str0[tmp6_yearly_activity[key_pos0$]->tmp5_htable[tmp_pos5$]], tmp6_yearly_activity[key_pos0$]->tmp5_keys_len0[tmp6_yearly_activity[key_pos0$]->tmp5_htable[tmp_pos5$]], (yyjson_get_str(tmp_get5) + 0), (4 - 0)) != 0))) {
                        (tmp_pos5$ = ((tmp_pos5$ + 1) & 63));
                    }
                    int key_pos5$ = tmp6_yearly_activity[key_pos0$]->tmp5_htable[tmp_pos5$];
                    if ((key_pos5$ == 0)) {
                        tmp6_yearly_activity[key_pos0$]->tmp5_key_count++;
                        (key_pos5$ = tmp6_yearly_activity[key_pos0$]->tmp5_key_count);
                        (tmp6_yearly_activity[key_pos0$]->tmp5_htable[tmp_pos5$] = key_pos5$);
                        (tmp6_yearly_activity[key_pos0$]->tmp5_keys_str0[key_pos5$] = (yyjson_get_str(tmp_get5) + 0));
                        (tmp6_yearly_activity[key_pos0$]->tmp5_keys_len0[key_pos5$] = (4 - 0));
                        (tmp6_yearly_activity[key_pos0$]->tmp5_total_commits[key_pos5$] = 0);
                        (tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$] = (struct tmp4 *)malloc(sizeof(struct tmp4) * 1));
                        (tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_key_count = 0);
                        (tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_htable = (int *)calloc(64, sizeof(int)));
                        (tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_keys_str0 = (const char **)malloc(sizeof(const char *) * 64));
                        (tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_keys_len0 = (int *)malloc(sizeof(int) * 64));
                        (tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_total_commits = (uint32_t *)malloc(sizeof(uint32_t) * 64));
                    }
                    (tmp6_yearly_activity[key_pos0$]->tmp5_total_commits[key_pos5$] = (tmp6_yearly_activity[key_pos0$]->tmp5_total_commits[key_pos5$] + 1));
                    yyjson_val *tmp_get0 = yyjson_obj_getn(xj_gen, "commit", 6);
                    yyjson_val *tmp_get1 = yyjson_obj_getn(tmp_get0, "author", 6);
                    yyjson_val *tmp_get2 = yyjson_obj_getn(tmp_get1, "date", 4);
                    // generator: K0 <- mkset(substr(loadInput('ndjson', cgen-sql/data/commits/commits.json)[*i][*j][commit][author][date], 0, 7))
                    if (!((((tmp_get0 == NULL) || (tmp_get1 == NULL)) || (tmp_get2 == NULL)) || !yyjson_is_str(tmp_get2))) {
                        // singleton value here
                        unsigned long hash2 = 0;
                        unsigned long tmp_hash2 = hash((yyjson_get_str(tmp_get2) + 0), (7 - 0));
                        (hash2 = (hash2 + tmp_hash2));
                        unsigned long tmp_pos12$ = (hash2 & 63);
                        while (((tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_htable[tmp_pos12$] != 0) && (compare_str2(tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_keys_str0[tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_htable[tmp_pos12$]], tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_keys_len0[tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_htable[tmp_pos12$]], (yyjson_get_str(tmp_get2) + 0), (7 - 0)) != 0))) {
                            (tmp_pos12$ = ((tmp_pos12$ + 1) & 63));
                        }
                        int key_pos12$ = tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_htable[tmp_pos12$];
                        if ((key_pos12$ == 0)) {
                            tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_key_count++;
                            (key_pos12$ = tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_key_count);
                            (tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_htable[tmp_pos12$] = key_pos12$);
                            (tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_keys_str0[key_pos12$] = (yyjson_get_str(tmp_get2) + 0));
                            (tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_keys_len0[key_pos12$] = (7 - 0));
                            (tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_total_commits[key_pos12$] = 0);
                        }
                        (tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_total_commits[key_pos12$] = (tmp6_yearly_activity[key_pos0$]->tmp5_monthly_activity[key_pos5$]->tmp4_total_commits[key_pos12$] + 1));
                    }
                }
            }
        }
        yyjson_doc_free(tmp_doc0);
    }
    int *tmp6 = (int *)malloc(sizeof(int) * tmp6_key_count);
    for (int i = 0; i < tmp6_key_count; i++) tmp6[i] = i + 1;
    qsort(tmp6, tmp6_key_count, sizeof(int), (__compar_fn_t)compare_func0);
    // print hashmap
    printf("{");
    for (int i = 0; i < ((5 < tmp6_key_count) ? 5 : tmp6_key_count); i++) {
        int key_pos = tmp6[i];
        // print key
        printf("\"%.*s\"", tmp6_keys_len0[key_pos], tmp6_keys_str0[key_pos]);
        printf(":");
        // print value
        if ((key_pos == 0)) {
            printf("null");
        } else {
            // print object
            printf("{");
            printf("\"email\":");
            if (((key_pos == 0) || !tmp6_email_defined[key_pos])) {
                printf("null");
            } else {
                printf("\"%.*s\"", tmp6_email_len[key_pos], tmp6_email_str[key_pos]);
            }
            printf(",");
            printf("\"total_commits\":");
            if ((key_pos == 0)) {
                printf("null");
            } else {
                printf("%u", tmp6_total_commits[key_pos]);
            }
            printf(",");
            printf("\"yearly_activity\":");
            if ((key_pos == 0)) {
                printf("null");
            } else {
                // print nested hashmap
                printf("{");
                for (int key_pos19 = 1; key_pos19 <= tmp6_yearly_activity[key_pos]->tmp5_key_count; key_pos19++) {
                    // print key
                    printf("\"%.*s\"", tmp6_yearly_activity[key_pos]->tmp5_keys_len0[key_pos19], tmp6_yearly_activity[key_pos]->tmp5_keys_str0[key_pos19]);
                    printf(":");
                    // print value
                    if ((key_pos19 == 0)) {
                        printf("null");
                    } else {
                        // print object
                        printf("{");
                        printf("\"total_commits\":");
                        if ((key_pos19 == 0)) {
                            printf("null");
                        } else {
                            printf("%u", tmp6_yearly_activity[key_pos]->tmp5_total_commits[key_pos19]);
                        }
                        printf(",");
                        printf("\"monthly_activity\":");
                        if ((key_pos19 == 0)) {
                            printf("null");
                        } else {
                            // print nested hashmap
                            printf("{");
                            for (int key_pos20 = 1; key_pos20 <= tmp6_yearly_activity[key_pos]->tmp5_monthly_activity[key_pos19]->tmp4_key_count; key_pos20++) {
                                // print key
                                printf("\"%.*s\"", tmp6_yearly_activity[key_pos]->tmp5_monthly_activity[key_pos19]->tmp4_keys_len0[key_pos20], tmp6_yearly_activity[key_pos]->tmp5_monthly_activity[key_pos19]->tmp4_keys_str0[key_pos20]);
                                printf(":");
                                // print value
                                if ((key_pos20 == 0)) {
                                    printf("null");
                                } else {
                                    // print object
                                    printf("{");
                                    printf("\"total_commits\":");
                                    if ((key_pos20 == 0)) {
                                        printf("null");
                                    } else {
                                        printf("%u", tmp6_yearly_activity[key_pos]->tmp5_monthly_activity[key_pos19]->tmp4_total_commits[key_pos20]);
                                    }
                                    printf("}");
                                }
                                if (key_pos20 != tmp6_yearly_activity[key_pos]->tmp5_monthly_activity[key_pos19]->tmp4_key_count) {
                                    printf(",");
                                }
                            }
                            printf("}");
                        }
                        printf("}");
                    }
                    if (key_pos19 != tmp6_yearly_activity[key_pos]->tmp5_key_count) {
                        printf(",");
                    }
                }
                printf("}");
            }
            printf("}");
        }
        if (i != ((5 < tmp6_key_count) ? 5 : tmp6_key_count) - 1) {
            printf(",");
        }
    }
    printf("}");
    fflush(stdout);
    struct timeval timeval2;
    gettimeofday(&timeval2, NULL);
    long t2 = ((timeval2.tv_sec * 1000000L) + timeval2.tv_usec);
    fprintf(stderr, "\n\nTiming:\n\tInitializaton:\t%ld μs\n\tRuntime:\t%ld μs\n\tTotal:\t\t%ld μs\n", (t1 - t0), (t2 - t1), (t2 - t0));
    return 0;
}
