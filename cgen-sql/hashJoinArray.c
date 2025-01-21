#include "rhyme-sql.h"
int main() {
    // loading CSV file: ./cgen-sql/country.csv
    int fd0 = open("./cgen-sql/country.csv", 0);
    if (fd0 == -1) {
        fprintf(stderr, "Unable to open file ./cgen-sql/country.csv\n");
        return 1;
    }
    int n0 = fsize(fd0);
    char *csv0 = mmap(0, n0, PROT_READ, MAP_FILE | MAP_SHARED, fd0, 0);
    close(fd0);
    int D1;
    // loading CSV file: ./cgen-sql/region.csv
    int fd1 = open("./cgen-sql/region.csv", 0);
    if (fd1 == -1) {
        fprintf(stderr, "Unable to open file ./cgen-sql/region.csv\n");
        return 1;
    }
    int n1 = fsize(fd1);
    char *csv1 = mmap(0, n1, PROT_READ, MAP_FILE | MAP_SHARED, fd1, 0);
    close(fd1);
    int xO;
    // init hashmap for tmp0
    // keys of tmp0
    char **tmp0_keys_str = (char **)malloc(sizeof(char *) * 256);
    int *tmp0_keys_len = (int *)malloc(sizeof(int) * 256);
    // key count for tmp0
    int tmp0_key_count = 0;
    // hash table for tmp0
    int *tmp0_htable = (int *)malloc(sizeof(int) * 256);
    // init hash table entries to -1 for tmp0
    for (int i = 0; i < 256; i++) tmp0_htable[i] = -1;
    // values of tmp0
    uint32_t *tmp0_data = (uint32_t *)malloc(sizeof(uint32_t) * 65536);
    int tmp0_data_count = 0;
    int *tmp0_buckets = (int *)malloc(sizeof(int) * 65536);
    int *tmp0_bucket_counts = (int *)malloc(sizeof(int) * 256);
    // init hashmap for tmp1
    // keys of tmp1
    char **tmp1_keys_str = (char **)malloc(sizeof(char *) * 256);
    int *tmp1_keys_len = (int *)malloc(sizeof(int) * 256);
    // key count for tmp1
    int tmp1_key_count = 0;
    // hash table for tmp1
    int *tmp1_htable = (int *)malloc(sizeof(int) * 256);
    // init hash table entries to -1 for tmp1
    for (int i = 0; i < 256; i++) tmp1_htable[i] = -1;
    // values of tmp1
    char **tmp1_values_str = (char **)malloc(sizeof(char *) * 256);
    int *tmp1_values_len = (int *)malloc(sizeof(int) * 256);
    // init tmp2 for group
    // init hashmap for tmp2
    // keys of tmp2
    char **tmp2_keys_str = (char **)malloc(sizeof(char *) * 256);
    int *tmp2_keys_len = (int *)malloc(sizeof(int) * 256);
    // key count for tmp2
    int tmp2_key_count = 0;
    // hash table for tmp2
    int *tmp2_htable = (int *)malloc(sizeof(int) * 256);
    // init hash table entries to -1 for tmp2
    for (int i = 0; i < 256; i++) tmp2_htable[i] = -1;
    // values of tmp2
    char **tmp2_values_str = (char **)malloc(sizeof(char *) * 256);
    int *tmp2_values_len = (int *)malloc(sizeof(int) * 256);
    // init tmp3 for group
    // init hashmap for tmp3
    // keys of tmp3
    char **tmp3_keys_str = (char **)malloc(sizeof(char *) * 256);
    int *tmp3_keys_len = (int *)malloc(sizeof(int) * 256);
    // key count for tmp3
    int tmp3_key_count = 0;
    // hash table for tmp3
    int *tmp3_htable = (int *)malloc(sizeof(int) * 256);
    // init hash table entries to -1 for tmp3
    for (int i = 0; i < 256; i++) tmp3_htable[i] = -1;
    // values of tmp3
    uint32_t *tmp3_data = (uint32_t *)malloc(sizeof(uint32_t) * 65536);
    int tmp3_data_count = 0;
    int *tmp3_buckets = (int *)malloc(sizeof(int) * 65536);
    int *tmp3_bucket_counts = (int *)malloc(sizeof(int) * 256);
    int i0 = 0;
    while (i0 < n1 && csv1[i0] != '\n') {
        i0++;
    }
    i0++;
    // generator: *O <- loadCSV(./cgen-sql/region.csv)
    xO = -1;
    while (1) {
        xO++;
        if (i0 >= n1) break;
        // reading column region
        int csv1_xO_region_start = i0;
        while (i0 < n1 && csv1[i0] != ',') {
            i0++;
        }
        int csv1_xO_region_end = i0;
        i0++;
        // reading column country
        int csv1_xO_country_start = i0;
        while (i0 < n1 && csv1[i0] != '\n') {
            i0++;
        }
        int csv1_xO_country_end = i0;
        i0++;
        // generator: K0 <- mkset(loadCSV(./cgen-sql/region.csv)[*O][country])
        {
            // singleton value here
            // update tmp1 for single
            unsigned long hash2 = hash(csv1 + csv1_xO_country_start, csv1_xO_country_end - csv1_xO_country_start);
            unsigned long pos2 = hash2 & 255;
            while (tmp1_htable[pos2] != -1 && compare_str2(tmp1_keys_str[tmp1_htable[pos2]], tmp1_keys_len[tmp1_htable[pos2]], csv1 + csv1_xO_country_start, csv1_xO_country_end - csv1_xO_country_start) != 0) {
                pos2 = (pos2 + 1) & 255;
            }
            int key_pos2 = tmp1_htable[pos2];
            if (key_pos2 == -1) {
                key_pos2 = tmp1_key_count;
                tmp1_key_count++;
                tmp1_htable[pos2] = key_pos2;
                tmp1_keys_str[key_pos2] = csv1 + csv1_xO_country_start;
                tmp1_keys_len[key_pos2] = csv1_xO_country_end - csv1_xO_country_start;
            }
            tmp1_values_str[key_pos2] = csv1 + csv1_xO_region_start;
            tmp1_values_len[key_pos2] = csv1_xO_region_end - csv1_xO_region_start;
        }
    }
    int i1 = 0;
    while (i1 < n1 && csv1[i1] != '\n') {
        i1++;
    }
    i1++;
    // generator: *O <- loadCSV(./cgen-sql/region.csv)
    xO = -1;
    while (1) {
        xO++;
        if (i1 >= n1) break;
        // reading column region
        int csv1_xO_region_start = i1;
        while (i1 < n1 && csv1[i1] != ',') {
            i1++;
        }
        int csv1_xO_region_end = i1;
        i1++;
        // reading column country
        int csv1_xO_country_start = i1;
        while (i1 < n1 && csv1[i1] != '\n') {
            i1++;
        }
        int csv1_xO_country_end = i1;
        i1++;
        // generator: K0 <- mkset(loadCSV(./cgen-sql/region.csv)[*O][country])
        {
            // singleton value here
            // update tmp2 for group
            unsigned long hash3 = hash(csv1 + csv1_xO_country_start, csv1_xO_country_end - csv1_xO_country_start);
            unsigned long pos3 = hash3 & 255;
            while (tmp1_htable[pos3] != -1 && compare_str2(tmp1_keys_str[tmp1_htable[pos3]], tmp1_keys_len[tmp1_htable[pos3]], csv1 + csv1_xO_country_start, csv1_xO_country_end - csv1_xO_country_start) != 0) {
                pos3 = (pos3 + 1) & 255;
            }
            int key_pos3 = tmp1_htable[pos3];
            unsigned long hash4 = hash(csv1 + csv1_xO_country_start, csv1_xO_country_end - csv1_xO_country_start);
            unsigned long pos4 = hash4 & 255;
            while (tmp2_htable[pos4] != -1 && compare_str2(tmp2_keys_str[tmp2_htable[pos4]], tmp2_keys_len[tmp2_htable[pos4]], csv1 + csv1_xO_country_start, csv1_xO_country_end - csv1_xO_country_start) != 0) {
                pos4 = (pos4 + 1) & 255;
            }
            int key_pos4 = tmp2_htable[pos4];
            if (key_pos4 == -1) {
                key_pos4 = tmp2_key_count;
                tmp2_key_count++;
                tmp2_htable[pos4] = key_pos4;
                tmp2_keys_str[key_pos4] = csv1 + csv1_xO_country_start;
                tmp2_keys_len[key_pos4] = csv1_xO_country_end - csv1_xO_country_start;
            }
            tmp2_values_str[key_pos4] = tmp1_values_str[key_pos3];
            tmp2_values_len[key_pos4] = tmp1_values_len[key_pos3];
        }
    }
    int i2 = 0;
    while (i2 < n0 && csv0[i2] != '\n') {
        i2++;
    }
    i2++;
    // generator: D1 <- loadCSV(./cgen-sql/country.csv)
    D1 = -1;
    while (1) {
        D1++;
        if (i2 >= n0) break;
        // reading column country
        int csv0_D1_country_start = i2;
        while (i2 < n0 && csv0[i2] != ',') {
            i2++;
        }
        int csv0_D1_country_end = i2;
        i2++;
        // reading column city
        int csv0_D1_city_start = i2;
        while (i2 < n0 && csv0[i2] != ',') {
            i2++;
        }
        int csv0_D1_city_end = i2;
        i2++;
        // reading column population
        uint32_t csv0_D1_population = 0;
        int csv0_D1_population_start = i2;
        while (i2 < n0 && csv0[i2] != '\n') {
            // extract integer
            csv0_D1_population *= 10;
            csv0_D1_population += csv0[i2] - '0';
            i2++;
        }
        int csv0_D1_population_end = i2;
        i2++;
        unsigned long hash0 = hash(csv0 + csv0_D1_country_start, csv0_D1_country_end - csv0_D1_country_start);
        unsigned long pos0 = hash0 & 255;
        while (tmp2_htable[pos0] != -1 && compare_str2(tmp2_keys_str[tmp2_htable[pos0]], tmp2_keys_len[tmp2_htable[pos0]], csv0 + csv0_D1_country_start, csv0_D1_country_end - csv0_D1_country_start) != 0) {
            pos0 = (pos0 + 1) & 255;
        }
        int key_pos0 = tmp2_htable[pos0];
        // generator: K2 <- mkset(tmp2[][loadCSV(./cgen-sql/country.csv)[D1][country]])
        {
            // singleton value here
            // update tmp0 for array
            unsigned long hash1 = hash(tmp2_values_str[key_pos0], tmp2_values_len[key_pos0]);
            unsigned long pos1 = hash1 & 255;
            while (tmp0_htable[pos1] != -1 && compare_str2(tmp0_keys_str[tmp0_htable[pos1]], tmp0_keys_len[tmp0_htable[pos1]], tmp2_values_str[key_pos0], tmp2_values_len[key_pos0]) != 0) {
                pos1 = (pos1 + 1) & 255;
            }
            int key_pos1 = tmp0_htable[pos1];
            if (key_pos1 == -1) {
                key_pos1 = tmp0_key_count;
                tmp0_key_count++;
                tmp0_htable[pos1] = key_pos1;
                tmp0_keys_str[key_pos1] = tmp2_values_str[key_pos0];
                tmp0_keys_len[key_pos1] = tmp2_values_len[key_pos0];
                tmp0_bucket_counts[key_pos1] = 0;
            }
            int data_pos0 = tmp0_data_count;
            tmp0_data_count++;
            int bucket_pos0 = tmp0_bucket_counts[key_pos1];
            tmp0_bucket_counts[key_pos1] = bucket_pos0 + 1;
            tmp0_buckets[key_pos1 * 256 + bucket_pos0] = data_pos0;
            tmp0_data[data_pos0] = csv0_D1_population;
        }
    }
    
    // print hashmap
    for (int i = 0; i < 256; i++) {
        int key_pos = tmp0_htable[i];
        if (key_pos == -1) {
            continue;
        }
        // print key
        print(tmp0_keys_str[key_pos], tmp0_keys_len[key_pos]);
        print(": ", 2);
        // print value
        print("[", 1);
        int bucket_count = tmp0_bucket_counts[key_pos];
        for (int j = 0; j < bucket_count; j++) {
            int data_pos = tmp0_buckets[key_pos * 256 + j];
            printf("%d", tmp0_data[data_pos]);
            if (j != bucket_count - 1) {
                print(", ", 2);
            }
        }
        print("]\n", 2);
        
    }
    return 0;
}