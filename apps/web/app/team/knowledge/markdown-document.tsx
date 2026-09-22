/**
 * A team's page, rendered.
 *
 * Small on purpose: headings, lists, quotes, code and paragraphs. A team
 * playbook is prose and checklists, and every feature beyond that is a
 * parser to keep safe — this renders to React elements rather than HTML, so
 * there is no string of markup to sanitise and nothing a page's author can
 * write that becomes an element they did not type.
 *
 * Lifted out of `knowledge-client.tsx` when that file reached the repo's
 * 1000-line ceiling. It was already self-contained.
 */

import type { ReactNode } from "react";

export function MarkdownDocument({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  const isBlockStart = (line: string) =>
    /^#{1,3}\s+/.test(line) ||
    /^```/.test(line) ||
    /^[-*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    /^>\s?/.test(line);

  for (let index = 0; index < lines.length; ) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.startsWith("```")) {
        code.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`code-${index}`} data-language={language || undefined}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const text = heading[2]!;
      /*
        A page's markdown starts at h2, not h1.

        `# Team 6925 2026 season playbook` at the top of a page was rendering
        an h1 inside a hub that already has one, so the document outline said
        the screen was two pages. Somebody navigating by heading level would
        land in the middle of the playbook believing they had arrived
        somewhere new.

        The levels shift down together — # is h2, ## is h3, ### is h4 — so a
        page's own structure is preserved and simply nests under the page it
        is on, which is what it always was. The classes keep the sizes the
        levels had, so nothing looks different.
      */
      blocks.push(
        level === 1 ? (
          <h2 className="kb-doc-1" key={`h-${index}`}>
            {text}
          </h2>
        ) : level === 2 ? (
          <h3 className="kb-doc-2" key={`h-${index}`}>
            {text}
          </h3>
        ) : (
          <h4 className="kb-doc-3" key={`h-${index}`}>
            {text}
          </h4>
        ),
      );
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index]!)) {
        items.push(lines[index]!.replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(<ul key={`ul-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index]!)) {
        items.push(lines[index]!.replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(<ol key={`ol-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ol>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      blocks.push(<blockquote key={`quote-${index}`}>{line.replace(/^>\s?/, "")}</blockquote>);
      index += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index]!.trim() && !isBlockStart(lines[index]!)) {
      paragraph.push(lines[index]!.trim());
      index += 1;
    }
    blocks.push(<p key={`p-${index}`}>{paragraph.join(" ")}</p>);
  }

  return (
    <article className="kb-document" aria-label="Page content">
      {blocks.length ? blocks : <p className="kb-meta">This page is empty.</p>}
    </article>
  );
}
