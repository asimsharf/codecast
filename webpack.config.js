const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const SRC = path.resolve(__dirname, "frontend");
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const CopyPlugin = require("copy-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

// To analyse webpack speed and build size
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const SpeedMeasurePlugin = require("speed-measure-webpack-plugin");
const smp = new SpeedMeasurePlugin();

const bundledFiles = fs.readFileSync('bundled_files.txt', 'utf8')
  .split("\n")
  .filter(a => a.length && a.trim().split('')[0] !== '#')
  .map(file => {
      const fileName = file.split(':').length >= 2 ? file.split(':')[1] : file;

      return {
          from: fileName,
          to({absoluteFilename}) {
              return path.join(__dirname, 'build', path.relative(path.resolve(__dirname), absoluteFilename));
          },
      };
  });

module.exports = (env, argv) => {
    if (!argv.mode) {
        argv.mode = 'development';
    }

    process.env.NODE_ENV = argv.mode;
    console.log('process.env.NODE_ENV=', process.env.NODE_ENV);

    const isDev = (argv.mode === 'development');
    if (isDev) {
        process.env.NODE_ENV = 'development';
    } else {
        process.env.NODE_ENV = 'production';
    }

    console.log('isDevelopment ?', isDev);

    const jsonConfig = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    let publicPath = path.join(jsonConfig.mountPath, 'build/');
    if ('lib' === process.env.BUILD) {
        publicPath = './';
    }

    return {
        mode: argv.mode,
        resolve: {
            fallback: {
                assert: false,
                fs: false,
                crypto: require.resolve('crypto-browserify'),
                util: require.resolve('util'),
            },
            alias: {
                lamejs: 'lamejs/src/js/',
                stream: 'stream-browserify'
            },
            extensions: ['.tsx', '.ts', '.js']
        },
        entry: {
            index: ['./frontend/index.tsx'],
        },
        output: {
            path: path.join(__dirname, 'build'),
            publicPath: publicPath,
            filename: '[name].js',
            ...(isDev ? {pathinfo: false} : {}),
        },
        devtool: isDev ? 'inline-source-map' : undefined,
        module: {
            rules: [
                {
                    test: /\.worker\.js$/,
                    use: {
                        loader: 'worker-loader'
                    }
                },
                {
                    test: /\.tsx?$/,
                    loader: 'ts-loader',
                    include: SRC,
                    options: {
                        happyPackMode: true,
                        transpileOnly: true,
                        experimentalWatchApi: true,
                    },
                },
                {
                    test: /\.js$/,
                    include: SRC,
                    use: [
                        {
                            loader: 'babel-loader',
                            options: {
                                babelrc: true,
                            }
                        }
                    ]
                },
                {
                    test: /\.css$/,
                    use: [
                        {
                            loader: isDev ? "style-loader" : MiniCssExtractPlugin.loader,
                        }, {
                            loader: 'css-loader',
                            options: {
                                modules: false,
                                sourceMap: isDev,
                            }
                        },
                    ],
                },
                {
                    test: /\.scss$/,
                    use: [
                        {
                            loader: isDev ? "style-loader" : MiniCssExtractPlugin.loader,
                        }, {
                            loader: 'css-loader',
                            options: {
                                sourceMap: isDev
                            }
                        }, {
                            loader: 'resolve-url-loader'
                        }, {
                            loader: 'sass-loader',
                            options: {
                                sassOptions: {
                                    sourceMap: isDev,
                                    precision: 8
                                }
                            }
                        }
                    ]
                },
                {
                    test: /\.(eot|ttf|woff(2)?)(\?v=\d+\.\d+\.\d+)?/,
                    use: [
                        {
                            loader: 'file-loader',
                            options: {
                                publicPath: isDev ? './build/' : './',
                                name: 'fonts/[name].[ext]'
                            }
                        }
                    ]
                },
                {
                    test: /\.(ico|gif|png|jpg|jpeg|svg)$/,
                    include: [
                        path.resolve(__dirname, "frontend/task/fixture"),
                    ],
                    use: [
                        {
                            loader: 'file-loader',
                            options: {
                                context: 'public',
                                publicPath: './build/',
                                name(resourcePath) {
                                    const matches = /.+task\/fixtures\/([\w_\-]+)\/(.*)/ig.exec(resourcePath);

                                    return 'images/' + matches[1] + '/' + matches[2];
                                },
                            }
                        }
                    ],
                },
                {
                    test: /\.(ico|gif|png|jpg|jpeg|svg)$/,
                    exclude: [
                        path.resolve(__dirname, "frontend/task/fixture"),
                    ],
                    use: [
                        {
                            loader: 'file-loader',
                            options: {
                                context: 'public',
                                publicPath: './build/',
                                name: 'images/[name].[ext]'
                            }
                        }
                    ],
                },
                {
                    test: /\.xml$/,
                    use : [
                        {loader: 'raw-loader'}
                    ],
                },
            ],
        },
        plugins: [
            new webpack.DefinePlugin({
                'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
            }),
            new webpack.NoEmitOnErrorsPlugin(),
            new webpack.ProvidePlugin({
                Buffer: ['buffer', 'Buffer'],
                process: ['process']
            }),
            new ForkTsCheckerWebpackPlugin({
                typescript: {
                    memoryLimit: 4096,
                }
            }),
            new CopyPlugin({
                patterns: bundledFiles,
            }),
            new MiniCssExtractPlugin(),
            // new BundleAnalyzerPlugin(),
        ],
        // Note : splitChunks breaks the audio recording.
        //
        optimization: {
            removeAvailableModules: false,
            removeEmptyChunks: false,
            splitChunks: false,
        },
        stats: {
            assets: false,
            cached: false,
            children: false,
            chunks: false,
            chunkGroups: false,
            chunkModules: false,
            chunkOrigins: false,
            colors: true,
            modules: false,
            moduleTrace: false,
        }
    };
}

require('pretty-error').start();
const oldPrepareStackTrace = Error.prepareStackTrace;
const nodeModulesPath = path.resolve(__dirname, 'node_modules');
Error.prepareStackTrace = function (exc, frames) {
    let hideNodeModules = false;
    frames = frames.filter(function (call_site) {
        const fn = call_site.getFileName();
        if (fn && fn.startsWith(nodeModulesPath)) {
            if (hideNodeModules) {
                return false;
            } else {
                hideNodeModules = true;
                return true;
            }
        }
        return true;
    });
    return oldPrepareStackTrace.call(null, exc, frames);
};
