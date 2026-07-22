import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const planPath = resolve(root, 'docs/quality/test-plan.md')
const tracePath = resolve(root, 'docs/quality/automated-test-traceability.md')
const allowedStatuses = new Set(['covered', 'partial', 'gap'])
const requireCovered = process.argv.slice(2).includes('--require-covered')
const unknownArguments = process.argv.slice(2).filter(
  (argument) => argument !== '--require-covered',
)

if (unknownArguments.length > 0) {
  console.error(`Unknown argument(s): ${unknownArguments.join(', ')}`)
  process.exit(1)
}

const plan = readFileSync(planPath, 'utf8')
const traceability = readFileSync(tracePath, 'utf8')
const planned = new Map()
const planRow = /^\|\s*([A-Z]+-\d{3})\s*\|\s*(P[012])\s*\|/gm

for (const match of plan.matchAll(planRow)) {
  const [, id, priority] = match
  if (priority === 'P0' || priority === 'P1') {
    if (planned.has(id)) {
      console.error(`Duplicate P0/P1 ID in test plan: ${id}`)
      process.exit(1)
    }
    planned.set(id, priority)
  }
}

const block = traceability.match(/```traceability-tsv\s*\n([\s\S]*?)\n```/)
if (!block?.[1]) {
  console.error('Missing traceability-tsv block')
  process.exit(1)
}

const errors = []
const mapped = new Map()
const allowedEvidencePath = /^(?:apps\/api\/test\/.*\.test\.ts|apps\/client\/src\/.*\.test\.ts|packages\/contracts\/test\/.*\.test\.ts|e2e\/.*\.spec\.cjs|scripts\/verify-[^/]+\.(?:sh|mjs))$/

for (const [index, line] of block[1].split('\n').entries()) {
  if (!line.trim()) continue
  const columns = line.split('\t')
  if (columns.length !== 5) {
    errors.push(`Trace row ${index + 1} must contain exactly five TSV columns`)
    continue
  }
  const [id, priority, status, evidenceList, note] = columns
  if (!/^[A-Z]+-\d{3}$/.test(id)) {
    errors.push(`Invalid trace ID: ${id}`)
    continue
  }
  if (mapped.has(id)) {
    errors.push(`Duplicate trace mapping: ${id}`)
    continue
  }
  mapped.set(id, { priority, status, note })
  if (!allowedStatuses.has(status)) {
    errors.push(`${id}: invalid status ${status}`)
  }
  if (!note.trim()) {
    errors.push(`${id}: explanation is required`)
  }
  const evidence = evidenceList.split(';;').filter(Boolean)
  if (evidence.length === 0) {
    errors.push(`${id}: at least one evidence reference is required`)
  }
  for (const reference of evidence) {
    const separator = reference.indexOf('::')
    if (separator <= 0 || separator === reference.length - 2) {
      errors.push(`${id}: invalid evidence reference ${reference}`)
      continue
    }
    const relativePath = reference.slice(0, separator)
    const marker = reference.slice(separator + 2)
    if (!allowedEvidencePath.test(relativePath)) {
      errors.push(`${id}: evidence is not a test or verification script: ${relativePath}`)
      continue
    }
    const absolutePath = resolve(root, relativePath)
    if (!absolutePath.startsWith(`${root}${sep}`)) {
      errors.push(`${id}: evidence path escapes repository root: ${relativePath}`)
      continue
    }
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      errors.push(`${id}: evidence path does not exist: ${relativePath}`)
      continue
    }
    if (!readFileSync(absolutePath, 'utf8').includes(marker)) {
      errors.push(`${id}: evidence marker not found in ${relativePath}: ${marker}`)
    }
  }
}

for (const [id, priority] of planned) {
  const mapping = mapped.get(id)
  if (!mapping) {
    errors.push(`${id}: P0/P1 test-plan case has no trace mapping`)
  } else if (mapping.priority !== priority) {
    errors.push(
      `${id}: priority mismatch; test plan is ${priority}, trace is ${mapping.priority}`,
    )
  }
}

for (const id of mapped.keys()) {
  if (!planned.has(id)) {
    errors.push(`${id}: trace mapping is not a P0/P1 case in test-plan.md`)
  }
}

const summaryRows = new Map()
const summaryRow = /^\|\s*(P0|P1|合计)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|$/gm
for (const match of traceability.matchAll(summaryRow)) {
  summaryRows.set(match[1], match.slice(2).map(Number))
}

for (const priority of ['P0', 'P1']) {
  const rows = [...mapped.values()].filter((mapping) => mapping.priority === priority)
  const actual = [
    rows.length,
    rows.filter((mapping) => mapping.status === 'covered').length,
    rows.filter((mapping) => mapping.status === 'partial').length,
    rows.filter((mapping) => mapping.status === 'gap').length,
  ]
  if (JSON.stringify(summaryRows.get(priority)) !== JSON.stringify(actual)) {
    errors.push(`${priority}: documented summary does not match trace rows`)
  }
}

const totalSummary = [
  mapped.size,
  [...mapped.values()].filter((mapping) => mapping.status === 'covered').length,
  [...mapped.values()].filter((mapping) => mapping.status === 'partial').length,
  [...mapped.values()].filter((mapping) => mapping.status === 'gap').length,
]
if (JSON.stringify(summaryRows.get('合计')) !== JSON.stringify(totalSummary)) {
  errors.push('合计: documented summary does not match trace rows')
}

if (errors.length > 0) {
  console.error(`Traceability verification failed with ${errors.length} error(s):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

const counts = { covered: 0, partial: 0, gap: 0 }
const outstanding = []
for (const [id, mapping] of mapped) {
  counts[mapping.status] += 1
  if (mapping.status !== 'covered') {
    outstanding.push({ id, ...mapping })
  }
}

const p0 = [...planned.values()].filter((priority) => priority === 'P0').length
const p1 = [...planned.values()].filter((priority) => priority === 'P1').length
console.log(
  `Traceability verified: ${planned.size} P0/P1 cases ` +
    `(P0=${p0}, P1=${p1}, covered=${counts.covered}, ` +
    `partial=${counts.partial}, gap=${counts.gap}).`,
)

if (outstanding.length > 0) {
  console.log('Outstanding automated coverage:')
  for (const item of outstanding) {
    console.log(`- ${item.id} [${item.priority}/${item.status}]: ${item.note}`)
  }
}

if (requireCovered && outstanding.length > 0) {
  console.error(
    `Coverage gate failed: ${outstanding.length} P0/P1 case(s) are not fully covered.`,
  )
  process.exit(2)
}
