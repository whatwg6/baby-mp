import { spawn } from 'node:child_process'

import { validateEnvironment } from './environment'

const immutableImagePattern = /^[A-Za-z0-9._:/-]+@sha256:[0-9a-f]{64}$/

function fail(message: string): never {
  throw new Error(`Runtime preflight failed: ${message}`)
}

function validateRuntime(): void {
  const environment = validateEnvironment(process.env)
  if (environment.APP_ENV !== 'staging' && environment.APP_ENV !== 'production') {
    fail('APP_ENV must be staging or production')
  }

  const imageReference = process.env.BABY_MP_IMAGE_REF?.trim()
  if (!imageReference || !immutableImagePattern.test(imageReference)) {
    fail('BABY_MP_IMAGE_REF must be an immutable OCI image reference using @sha256:<64 lowercase hex>')
  }
}

function run(): void {
  validateRuntime()
  const [command, ...arguments_] = process.argv.slice(2)
  if (!command) fail('a child command is required')

  const child = spawn(command, arguments_, {
    env: process.env,
    stdio: 'inherit',
  })
  const forward = (signal: NodeJS.Signals) => {
    if (!child.killed) child.kill(signal)
  }
  const forwardSigint = () => forward('SIGINT')
  const forwardSigterm = () => forward('SIGTERM')
  process.once('SIGINT', forwardSigint)
  process.once('SIGTERM', forwardSigterm)
  child.once('error', () => {
    process.stderr.write('Runtime child process failed to start.\n')
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', forwardSigint)
    process.removeListener('SIGTERM', forwardSigterm)
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exitCode = code ?? 1
  })
}

try {
  run()
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Runtime preflight failed'}\n`)
  process.exitCode = 1
}
