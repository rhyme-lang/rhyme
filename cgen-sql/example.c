/*
 * Generated from the query: loadCSV("./cgen-sql/simple.csv").*.B | sum
 */

#include "../cgen-sql/rhyme-sql.h"
int main() {
    // loadCSV ./cgen-sql/simple.csv
    int fd0 = open("./cgen-sql/simple.csv", 0);
    if (fd0 == -1) {
        fprintf(stderr, "Unable to open file ./cgen-sql/simple.csv\n");
        return 1;
    }
    int n0 = fsize(fd0);
    char *csv0 = mmap(0, n0, PROT_READ, MAP_FILE | MAP_SHARED, fd0, 0);
    close(fd0);
    int32_t tmp0 = 0;
    int i0 = 0;
    while (i0 < n0 && csv0[i0] != '\n') {
        i0++;
    }
    // generator: D0 <- loadCSV("./cgen-sql/simple.csv")
    while (1) {
        if (i0 >= n0) break;
        // reading column A
        int csv0_D0_A_start = i0;
        while (1) {
            char c = csv0[i0];
            if (c == ',') break;
            i0++;
        }
        int csv0_D0_A_end = i0;
        i0++;
        // reading column B
        int csv0_D0_B_start = i0;
        while (1) {
            char c = csv0[i0];
            if (c == ',') break;
            i0++;
        }
        int csv0_D0_B_end = i0;
        i0++;
        // reading column C
        int csv0_D0_C_start = i0;
        while (1) {
            char c = csv0[i0];
            if (c == ',') break;
            i0++;
        }
        int csv0_D0_C_end = i0;
        i0++;
        // reading column D
        int csv0_D0_D_start = i0;
        while (1) {
            char c = csv0[i0];
            if (c == '\n') break;
            i0++;
        }
        int csv0_D0_D_end = i0;
        i0++;
        tmp0 += extract_int(csv0, csv0_D0_B_start, csv0_D0_B_end);
    }
    printf("res = %d\n", tmp0);
    return 0;
}