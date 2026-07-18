export type TextPdfInput = {
  title: string;
  subtitle?: string;
  lines: string[];
  footer?: string;
};

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapLines(source: string[], maxChars: number): string[] {
  const wrapped: string[] = [];
  for (const line of source) {
    const text = line.trimEnd();
    if (text.length <= maxChars) {
      wrapped.push(text);
      continue;
    }
    let rest = text;
    while (rest.length > maxChars) {
      let split = rest.lastIndexOf(" ", maxChars);
      if (split < maxChars * 0.5) split = maxChars;
      wrapped.push(rest.slice(0, split).trimEnd());
      rest = rest.slice(split).trimStart();
    }
    if (rest) wrapped.push(rest);
  }
  return wrapped;
}

export function buildTextPdf(input: TextPdfInput): Uint8Array {
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 54;
  const bodySize = 10;
  const lineHeight = 14;
  const titleBlock = 56;
  const footerBlock = input.footer ? 28 : 12;
  const usableHeight = pageHeight - margin * 2 - titleBlock - footerBlock;
  const linesPerPage = Math.max(8, Math.floor(usableHeight / lineHeight));
  const bodyLines = wrapLines(input.lines, 96);
  const pages: string[][] = [];
  for (let index = 0; index < bodyLines.length || pages.length === 0; index += linesPerPage) {
    pages.push(bodyLines.slice(index, index + linesPerPage));
  }

  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  const contentIds: number[] = [];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const yStart = pageHeight - margin - 28;
    const commands: string[] = ["BT", `/F1 ${bodySize} Tf`, `${lineHeight} TL`, `1 0 0 1 ${margin} ${yStart} Tm`];
    if (pageIndex === 0) {
      commands.splice(1, 0, `/F1 18 Tf`, `1 0 0 1 ${margin} ${pageHeight - margin} Tm`, `(${escapePdfText(input.title)}) Tj`);
      if (input.subtitle) {
        commands.push(`/F1 11 Tf`, `1 0 0 1 ${margin} ${pageHeight - margin - 22} Tm`, `(${escapePdfText(input.subtitle)}) Tj`);
      }
      commands.push(`/F1 ${bodySize} Tf`, `${lineHeight} TL`, `1 0 0 1 ${margin} ${yStart} Tm`);
    }
    for (const line of pages[pageIndex]!) {
      commands.push(`(${escapePdfText(line || " ")}) Tj`, "T*");
    }
    if (input.footer) {
      const footerY = margin - 6;
      commands.push("ET", "BT", `/F1 9 Tf`, `1 0 0 1 ${margin} ${footerY} Tm`, `(${escapePdfText(`${input.footer} · page ${pageIndex + 1}/${pages.length}`)}) Tj`, "ET");
    } else {
      commands.push("ET");
    }
    const stream = commands.join("\n");
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
    contentIds.push(contentId);
    const pageId = addObject(
      `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  const pagesId = addObject(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  for (const pageId of pageIds) {
    objects[pageId - 1] = objects[pageId - 1]!.replace("/Parent 0 0 R", `/Parent ${pagesId} 0 R`);
  }
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index++) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "utf8"));
}