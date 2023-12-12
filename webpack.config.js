const path = require('path');

module.exports = {
  mode: 'production',
  entry: './src/rhyme.js',
  output: {
    path: path.resolve(__dirname, 'umd'),
    filename: 'rhyme-lang.min.js',
    library: "rhyme",
    libraryTarget: 'umd',
    globalObject: 'this'
  },
};