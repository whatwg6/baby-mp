export function resolveClientOutputRoot(taroEnv: string, isE2eBuild: boolean): string {
  return isE2eBuild && taroEnv === 'h5'
    ? 'dist/h5-e2e'
    : `dist/${taroEnv}`
}
