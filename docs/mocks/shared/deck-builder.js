const LEVEL_ICON = { 赤: '../shared/level-icons/赤.svg', 黒: '../shared/level-icons/黒.svg', 青: '../shared/level-icons/青.svg', 白: '../shared/level-icons/白.svg', 緑: '../shared/level-icons/緑.svg' }
const TYPES = ['ユニット', 'ストラテジー', 'トラップ', '超必殺ストラテジー！']
const COLORS = ['赤', '黒', '青', '白', '緑']
const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8]
const STAR_CHOICES = ['なし', '★1', '★2', 'リバーススター']
// 移動方向は、ムーブアイコンの形そのもので選ぶ（開発者の指定の 4 種）
const MOVE_PATTERNS = [['上のみ', ['上']], ['上下のみ', ['上', '下']], ['上・右・左', ['上', '右', '左']], ['上下左右', ['上', '下', '左', '右']]]
const moveKey = (dirs) => [...dirs].sort().join('')
const movePatternOf = (c) => MOVE_PATTERNS.find(([, dirs]) => moveKey(dirs) === moveKey(c.face.moveIcon ?? []))?.[0]
const ATTR_SEP = ' | '

/* ---- ラベル ---- */
// 持ち主が選ぶラベル：型は 1 つまで、用途はいくつでも
const TAG_TYPES = ['アグロ', 'ミッドレンジ', 'コントロール', 'コンボ']
const TAG_USES = ['初心者向け', '大会用', 'お試し']
/**
 * デッキの中身から自動で付くラベル。数えるだけで決まるもの（ルールの判断は含めない）。
 * アーキタイプのしきい値はモックの仮の値。持ち主が型を選んでいれば、アーキタイプは付けない。
 */
function autoTagsOf(cards, userType) {
  const usable = cards.map((k) => pool.find((c) => c.key === k)).filter(Boolean)
  if (!usable.length) return []
  const tags = []
  if (!userType) {
    const avg = usable.reduce((s, c) => s + c.face.level, 0) / usable.length
    tags.push({ label: avg <= 3.6 ? 'アグロ' : avg >= 4.6 ? 'コントロール' : 'ミッドレンジ', group: 'アーキタイプ' })
  }
  const colors = COLORS.filter((c) => usable.some((x) => (x.face.colors[0] ?? '黒') === c))
  tags.push({ label: colors.length === 1 ? `${colors[0]}単` : colors.length === 2 ? colors.join('') : '多色', group: '色の構成' })
  const majority = (of) => { const m = {}; for (const c of usable) m[of(c)] = (m[of(c)] ?? 0) + 1; const [top, n] = Object.entries(m).sort((a, b) => b[1] - a[1])[0]; return n / usable.length >= 0.5 ? top : undefined }
  const work = majority((c) => WORK_OF_KEY[c.key] ?? FALLBACK_WORKS[Number(c.key.slice(-2)) % FALLBACK_WORKS.length])
  if (work) tags.push({ label: work, group: '作品名' })
  const block = majority((c) => BLOCK_OF_WORK[WORK_OF_KEY[c.key] ?? FALLBACK_WORKS[Number(c.key.slice(-2)) % FALLBACK_WORKS.length]])
  if (block) tags.push({ label: block, group: 'ブロック' })
  return tags.map((t) => ({ ...t, kind: '自動' }))
}
function tagsOf(cards, userType, userUses) {
  return [...autoTagsOf(cards, userType), ...(userType ? [{ label: userType, group: 'アーキタイプ', kind: '選択' }] : []), ...userUses.map((u) => ({ label: u, group: 'その他', kind: '選択' }))]
}
/** ラベルの中身を表す絵文字。色の構成は色のアイコン（レベルアイコンの形）で表す。 */
const TAG_EMOJI = { アグロ: '⚡', ミッドレンジ: '⚖️', コントロール: '🛡️', コンボ: '🧩', 初心者向け: '🔰', 大会用: '🏆', お試し: '🧪', 多色: '🌈' }
function tagIcon(t) {
  if (t.group === '色の構成' && t.label !== '多色') {
    const box = el('span', 'tag__colors')
    for (const c of COLORS.filter((c) => t.label.includes(c))) { const i = el('img'); i.src = LEVEL_ICON[c]; i.alt = ''; box.append(i) }
    return box
  }
  const emoji = TAG_EMOJI[t.label] ?? (t.group === '作品名' ? '📖' : t.group === 'ブロック' ? '🏢' : undefined)
  return emoji ? el('span', 'tag__emoji', emoji) : undefined
}
const KEYWORDS = ['夢', '希望', '元気', '信頼', '根性', '勇気']
// ブロックの選択肢（開発者の指定）。作品名・ブロック・エキスパンションコードは、まだカードのデータに無い（別 Issue）。
const BLOCKS = ['見本書房', '架空出版', '例文社', '仮置文庫', 'サンプル堂']
const BLOCK_LOGO = { 見本書房: 'Ａ', 架空出版: 'Ｂ', 例文社: 'Ｃ', 仮置文庫: 'Ｄ', サンプル堂: 'Ｅ' }
const EXPANSION_CODE = { '見本デッキ A': 'MHA', '見本デッキ B': 'MHB' }
// 以下はモックだけの仮の割り当て（推測を含む）。本番はカードのデータが持つ。
const WORK_OF_KEY = {
  'MHA-01': '見本作品Ａ', 'MHA-13': '見本作品Ａ', 'MHA-02': '見本作品Ｊ', 'MHA-03': '見本作品Ｂ',
  'MHA-04': '見本作品Ｋ', 'MHA-18': '見本作品Ｋ', 'MHA-05': '見本作品Ｌ', 'MHA-06': '見本作品Ｃ',
  'MHA-07': '見本作品Ｃ', 'MHB-09': '見本作品Ｃ', 'MHA-10': '見本作品Ｃ２',
  'MHA-09': '見本作品Ｄ', 'MHA-14': '見本作品Ｍ', 'MHB-01': '見本作品Ｎ', 'MHB-02': '見本作品Ｏ',
  'MHB-03': '見本作品Ｐ', 'MHB-04': '見本作品Ｇ', 'MHB-08': '見本作品Ｇ', 'MHB-07': '見本作品Ｆ',
  'MHB-12': '見本作品Ｉ', 'MHB-13': '見本作品Ｈ', 'MHB-14': '見本作品Ｅ', 'MHB-18': '見本作品Ｅ',
}
const BLOCK_OF_WORK = {
  '見本作品Ａ': '見本書房', '見本作品Ｊ': '架空出版', '見本作品Ｂ': '仮置文庫',
  '見本作品Ｋ': '架空出版', '見本作品Ｌ': '架空出版', '見本作品Ｃ': 'サンプル堂', '見本作品Ｃ２': 'サンプル堂',
  '見本作品Ｄ': '見本書房', '見本作品Ｍ': '架空出版', '見本作品Ｎ': '例文社',
  '見本作品Ｏ': '見本書房', '見本作品Ｐ': '例文社', '見本作品Ｇ': 'サンプル堂',
  '見本作品Ｆ': '見本書房', '見本作品Ｉ': '例文社', '見本作品Ｈ': '例文社',
  '見本作品Ｅ': '例文社',
}
const FALLBACK_WORKS = ['見本作品Ｊ', '見本作品Ｋ', '見本作品Ｐ', '見本作品Ｎ', '見本作品Ｂ']
const workOf = (c) => WORK_OF_KEY[c.key] ?? FALLBACK_WORKS[Number(c.key.slice(-2)) % FALLBACK_WORKS.length]
const blockOf = (c) => BLOCK_OF_WORK[workOf(c)]
const codesOf = (c) => c.expansions.map((e) => EXPANSION_CODE[e] ?? e)
const BATCH = { カード: 24, 一覧: 60 }

const pool = [...window.POOL].sort((a, b) =>
  TYPES.indexOf(a.face.type) - TYPES.indexOf(b.face.type) ||
  COLORS.indexOf(a.face.colors[0]) - COLORS.indexOf(b.face.colors[0]) ||
  a.face.level - b.face.level || a.face.name.localeCompare(b.face.name, 'ja'))
// モックだけの近似：プランのもの以外のキーワード能力は、テキストの行頭から拾う（本番はエンジンが表記に載せる）
const keywordsOf = (c) => [...new Set([...c.face.keywords, ...KEYWORDS.filter((k) => c.face.text.some((l) => l.startsWith(k)))])]

const startCards = []
for (const c of pool) if (c.expansions.includes('見本デッキ A')) for (let i = 0; i < 3; i++) startCards.push(c.key)
startCards.splice(0, 9)
startCards.push('OLD-01', 'OLD-01')

const emptyFilter = () => ({ text: '', types: [], colors: [], levels: [], bpMin: '', bpMax: '', spMin: '', spMax: '', stars: [], moves: [], keywords: [], attributes: [], works: [], blocks: [], expansions: [] })
const state = {
  // どちらの画面として開くか。画面ごとの index.html が決める（deck-list/・deck-builder/）
  view: window.MOCK_VIEW ?? 'build',
  name: '見本・もちぬい速攻',
  editingName: false,
  description: '気合のダメージを受け止めて、先に押し切る。\n序盤はレベル 2〜3 を並べ、終盤は見本・霧島透で押し込む。',
  format: '構築戦',
  cards: startCards,
  partner: undefined,
  partnerDropped: undefined,
  saved: false,
  pinned: undefined,
  filterOpen: false,
  folds: {},
  detailOpen: true,
  userType: undefined,
  userUses: ['初心者向け'],
  deckTags: [],
  filter: emptyFilter(),
  poolView: 'カード',
  shown: BATCH.カード,
  modal: undefined,
  deckSearch: '',
  deckColors: [],
  // スマホの並べ方でだけ使う。PC の見た目には効かない
  phoneTab: '探す', // デッキ構築の 2 つのタブ（探す・デッキ）
  phoneScroll: {}, // タブごとに、前に見ていたスクロールの位置（帯が上に付いている間に離れたときだけ覚える）
  scrollTo: undefined, // 描き直したあとに 1 度だけ行うスクロール（'位置' | 'タブの帯の下' | '確かめた結果'）
  phoneFilter: false, // 絞り込みを開いているか（デッキ構築・デッキ一覧で共通）
  phoneSettings: false, // デッキ構築の上の段（解説・ラベル・形式・リスト）を開いているか

}

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }
const btn = (label, onClick, cls) => { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b }
const iconBtn = (icon, label, onClick, cls = '') => { const b = btn(icon, onClick, `icon-button ${cls}`); b.setAttribute('aria-label', label); b.title = label; return b }
const countOf = (key, cards = state.cards) => cards.filter((k) => k === key).length
const known = new Set(pool.map((c) => c.key))
const byKey = (key) => pool.find((c) => c.key === key)
const colorOf = (c) => c.face.colors[0] ?? '黒'

/* ---- カードの面（render.ts の faceElement と同じ組み立て） ---- */
function svg(tag, attrs) { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n }
function moveIcon(dirs) {
  const on = (d) => (dirs.includes(d) ? '#fff' : '#4a4a4a')
  const s = svg('svg', { class: 'move-icon', viewBox: '0 0 20 20', role: 'img', 'aria-label': `ムーブアイコン：${dirs.join('・')}` })
  s.append(svg('path', { d: 'M10 0.6 19.4 10 10 19.4 0.6 10Z', fill: '#2a2a2a', stroke: '#fff', 'stroke-width': '0.8' }), svg('path', { d: 'M10 2.6 12.4 6H7.6Z', fill: on('上') }), svg('path', { d: 'M10 17.4 12.4 14H7.6Z', fill: on('下') }), svg('path', { d: 'M2.6 10 6 7.6V12.4Z', fill: on('左') }), svg('path', { d: 'M17.4 10 14 7.6V12.4Z', fill: on('右') }), svg('circle', { cx: '10', cy: '10', r: '2.6', fill: '#c81c1c', stroke: '#fff', 'stroke-width': '0.6' }))
  return s
}
function triggerIcon(cells) {
  const s = svg('svg', { class: 'trigger-icon', viewBox: '0 0 20.6 20.6', role: 'img', 'aria-label': 'トリガーアイコン' })
  s.append(svg('rect', { x: '0', y: '0', width: '20.6', height: '20.6', rx: '1.4', fill: '#fff', stroke: '#222', 'stroke-width': '0.6' }))
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
    const hit = cells.some((q) => q.row === row && q.column === column)
    s.append(svg('rect', { x: String(1 + column * 6.2), y: String(1 + (2 - row) * 6.2), width: '5.6', height: '5.6', rx: '0.6', fill: hit ? '#e8202a' : '#4d4d4d' }))
  }
  return s
}
function star(count, reverse) {
  if (!count) return undefined
  const n = el('span', `star${reverse ? ' star--reverse' : ''}`)
  n.setAttribute('role', 'img'); n.setAttribute('aria-label', `${reverse ? 'リバーススター' : 'スター'} ${count}`)
  const i = el('img'); i.src = reverse ? '../shared/reverse-star.svg' : '../shared/star.svg'; i.alt = ''; n.append(i)
  if (count >= 2) n.append(el('span', '', String(count)))
  return n
}
function levelBadge(face) {
  const n = el('span', 'card__level')
  const i = el('img'); i.src = LEVEL_ICON[face.colors[0] ?? '黒']; i.alt = ''
  n.append(i, el('span', '', String(face.level)))
  n.setAttribute('role', 'img'); n.setAttribute('aria-label', `レベル ${face.level}`)
  return n
}
function face(f, big, block) {
  const node = el('div', 'card__face')
  const top = el('div', 'card__top'); top.append(levelBadge(f), el('span', 'card__kind', f.type)); node.append(top)
  const title = el('div', 'card__title')
  for (const s of [star(f.stars, false), star(f.reverseStars, true)]) if (s) title.append(s)
  title.append(el('span', 'card__name', f.name))
  const icon = f.moveIcon?.length ? moveIcon(f.moveIcon) : f.triggerIcon?.length ? triggerIcon(f.triggerIcon) : undefined
  const icons = icon ? (() => { const d = el('div', 'card__icons'); d.append(icon); return d })() : undefined
  const bottom = el('div', 'card__bottom')
  if (big) {
    if (f.keywords?.length) { const k = el('span', 'keywords'); for (const w of f.keywords) { const g = el('span', `keyword keyword--${w}`); g.setAttribute('role', 'img'); g.setAttribute('aria-label', w); g.append(el('span', '', w)); k.append(g) } title.append(k) }
    bottom.append(title)
    const text = el('div', 'card__text'); const lines = el('div', 'card__lines')
    for (const p of f.text) lines.append(el('p', '', p))
    text.append(lines); if (icons) text.append(icons); bottom.append(text)
  } else { node.append(title); if (icons) bottom.append(icons) }
  if (f.attributes.length) bottom.append(el('span', 'card__traits', f.attributes.join(ATTR_SEP)))
  // BP・SP の間にブロックのロゴ。ユニット以外は BP・SP が無いので、ロゴだけを真ん中に置く。
  const stats = el('div', `card__stats${f.type === 'ユニット' ? '' : ' card__stats--ロゴだけ'}`)
  if (f.type === 'ユニット') stats.append(el('span', 'card__bp', String(f.bp)))
  if (block) stats.append(blockLogo(block))
  if (f.type === 'ユニット') stats.append(el('span', 'card__sp', String(f.sp)))
  bottom.append(stats)
  node.append(bottom)
  return node
}
function blockLogo(block) {
  const n = el('span', `block-logo block-logo--${BLOCK_LOGO[block]}`, BLOCK_LOGO[block])
  n.setAttribute('role', 'img'); n.setAttribute('aria-label', `ブロック：${block}`); n.title = block
  return n
}
function cardEl(c, big, extra = '') {
  const n = el('div', `card card--色-${colorOf(c)}${big ? ' card--拡大' : ''}${!big && state.pinned === c.key ? ' card--詳細中' : ''} ${extra}`)
  n.append(face(c.face, big, blockOf(c)))
  return n
}
function colorIcon(color) { const i = el('img', 'chip__color'); i.src = LEVEL_ICON[color]; i.alt = ''; return i }

/* ---- 絞り込み ---- */
const inRange = (v, min, max) => (min === '' || v >= Number(min)) && (max === '' || v <= Number(max))
function starOf(c) { const r = []; if (!c.face.stars && !c.face.reverseStars) r.push('なし'); if (c.face.stars === 1) r.push('★1'); if (c.face.stars === 2) r.push('★2'); if (c.face.reverseStars > 0) r.push('リバーススター'); return r }
function filtered() {
  const f = state.filter
  const t = f.text.trim()
  return pool.filter((c) =>
    (!t || c.face.name.includes(t) || c.face.text.some((l) => l.includes(t))) &&
    (!f.types.length || f.types.includes(c.face.type)) &&
    (!f.colors.length || c.face.colors.some((x) => f.colors.includes(x))) &&
    (!f.levels.length || f.levels.includes(c.face.level)) &&
    (!f.attributes.length || c.face.attributes.some((x) => f.attributes.includes(x))) &&
    (!f.works.length || f.works.includes(workOf(c))) &&
    (!f.blocks.length || f.blocks.includes(blockOf(c))) &&
    (!f.stars.length || starOf(c).some((s) => f.stars.includes(s))) &&
    (!f.moves.length || f.moves.includes(movePatternOf(c))) &&
    (!f.keywords.length || keywordsOf(c).some((k) => f.keywords.includes(k))) &&
    (!f.expansions.length || c.expansions.some((x) => f.expansions.includes(x))) &&
    ((f.bpMin === '' && f.bpMax === '') || (c.face.type === 'ユニット' && inRange(c.face.bp, f.bpMin, f.bpMax))) &&
    ((f.spMin === '' && f.spMax === '') || (c.face.type === 'ユニット' && inRange(c.face.sp, f.spMin, f.spMax))))
}
const filtering = () => JSON.stringify(state.filter) !== JSON.stringify(emptyFilter())
const toggled = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
function setFilter(next) {
  state.filter = { ...state.filter, ...next }; state.shown = BATCH[state.poolView]
  // 一覧の中身が変わるので、カード一覧は先頭から見せる（本番の onFilter と同じ）。絞り込みパネルの位置は保つ
  delete keepScroll[`pool-${state.poolView}`]
  draw()
}

function chip(content, pressed, onClick, extra = '') {
  const b = btn('', onClick, `chip${pressed ? ' chip--選択中' : ''} ${extra}`)
  for (const c of [].concat(content)) b.append(c)
  b.setAttribute('aria-pressed', String(pressed))
  return b
}
/** 「すべて」＋選択肢の並び。すべて＝その軸で絞らない。label をかける選択肢は aria-label に使う。 */
function chips(values, chosen, key, render = (v) => String(v), labelOf = undefined) {
  const box = el('div', 'filter__chips')
  box.append(chip('すべて', chosen.length === 0, () => setFilter({ [key]: [] }), 'chip--すべて'))
  for (const v of values) {
    const c = chip(render(v), chosen.includes(v), () => setFilter({ [key]: toggled(chosen, v) }))
    if (labelOf) { c.setAttribute('aria-label', labelOf(v)); c.title = labelOf(v) }
    box.append(c)
  }
  return box
}
/** 折りたためない項目：項目名と選択肢を同じ行に並べる。 */
function chipRow(label, values, chosen, key, render, labelOf) {
  const row = el('div', 'filter__row')
  row.append(el('span', 'filter__label', label), chips(values, chosen, key, render, labelOf))
  return row
}
function rangeRow(label, minKey, maxKey) {
  const row = el('div', 'filter__row'); row.append(el('span', 'filter__label', label))
  const range = el('div', 'filter__range')
  const mk = (side) => { const i = el('input'); i.type = 'number'; i.step = '500'; i.min = '0'; i.placeholder = side === minKey ? '下限' : '上限'; i.setAttribute('aria-label', `${label}の${side === minKey ? '下限' : '上限'}`); i.value = state.filter[side]; i.addEventListener('change', () => setFilter({ [side]: i.value })); return i }
  range.append(mk(minKey), el('span', '', '〜'), mk(maxKey)); row.append(range)
  return row
}
/** 折りたためる項目。閉じている間は、項目名の横に選んでいる値を並べる（収まらなければ省略）。 */
function fold(label, values, chosen, key, shownAs = (v) => v) {
  const d = el('details', 'fold'); d.open = !!state.folds[key]
  d.addEventListener('toggle', () => { state.folds[key] = d.open })
  const s = el('summary')
  s.append(el('span', 'filter__label', label))
  const picked = el('span', `fold__picked${chosen.length ? '' : ' fold__picked--すべて'}`, chosen.length ? chosen.map(shownAs).join(' | ') : 'すべて')
  picked.title = chosen.join('・')
  s.append(picked)
  d.append(s)
  const b = el('div', 'fold__body'); b.append(chips(values, chosen, key)); d.append(b)
  return d
}

/* ---- 描く ---- */
const app = document.getElementById('app')
let keepScroll = {}
/** スマホの並べ方か。deck-builder.css の境目（幅 768px）と同じ。DOM の順を入れ替えるのに使う */
const phoneQuery = matchMedia('(max-width: 768px)')
const phoneWidth = () => phoneQuery.matches
// 幅を行き来したら、DOM の順が変わるので描き直す
phoneQuery.addEventListener('change', () => draw())

function draw() {
  // 縦だけでなく横の位置も戻す（一覧表示は狭いと横にスクロールするので、−・＋を押すたびに左端へ戻らないように）
  for (const n of app.querySelectorAll('[data-keep-scroll]')) keepScroll[n.dataset.keepScroll] = { top: n.scrollTop, left: n.scrollLeft }
  app.replaceChildren(state.view === 'build' ? builder() : deckList())
  for (const n of app.querySelectorAll('[data-keep-scroll]')) { const at = keepScroll[n.dataset.keepScroll]; if (at) { n.scrollTop = at.top; n.scrollLeft = at.left } }
  const sentinel = app.querySelector('.pool__more')
  if (sentinel) new IntersectionObserver((entries, obs) => { if (entries[0].isIntersecting) { obs.disconnect(); state.shown += BATCH[state.poolView]; draw() } }, { root: app.querySelector('.pool') }).observe(sentinel)
  const focus = app.querySelector('[data-autofocus]'); if (focus) focus.focus()
  settlePhoneScroll()
}
/** 確かめた結果。使えなくなったカードがあれば確かめられない。無ければ、枚数と同名の入れすぎを見る */
function checkOf() {
  const unusable = state.cards.filter((k) => !known.has(k)).length
  if (unusable > 0) return { kind: '確かめられない', lines: [`使えなくなったカードが ${unusable} 枚入っています。下の一覧の「抜く」で外すまで、規定を確かめることも保存することもできません`] }
  const lines = []
  if (state.cards.length < 60) lines.push(`あと ${60 - state.cards.length} 枚足りません（60 枚以上）`)
  for (const c of pool) { const n = countOf(c.key); if (n > 4) lines.push(`「${c.face.name}」が ${n} 枚入っています（4 枚まで）`) }
  return lines.length ? { kind: '満たしていない', lines } : { kind: '満たしている', lines: ['規定を満たしています'] }
}
/** タブの帯の下から、中身の先頭までの隙間（`.deckbuild` の gap と同じ 0.5rem） */
const GAP_BELOW_TABS = 8
/** 描き直したあと、タブを切り替えた先のスクロールの位置に置く。実装の `phone-scroll.ts` と同じ */
function settlePhoneScroll() {
  const to = state.scrollTo; state.scrollTo = undefined
  const tabs = app.querySelector('.phone-tabs')
  if (!to || !tabs) return
  const at = (top) => window.scrollTo({ top: Math.max(0, top), behavior: 'instant' })
  if (to.kind === '位置') return at(to.top)
  const target = app.querySelector(to.kind === 'タブの帯の下' ? '.columns' : '.check')
  if (target) at(target.getBoundingClientRect().top + window.scrollY - tabs.getBoundingClientRect().height - GAP_BELOW_TABS)
}
/**
 * タブを切り替える。離れるタブの位置を覚え（帯が上に付いている間だけ）、着いたタブでは、確かめた結果を見に来たならその文、
 * 帯がまだ付いていなければ動かさず、前に見ていた位置があればそこ、無ければタブの帯のすぐ下へ置く。実装の `phone.ts` と同じ
 */
function switchTab(key, reveal) {
  const tabs = app.querySelector('.phone-tabs')
  const stuck = Boolean(tabs) && tabs.getBoundingClientRect().top <= 0.5
  if (key === state.phoneTab) { if (reveal) { state.scrollTo = { kind: '確かめた結果' }; draw() } else draw(); return }
  if (stuck) state.phoneScroll[state.phoneTab] = window.scrollY; else delete state.phoneScroll[state.phoneTab]
  const remembered = state.phoneScroll[key]
  state.scrollTo = reveal ? { kind: '確かめた結果' } : !stuck ? undefined : remembered === undefined ? { kind: 'タブの帯の下' } : { kind: '位置', top: remembered }
  state.phoneTab = key
  draw()
}
const panel = (cls, title, aside) => { const p = el('section', `panel ${cls}`); const h = el('div', 'panel__head'); h.append(el('h2', 'panel__title', title)); if (aside) h.append(aside); p.append(h); return p }

/* ================= デッキを組む ================= */
function builder() {
  // 下の帯に規定外の印が出る間は帯が高くなるので、末尾の余白を足す
  const root = el('div', `deckbuild deckbuild--tab-${state.phoneTab}${checkOf().kind === '満たしている' ? '' : ' deckbuild--notice'}`)
  // スマホ専用の部品（phone-only）は PC では display:none で、グリッドにも入らない
  root.append(topbarBuild(), phoneTabs())
  const columns = el('div', 'columns')
  columns.append(tabpanel(leftColumn(), '探す', 0), tabpanel(centerColumn(), '探す', 1), tabpanel(rightColumn(), 'デッキ', 0))
  root.append(columns, phoneBar())
  if (state.pinned && byKey(state.pinned)) root.append(...phoneSheet(byKey(state.pinned)))
  if (state.modal) root.append(modal())
  return root
}

/** タブが出す中身の塊の数（探す: 左と真ん中の列、デッキ: 右の列）。中身には tabpanel と、タブ由来の名前を付ける */
const TAB_PANELS = { 探す: 2, デッキ: 1 }
function tabpanel(panel, key, at) {
  panel.id = `phone-panel-${key}-${at}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `phone-tab-${key}`)
  return panel
}
/** スマホで、「カードを探す」「デッキ」を切り替えるタブ。デッキのほうには、いまの枚数を出す */
function phoneTabs() {
  const n = el('div', 'phone-only phone-tabs'); n.setAttribute('role', 'tablist')
  for (const [key, label] of [['探す', 'カードを探す'], ['デッキ', `デッキ（${state.cards.length} 枚）`]]) {
    const b = btn(label, () => switchTab(key, false), 'phone-tab')
    b.id = `phone-tab-${key}`; b.setAttribute('aria-controls', Array.from({ length: TAB_PANELS[key] }, (_, at) => `phone-panel-${key}-${at}`).join(' '))
    b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(state.phoneTab === key))
    n.append(b)
  }
  return n
}
/** スマホで、絞り込みを畳んで置く開閉のボタン（デッキ構築・デッキ一覧で共通）。絞り込み中かは、畳んでいても分かるようにする */
function phoneFilterToggle(active) {
  const b = btn('', () => { state.phoneFilter = !state.phoneFilter; draw() }, 'phone-only filter__toggle')
  b.setAttribute('aria-expanded', String(state.phoneFilter))
  b.append(el('span', '', active ? '絞り込み（絞り込み中）' : '絞り込み'), el('span', 'filter__toggle-mark', state.phoneFilter ? '▲' : '▼'))
  return b
}
/**
 * スマホで、上の段の解説・ラベル・形式・禁止／制限リストを畳んで置く開閉のボタン。上の段が大きいと、
 * カードプールが 1 段ほどしか見えなくなるため。畳んでいても、いまの形式とリストは分かるようにする
 */
function phoneSettingsToggle() {
  const b = btn('', () => { state.phoneSettings = !state.phoneSettings; draw() }, 'phone-only settings__toggle')
  b.setAttribute('aria-expanded', String(Boolean(state.phoneSettings)))
  b.append(el('span', '', `デッキの設定（${state.format}・制限なし）`), el('span', 'filter__toggle-mark', state.phoneSettings ? '▲' : '▼'))
  return b
}
/** スマホで、画面の下に常に出しておく帯。枚数と保存。どちらのタブでも見える */
function phoneBar() {
  const n = el('div', 'phone-only phonebar')
  const total = el('span', 'phonebar__count'); total.append(el('strong', '', String(state.cards.length)), ' 枚')
  const hasUnusable = state.cards.some((k) => !known.has(k))
  const save = btn('保存する', () => { state.saved = true; draw() }, 'button--primary')
  save.disabled = hasUnusable || state.saved
  // 規定を満たしていないときだけ出す印。押すと「デッキ」のタブへ移り、確かめた結果の文が見える位置へ持っていく
  const check = checkOf()
  if (check.kind !== '満たしている') {
    const label = check.kind === '満たしていない' ? `規定外 ${check.lines.length} 件` : '規定を確かめられません'
    const spoken = check.kind === '満たしていない' ? `規定を満たしていない点が ${check.lines.length} 件あります` : '使えなくなったカードが入っていて、規定を確かめられません'
    const notice = btn('', () => switchTab('デッキ', true), 'phonebar__notice')
    notice.setAttribute('aria-label', `${label}。${spoken}。押すとデッキのタブで見られます`)
    const mark = el('span', 'phonebar__notice-mark', '⚠'); mark.setAttribute('aria-hidden', 'true')
    notice.append(mark, el('span', '', label))
    n.append(notice)
  }
  n.append(total,el('span', `savebar__state${state.saved ? '' : ' savebar__state--未保存'}`, state.saved ? '保存しました' : '未保存'), save)
  return n
}
/** スマホで、カードを 1 回タップしたときに下から出す詳細のシート。枚数を増減する口と、一番下に「閉じる」 */
function phoneSheet(c) {
  const close = () => { state.pinned = undefined; draw() }
  const back = el('div', 'phone-only sheet-backdrop'); back.addEventListener('click', close)
  const sheet = el('section', 'phone-only sheet'); sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', `「${c.face.name}」の詳細`)
  const d = el('div', 'detail'); d.append(...detailNodes(c))
  const count = countOf(c.key)
  const row = el('div', 'sheet__counter')
  const minus = btn('1 枚抜く', () => removeOne(c)); minus.disabled = count === 0
  const badge = el('span', `counter__count${count > 0 ? ' counter__count--入っている' : ''}`, `×${count}`); badge.setAttribute('aria-label', `デッキに ${count} 枚`)
  row.append(minus, badge, btn('1 枚入れる', () => addOne(c), 'button--primary'))
  sheet.append(d, row, btn('閉じる', close, 'sheet__close'))
  return [back, sheet]
}

function topbarBuild() {
  const bar = el('header', 'panel topbar')
  bar.append(btn('← デッキ一覧に戻る', () => go('deck-list')), el('h1', 'topbar__title', 'デッキ構築'), el('span', 'topbar__divider'))
  const name = el('div', 'deckname')
  if (state.editingName) {
    const input = el('input'); input.type = 'text'; input.maxLength = 40; input.value = state.name; input.setAttribute('aria-label', 'デッキの名前'); input.dataset.autofocus = ''
    const commit = () => { if (!state.editingName) return; state.name = input.value.trim() || state.name; state.editingName = false; state.saved = false; draw() }
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { state.editingName = false; draw() } })
    input.addEventListener('blur', commit)
    name.append(input)
  } else {
    name.append(el('span', 'deckname__text', state.name), iconBtn('✏️', 'デッキの名前を変える', () => { state.editingName = true; draw() }))
  }
  bar.append(name, phoneSettingsToggle())
  if (state.phoneSettings) bar.classList.add('topbar--phone-開いている')
  const desc = btn(state.description ? '📝 解説' : '📝 解説を書く', () => { state.modal = '解説'; draw() }, 'button--small')
  desc.setAttribute('aria-haspopup', 'dialog')
  const tagBtn = btn('🏷 ラベル', () => { state.modal = 'ラベル'; draw() }, 'button--small')
  tagBtn.setAttribute('aria-haspopup', 'dialog')
  bar.append(desc, tagBtn, tagList(tagsOf(state.cards, state.userType, state.userUses), 'taglist--bar'), el('span', 'topbar__spacer'))
  const rule = (label, options, value) => { const l = el('label', 'rule'); l.append(el('span', '', label)); const s = el('select'); for (const o of options) s.append(new Option(o, o, false, o === value)); l.append(s); return l }
  bar.append(rule('形式', ['構築戦'], state.format), rule('禁止／制限リスト', ['制限なし'], '制限なし'))
  return bar
}

function leftColumn() {
  const col = el('div', 'column column--left')
  const f = state.filter
  const reset = filtering() ? btn('すべて外す', () => setFilter(emptyFilter()), 'button--small') : undefined
  const filter = panel(`panel--filter${state.phoneFilter ? ' panel--phone-開いている' : ''}`, '絞り込み', reset)
  col.append(phoneFilterToggle(filtering()))
  const body = el('div', 'panel__body')
  // 選ぶたびに描き直すので、スクロールした位置を戻す（本番の KEEP_SCROLL と同じ）
  body.dataset.keepScroll = 'filter'
  const search = el('input'); search.type = 'search'; search.placeholder = '名前・テキストで探す'; search.setAttribute('aria-label', '名前・テキストで探す'); search.value = f.text
  search.addEventListener('change', () => setFilter({ text: search.value }))
  body.append(search)
  const exps = [...new Set(pool.flatMap((c) => c.expansions))]
  body.append(fold('エキスパンション', exps, f.expansions, 'expansions', (e) => EXPANSION_CODE[e] ?? e))
  body.append(chipRow('色', COLORS, f.colors, 'colors', (c) => [colorIcon(c), c]))
  body.append(chipRow('種別', TYPES, f.types, 'types', (t) => (t === '超必殺ストラテジー！' ? '超必殺' : t), (t) => t))
  body.append(chipRow('レベル', LEVELS, f.levels, 'levels', (v) => String(v), (v) => `レベル ${v}`))
  const more = btn(state.filterOpen ? '▴ 詳しい絞り込みを閉じる' : '▾ 詳しく絞り込む', () => { state.filterOpen = !state.filterOpen; draw() }, 'filter__more button--small')
  more.setAttribute('aria-expanded', String(state.filterOpen))
  body.append(more)
  if (state.filterOpen) {
    body.append(rangeRow('ＢＰ', 'bpMin', 'bpMax'), rangeRow('ＳＰ', 'spMin', 'spMax'))
    body.append(chipRow('スター', STAR_CHOICES, f.stars, 'stars',
      (v) => (v === 'なし' ? 'なし' : v === '★1' ? star(1, false) : v === '★2' ? star(2, false) : star(1, true)),
      (v) => (v === 'なし' ? 'スターなし' : v === '★1' ? 'スター 1' : v === '★2' ? 'スター 2' : 'リバーススター')))
    body.append(chipRow('移動方向', MOVE_PATTERNS.map(([name]) => name), f.moves, 'moves',
      (name) => { const icon = moveIcon(MOVE_PATTERNS.find(([n]) => n === name)[1]); icon.removeAttribute('role'); icon.removeAttribute('aria-label'); icon.classList.add('chip__move'); return icon },
      (name) => `移動方向：${name}`))
    body.append(fold('キーワード能力', KEYWORDS, f.keywords, 'keywords'))
    body.append(fold('ブロック', BLOCKS, f.blocks, 'blocks'))
    const works = [...new Set(pool.map(workOf))].sort((a, b) => a.localeCompare(b, 'ja'))
    body.append(fold('作品名', works, f.works, 'works'))
    const attrs = [...new Set(pool.flatMap((c) => c.face.attributes))].sort((a, b) => a.localeCompare(b, 'ja'))
    body.append(fold('属性', attrs, f.attributes, 'attributes'))
  }
  filter.append(body)
  col.append(filter, detailPanel())
  return col
}

/** カードの詳細。見出しを押すと、中身が下へ畳まれる（開くときは下からせり上がる）。 */
function detailPanel() {
  const detail = el('section', `panel panel--detail${state.detailOpen ? '' : ' panel--detail-閉'}`)
  detail.setAttribute('aria-label', 'カードの詳細')
  const head = el('div', 'panel__head')
  const toggle = btn('', () => toggleDetail(), 'detail__toggle')
  toggle.append(el('h2', 'panel__title', 'カードの詳細'), el('span', 'detail__chevron', state.detailOpen ? '▾' : '▴'))
  toggle.setAttribute('aria-expanded', String(state.detailOpen))
  toggle.setAttribute('aria-controls', 'detail')
  head.append(toggle)
  detail.append(head)
  const d = el('div', 'detail'); d.id = 'detail'
  detail.append(d)
  queueMicrotask(() => showDetail(state.pinned))
  return detail
}
/*
 * 開閉は描き直さない。今ある要素の class を切り替えるだけなので、CSS の transition が効く。
 * 開いているかは覚えておき、後で別の理由で描き直したときは最終の状態で描く（動かない）。
 */
function toggleDetail() {
  state.detailOpen = !state.detailOpen
  const detail = document.querySelector('.panel--detail')
  detail.classList.toggle('panel--detail-閉', !state.detailOpen)
  const toggle = detail.querySelector('.detail__toggle')
  toggle.setAttribute('aria-expanded', String(state.detailOpen))
  toggle.querySelector('.detail__chevron').textContent = state.detailOpen ? '▾' : '▴'
}

function centerColumn() {
  const col = el('div', 'column column--center')
  const rows = filtered()
  const aside = el('div', 'panel__aside panel__aside--tools')
  const count = el('span'); count.append(el('strong', '', String(rows.length)), ` / ${pool.length} 種`)
  const sw = el('div', 'viewswitch'); sw.setAttribute('role', 'group'); sw.setAttribute('aria-label', '表示の形')
  for (const v of ['カード', '一覧']) { const b = btn(v === 'カード' ? '▦ カード' : '☰ 一覧', () => { state.poolView = v; state.shown = BATCH[v]; draw() }); b.setAttribute('aria-pressed', String(state.poolView === v)); sw.append(b) }
  aside.append(count, sw)
  const p = panel('', 'カード一覧', aside)

  const scroller = el('div', 'pool'); scroller.dataset.keepScroll = `pool-${state.poolView}`
  const shown = rows.slice(0, state.shown)
  if (state.poolView === 'カード') {
    const grid = el('div', 'pool__grid')
    for (const c of shown) {
      const count = countOf(c.key)
      const item = el('div', `pool__item${count > 0 ? ' pool__item--入っている' : ''}`)
      const card = cardEl(c, false); card.tabIndex = 0
      card.setAttribute('aria-label', `${c.face.name}（押すと詳細に出したままにする）`)
      hoverable(card, c.key)
      card.addEventListener('click', () => pin(c.key))
      item.append(card, counter(c, count))
      grid.append(item)
    }
    scroller.append(grid)
  } else {
    const list = el('div', 'rows')
    for (const c of shown) list.append(cardRow(c, false))
    scroller.append(list)
  }
  if (!rows.length) scroller.append(el('p', 'pool__none', '条件に合うカードがありません'))
  if (rows.length > state.shown) scroller.append(el('p', 'pool__more', `続きを表示しています…（${state.shown} / ${rows.length} 種）`))
  p.append(scroller)
  col.append(p)
  return col
}

function hoverable(node, key) {
  node.addEventListener('mouseenter', () => showDetail(key))
  node.addEventListener('mouseleave', () => showDetail(state.pinned))
  node.addEventListener('focus', () => showDetail(key))
}
function pin(key) { state.pinned = state.pinned === key ? undefined : key; draw() }

function cardRow(c, inDeck) {
  const row = el('div', `cardrow card--色-${colorOf(c)}${state.pinned === c.key ? ' cardrow--詳細中' : ''}`)
  hoverable(row, c.key)
  const name = btn(c.face.name, () => pin(c.key), 'cardrow__name')
  name.setAttribute('aria-pressed', String(state.pinned === c.key))
  row.append(levelBadge(c.face), el('span', 'card__kind', c.face.type))
  for (const s of [star(c.face.stars, false), star(c.face.reverseStars, true)]) if (s) row.append(s)
  row.append(name)
  if (!inDeck) {
    row.append(el('span', 'cardrow__meta', c.face.type === 'ユニット' ? `BP ${c.face.bp} ／ SP ${c.face.sp}` : ''))
  } else {
    const on = state.partner === c.key
    const p = btn('♥', () => { state.partner = on ? undefined : c.key; state.partnerDropped = undefined; state.saved = false; draw() }, 'partner-toggle')
    p.setAttribute('aria-pressed', String(on)); p.setAttribute('aria-label', on ? `「${c.face.name}」をパートナーから外す` : `「${c.face.name}」をパートナーにする`); p.title = p.getAttribute('aria-label')
    row.append(p)
  }
  row.append(counter(c, countOf(c.key)))
  return row
}

function removeOne(c) {
  const i = state.cards.lastIndexOf(c.key); if (i < 0) return
  state.cards.splice(i, 1); state.saved = false
  // パートナーのカードを全部抜いたら、パートナーから外れる（その旨を出す）
  if (state.partner === c.key && countOf(c.key) === 0) { state.partner = undefined; state.partnerDropped = c.face.name }
  draw()
}
function addOne(c) { state.cards.push(c.key); state.saved = false; draw() }

function counter(c, count) {
  const n = el('div', 'counter')
  const minus = btn('−', () => removeOne(c))
  minus.setAttribute('aria-label', `「${c.face.name}」を 1 枚抜く`); minus.disabled = count === 0
  const plus = btn('＋', () => addOne(c))
  plus.setAttribute('aria-label', `「${c.face.name}」を 1 枚入れる`)
  const badge = el('span', `counter__count${count > 0 ? ' counter__count--入っている' : ''}`, `×${count}`)
  badge.setAttribute('aria-label', `デッキに ${count} 枚`)
  n.append(minus, badge, plus)
  return n
}

function rightColumn() {
  const col = el('div', 'column column--right')
  const aside = el('span', 'panel__aside'); aside.append(el('strong', '', String(state.cards.length)), ' 枚')
  const deck = panel('panel--deck', 'デッキ', aside)

  // パートナー
  const partner = el('div', 'partner')
  const pc = state.partner && byKey(state.partner)
  if (pc) {
    partner.append(cardEl(pc, false))
    const b = el('div', 'partner__body')
    b.append(el('span', 'partner__label', 'パートナー'), el('span', 'partner__name', pc.face.name))
    if (pc.face.type !== 'ユニット') b.append(el('span', 'partner__warn', `${pc.face.type}なので、パートナーバトルでは使えません`))
    else b.append(el('span', 'partner__note', 'デッキ一覧で、このデッキの表紙のカードにもなります'))
    partner.append(b, btn('外す', () => { state.partner = undefined; state.saved = false; draw() }, 'button--small'))
  } else {
    partner.append(el('span', 'partner__empty', '♥'))
    const b = el('div', 'partner__body')
    b.append(el('span', 'partner__label', 'パートナー'), el('span', 'partner__note', state.partnerDropped ? `「${state.partnerDropped}」をデッキから全部抜いたので、パートナーから外れました` : '未設定。下の一覧の ♥ で選べます'))
    partner.append(b)
  }
  deck.append(partner)

  const usable = state.cards.map(byKey).filter(Boolean)
  const breakdown = el('div', 'breakdown')
  // レベルは 2 以下・3〜6・7 以上に分け、色ごとに積み上げる
  const BUCKETS = [['2-', (lv) => lv <= 2], ['3', (lv) => lv === 3], ['4', (lv) => lv === 4], ['5', (lv) => lv === 5], ['6', (lv) => lv === 6], ['7+', (lv) => lv >= 7]]
  const levels = el('figure', 'levels')
  const table = BUCKETS.map(([label, hit]) => ({ label, byColor: COLORS.map((c) => usable.filter((x) => hit(x.face.level) && colorOf(x) === c).length) }))
  const totals = table.map((b) => b.byColor.reduce((s, n) => s + n, 0))
  const max = Math.max(1, ...totals)
  levels.setAttribute('role', 'img')
  levels.setAttribute('aria-label', `レベルごとの枚数：${table.map((b, i) => `レベル${b.label} ${totals[i]} 枚（${COLORS.map((c, j) => (b.byColor[j] ? `${c} ${b.byColor[j]}` : '')).filter(Boolean).join('・') || 'なし'}）`).join('、')}`)
  levels.append(el('span', 'levels__caption', 'レベルごとの枚数'))
  const bars = el('div', 'levels__bars')
  table.forEach((b, i) => {
    const bar = el('div', 'levels__bar')
    bar.append(el('span', 'levels__total', String(totals[i])))
    const stack = el('div', 'levels__stack'); stack.style.height = `${(totals[i] / max) * 74}%`
    COLORS.forEach((c, j) => { if (!b.byColor[j]) return; const seg = el('div', `levels__seg card--色-${c}`); seg.style.flexGrow = String(b.byColor[j]); seg.title = `${c} ${b.byColor[j]} 枚`; stack.append(seg) })
    bar.append(stack); bars.append(bar)
  })
  const axis = el('div', 'levels__axis'); for (const [l] of BUCKETS) axis.append(el('span', '', l))
  levels.append(bars, axis)
  const types = el('ul', 'types'); types.setAttribute('aria-label', '種別ごとの枚数')
  for (const t of TYPES) { const n = usable.filter((c) => c.face.type === t).length; const li = el('li', n === 0 ? 'types__zero' : ''); li.append(el('span', '', t === '超必殺ストラテジー！' ? '超必殺' : t), el('span', '', String(n))); types.append(li) }
  const stars = usable.reduce((s, c) => s + c.face.stars, 0)
  const starLi = el('li', 'types__stars'); const sl = el('span'); sl.append(star(1, false) ?? '', 'スター合計'); starLi.append(sl, el('span', '', String(stars)))
  starLi.setAttribute('aria-label', `スターの合計 ${stars} 個`)
  types.append(starLi)
  breakdown.append(levels, types)
  deck.append(breakdown)

  const hasUnusable = state.cards.some((k) => !known.has(k))
  const result = checkOf()
  const check = el('div', `check check--${result.kind}`)
  for (const l of result.lines) check.append(el('p', '', l))
  deck.append(check)

  const lh = el('div', 'decklist__head'); lh.append(el('span', '', 'カード'), el('span', '', 'パートナー ・ 枚数')); deck.append(lh)
  const list = el('div', 'decklist rows'); list.dataset.keepScroll = 'deck'
  const keys = [...new Set(state.cards)]
  for (const c of pool.filter((c) => keys.includes(c.key))) list.append(cardRow(c, true))
  for (const k of keys.filter((k) => !known.has(k))) {
    const row = el('div', 'cardrow cardrow--使えない')
    row.append(el('span', 'cardrow__name', `使えないカード ×${countOf(k)}`), btn('抜く', () => { state.cards = state.cards.filter((x) => x !== k); state.saved = false; draw() }, 'button--small'))
    list.append(row)
  }
  if (!state.cards.length) list.append(el('p', 'pool__none', 'まだカードが入っていません'))
  deck.append(list)

  const bar = el('div', 'savebar')
  bar.append(el('span', `savebar__state${state.saved ? '' : ' savebar__state--未保存'}`, state.saved ? '保存しました' : '保存していない変更があります'))
  const save = btn('保存する', () => { state.saved = true; draw() }, 'button--primary')
  save.disabled = hasUnusable || state.saved
  bar.append(save)
  deck.append(bar)
  col.append(deck)
  return col
}

function showDetail(key) {
  const body = document.getElementById('detail')
  if (!body) return
  const c = key === undefined ? undefined : byKey(key)
  if (!c) { body.replaceChildren(el('p', 'detail__none', 'カードにカーソルを合わせると、ここに出ます。押すと出したままにします')); return }
  body.replaceChildren(...detailNodes(c))
}
/** カードの詳細の中身（PC の詳細の枠と、スマホの詳細のシートで共通） */
function detailNodes(c) {
  // 左にカードの面、右に文字で全部を書く。面のテキスト欄は省略されてよい（右に全文がある）。
  const info = el('div', 'detail__info')
  const title = el('div', 'detail__name')
  for (const s of [star(c.face.stars, false), star(c.face.reverseStars, true)]) if (s) title.append(s)
  title.append(el('span', '', c.face.name))
  info.append(title)
  const dl = el('dl', 'detail__rows')
  const rows = [
    ['種別', c.face.type],
    ['レベル', String(c.face.level)],
    ['色', c.face.colors.join('・')],
    ...(c.face.type === 'ユニット' ? [['ＢＰ', String(c.face.bp)], ['ＳＰ', String(c.face.sp)]] : []),
    ...(c.face.moveIcon?.length ? [['移動方向', c.face.moveIcon.join('・')]] : []),
    ...(c.face.stars ? [['スター', String(c.face.stars)]] : []),
    ...(c.face.reverseStars ? [['リバーススター', String(c.face.reverseStars)]] : []),
    ...(keywordsOf(c).length ? [['キーワード', keywordsOf(c).join('・')]] : []),
    ...(c.face.attributes.length ? [['属性', c.face.attributes.join(ATTR_SEP)]] : []),
    ['作品名', workOf(c)],
    ['ブロック', blockOf(c)],
    ['収録', codesOf(c).join('・')],
  ]
  for (const [k, v] of rows) dl.append(el('dt', '', k), el('dd', '', v))
  info.append(dl)
  if (c.face.text.length) { const t = el('div', 'detail__text'); for (const p of c.face.text) t.append(el('p', '', p)); info.append(t) }
  return [cardEl(c, true), info]
}

/* ================= 重ねる窓 ================= */
function modal() {
  const layer = el('div', 'modal')
  const box = el('section', 'panel modal__box'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true')
  const close = () => { state.modal = undefined; draw() }
  if (state.modal === '解説') {
    box.setAttribute('aria-label', 'デッキの解説')
    const h = el('div', 'panel__head'); h.append(el('h2', 'panel__title', `「${state.name}」の解説`)); box.append(h)
    const b = el('div', 'modal__body')
    const t = el('textarea'); t.rows = 8; t.maxLength = 1000; t.placeholder = '解説（無くてもかまいません）'; t.value = state.description; t.dataset.autofocus = ''
    t.addEventListener('input', () => { state.description = t.value; state.saved = false })
    b.append(t, el('span', 'modal__hint', '保存するまで、デッキには残りません（1000 文字まで）'))
    box.append(b)
    const bs = el('div', 'modal__buttons'); bs.append(btn('閉じる', close, 'button--primary')); box.append(bs)
  } else if (state.modal === 'ラベル') {
    // 組む画面から開いたときは組みかけを直接変え（保存するまで残らない）、デッキ一覧から開いたときはその場で保存する
    const fromList = state.view === 'list'
    const edit = fromList ? state.tagEdit : { name: state.name, cards: state.cards, userType: state.userType, userUses: state.userUses }
    const set = (next) => {
      if (fromList) { state.tagEdit = { ...state.tagEdit, ...next } } else { Object.assign(state, next); state.saved = false }
      draw()
    }
    box.setAttribute('aria-label', 'デッキのラベル')
    const h = el('div', 'panel__head'); h.append(el('h2', 'panel__title', `「${edit.name}」のラベル`)); box.append(h)
    const b = el('div', 'modal__body')
    const section = (title, note, chips) => {
      const s = el('section', 'tagsec'); s.append(el('h3', 'tagsec__title', title))
      if (note) s.append(el('p', 'tagsec__note', note))
      s.append(chips); return s
    }
    const autoBox = el('div', 'filter__chips'); for (const t of autoTagsOf(edit.cards, edit.userType)) autoBox.append(tagChip(t))
    b.append(section('自動で付くラベル', 'デッキの中身から付きます。外すことはできません', autoBox))
    const typeBox = el('div', 'filter__chips'); typeBox.setAttribute('role', 'radiogroup'); typeBox.setAttribute('aria-label', 'アーキタイプ（1 つまで）')
    for (const t of [undefined, ...TAG_TYPES]) {
      const content = t ? [tagIcon({ label: t, group: 'アーキタイプ' }), t].filter(Boolean) : '指定しない'
      const c = chip(content, edit.userType === t, () => set({ userType: t }), t ? '' : 'chip--すべて')
      c.setAttribute('role', 'radio'); c.setAttribute('aria-checked', String(edit.userType === t)); c.removeAttribute('aria-pressed')
      typeBox.append(c)
    }
    b.append(section('アーキタイプ（1 つまで）', '選ぶと、自動で付くアーキタイプの代わりにこちらが付きます', typeBox))
    const useBox = el('div', 'filter__chips')
    for (const u of TAG_USES) useBox.append(chip([tagIcon({ label: u, group: 'その他' }), u].filter(Boolean), edit.userUses.includes(u), () => set({ userUses: toggled(edit.userUses, u) })))
    b.append(section('その他（いくつでも）', undefined, useBox))
    if (!fromList) b.append(el('span', 'modal__hint', '保存するまで、デッキには残りません'))
    box.append(b)
    const bs = el('div', 'modal__buttons')
    if (fromList) {
      const cancel = btn('やめる', () => { state.tagEdit = undefined; close() }); cancel.dataset.autofocus = ''
      const save = btn('保存する', () => { const d = state.listDecks[state.tagEdit.index]; if (d) Object.assign(d, { userType: state.tagEdit.userType, userUses: state.tagEdit.userUses }); else Object.assign(state, { userType: state.tagEdit.userType, userUses: state.tagEdit.userUses }); state.tagEdit = undefined; close() }, 'button--primary')
      bs.append(cancel, save)
    } else { const done = btn('閉じる', close, 'button--primary'); done.dataset.autofocus = ''; bs.append(done) }
    box.append(bs)
  } else if (state.modal === '削除') {
    box.setAttribute('aria-label', '確認')
    const h = el('div', 'panel__head'); h.append(el('h2', 'panel__title', 'デッキを削除する')); box.append(h)
    const b = el('div', 'modal__body'); b.append(el('p', '', '「青コントロール（試作）」を削除しますか？ 削除したデッキは戻せません')); box.append(b)
    const bs = el('div', 'modal__buttons'); const cancel = btn('やめる', close); cancel.dataset.autofocus = ''; bs.append(cancel, btn('削除する', close, 'button--danger')); box.append(bs)
  }
  layer.append(box)
  layer.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })
  return layer
}

/* ================= デッキ一覧 ================= */
/** ラベル 1 つ。自動で付いたか持ち主が選んだかは、見た目にも読み上げにも出さない。 */
function tagChip(t) {
  const n = el('span', 'tag')
  const icon = tagIcon(t); if (icon) n.append(icon)
  n.append(t.label)
  n.setAttribute('aria-label', `${t.group}：${t.label}`)
  return n
}
function tagList(tags, cls = '') {
  const box = el('div', `taglist ${cls}`); box.setAttribute('aria-label', 'ラベル')
  for (const t of tags) box.append(tagChip(t))
  return box
}
// 1 つ目は組む画面の組みかけ、2 つ目からはデッキ一覧だけにあるデッキ（ラベルを一覧から直せるよう、状態に持つ）
state.listDecks = [
  undefined,
  { name: '見本デッキ B（コピー）', description: '', cards: pool.filter((c) => c.expansions.includes('見本デッキ B')).flatMap((c) => [c.key, c.key, c.key]), userType: 'コンボ', userUses: ['大会用'] },
  { name: '青コントロール（試作）', description: '見本・エルミナで手札を整えて、後半に大型を出す。まだ枚数が足りない。', cards: pool.filter((c) => c.face.colors.includes('青')).flatMap((c) => [c.key, c.key]), userType: undefined, userUses: ['お試し'] },
]
const decks = () => [
  { name: state.name, description: state.description, cards: state.cards, partner: state.partner ?? pool.find((c) => c.face.name === '見本・霧島透')?.key, userType: state.userType, userUses: state.userUses },
  ...state.listDecks.slice(1),
].map((d, index) => ({ ...d, index, tags: tagsOf(d.cards, d.userType, d.userUses) }))
function faceCardOf(d) {
  if (d.partner && d.cards.includes(d.partner)) return byKey(d.partner)
  const counted = [...new Set(d.cards)].map(byKey).filter(Boolean).sort((a, b) => countOf(b.key, d.cards) - countOf(a.key, d.cards) || b.face.level - a.face.level)
  return counted[0]
}
function colorCounts(cards) { const m = {}; for (const c of cards.map(byKey).filter(Boolean)) m[colorOf(c)] = (m[colorOf(c)] ?? 0) + 1; return m }

function deckList() {
  const root = el('div', 'deckbuild deckbuild--list')
  const bar = el('header', 'panel topbar')
  bar.append(btn('← ロビーに戻る', () => go('lobby')), el('h1', 'topbar__title', 'デッキ一覧'), el('span', 'topbar__sub', '自分のデッキを組む・共有する'), el('span', 'topbar__spacer'), btn('自分の共有', () => {}), btn('共有されたレシピ', () => {}), btn('＋ 新しく作る', () => go('deck-builder'), 'button--primary'))
  root.append(bar)

  const all = decks()
  const shown = all.filter((d) =>
    (!state.deckSearch || d.name.includes(state.deckSearch)) &&
    (!state.deckColors.length || Object.keys(colorCounts(d.cards)).some((c) => state.deckColors.includes(c))) &&
    (!state.deckTags.length || d.tags.some((t) => state.deckTags.includes(t.label))))

  const columns = el('div', 'columns')
  // 左：探す
  const left = el('div', 'column column--left')
  left.append(phoneFilterToggle(!!state.deckSearch || state.deckColors.length > 0 || state.deckTags.length > 0))
  const find = panel(`panel--find${state.phoneFilter ? ' panel--phone-開いている' : ''}`, 'デッキを探す')
  const fb = el('div', 'panel__body')
  const s = el('input'); s.type = 'search'; s.placeholder = 'デッキの名前で探す'; s.setAttribute('aria-label', 'デッキの名前で探す'); s.value = state.deckSearch
  s.addEventListener('change', () => { state.deckSearch = s.value; draw() })
  fb.append(s)
  const colorRow = el('div', 'filter__row'); colorRow.append(el('span', 'filter__label', '入っている色'))
  const cc = el('div', 'filter__chips'); cc.append(chip('すべて', !state.deckColors.length, () => { state.deckColors = []; draw() }, 'chip--すべて'))
  for (const c of COLORS) cc.append(chip([colorIcon(c), c], state.deckColors.includes(c), () => { state.deckColors = toggled(state.deckColors, c); draw() }))
  colorRow.append(cc); fb.append(colorRow)
  // ラベル：自動のラベルと選んだラベルの両方。複数選ぶと「どれかを持つデッキ」
  const allTags = []
  for (const t of all.flatMap((d) => d.tags)) if (!allTags.some((x) => x.label === t.label)) allTags.push(t)
  const GROUP_ORDER = ['アーキタイプ', '色の構成', '作品名', 'ブロック', 'その他']
  allTags.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
  const tagRow = el('div', 'filter__row'); tagRow.append(el('span', 'filter__label', 'ラベル'))
  const tc = el('div', 'filter__chips'); tc.append(chip('すべて', !state.deckTags.length, () => { state.deckTags = []; draw() }, 'chip--すべて'))
  for (const t of allTags) { const c = chip([tagIcon(t), t.label].filter(Boolean), state.deckTags.includes(t.label), () => { state.deckTags = toggled(state.deckTags, t.label); draw() }); c.setAttribute('aria-label', `${t.group}：${t.label}`); tc.append(c) }
  tagRow.append(tc); fb.append(tagRow)
  find.append(fb); left.append(find)

  // 真ん中：自分のデッキ
  const center = el('div', 'column column--center')
  const aside = el('span', 'panel__aside'); aside.append(el('strong', '', String(shown.length)), ` / ${all.length} 件`)
  const mine = panel('', '自分のデッキ', aside)
  const scroller = el('div', 'decks')
  const grid = el('div', 'decks__grid')
  for (const d of shown) {
    const card = el('article', 'deckcard')
    const faceCard = faceCardOf(d)
    const faceWrap = el('div', 'deckcard__face')
    if (faceCard) faceWrap.append(cardEl(faceCard, false))
    card.append(faceWrap)
    const main = el('div', 'deckcard__main')
    const head = el('div', 'deckcard__head'); head.append(el('h3', 'deckcard__name', d.name))
    main.append(head)
    main.append(el('p', 'deckcard__desc', d.description || '（解説はありません）'))
    const count = el('span', 'deckcard__count', `${d.cards.length}`); count.append(el('small', '', ' 枚')); main.append(count)
    const colors = el('div', 'colors'); colors.setAttribute('aria-label', '色ごとの枚数')
    for (const [c, n] of Object.entries(colorCounts(d.cards)).sort((a, b) => COLORS.indexOf(a[0]) - COLORS.indexOf(b[0]))) { const sp = el('span'); const i = el('img'); i.src = LEVEL_ICON[c]; i.alt = c; sp.append(i, String(n)); colors.append(sp) }
    main.append(colors, tagList(d.tags))
    card.append(main)
    const actions = el('div', 'deckcard__actions')
    const tagBtn = btn('🏷 ラベル', () => { state.tagEdit = { index: d.index, name: d.name, cards: d.cards, userType: d.userType, userUses: d.userUses }; state.modal = 'ラベル'; draw() })
    tagBtn.setAttribute('aria-label', `「${d.name}」のラベルを変える`); tagBtn.setAttribute('aria-haspopup', 'dialog')
    actions.append(btn('✏️ 編集', () => go('deck-builder')), btn('⧉ 複製', () => {}), btn('🔗 共有', () => {}), tagBtn, iconBtn('🗑️', `「${d.name}」を削除する`, () => { state.modal = '削除'; draw() }))
    card.append(actions)
    grid.append(card)
  }
  scroller.append(grid)
  if (!shown.length) scroller.append(el('p', 'pool__none', '条件に合うデッキがありません'))
  mine.append(scroller)
  center.append(mine)

  // 左の下：既製デッキ（統計は置かない。2 列にする）
  const presets = panel('panel--presets', '既製デッキからコピーして作る')
  const pb = el('div', 'presets')
  for (const name of ['見本デッキ A', '見本デッキ B']) {
    const row = el('div', 'preset')
    const cards = pool.filter((c) => c.expansions.includes(name))
    const top = cards.sort((a, b) => b.face.level - a.face.level)[0]
    if (top) row.append(cardEl(top, false))
    row.append(el('span', 'preset__name', name), btn('コピーして組む', () => go('deck-builder'), 'button--small'))
    pb.append(row)
  }
  presets.append(pb)

  // PC は左の列の下。スマホは自分のデッキの下（見た目の順と Tab・読み上げの順を DOM の順でそろえる。CSS の order は使わない）
  if (phoneWidth()) { columns.append(left, center, presets) } else { left.append(presets); columns.append(left, center) }
  root.append(columns)
  if (state.modal) root.append(modal())
  return root
}

// 画面の移動は、移った先の画面のモックを開く（移る前の選択は引き継がない）
function go(screen) { location.href = `../${screen}/index.html` }

// 撮影用の指定
const params = new URLSearchParams(location.search)
if (params.get('pin') === 'auto') state.pinned = (pool.find((c) => c.face.keywords.length && c.face.stars > 0) ?? pool.find((c) => c.face.keywords.length))?.key
if (params.get('open') === '1') state.filterOpen = true
if (params.get('view') === 'list') state.view = 'list'
if (params.get('rows') === '1') { state.poolView = '一覧'; state.shown = BATCH.一覧 }
if (params.get('partner') === 'unit') state.partner = pool.find((c) => c.face.name === '見本・霧島透')?.key
if (params.get('partner') === 'trap') { const t = pool.find((c) => c.face.type === 'トラップ' && startCards.includes(c.key)) ?? pool.find((c) => c.face.type !== 'ユニット' && startCards.includes(c.key)); state.partner = t?.key }
if (params.get('ok') === '1') { state.cards = state.cards.filter((k) => known.has(k)); while (state.cards.length < 60) state.cards.push(pool[state.cards.length % pool.length].key) }
// 使えなくなったカードを外す。枚数が足りないままなので、「規定外」の印が出る（満たしている場面は ok=1）
if (params.get('ng') === '1') state.cards = state.cards.filter((k) => known.has(k))
if (params.get('modal')) state.modal = params.get('modal')
if (params.get('detail') === '0') state.detailOpen = false
if (params.get('tagedit') === '1') { const d = state.listDecks[1]; state.view = 'list'; state.tagEdit = { index: 1, name: d.name, cards: d.cards, userType: d.userType, userUses: d.userUses }; state.modal = 'ラベル' }
if (params.get('pick') === '1') Object.assign(state.filter, { expansions: ['見本デッキ B'], blocks: ['例文社', '見本書房'], works: ['見本作品Ｐ', '見本作品Ｎ', '見本作品Ｅ', '見本作品Ｏ'], keywords: ['夢'] })
if (params.get('folds')) for (const k of params.get('folds').split(',')) state.folds[k] = true
draw()
if (params.get('fscroll')) { const b = document.querySelector('.panel--filter .panel__body'); if (b) b.scrollTop = params.get('fscroll') === 'end' ? b.scrollHeight : Number(params.get('fscroll')) }
