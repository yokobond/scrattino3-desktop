const path = require('path');

const CopyWebpackPlugin = require('copy-webpack-plugin');

const makeConfig = require('./webpack.makeConfig.js');

module.exports = makeConfig({
    name: 'renderer',
    useReact: true,
    babelPaths: [
        path.resolve(__dirname, 'src', 'renderer')
    ],
    plugins: [
        new CopyWebpackPlugin([{
            from: path.resolve(__dirname, 'node_modules', 'scratch-gui', 'dist', 'static'),
            to: 'static'
        }]),
        new CopyWebpackPlugin([{
            from: 'extension-worker.{js,js.map}',
            to: 'static',
            context: path.resolve(__dirname, 'node_modules', 'scratch-gui', 'dist')
        }]),
        new CopyWebpackPlugin([{
            from: 'extensions/**',
            to: 'static',
            context: path.resolve(__dirname, 'static')
        }])
    ]
});
