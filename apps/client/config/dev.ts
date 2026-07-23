import type { UserConfigExport } from '@tarojs/cli'

const config = {
  mini: {},
  h5: {
    devServer: {
      host: '127.0.0.1',
      allowedHosts: 'auto',
    },
  },
} satisfies UserConfigExport<'webpack5'>

export default config
