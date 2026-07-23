import type { UserConfigExport } from '@tarojs/cli'

const config = {
  mini: {},
  h5: {
    devServer: {
      host: '127.0.0.1',
      allowedHosts: 'auto',
    },
    webpackChain(chain) {
      chain.merge({
        // Development bundles intentionally favor source maps and fast
        // rebuilds. Release sizes are enforced separately by
        // verify:artifact-budgets, so Webpack's generic raw-size hints are not
        // useful here.
        performance: false,
        // Webpack's filesystem cache can skip individual third-party module
        // records that Taro loaders do not serialize. These infrastructure
        // diagnostics do not affect compilation; application warnings remain
        // visible through the normal stats channel below.
        infrastructureLogging: {
          level: 'error',
        },
        ignoreWarnings: [
          {
            // Taro 4.1.5 ships this redundant magic comment in its video
            // component. Keep the filter scoped to that upstream module and
            // warning so application warnings remain visible.
            module: /@tarojs[\\/]components[\\/]dist[\\/]components[\\/]taro-video-core\.js$/,
            message: /You don't need `webpackExports`/,
          },
        ],
      })
    },
  },
} satisfies UserConfigExport<'webpack5'>

export default config
