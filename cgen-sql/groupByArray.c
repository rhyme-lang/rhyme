#include "rhyme-sql.h"
int main() {
    // loading CSV file: ./cgen-sql/region.csv
    int fd0 = open("./cgen-sql/region.csv", 0);
    if (fd0 == -1) {
        fprintf(stderr, "Unable to open file ./cgen-sql/region.csv\n");
        return 1;
    }
    int n0 = fsize(fd0);
    char *csv0 = mmap(0, n0, PROT_READ, MAP_FILE | MAP_SHARED, fd0, 0);
    close(fd0);
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
    char **tmp0_data_str = (char **)malloc(sizeof(char *) * 65536);
    int *tmp0_data_len = (int *)malloc(sizeof(int) * 65536);
    int tmp0_data_count = 0;
    int *tmp0_buckets = (int *)malloc(sizeof(int) * 65536);
    int *tmp0_bucket_counts = (int *)malloc(sizeof(int) * 256);
    int i0 = 0;
    while (i0 < n0 && csv0[i0] != '\n') {
        i0++;
    }
    i0++;
    // generator: *O <- loadCSV(./cgen-sql/region.csv)
    xO = -1;
    while (1) {
        xO++;
        if (i0 >= n0) break;
        // reading column region
        int csv0_xO_region_start = i0;
        while (i0 < n0 && csv0[i0] != ',') {
            i0++;
        }
        int csv0_xO_region_end = i0;
        i0++;
        // reading column country
        int csv0_xO_country_start = i0;
        while (i0 < n0 && csv0[i0] != '\n') {
            i0++;
        }
        int csv0_xO_country_end = i0;
        i0++;
        // generator: K0 <- mkset(loadCSV(./cgen-sql/region.csv)[*O][region])
        {
            // singleton value here
            // update tmp0 for array
            unsigned long hash0 = hash(csv0 + csv0_xO_region_start, csv0_xO_region_end - csv0_xO_region_start);
            unsigned long pos0 = hash0 & 255;
            while (tmp0_htable[pos0] != -1 && compare_str2(tmp0_keys_str[tmp0_htable[pos0]], tmp0_keys_len[tmp0_htable[pos0]], csv0 + csv0_xO_region_start, csv0_xO_region_end - csv0_xO_region_start) != 0) {
                pos0 = (pos0 + 1) & 255;
            }
            int key_pos0 = tmp0_htable[pos0];
            if (key_pos0 == -1) {
                key_pos0 = tmp0_key_count;
                tmp0_key_count++;
                tmp0_htable[pos0] = key_pos0;
                tmp0_keys_str[key_pos0] = csv0 + csv0_xO_region_start;
                tmp0_keys_len[key_pos0] = csv0_xO_region_end - csv0_xO_region_start;
                tmp0_bucket_counts[key_pos0] = 0;
            }
            int data_pos0 = tmp0_data_count;
            tmp0_data_count++;
            int bucket_pos0 = tmp0_bucket_counts[key_pos0];
            tmp0_bucket_counts[key_pos0] = bucket_pos0 + 1;
            tmp0_buckets[key_pos0 * 256 + bucket_pos0] = data_pos0;
            tmp0_data_str[data_pos0] = csv0 + csv0_xO_country_start;
            tmp0_data_len[data_pos0] = csv0_xO_country_end - csv0_xO_country_start;
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
            print(tmp0_data_str[data_pos], tmp0_data_len[data_pos]);
            if (j != bucket_count - 1) {
                print(", ", 2);
            }
        }
        print("]\n", 2);
        
    }
    return 0;
}