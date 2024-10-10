#include <stdio.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
int query(char *inp, int n);
int fsize(int fd) {
    struct stat stat;
    int res = fstat(fd,&stat);
    return stat.st_size;
}
int main(int argc, char *argv[]) {
    if (argc < 2) {
        printf("Usage: %s <csv_file>\n", argv[0]);
        return 1;
    }
    // perform the actual loadCSV operation here
    int fd = open(argv[1], 0);
    int size = fsize(fd);
    char* file = mmap(0, size, PROT_READ, MAP_FILE | MAP_SHARED, fd, 0);
    printf("%d\n", query(file, size));
    close(fd);
    return 0;
}
int query(char *inp, int n) {
    // emit tmp0
    int tmp0 = 0;
    int i0 = 0;
    while (inp[i0] != '\n') {
        i0++;
    }
    while (1) {
        if (i0 >= n) break;
        // reading Phrase
        int start0 = i0;
        while (1) {
            char c0 = inp[i0];
            if (c0 == ',') break;
            i0++;
        }
        int end0 = i0;
        i0++;
        // reading Year
        int start1 = i0;
        while (1) {
            char c1 = inp[i0];
            if (c1 == ',') break;
            i0++;
        }
        int end1 = i0;
        i0++;
        // reading MatchCount
        int start2 = i0;
        while (1) {
            char c2 = inp[i0];
            if (c2 == ',') break;
            i0++;
        }
        int end2 = i0;
        i0++;
        // reading VolumeCount
        int start3 = i0;
        while (1) {
            char c3 = inp[i0];
            if (c3 == '\n') break;
            i0++;
        }
        int end3 = i0;
        i0++;
        // converting string to number
        int VolumeCount = 0;
        int curr0 = start3;
        while (curr0 < end3) {
            VolumeCount *= 10;
            VolumeCount += (inp[curr0] - '0');
            curr0++;
        }
        tmp0 += VolumeCount;
    }
    return tmp0;
}