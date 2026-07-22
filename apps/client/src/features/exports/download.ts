import { platform } from '../../platform'
import { getExportDownload } from './api'

interface ExportDownloadPlatform {
  downloadExportFile: (input: { url: string; fileName: string }) => Promise<void>
}

const exportPlatform = platform as typeof platform & Partial<ExportDownloadPlatform>

/** Signed URLs remain function-local and are never returned to page state or persisted. */
export async function downloadExportFile(exportId: string) {
  if (!exportPlatform.downloadExportFile) {
    throw new Error('当前平台尚未提供安全下载能力，请稍后重试')
  }
  const { downloadUrl } = await getExportDownload(exportId)
  await exportPlatform.downloadExportFile({
    url: downloadUrl,
    fileName: `baby-growth-export-${exportId.slice(0, 8)}.zip`,
  })
}
