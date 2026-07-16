import { defineConfig, type UserConfigExport } from '@tarojs/cli'

import { resolveClientApiBaseUrl } from './api-base-url'
import devConfig from './dev'
import prodConfig from './prod'

const taroEnv = process.env.TARO_ENV ?? 'h5'
const outputRoot = `dist/${taroEnv}`
const apiBaseUrl = resolveClientApiBaseUrl({
  explicitValue: process.env.TARO_APP_API_BASE_URL,
  nodeEnv: process.env.NODE_ENV,
  taroEnv,
})

const baseConfig: UserConfigExport = {
  projectName: 'baby-mp-client',
  date: '2026-07-16',
  designWidth: 375,
  deviceRatio: {
    375: 2,
    640: 1.17,
    750: 1,
    828: 0.905,
  },
  sourceRoot: 'src',
  outputRoot,
  framework: 'react',
  env: {
    TARO_APP_API_BASE_URL: JSON.stringify(apiBaseUrl),
  },
  compiler: {
    type: 'webpack5',
    // Taro 4.1.5's optional prebundle plugin is incompatible with the
    // enhanced-resolve version selected by the current dependency graph in
    // watch mode. Disabling it affects startup speed only, not output.
    prebundle: {
      enable: false,
    },
  },
  cache: {
    enable: true,
  },
  copy: {
    patterns:
      taroEnv === 'weapp'
        ? [
            {
              from: 'config/weapp-project.config.json',
              to: `${outputRoot}/project.config.json`,
            },
          ]
        : [],
    options: {},
  },
  mini: {
    postcss: {
      pxtransform: {
        enable: true,
        config: {},
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]',
        },
      },
    },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    router: {
      mode: 'hash',
    },
    postcss: {
      autoprefixer: {
        enable: true,
        config: {},
      },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]',
        },
      },
    },
  },
}

export default defineConfig<'webpack5'>(() => ({
  ...baseConfig,
  ...(process.env.NODE_ENV === 'development' ? devConfig : prodConfig),
}))
