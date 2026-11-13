import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fromKg, toKg, weightKey, roundForDisplay } from '../../packages/core/src/units.ts'
const values: (number | null)[] = [null, 0, -0.001, -1.125, -1.25, 0.005, 1.005, 56.699, 56.70, 61.23496995, 100, 250.5]
let seed = 42
for (let i = 0; i < 256; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  values.push((seed / 2 ** 32) * 500 - 10)
}
const cases = values.map(input => ({ input, weightKey: weightKey(input), rounded: roundForDisplay(input ?? 0, 'kg'), ...Object.fromEntries((['kg', 'lb'] as const).map(unit => [unit, { from: fromKg(input, unit), to: toKg(input ?? 0, unit) }])) }))
writeFileSync(fileURLToPath(new URL('../../tests/engine-parity/units.json', import.meta.url)), JSON.stringify(cases, null, 2) + '\n')
