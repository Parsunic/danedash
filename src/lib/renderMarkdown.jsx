function inlineMarkdown(text) {
  const parts = text.split(/(\*\*[^*\n]+?\*\*|\*[^*\n]+?\*|`[^`\n]+?`)/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="md-code">{part.slice(1, -1)}</code>
    return part
  })
}

function parseTable(tableLines) {
  const rows = tableLines
    .filter(line => !line.replace(/[|\s]/g, '').match(/^[-:]+$/))
    .map(line =>
      line.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1)
    )
    .filter(row => row.length > 0)
  if (rows.length === 0) return null
  const [header, ...body] = rows
  return { header, body }
}

export function renderMarkdown(text) {
  if (!text) return null
  const lines = text.split('\n')
  const elements = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Heading
    const hMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (hMatch) {
      const lvl = hMatch[1].length
      const Tag = lvl === 1 ? 'h4' : lvl === 2 ? 'h5' : 'h6'
      elements.push(<Tag key={i} className="md-heading">{inlineMarkdown(hMatch[2])}</Tag>)
      i++; continue
    }

    // Table
    if (line.trim().startsWith('|')) {
      const tableLines = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]); i++
      }
      const table = parseTable(tableLines)
      if (table) {
        elements.push(
          <table key={`t${i}`} className="md-table">
            <thead><tr>{table.header.map((h, j) => <th key={j}>{inlineMarkdown(h)}</th>)}</tr></thead>
            <tbody>
              {table.body.map((row, j) => (
                <tr key={j}>{row.map((c, k) => <td key={k}>{inlineMarkdown(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        )
      }
      continue
    }

    // Bullet list — collect consecutive bullets
    if (/^[-*]\s+/.test(line)) {
      const bullets = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        const m = lines[i].match(/^[-*]\s+(.+)$/)
        if (m) bullets.push(m[1])
        i++
      }
      elements.push(
        <ul key={`ul${i}`} className="md-list">
          {bullets.map((b, j) => <li key={j}>{inlineMarkdown(b)}</li>)}
        </ul>
      )
      continue
    }

    // Empty line
    if (line.trim() === '') {
      if (elements.length > 0) elements.push(<br key={`br${i}`} />)
      i++; continue
    }

    // Paragraph
    elements.push(<p key={i} className="md-p">{inlineMarkdown(line)}</p>)
    i++
  }

  return <>{elements}</>
}
