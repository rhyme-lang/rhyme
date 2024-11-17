#include <stdio.h>

int main(int argc, char *argv[]) {
    if (argc != 2) {
        fputs("Usage: convert <file>\n", stderr);
        return 1;
    }

    FILE *fin = fopen(argv[1], "r");
    if (fin == NULL) {
        fprintf(stderr, "Unable to open %s\n", argv[1]);
        return 1;
    }

    FILE *fout = fopen("./out.csv", "w");
    if (fout == NULL) {
        fputs("Unable to open ./out.csv\n", stderr);
        return 1;
    }
    fputs("n_gram,year,match_count,volume_count\n", fout);

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