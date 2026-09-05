import { notFound } from "next/navigation";
import { getHelpArticle } from "../../../lib/help";
import HelpArticleClient from "../help-article-client";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/** The tab should name the article, not the section it lives in. */
export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const article = getHelpArticle(slug);
  if (!article) return { title: "Help" };
  return { title: article.title, description: article.summary };
}

export default async function HelpArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = getHelpArticle(slug);
  if (!article) notFound();
  return <HelpArticleClient article={article} />;
}
