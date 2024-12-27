const path = require('path');

module.exports = {
  target: 'web',
  mode: 'production', // to skip minification: 'development'
  entry: './src/rhyme.js',
  output: {
    path: path.resolve(__dirname, 'umd'),
    filename: 'rhyme-lang.min.js',
    library: "rhyme",
    libraryTarget: 'umd',
    globalObject: 'this'
  },
  resolve: {
    fallback: { // exclude node modules from browser bundle
      'node:fs': false,
      'node:fs/promises': false,
      'node:child_process': false,
      'fs': false,
      'fs/promises': false,
      'child_process': false
    }
  }
};