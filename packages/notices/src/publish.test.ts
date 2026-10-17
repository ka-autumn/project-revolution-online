import { describe, expect, it, vi } from 'vitest'
import { NOTICES_PATHNAME, PutFailure, TOKEN_VARIABLES, publishNotices } from './index.js'
import type { PublishRequest, PublishTarget } from './index.js'

const PROD = 'REVOLUTION_NOTICES_TOKEN'
const VERIFY = 'REVOLUTION_NOTICES_TOKEN_VERIFY'

const entry = (id: string, date: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: '更新',
  date,
  title: '見本',
  summary: '要約',
  body: ['段落'],
  ...extra,
})

const good = JSON.stringify({ notices: [entry('b', '2026-01-02'), entry('a', '2026-01-01')] }, null, 2) + '\n'

function run(options: {
  file?: string
  argv?: string[]
  target?: PublishTarget
  env?: Record<string, string>
  put?: PublishRequest['put']
}) {
  const put = vi.fn(options.put ?? (async () => ({ url: 'https://example.invalid/notices.json' })))
  const out: string[] = []
  const err: string[] = []
  const envRead: string[] = []
  const done = publishNotices({
    argv: options.argv ?? ['--notices', 'notices.json'],
    target: options.target ?? '本番',
    env: (name) => {
      envRead.push(name)
      return options.env?.[name]
    },
    readFile: async () => options.file ?? good,
    put,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  })
  return { done, put, out, err, envRead }
}

describe('publishNotices', () => {
  it('正しいファイルを、決めた引数で 1 回だけ上げる', async () => {
    const { done, put, out } = run({ env: { [PROD]: 'secret-prod' } })
    expect(await done).toBe(0)
    expect(put).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledWith(NOTICES_PATHNAME, good, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      contentType: 'application/json',
      token: 'secret-prod',
    })
    expect(NOTICES_PATHNAME).toBe('notices.json')
    expect(out.join('\n')).toContain('2 件')
    expect(out.join('\n')).toContain('https://example.invalid/notices.json')
  })

  describe('通らないファイルは理由を出して 0 以外で終わり、上げず、トークンも読まない', () => {
    const cases: [string, string, string][] = [
      ['JSON として読めない', '{ not json', 'JSON'],
      ['必須項目が欠けている', JSON.stringify({ notices: [{ id: 'a', kind: '更新' }] }), 'date'],
      ['知らない種別がある', JSON.stringify({ notices: [entry('a', '2026-01-01', { kind: '未知' })] }), 'kind'],
      ['id が重なっている', JSON.stringify({ notices: [entry('a', '2026-01-02'), entry('a', '2026-01-01')] }), '1 件目と 2 件目で重なって'],
      ['日付が新しい順になっていない', JSON.stringify({ notices: [entry('a', '2026-01-01'), entry('b', '2026-01-02')] }), '新しい日付'],
      ['日付が実在しない', JSON.stringify({ notices: [entry('a', '2026-02-30')] }), '実在する日付'],
      ['BOM が付いている', '﻿' + good, 'BOM'],
    ]
    for (const [name, file, word] of cases) {
      it(name, async () => {
        const { done, put, err, envRead } = run({ file, env: { [PROD]: 'secret-prod' } })
        expect(await done).not.toBe(0)
        expect(put).not.toHaveBeenCalled()
        expect(err.join('\n')).toContain(word)
        expect(envRead).toEqual([])
      })
    }
  })

  describe('トークンの変数', () => {
    it('検証のコマンドに本番の変数だけを渡すと、変数名を挙げて断る', async () => {
      const { done, put, err, envRead } = run({ target: '検証', env: { [PROD]: 'secret-prod' } })
      expect(await done).not.toBe(0)
      expect(put).not.toHaveBeenCalled()
      expect(err.join('\n')).toContain(VERIFY)
      expect(err.join('\n')).not.toContain('secret-prod')
      expect(envRead).toEqual([VERIFY])
    })

    it('本番のコマンドに検証の変数だけを渡すと、変数名を挙げて断る', async () => {
      const { done, put, err, envRead } = run({ target: '本番', env: { [VERIFY]: 'secret-verify' } })
      expect(await done).not.toBe(0)
      expect(put).not.toHaveBeenCalled()
      expect(err.join('\n')).toContain(PROD)
      expect(envRead).toEqual([PROD])
    })

    it('両方入れると、検証のコマンドは検証の値で上げる', async () => {
      const { done, put } = run({ target: '検証', env: { [PROD]: 'secret-prod', [VERIFY]: 'secret-verify' } })
      expect(await done).toBe(0)
      expect(put.mock.calls[0]?.[2].token).toBe('secret-verify')
    })

    it('両方入れると、本番のコマンドは本番の値で上げる', async () => {
      const { done, put } = run({ target: '本番', env: { [PROD]: 'secret-prod', [VERIFY]: 'secret-verify' } })
      expect(await done).toBe(0)
      expect(put.mock.calls[0]?.[2].token).toBe('secret-prod')
    })

    it('空の時は理由を出して上げない', async () => {
      for (const env of [{}, { [PROD]: '' }, { [PROD]: '  ' }] as Record<string, string>[]) {
        const { done, put, err } = run({ env })
        expect(await done).not.toBe(0)
        expect(put).not.toHaveBeenCalled()
        expect(err.join('\n')).toContain(PROD)
      }
    })

    it('BLOB_READ_WRITE_TOKEN は読まない', async () => {
      const { done, put, envRead } = run({ env: { BLOB_READ_WRITE_TOKEN: 'ambient' } })
      expect(await done).not.toBe(0)
      expect(put).not.toHaveBeenCalled()
      expect(envRead).not.toContain('BLOB_READ_WRITE_TOKEN')
    })
  })

  describe('--check', () => {
    it('環境変数が無くても形の結果だけを出し、トークンを読まず、上げない', async () => {
      const { done, put, out, envRead } = run({ argv: ['--notices', 'n.json', '--check'] })
      expect(await done).toBe(0)
      expect(put).not.toHaveBeenCalled()
      expect(envRead).toEqual([])
      expect(out.join('\n')).toContain('2 件')
    })

    it('形が誤っていれば 0 以外で終わる', async () => {
      const { done, err } = run({ argv: ['--notices', 'n.json', '--check'], file: '{' })
      expect(await done).not.toBe(0)
      expect(err.length).toBeGreaterThan(0)
    })
  })

  it('put がトークンを含む文言で失敗しても、出力にトークンが出ない', async () => {
    const { done, out, err } = run({
      env: { [PROD]: 'secret-prod' },
      put: async () => {
        throw new Error('401 invalid token secret-prod')
      },
    })
    expect(await done).not.toBe(0)
    expect(err.length).toBeGreaterThan(0)
    expect([...out, ...err].join('\n')).not.toContain('secret-prod')
  })

  describe('上げるのに失敗した時は、種類が分かる文言を出す', () => {
    const cases: [string, string][] = [
      ['BlobAccessError', 'トークンが受け付けられませんでした'],
      ['BlobStoreNotFoundError', 'ストアが見つかりません'],
      ['BlobStoreSuspendedError', 'ストアが止まっています'],
      ['BlobRequestAbortedError', '送信が中断されました'],
      ['BlobFileTooLargeError', '上げられませんでした（BlobFileTooLargeError）'],
    ]
    for (const [kind, text] of cases) {
      it(kind, async () => {
        const { done, err } = run({
          env: { [PROD]: 'secret-prod' },
          put: async () => {
            throw new PutFailure(kind)
          },
        })
        expect(await done).not.toBe(0)
        expect(err.join('\n')).toContain(text)
        expect(err.join('\n')).not.toContain('secret-prod')
      })
    }

    it('Blob 以外の例外は、名前だけを添え、メッセージは出さない', async () => {
      const { done, err } = run({
        env: { [PROD]: 'secret-prod' },
        put: async () => {
          throw new TypeError('fetch failed secret-prod')
        },
      })
      expect(await done).not.toBe(0)
      expect(err.join('\n')).toContain('上げられませんでした（TypeError）')
      expect(err.join('\n')).not.toContain('secret-prod')
    })

    it('名前の形が外れた例外は、名前も出さない', async () => {
      const bad = new Error('x')
      bad.name = 'secret-prod token'
      const { done, err } = run({
        env: { [PROD]: 'secret-prod' },
        put: async () => {
          throw bad
        },
      })
      expect(await done).not.toBe(0)
      expect(err.join('\n')).toContain('（不明）')
      expect(err.join('\n')).not.toContain('secret-prod')
    })
  })

  describe('上げ先ごとの環境変数', () => {
    it('対応は本番と検証で別の変数になっている', () => {
      expect(TOKEN_VARIABLES).toEqual({ 本番: PROD, 検証: VERIFY })
    })

    it('検証を選ぶと検証の変数だけを、本番を選ぶと本番の変数だけを読む', async () => {
      const verify = run({ target: '検証', env: {} })
      await verify.done
      expect(verify.envRead).toEqual([VERIFY])
      const prod = run({ target: '本番', env: {} })
      await prod.done
      expect(prod.envRead).toEqual([PROD])
    })
  })

  describe('引数', () => {
    it('--notices が無ければ断る', async () => {
      const { done, put } = run({ argv: [], env: { [PROD]: 't' } })
      expect(await done).not.toBe(0)
      expect(put).not.toHaveBeenCalled()
    })

    it('トークンを渡す口は無く、渡された値も出力に出ない', async () => {
      const { done, put, out, err } = run({ argv: ['--notices', 'n.json', '--token', 'leaky'], env: { [PROD]: 't' } })
      expect(await done).not.toBe(0)
      expect(put).not.toHaveBeenCalled()
      expect([...out, ...err].join('\n')).not.toContain('leaky')
    })

    it('= でつなぐ形は、値を出さずに、渡し方を示して断る', async () => {
      for (const arg of ['--notices=leaky.json', '--check=leaky', '--token=leaky']) {
        const { done, put, out, err } = run({ argv: ['--notices', 'n.json', arg], env: { [PROD]: 't' } })
        expect(await done).not.toBe(0)
        expect(put).not.toHaveBeenCalled()
        const shown = [...out, ...err].join('\n')
        expect(shown).toContain('= でつなぐ形を受け付けません')
        expect(shown).not.toContain('leaky')
      }
    })
  })

  it('ファイルを読めなければ断る', async () => {
    const put = vi.fn()
    const err: string[] = []
    const code = await publishNotices({
      argv: ['--notices', 'missing.json'],
      target: '本番',
      env: () => 't',
      readFile: async () => {
        throw new Error('ENOENT')
      },
      put,
      out: () => {},
      err: (line) => err.push(line),
    })
    expect(code).not.toBe(0)
    expect(put).not.toHaveBeenCalled()
    expect(err.join('\n')).toContain('missing.json')
  })
})
