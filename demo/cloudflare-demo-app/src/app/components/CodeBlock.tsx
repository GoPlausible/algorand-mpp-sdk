const KEYWORDS = /\b(import|from|const|let|await|async|new|return|export|type|function)\b/g
const STRINGS = /('[^']*'|"[^"]*"|`[^`]*`)/g
const COMMENTS = /(\/\/.*$)/gm
const METHODS = /\.(\w+)\(/g

export default function CodeBlock({ code }: { code: string }) {
  const html = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(COMMENTS, '<span style="color:#666">$1</span>')
    .replace(STRINGS, '<span style="color:#00D4AA">$1</span>')
    .replace(KEYWORDS, '<span style="color:#6F42C1">$1</span>')
    .replace(METHODS, '.<span style="color:#FFD700">$1</span>(')

  return (
    <pre
      style={{
        margin: 0,
        padding: 16,
        fontSize: 13,
        lineHeight: 1.6,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
