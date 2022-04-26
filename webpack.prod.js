const dev = require('./webpack.dev.js');

module.exports = Object.assign(dev, {
  mode: 'production',
  devtool: false,
});
