import type { ReactNode } from 'react';
function inline(value: string): ReactNode[] {
  const parts = value.split(
    /(`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|\/)[^\s)]+\))/g,
  );
  return parts.map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`'))
      return <code key={i}>{p.slice(1, -1)}</code>;
    const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (m)
      return (
        <a key={i} href={m[2]} rel="noreferrer noopener">
          {m[1]}
        </a>
      );
    return p;
  });
}
export function Prose({
  text,
  skipTitle = false,
  headingOffset = false,
  idPrefix = '',
}: {
  text: string;
  skipTitle?: boolean;
  headingOffset?: boolean;
  idPrefix?: string;
}) {
  const Title = headingOffset ? 'h2' : 'h1';
  const Heading = headingOffset ? 'h3' : 'h2';
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let code: string[] | null = null;
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      blocks.push(<p key={blocks.length}>{inline(paragraph.join(' '))}</p>);
      paragraph = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(?:```|~~~)/.test(line)) {
      flush();
      if (code) {
        blocks.push(
          <pre key={blocks.length}>
            <code>{code.join('\n')}</code>
          </pre>,
        );
        code = null;
      } else code = [];
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith('# ')) {
      flush();
      if (!skipTitle)
        blocks.push(<Title key={blocks.length}>{inline(line.slice(2))}</Title>);
      continue;
    }
    if (line.startsWith('## ')) {
      flush();
      const label = line.slice(3);
      blocks.push(
        <Heading
          key={blocks.length}
          id={idPrefix + label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
        >
          {inline(label)}
        </Heading>,
      );
      continue;
    }
    if (/^\d+\. |^- /.test(line)) {
      flush();
      const numbered = /^\d/.test(line);
      const start = numbered ? Number(line.match(/^\d+/)![0]) : undefined;
      const items: string[] = [];
      while (i < lines.length && (numbered ? /^\d+\. / : /^- /).test(lines[i]))
        items.push(lines[i++].replace(/^(?:\d+\.|-) /, ''));
      i--;
      blocks.push(
        numbered ? (
          <ol key={blocks.length} start={start}>
            {items.map((s, j) => (
              <li key={j}>{inline(s)}</li>
            ))}
          </ol>
        ) : (
          <ul key={blocks.length}>
            {items.map((s, j) => (
              <li key={j}>{inline(s)}</li>
            ))}
          </ul>
        ),
      );
      continue;
    }
    paragraph.push(line);
  }
  flush();
  if (code) blocks.push(<pre key={blocks.length}>{code.join('\n')}</pre>);
  return <div className="prose">{blocks}</div>;
}
