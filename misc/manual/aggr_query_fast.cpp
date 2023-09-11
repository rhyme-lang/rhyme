#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>
#include <iostream>
#include <vector>

struct Entry
{
    int key;
    int value;
};

Entry parseLine(const char *pos)
{
    Entry entry;

    pos = pos + 9; // Skip to the start of the key value
    pos += 1; // skip "x"
    int keyInt = 0;
    while (*pos != '\"')
    {
        keyInt = keyInt * 10 + (*pos - '0');
        pos++;
    }
    entry.key = keyInt;

    while (*pos != ':')
    {
        pos++;
    }
    pos += 2; // skip : and space
    int valueInt = 0;
    while (*pos != '}')
    {
        valueInt = valueInt * 10 + (*pos - '0');
        pos++;
    }
    entry.value = valueInt;
    return entry;
}

int main(int argc, char **argv)
{
    auto start = std::chrono::steady_clock::now();
    char* fName;
    if (argc < 2) {
        fName = "data/data_10_2.jsonl";
    } else {
        fName = argv[1];
    }

    int fd = open(fName, O_RDONLY);
    if (fd == -1)
    {
        std::cerr << "Error opening file\n";
        return 1;
    }

    off_t fileSize = lseek(fd, 0, SEEK_END);
    char *map = static_cast<char *>(mmap(nullptr, fileSize, PROT_READ, MAP_PRIVATE, fd, 0));
    if (map == MAP_FAILED)
    {
        std::cerr << "Error mapping file\n";
        return 1;
    }

    const char *pos = map;
    std::vector<Entry> entries;
    while (pos < map + fileSize)
    {
        if (*pos == '{')
        {
            entries.push_back(parseLine(pos));
        }
        pos++;
    }

    std::cout << "Loading data done\n";

    int aggrMap[10001]; // hard coded to 10001
    // init to zero
    for (auto i = 0; i < 1000; i++)
    {
        aggrMap[i] = 0;
    }


    int total = 0;
    for (auto i = 0; i < entries.size(); i++)
    {
        Entry entry = entries[i];
        // drop the first character ("x") of the key
        // int key = std::stoi(entry.key.substr(1));
        int key = entry.key;
        int value = entry.value;
        aggrMap[key] += value;
        total += value;
    }

    std::cout << "Aggregation done\n";

    // output the result
    for (auto i = 0; i < 1000; i++)
    {
        if (aggrMap[i] != 0)
        {
            std::cout << "Key: " << i << ", Aggr: " << aggrMap[i] / (float) total << std::endl;
        }
    }

    auto end = std::chrono::steady_clock::now();
    std::cout << "Elapsed time in milliseconds: " << std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count() << std::endl;

    munmap(map, fileSize);
    close(fd);

    return 0;
}
