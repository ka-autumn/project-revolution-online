import { describe, expect, it } from 'vitest'
import { checkNoticeFile, readNotices } from './index.js'
import type { Notice } from './index.js'

/** 架空のお知らせ 1 件。 */
function sample(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '2026-01-05-sample',
    kind: '更新',
    date: '2026-01-05',
    title: '見本のお知らせ',
    summary: '見本の要約です。',
    body: ['見本の段落です。'],
    ...overrides,
  }
}

function file(...notices: unknown[]): string {
  return JSON.stringify({ notices })
}

function readable(text: string): { notices: readonly Notice[]; rejected: readonly { reason: string }[] } {
  const reading = readNotices(text)
  if (!reading.ok) throw new Error(reading.reason)
  return reading
}

describe('readNotices', () => {
  it('必須項目がそろった 1 件を読める', () => {
    const { notices, rejected } = readable(file(sample()))
    expect(rejected).toEqual([])
    expect(notices).toEqual([
      {
        id: '2026-01-05-sample',
        kind: '更新',
        date: '2026-01-05',
        title: '見本のお知らせ',
        summary: '見本の要約です。',
        body: ['見本の段落です。'],
      },
    ])
  })

  it('版・変わったこと・引用の段落を読める', () => {
    const { notices } = readable(
      file(
        sample({
          version: 'v1.2',
          changes: ['一つ目', '二つ目'],
          body: ['導入', { quote: '（直した後のテキスト）' }],
        }),
      ),
    )
    expect(notices[0]).toMatchObject({
      version: 'v1.2',
      changes: ['一つ目', '二つ目'],
      body: ['導入', { quote: '（直した後のテキスト）' }],
    })
  })

  it('1 件だけ壊れていても、残りは読めた件として返り、壊れた件は理由つきで外れる', () => {
    const { notices, rejected } = readable(
      file(sample({ id: 'first' }), sample({ id: 'broken', title: '' }), sample({ id: 'last' })),
    )
    expect(notices.map((notice) => notice.id)).toEqual(['first', 'last'])
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toBe('2 件目（id: broken）: title — 空でない文字列が要ります')
  })

  it('知らない種別の件は、外さずに kind が null の読めた件に入る', () => {
    const { notices, rejected } = readable(file(sample({ kind: '新しい種別' })))
    expect(rejected).toEqual([])
    expect(notices[0]?.kind).toBeNull()
  })

  it('知らない項目は、件の中でもファイル全体でも無視する', () => {
    const text = JSON.stringify({ extra: 1, notices: [sample({ unknown: true })] })
    const { notices, rejected } = readable(text)
    expect(rejected).toEqual([])
    expect(notices[0]).not.toHaveProperty('unknown')
  })

  it('丸ごと読めないファイルは、それと分かる結果になる', () => {
    expect(readNotices('{')).toMatchObject({ ok: false })
    expect(readNotices('[]')).toMatchObject({ ok: false })
    expect(readNotices('null')).toMatchObject({ ok: false })
    expect(readNotices('{"notices": {}}')).toMatchObject({ ok: false })
    expect(readNotices('{}')).toMatchObject({ ok: false })
  })

  it('先頭に BOM があるファイルは、BOM が原因と分かる理由で丸ごと読めない', () => {
    const reading = readNotices('\uFEFF' + file(sample()))
    expect(reading).toMatchObject({ ok: false })
    expect(reading.ok ? '' : reading.reason).toContain('BOM')
  })

  it('件が 0 でも読める', () => {
    expect(readable(file()).notices).toEqual([])
  })

  describe('1 件の検査', () => {
    const rejects = (overrides: Record<string, unknown>, field: string) => {
      const { notices, rejected } = readable(file(sample(overrides)))
      expect(notices).toEqual([])
      expect(rejected[0]?.reason).toContain(field)
    }

    it('必須項目が欠けると外す', () => {
      for (const field of ['id', 'kind', 'date', 'title', 'summary', 'body']) {
        rejects({ [field]: undefined }, field)
      }
    })

    it('id は英小文字・数字・ハイフンだけ', () => {
      for (const id of ['Upper', 'a_b', '-a', 'a-', 'a--b', 'あ', '']) rejects({ id }, 'id')
    })

    it('日付は実在する YYYY-MM-DD だけ', () => {
      for (const date of ['2026-02-30', '2026-13-01', '2026-1-1', '20260101', 'あした']) rejects({ date }, 'date')
    })

    it('うるう日は年によって通る', () => {
      expect(readable(file(sample({ date: '2028-02-29' }))).rejected).toEqual([])
      rejects({ date: '2027-02-29' }, 'date')
    })

    it('本文は 1 要素以上で、各要素は空でない文字列か quote', () => {
      rejects({ body: [] }, 'body')
      rejects({ body: 'text' }, 'body')
      rejects({ body: ['ok', ''] }, 'body[1]')
      rejects({ body: [{ quote: '' }] }, 'body[0]')
      rejects({ body: [{ text: 'x' }] }, 'body[0]')
      rejects({ body: [1] }, 'body[0]')
    })

    it('版は省略できるが、書くなら空でない文字列', () => {
      rejects({ version: '' }, 'version')
      rejects({ version: 3 }, 'version')
    })

    it('変わったことは省略できるが、書くなら空でない文字列の配列', () => {
      rejects({ changes: ['ok', ''] }, 'changes')
      rejects({ changes: 'x' }, 'changes')
    })

    it('オブジェクトでない件は外す', () => {
      const { rejected } = readable(file('x', null))
      expect(rejected).toHaveLength(2)
    })

    it('空白だけの文字列は、空とみなして外す', () => {
      rejects({ title: '  　\n' }, 'title')
      rejects({ summary: ' ' }, 'summary')
      rejects({ version: '\t' }, 'version')
      rejects({ body: ['ok', ' '] }, 'body[1]')
      rejects({ body: [{ quote: ' ' }] }, 'body[0]')
      rejects({ changes: ['ok', ' '] }, 'changes')
    })

    it('前後に空白のある文字列は、書き換えずにそのまま読む', () => {
      expect(readable(file(sample({ title: ' 題 ' }))).notices[0]?.title).toBe(' 題 ')
    })
  })
})

describe('checkNoticeFile', () => {
  const notices = (...overrides: Record<string, unknown>[]) =>
    readable(file(...overrides.map((override) => sample(override)))).notices

  it('新しい順で id が重ならなければ問題なし（同じ日はファイルの順のまま）', () => {
    expect(
      checkNoticeFile(
        notices({ id: 'a', date: '2026-01-05' }, { id: 'b', date: '2026-01-05' }, { id: 'c', date: '2026-01-01' }),
      ),
    ).toEqual([])
  })

  it('id の重なりを断る', () => {
    const problems = checkNoticeFile(notices({ id: 'a' }, { id: 'a' }))
    expect(problems).toEqual(['id "a": 1 件目と 2 件目で重なっています'])
  })

  it('日付が上より新しい件を断る', () => {
    const problems = checkNoticeFile(notices({ id: 'a', date: '2026-01-01' }, { id: 'b', date: '2026-01-02' }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('id "b"')
  })

  it('知らない種別を断る', () => {
    const problems = checkNoticeFile(notices({ id: 'a', kind: '未知' }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('kind')
  })
})
