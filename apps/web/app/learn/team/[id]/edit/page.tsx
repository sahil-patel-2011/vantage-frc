import { LessonEditor } from "./lesson-editor";
import "../../../guided/guided.css";
import "../../team-lessons.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Edit team lesson",
  description: "Write a team lesson step by step, or upload a PDF, and add practice questions. Saves as you type.",
};

type Props = { params: Promise<{ id: string }> };

export default async function EditTeamLessonPage({ params }: Props) {
  const { id } = await params;
  return <LessonEditor lessonId={id} />;
}
