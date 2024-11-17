#include <stdio.h>

int main() {
    FILE *fin = fopen("./t1gram.csv", "r");
    if (fin == NULL) {
        fputs("Unable to open ./t1gram.csv", stderr);
    }

    FILE *fout = fopen("./t1gram_converted.csv", "w");
    if (fout == NULL) {
        fputs("Unable to open ./t1gram_converted.csv", stderr);
    }
    fputs("n_gram,year,match_count,volumn_count\n", fout);

    while (1) {
        char c = fgetc(fin);
        if (c == EOF) {
            break;
        }

        if (c == '\t') {
            fputc(',', fout);
        } else {
            fputc(c, fout);
        }
    }

    fclose(fin);
    fclose(fout);
    return 0;
}