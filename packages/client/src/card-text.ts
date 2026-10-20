export function cardTextParagraphs(lines: readonly string[], className = ''): HTMLParagraphElement[] {
  return lines.map((line) => {
    const paragraph = document.createElement('p')
    paragraph.className = className
    if (line.trim() === '') return paragraph

    // 記号を本文に混ぜると読み上げられるので、表示だけの要素に分ける。
    const bullet = document.createElement('span')
    bullet.textContent = '●'
    bullet.setAttribute('aria-hidden', 'true')
    paragraph.append(bullet, document.createTextNode(line))
    return paragraph
  })
}
