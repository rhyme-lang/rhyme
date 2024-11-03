#include "rhyme-sql.h"
#include <stdio.h>

typedef struct obj {
    char *key[1024];
    void *val[1024];
} obj_t;

int main() {
    int32_t *tmp0[1024] = { 0 };
    // loadCSV ./cgen-sql/simple.csv
    int fd0 = open("./cgen-sql/simple.csv", 0);
    if (fd0 == -1) {
        fprintf(stderr, "Unable to open file ./cgen-sql/simple.csv\n");
        return 1;
    }
    int n0 = fsize(fd0);
    char *csv0 = mmap(0, n0, PROT_READ, MAP_FILE | MAP_SHARED, fd0, 0);
    close(fd0);
    int i0 = 0;
    while (i0 < n0 && csv0[i0] != '\n') {
        i0++;
    }
    i0++;
    // generator: *A <- loadCSV ./cgen-sql/simple.csv
    while (1) {
        if (i0 >= n0) break;
        // reading column A
        int csv0_xA_A_start = i0;
        while (i0 < n0 && csv0[i0] != ',') {
            i0++;
        }
        int csv0_xA_A_end = i0;
        i0++;
        // reading column B
        int csv0_xA_B_start = i0;
        while (i0 < n0 && csv0[i0] != ',') {
            i0++;
        }
        int csv0_xA_B_end = i0;
        i0++;
        // reading column C
        int csv0_xA_C_start = i0;
        while (i0 < n0 && csv0[i0] != ',') {
            i0++;
        }
        int csv0_xA_C_end = i0;
        i0++;
        // reading column D
        int csv0_xA_D_start = i0;
        while (i0 < n0 && csv0[i0] != ',') {
            i0++;
        }
        int csv0_xA_D_end = i0;
        i0++;
        // reading column String
        int csv0_xA_String_start = i0;
        while (i0 < n0 && csv0[i0] != '\n') {
            i0++;
        }
        int csv0_xA_String_end = i0;
        i0++;
        int32_t csv0_xA_C = extract_int(csv0, csv0_xA_C_start, csv0_xA_C_end);
        // K0 should just be the string which is the group key
        unsigned long hash0 = hash(csv0, csv0_xA_A_start, csv0_xA_A_end) % 1024;
        // init
        if (tmp0[hash0] == NULL) {
            tmp0[hash0] = (int32_t *)malloc(sizeof(int32_t));
            *tmp0[hash0] = 0;
        }
        // update
        *tmp0[hash0] += csv0_xA_C;
    }
    for (int i = 0; i < 1024; i++) {
        if (!tmp0[i]) {
            continue;
        }
        printf("%d\n", *tmp0[i]);
    }
    return 0;
}
