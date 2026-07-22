import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { resolveClientApiBaseUrl } from './api-base-url'
import devConfig from './dev'
import prodConfig from './prod'

const taroEnv = process.env.TARO_ENV ?? 'h5'
const isDevelopment = process.env.NODE_ENV === 'development'
const isE2eBuild = process.env.TARO_APP_E2E === 'true'
const mockLoginEnabled = isDevelopment || isE2eBuild
const outputRoot = `dist/${taroEnv}`
const apiBaseUrl = resolveClientApiBaseUrl({
  explicitValue: process.env.TARO_APP_API_BASE_URL,
  // E2E is an optimized static build, but it deliberately targets the local
  // HTTP test API. Release builds never set TARO_APP_E2E and retain the HTTPS
  // production gate below.
  nodeEnv: isE2eBuild ? 'test' : process.env.NODE_ENV,
  taroEnv,
})
const cacheVariant = createHash('sha256')
  .update(`${isE2eBuild ? 'e2e' : 'release'}\0${apiBaseUrl}`)
  .digest('hex')
  .slice(0, 12)

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
  alias: {
    '@mock-login-boundary': resolve(
      __dirname,
      `../src/features/auth/mock-login.${mockLoginEnabled ? 'enabled' : 'disabled'}.tsx`,
    ),
  },
  env: {
    TARO_APP_API_BASE_URL: JSON.stringify(apiBaseUrl),
    TARO_APP_E2E: JSON.stringify(isE2eBuild ? 'true' : 'false'),
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
    // E2E is also an optimized production-mode H5 build. Include every
    // compile-time security boundary in the filesystem cache key so its mock
    // login and local API constants can never leak into release artifacts.
    name: `${process.env.NODE_ENV}-${taroEnv}-${cacheVariant}`,
  },
  copy: {
    patterns:
      taroEnv === 'weapp'
        ? [
            {
              from: isDevelopment
                ? 'config/weapp-project.dev.config.json'
                : 'config/weapp-project.prod.config.json',
              to: `${outputRoot}/project.config.json`,
            },
          ]
        : taroEnv === 'h5'
          ? [
              {
                from: 'config/favicon.svg',
                to: `${outputRoot}/favicon.svg`,
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
  ...(isDevelopment ? devConfig : prodConfig),
}))
