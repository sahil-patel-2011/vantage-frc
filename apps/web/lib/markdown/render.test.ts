import { describe, expect, it } from "vitest";
import { escapeHtml, markdownToPlainText, renderMarkdown, safeHref } from "./render";

describe("renderMarkdown — safety", () => {
  it("escapes raw HTML instead of passing it through", () => {
    const html = renderMarkdown('<script>alert("x")</script> & <img onerror=1>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("drops javascript: and data: links but keeps the label", () => {
    expect(renderMarkdown("[x](javascript:alert(1))")).toBe("<p>x</p>");
    expect(renderMarkdown("[x](data:text/html;base64,AAAA)")).toBe("<p>x</p>");
  });

  it("renders http(s), mailto, relative, and bare-domain links with rel=noopener", () => {
    const html = renderMarkdown("[docs](https://example.com/a?b=1&c=2) [me](mailto:a@b.co) [home](/dashboard) [cd](chiefdelphi.com/t/1)");
    expect(html).toContain('<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">docs</a>');
    expect(html).toContain('<a href="mailto:a@b.co" target="_blank" rel="noopener noreferrer">me</a>');
    expect(html).toContain('<a href="/dashboard" target="_blank" rel="noopener noreferrer">home</a>');
    expect(html).toContain('href="https://chiefdelphi.com/t/1"');
  });

  it("keeps one level of balanced parentheses inside an href", () => {
    expect(renderMarkdown("[wiki](https://en.wikipedia.org/wiki/FRC_(robotics))")).toContain(
      'href="https://en.wikipedia.org/wiki/FRC_(robotics)"',
    );
  });

  it("escapes attribute-breaking characters inside hrefs", () => {
    expect(safeHref('https://x.com/" onclick="1')).toBeNull();
    expect(escapeHtml(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;");
  });
});

describe("renderMarkdown — blocks", () => {
  it("renders headings, paragraphs, and line breaks", () => {
    const html = renderMarkdown("# Title\n\nline one\nline two\n\n## Sub ##");
    expect(html).toBe("<h1>Title</h1>\n<p>line one<br>line two</p>\n<h2>Sub</h2>");
  });

  it("renders bullet and numbered lists with one level of nesting and task boxes", () => {
    const html = renderMarkdown("- a\n- b\n  - b1\n1. one\n2. [x] done\n3. [ ] open");
    expect(html).toBe(
      "<ul><li>a</li><li>b<ul><li>b1</li></ul></li></ul>" +
        '<ol><li>one</li><li><input type="checkbox" disabled checked> done</li><li><input type="checkbox" disabled> open</li></ol>',
    );
  });

  it("keeps fenced code literal", () => {
    const html = renderMarkdown("```ts\nconst a = **not bold** <b>;\n```");
    expect(html).toBe('<pre><code class="language-ts">const a = **not bold** &lt;b&gt;;</code></pre>');
  });

  it("renders tables, blockquotes, and rules", () => {
    const html = renderMarkdown("| a | b |\n|---|:--:|\n| 1 | **2** |\n\n> quoted *text*\n\n---");
    expect(html).toContain("<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td><strong>2</strong></td></tr></tbody></table>");
    expect(html).toContain("<blockquote><p>quoted <em>text</em></p></blockquote>");
    expect(html).toContain("<hr>");
  });

  it("renders inline emphasis, code, and strikethrough without touching snake_case words", () => {
    const html = renderMarkdown("**bold** *it* `co**de**` ~~gone~~ file_name_here");
    expect(html).toBe("<p><strong>bold</strong> <em>it</em> <code>co**de**</code> <del>gone</del> file_name_here</p>");
  });

  it("normalises CRLF input", () => {
    expect(renderMarkdown("a\r\n\r\nb")).toBe("<p>a</p>\n<p>b</p>");
  });
});

describe("markdownToPlainText", () => {
  it("strips syntax and truncates with an ellipsis", () => {
    expect(markdownToPlainText("# Hi\n\n- **one** [two](/x)\n`code`")).toBe("Hi one two code");
    expect(markdownToPlainText("word ".repeat(60), 20)).toMatch(/…$/);
  });
});
