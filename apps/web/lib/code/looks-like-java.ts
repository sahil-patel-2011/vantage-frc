/**
 * Whether pasted text is plausibly Java source. The coach's rules match Java patterns, so prose
 * ("hello this is not java") matched none of them and got a green "Clear: no risk patterns
 * matched" (A5-26), which reads as a pass. This only decides what to say; it never blocks a run.
 */
export function looksLikeJava(source: string): boolean {
  const text = source.trim();
  if (!text) return false;
  const keywords = /\b(class|interface|enum|record|import|package|public|private|protected|void|return|new|extends|implements)\b/;
  const structure = /[{};]/;
  return keywords.test(text) && structure.test(text);
}
