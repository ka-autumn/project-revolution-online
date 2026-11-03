// CPU 同士の勝率を測る（ADR-0060 の段階 1、#365）。
//
//     pnpm cpu-match --decks private/decks/src/index.ts
//
// **CPU を変える変更は、これで前の CPU に勝ち越すことを確かめてから入れる**（ADR-0060）。
// 勝ち越したかは、決着した局の勝率の 95% 信頼区間（Wilson）の下限が 50% を上回るかで決める
// （`packages/cpu/src/match.ts` の `verdictOf`）。
//
// `pnpm serve` と同じく、**どのカードを使うかはこのリポジトリが知らない**（ADR-0002）。カードと
// 既製デッキを渡すモジュールは実行時に受け取り、静的な依存にしない。既製デッキの組み合わせ
// すべて（同じデッキ同士も含む）を順に回す。
//
// 読むもの:
//
//     --decks <パス>          カードと既製デッキを渡すモジュール（必須）
//     --challenger <名前>     強くなったかを確かめたい CPU（既定 random）
//     --baseline <名前>       比べる相手の CPU（既定 random）
//     --games <数>            打つ局数。2 局を 1 組にするので偶数（既定 200）
//     --seed <数>             最初の組のシード（既定 1）
//     --presets <id,id,...>   使う既製デッキを絞る（既定はすべて）
//     --max-actions <数>      1 局で打てる手の数の上限（既定 5000）
//
// CPU の名前は `packages/cpu/src/players.ts` の `CPU_PLAYERS` にある。
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { readFlag } from './bundle-server.mjs'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))

/** import に書ける形にしたパス（`bundle-server.mjs` の `specifier` と同じ理由）。 */
function specifier(path) {
  return resolve(path).replaceAll('\\', '/')
}

/** 正の整数として読む。読めなければ理由を添えて止める。 */
function positiveInteger(argv, name, fallback) {
  const raw = readFlag(argv, name)
  if (raw === undefined) return fallback

  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`--${name} には正の整数を渡してください: ${raw}`)
  return value
}

function options(argv) {
  const decks = readFlag(argv, 'decks')
  if (decks === undefined || decks === '') {
    throw new Error('--decks <モジュールのパス> が要ります。カードのプールと既製デッキを export するモジュールを指してください')
  }

  const games = positiveInteger(argv, 'games', 200)
  if (games % 2 !== 0) throw new Error(`--games は偶数にしてください（2 局を 1 組にします）: ${games}`)

  const presets = readFlag(argv, 'presets')
  return {
    decks,
    challenger: readFlag(argv, 'challenger') ?? 'random',
    baseline: readFlag(argv, 'baseline') ?? 'random',
    games,
    seed: positiveInteger(argv, 'seed', 1),
    presets: presets === undefined ? undefined : presets.split(',').filter((id) => id !== ''),
    maxActions: positiveInteger(argv, 'max-actions', 5000),
  }
}

/**
 * 束ねる対象になる入口。**繋ぐところと見せ方だけ**を置き、測り方は `packages/cpu` にある。
 */
function entryPoint(settings) {
  // 受け取ったものの読み方は対戦サーバと同じものを使う。サーバの入口ごと読むと、接続や置き場まで
  // 束ねることになるので、デッキを読むところだけを指す。
  const deckReading = specifier(resolve(repoRoot, 'packages/server/src/deck.ts'))
  const cpuEntry = specifier(resolve(repoRoot, 'packages/cpu/src/index.ts'))

  return `
import { checkPresets, readSupply } from ${JSON.stringify(deckReading)}
import { CPU_PLAYERS, compareCpus } from ${JSON.stringify(cpuEntry)}
import * as supplied from ${JSON.stringify(specifier(settings.decks))}

const settings = ${JSON.stringify(settings)}

function fail(message) {
  console.error(message)
  process.exit(1)
}

const reading = readSupply(supplied)
if (reading.kind === '断る') fail(reading.reason)
const supply = reading.supply

const violations = checkPresets(supply)
if (violations.length > 0) {
  fail(['既製デッキが構築戦の規定を満たしていません:', ...violations.map(({ deck, violation }) => \`  \${deck}: \${JSON.stringify(violation)}\`)].join('\\n'))
}

const cpuNamed = (name) => CPU_PLAYERS[name] ?? fail(\`知らない CPU です: \${name}（選べるのは \${Object.keys(CPU_PLAYERS).join(', ')}）\`)
const challenger = cpuNamed(settings.challenger)
const baseline = cpuNamed(settings.baseline)

const presets = settings.presets === undefined
  ? supply.presets
  : settings.presets.map((id) => supply.presets.find((preset) => preset.id === id) ?? fail(\`知らない既製デッキです: \${id}\`))
if (presets.length === 0) fail('既製デッキが 1 つも選ばれていません')

const deckOf = (preset) =>
  preset.cards.map((key) => supply.pool[key] ?? fail(\`既製デッキ \${preset.id} の \${key} がプールにありません\`))

// 組み合わせすべて。席 0 と席 1 のデッキが違う組は、向きを変えたものも別の組として回す。
const pairings = presets.flatMap((first) =>
  presets.map((second) => ({ name: \`\${first.id} 対 \${second.id}\`, decks: [deckOf(first), deckOf(second)] })),
)

const started = performance.now()
const result = compareCpus({
  challenger,
  baseline,
  pairings,
  games: settings.games,
  seed: settings.seed,
  maxActions: settings.maxActions,
})
const seconds = (performance.now() - started) / 1000

const percent = (value) => (value === undefined ? '-' : \`\${(value * 100).toFixed(1)}%\`)
function line(label, tally) {
  const decided = tally.wins + tally.losses
  const rate = decided === 0 ? '-' : percent(tally.wins / decided)
  return \`  \${label}  勝ち \${tally.wins}  負け \${tally.losses}  引き分け \${tally.draws}  手数上限 \${tally.unfinished}  勝率 \${rate}\`
}

console.log(\`挑む側: \${settings.challenger}  比べる相手: \${settings.baseline}\`)
console.log(\`\${settings.games} 局（\${settings.games / 2} 組）、シード \${settings.seed} から、手数上限 \${settings.maxActions}、\${seconds.toFixed(1)} 秒\`)
console.log('')
console.log(line('全体', result.total))
console.log(line('先攻', result.byPosition['先攻']))
console.log(line('後攻', result.byPosition['後攻']))
for (const { name, tally } of result.byPairing) console.log(line(name, tally))
console.log('')
const { verdict } = result
const interval = verdict.interval === undefined ? '-' : \`\${percent(verdict.interval.lower)}〜\${percent(verdict.interval.upper)}\`
console.log(\`判定: \${verdict.kind}（決着した局の勝率 \${percent(verdict.winRate)}、95% 信頼区間 \${interval}）\`)
`
}

let settings
try {
  settings = options(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
const workDir = await mkdtemp(join(tmpdir(), 'revolution-cpu-match-'))
const bundle = join(workDir, 'cpu-match.cjs')

try {
  await esbuild.build({
    stdin: { contents: entryPoint(settings), resolveDir: repoRoot, loader: 'ts' },
    outfile: bundle,
    absWorkingDir: repoRoot,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'warning',
  })
} catch {
  await rm(workDir, { recursive: true, force: true })
  process.exit(1)
}

const child = spawn(process.execPath, [bundle], { stdio: 'inherit' })
child.on('exit', async (code) => {
  await rm(workDir, { recursive: true, force: true })
  process.exitCode = code ?? 0
})
