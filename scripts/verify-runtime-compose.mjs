import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

export function verifyRuntimeCompose(configuration) {
  const expectedNames = ['api', 'export-worker', 'media-cleanup', 'migrate']
  const services = configuration?.services
  requireCondition(services && typeof services === 'object', 'Compose configuration has no services')
  requireCondition(
    JSON.stringify(Object.keys(services).sort()) === JSON.stringify(expectedNames),
    'Compose configuration does not contain exactly the required runtime services',
  )

  for (const name of expectedNames) {
    const service = services[name]
    requireCondition(service.read_only === true, `${name} must use a read-only root filesystem`)
    requireCondition(service.init === true, `${name} must use an init process`)
    requireCondition(service.privileged !== true, `${name} must not run privileged`)
    requireCondition(service.pids_limit === 256, `${name} must enforce the PID limit`)
    requireCondition(service.cap_drop?.includes('ALL'), `${name} must drop all Linux capabilities`)
    requireCondition(
      service.security_opt?.includes('no-new-privileges:true'),
      `${name} must enforce no-new-privileges`,
    )
    requireCondition(
      service.tmpfs?.length === 1 && String(service.tmpfs[0]).startsWith('/tmp:'),
      `${name} must provide only an ephemeral writable /tmp`,
    )
    requireCondition(
      !service.volumes || service.volumes.length === 0,
      `${name} must not add writable or host-mounted volumes`,
    )
    requireCondition(service.logging?.driver === 'json-file', `${name} must use bounded json-file logging`)
    requireCondition(service.logging?.options?.['max-size'] === '10m', `${name} log size limit is missing`)
    requireCondition(service.logging?.options?.['max-file'] === '3', `${name} log rotation count is missing`)
    requireCondition(
      /^[A-Za-z0-9._:/-]+@sha256:[0-9a-f]{64}$/.test(service.image ?? ''),
      `${name} image must use an immutable digest`,
    )
  }
}

async function main() {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  requireCondition(input.trim(), 'Compose configuration JSON is required on stdin')
  verifyRuntimeCompose(JSON.parse(input))
  process.stdout.write('Runtime Compose hardening verification passed.\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
