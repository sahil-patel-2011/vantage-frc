// Small, safe Markdown renderer for team-authored pages (knowledge wiki bodies).
// No dependency, no raw HTML pass-through: every character of author text is
// escaped, and links are limited to http(s)/mailto/relative targets. Supports
// the subset teams actually write: headings, paragraphs, bullet and numbered
// lists (one level of nesting), bold/italic/strikethrough/inline code, links,
// fenced code blocks, blockquotes, tables, horizontal rules, and task boxes.

export type MarkdownOptions = {
  /** Open links in a new tab (default true; always adds rel=noopener). */
  externalLinks?: boolean;
};

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** Only these URL shapes become anchors; anything else renders as plain text. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href || /[\s<>"']/.test(href)) return null;
  if (/^(https?:\/\/|mailto:)/i.test(href)) return href;
  if (/^(\/|#|\.\/|\.\.\/)/.test(href)) return href;
  // Bare domains are common in student notes ("see chiefdelphi.com/...").
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i.test(href)) return `https://${href}`;
  return null;
}

function renderInline(text: string, options: MarkdownOptions): string {
  // Extract inline code first so its contents are never formatted.
  const codes: string[] = [];
  let work = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `${codes.length - 1}`;
  });

  work = escapeHtml(work);

  // Links: [label](href) — label is already escaped; href is validated.
  // The href may contain one level of balanced parentheses (Wikipedia-style URLs, "alert(1)").
  work = work.replace(/\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_match, label: string, url: string) => {
    const href = safeHref(url.replace(/&amp;/g, "&"));
    if (!href) return label;
    const target = options.externalLinks === false ? "" : ' target="_blank"';
    return `<a href="${escapeHtml(href)}"${target} rel="noopener noreferrer">${label}</a>`;
  });

  work = work
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

  return work.replace(/(\d+)/g, (_match, index: string) => codes[Number(index)] ?? "");
}

type ListItem = { depth: number; ordered: boolean; text: string };

function renderList(items: ListItem[], options: MarkdownOptions): string {
  let html = "";
  const stack: Array<"ul" | "ol"> = [];
  let previousDepth = -1;
  const closeTo = (depth: number) => {
    while (stack.length > depth + 1) html += `</li></${stack.pop()}>`;
  };
  for (const item of items) {
    const tag = item.ordered ? "ol" : "ul";
    // The first item anchors depth 0 even when it was indented.
    const depth = previousDepth === -1 ? 0 : item.depth;
    if (depth > previousDepth) {
      // Nested lists open inside the current <li>, one per depth step.
      for (let d = previousDepth + 1; d <= depth; d += 1) {
        html += `<${tag}>`;
        stack.push(tag);
      }
    } else {
      if (depth < previousDepth) closeTo(depth);
      if (stack[stack.length - 1] !== tag) {
        // "- a" followed by "1. b" at the same depth starts a new list.
        html += `</li></${stack.pop()}><${tag}>`;
        stack.push(tag);
      } else {
        html += "</li>";
      }
    }
    const task = item.text.match(/^\[( |x|X)\]\s+(.*)$/);
    const body = task
      ? `<input type="checkbox" disabled${task[1] === " " ? "" : " checked"}> ${renderInline(task[2] ?? "", options)}`
      : renderInline(item.text, options);
    html += `<li>${body}`;
    previousDepth = depth;
  }
  while (stack.length) html += `</li></${stack.pop()}>`;
  return html;
}

function renderTable(lines: string[], options: MarkdownOptions): string {
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  const header = cells(lines[0] ?? "");
  const rows = lines.slice(2).map(cells);
  let html = "<table><thead><tr>";
  for (const cell of header) html += `<th>${renderInline(cell, options)}</th>`;
  html += "</tr></thead>";
  if (rows.length) {
    html += "<tbody>";
    for (const row of rows) {
      html += "<tr>";
      for (let i = 0; i < header.length; i += 1) html += `<td>${renderInline(row[i] ?? "", options)}</td>`;
      html += "</tr>";
    }
    html += "</tbody>";
  }
  return `${html}</table>`;
}

const LIST_LINE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Markdown -> HTML string safe to inject with dangerouslySetInnerHTML. */
export function renderMarkdown(source: string, options: MarkdownOptions = {}): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: ListItem[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${paragraph.map((line) => renderInline(line, options)).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    out.push(renderList(list, options));
    list = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    // Fenced code: everything until the closing fence is literal.
    const fence = line.match(/^\s*```\s*([\w-]*)\s*$/);
    if (fence) {
      flushAll();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i] ?? "")) {
        code.push(lines[i] ?? "");
        i += 1;
      }
      const lang = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
      out.push(`<pre><code${lang}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushAll();
      const level = heading[1]!.length;
      out.push(`<h${level}>${renderInline(heading[2] ?? "", options)}</h${level}>`);
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      out.push("<hr>");
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushAll();
      const quoted: string[] = [quote[1] ?? ""];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1] ?? "")) {
        i += 1;
        quoted.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
      }
      out.push(`<blockquote>${renderMarkdown(quoted.join("\n"), options)}</blockquote>`);
      continue;
    }

    if (/^\s*\|/.test(line) && TABLE_DIVIDER.test(lines[i + 1] ?? "")) {
      flushAll();
      const block: string[] = [line, lines[i + 1] ?? ""];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i] ?? "")) {
        block.push(lines[i] ?? "");
        i += 1;
      }
      i -= 1;
      out.push(renderTable(block, options));
      continue;
    }

    const listMatch = line.match(LIST_LINE);
    if (listMatch) {
      flushParagraph();
      const indent = listMatch[1]!.replace(/\t/g, "  ").length;
      list.push({
        depth: Math.min(1, Math.floor(indent / 2)),
        ordered: /\d/.test(listMatch[2]!),
        text: listMatch[3] ?? "",
      });
      continue;
    }

    // A non-list line directly under a list item continues that item.
    if (list.length && /^\s{2,}\S/.test(line)) {
      list[list.length - 1]!.text += ` ${line.trim()}`;
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }
  flushAll();
  return out.join("\n");
}

/** Plain-text preview (first ~N chars) for lists and search snippets. */
export function markdownToPlainText(source: string, max = 200): string {
  const text = source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[*_~]{1,2}([^*_~]+)[*_~]{1,2}/g, "$1")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
