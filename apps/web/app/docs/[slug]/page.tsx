import { notFound } from "next/navigation";
import { getHelpArticle } from "../../../lib/help";
import HelpArticleClient from "../../help/help-article-client";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/** /docs/<slug> is the legacy alias for /help/<slug>; same article, same title. */
export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const article = getHelpArticle(slug);
  if (!article) return { title: "App manual" };
  return { title: article.title, description: article.summary };
}

export default async function DocsArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = getHelpArticle(slug);
  if (!article) notFound();
  return <HelpArticleClient article={article} />;
}
