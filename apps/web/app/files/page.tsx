import dynamic from "next/dynamic";

const FilesClient = dynamic(() => import("./files-client"));

export const metadata = {
  title: "Files",
  description:
    "Vantage Drive: one file space for the team and one for each person. Videos, CAD exports, print files, flyers, spreadsheets — shared to any email address with a link.",
};

export default function FilesPage() {
  return <FilesClient />;
}
