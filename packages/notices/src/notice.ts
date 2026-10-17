// ロビーのお知らせのファイルの形（ADR-0045）。
//
// 画面は読めた件だけを使い、上げるコマンドは外した件が 1 つでもあれば断る。
// 1 件ずつ外す読み方（`readNotices`）と、ファイル全体の取り決め（`checkNoticeFile`）を
// 分けてあるのは、後者を画面が使わないため。

export const NOTICE_KINDS = ['更新', '修正', 'お知らせ'] as const
export type NoticeKind = (typeof NOTICE_KINDS)[number]

/** 本文の 1 段落。文字列は平文の段落、`quote` は引用の段落。 */
export type NoticeBlock = string | { readonly quote: string }

export type Notice = {
  readonly id: string
  /** 知らない種別なら `null`。外さずに読めた件として返し、画面は札を出さない。 */
  readonly kind: NoticeKind | null
  readonly version?: string
  readonly date: string
  readonly title: string
  readonly summary: string
  readonly body: readonly NoticeBlock[]
  readonly changes?: readonly string[]
}

export type Rejection = {
  /** 0 始まりの位置。 */
  readonly index: number
  readonly id?: string
  /** 何件目か・どの項目か・なぜか、が分かる 1 行。 */
  readonly reason: string
}

export type NoticesReading =
  | { readonly ok: false; readonly reason: string }
  | { readonly ok: true; readonly notices: readonly Notice[]; readonly rejected: readonly Rejection[] }

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isRealDate(text: string): boolean {
  const match = DATE_PATTERN.exec(text)
  if (match === null) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** 外す理由（項目名と、なぜか）。読める件は、これではなく値そのものを返す。 */
type Problem = { readonly field: string; readonly why: string }

function readBody(value: unknown): readonly NoticeBlock[] | Problem {
  if (!Array.isArray(value) || value.length === 0) {
    return { field: 'body', why: '1 要素以上の配列が要ります' }
  }
  const blocks: NoticeBlock[] = []
  for (const [at, element] of value.entries()) {
    if (isFilled(element)) {
      blocks.push(element)
    } else if (isRecord(element) && isFilled(element.quote)) {
      blocks.push({ quote: element.quote })
    } else {
      return { field: `body[${at}]`, why: '空でない文字列か { "quote": 空でない文字列 } が要ります' }
    }
  }
  return blocks
}

function readChanges(value: unknown): readonly string[] | Problem {
  if (!Array.isArray(value) || !value.every(isFilled)) {
    return { field: 'changes', why: '空でない文字列の配列が要ります' }
  }
  return value as string[]
}

function readNotice(raw: unknown): Notice | Problem {
  if (!isRecord(raw)) return { field: '項目全体', why: 'オブジェクトが要ります' }

  if (!isFilled(raw.id) || !ID_PATTERN.test(raw.id)) {
    return { field: 'id', why: '英小文字・数字・ハイフンの文字列が要ります' }
  }
  if (typeof raw.kind !== 'string') return { field: 'kind', why: '文字列が要ります' }
  if (!isFilled(raw.date) || !isRealDate(raw.date)) {
    return { field: 'date', why: '実在する日付の YYYY-MM-DD が要ります' }
  }
  if (!isFilled(raw.title)) return { field: 'title', why: '空でない文字列が要ります' }
  if (!isFilled(raw.summary)) return { field: 'summary', why: '空でない文字列が要ります' }
  if (raw.version !== undefined && !isFilled(raw.version)) {
    return { field: 'version', why: '空でない文字列が要ります' }
  }

  const body = readBody(raw.body)
  if (!Array.isArray(body)) return body as Problem

  let changes: readonly string[] | undefined
  if (raw.changes !== undefined) {
    const read = readChanges(raw.changes)
    if (!Array.isArray(read)) return read as Problem
    changes = read
  }

  const kind = (NOTICE_KINDS as readonly string[]).includes(raw.kind) ? (raw.kind as NoticeKind) : null
  return {
    id: raw.id,
    kind,
    ...(raw.version === undefined ? {} : { version: raw.version }),
    date: raw.date,
    title: raw.title,
    summary: raw.summary,
    body: body as readonly NoticeBlock[],
    ...(changes === undefined ? {} : { changes }),
  }
}

function isProblem(read: Notice | Problem): read is Problem {
  return 'why' in read
}

/**
 * ファイルの文字列を読む。1 件ずつ検査して、読めない件だけを外す。
 *
 * 丸ごと読めない（JSON でない・外側がオブジェクトでない・`notices` が配列でない）時は
 * `ok: false` を返す。知らない項目は無視する。並べ替えはしない。
 */
export function readNotices(text: string): NoticesReading {
  if (text.startsWith('﻿')) {
    return { ok: false, reason: '先頭に BOM があります。BOM なしの UTF-8 で保存してください' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'JSON として読めません' }
  }
  if (!isRecord(parsed)) return { ok: false, reason: '外側がオブジェクトではありません' }
  if (!Array.isArray(parsed.notices)) return { ok: false, reason: '"notices" が配列ではありません' }

  const notices: Notice[] = []
  const rejected: Rejection[] = []
  for (const [index, raw] of (parsed.notices as unknown[]).entries()) {
    const read = readNotice(raw)
    if (!isProblem(read)) {
      notices.push(read)
      continue
    }
    const id = isRecord(raw) && isFilled(raw.id) ? raw.id : undefined
    const who = id === undefined ? `${index + 1} 件目` : `${index + 1} 件目（id: ${id}）`
    rejected.push({ index, ...(id === undefined ? {} : { id }), reason: `${who}: ${read.field} — ${read.why}` })
  }
  return { ok: true, notices, rejected }
}

/**
 * ファイル全体の取り決めを確かめて、破れているところを 1 行ずつ返す。画面は使わない。
 *
 * `id` が重ならないこと、日付が上から順に同じか古くなっていること（新しい順）。
 * 知らない種別の件も、ここで断る。
 *
 * 何件目かは、渡された配列の位置。外した件が混ざると、ファイルの位置とずれる。
 */
export function checkNoticeFile(notices: readonly Notice[]): string[] {
  const problems: string[] = []
  const firstAt = new Map<string, number>()
  for (const [at, notice] of notices.entries()) {
    const first = firstAt.get(notice.id)
    if (first === undefined) {
      firstAt.set(notice.id, at)
    } else {
      problems.push(`id "${notice.id}": ${first + 1} 件目と ${at + 1} 件目で重なっています`)
    }
    if (notice.kind === null) {
      problems.push(`id "${notice.id}": kind — 更新・修正・お知らせのどれかが要ります`)
    }
    const above = notices[at - 1]
    if (above !== undefined && notice.date > above.date) {
      problems.push(
        `id "${notice.id}": date — 上の件（${above.date}）より新しい日付です。新しい順（上が新しい）に書いてください`,
      )
    }
  }
  return problems
}
