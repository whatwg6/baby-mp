declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV?: string
    TARO_ENV?: string
    TARO_APP_API_BASE_URL?: string
    TARO_APP_E2E?: string
  }
}
