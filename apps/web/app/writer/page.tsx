import dynamic from "next/dynamic";

const WriterClient = dynamic(() => import("./writer-client"));

export const metadata = {
  title: "Writer",
};

export default function WriterPage() {
  return <WriterClient />;
}
