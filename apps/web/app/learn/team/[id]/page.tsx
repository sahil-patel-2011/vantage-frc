import { LessonPlayer } from "./lesson-player";
import "../../guided/guided.css";
import "../team-lessons.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Team lesson",
  description: "A lesson your team wrote, one step at a time, with practice questions Vantage checks.",
};

type Props = { params: Promise<{ id: string }> };

export default async function TeamLessonPage({ params }: Props) {
  const { id } = await params;
  return <LessonPlayer lessonId={id} />;
}
