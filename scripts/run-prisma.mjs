import { spawn } from 'node:child_process'
import { loadEnvFile } from 'node:process'

try {
  loadEnvFile('.env')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: run-prisma.mjs <command> [...args]')
  process.exit(2)
}

const child = spawn(
  'pnpm',
  ['--filter', '@baby-mp/api', 'exec', 'prisma', ...args],
  { env: process.env, stdio: 'inherit' },
)

child.once('error', (error) => {
  console.error(`Failed to start Prisma: ${error.message}`)
  process.exitCode = 1
})

child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})
