// use rapidjson
// g++ --std=c++11 -I/Users/supun/github/rapidjson/include/ aggr_query.cpp

#include "rapidjson/document.h"
#include "rapidjson/writer.h"
#include "rapidjson/stringbuffer.h"
#include <iostream>
#include <fstream>
#include <string>
#include <unordered_map>

using namespace std;

int main(int argc, char** argv) {
    auto start = chrono::steady_clock::now();
    // take file name the command line
    string fileName;
    if (argc < 2) {
        fileName = "data/data_array_10_2.jsonl";
    } else {
        fileName = argv[1];
    }

    ifstream inputFile(fileName);

    if (!inputFile.is_open()) {
        cout << "Unable to open file" << endl;
        return 0;
    }

    // read the content to a string
    string content((istreambuf_iterator<char>(inputFile)), (istreambuf_iterator<char>()));

    // parse the content to a document
    rapidjson::Document d;
    d.Parse(content.c_str());

    if (!d.IsArray()) {
        cout << "Document is not an array" << endl;
        return 0;
    }

    // evaluate the total of values
    int total = 0;
    for (auto i = 0; i < d.Size(); i++) {
        const rapidjson::Value& v = d[i];
        total += v["value"].GetInt();
    }

    // evaluate the group by aggregate (sum)
    unordered_map<string, int> aggrMap;
    for (auto i = 0; i < d.Size(); i++) {
        const rapidjson::Value& v = d[i];
        string key = v["key"].GetString();
        int value = v["value"].GetInt();
        if (aggrMap.find(key) == aggrMap.end()) {
            aggrMap[key] = value;
        } else {
            aggrMap[key] += value;
        }
    }

    // print the result
    for (auto it = aggrMap.begin(); it != aggrMap.end(); it++) {
        cout << "Key: " << it->first << ", Aggr: " << it->second / (float) total << endl; // computes the relative sum here
    }

    auto end = chrono::steady_clock::now();
    cout << "Elapsed time in milliseconds: " << chrono::duration_cast<chrono::milliseconds>(end - start).count() << endl;

}