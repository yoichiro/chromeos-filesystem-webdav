const path = require('path');

module.exports = {
  mode: 'production',
  entry: './scripts/background.ts',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts'],
  },
  output: {
    filename: 'background.js',
    path: path.resolve(__dirname, 'dist'),
  },
};
