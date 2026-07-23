import type { UserConfigExport } from '@tarojs/cli'

const config = {
  mini: {
    enableSourceMap: false,
  },
  h5: {
    enableSourceMap: false,
  },
} satisfies UserConfigExport<'webpack5'>

export default config
