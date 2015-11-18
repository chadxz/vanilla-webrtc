import path from 'path';

export default {
  devtool: "source-map",
  entry: [ './client/app.js' ],
  output: {
    path: path.join(__dirname, 'public'),
    filename: 'bundle.js',
    publicPath: '/'
  },
  module: {
    loaders: [{
      test: /\.jsx?$/,
      loaders: ['babel'],
      include: path.join(__dirname, 'client')
    }]
  }
};
