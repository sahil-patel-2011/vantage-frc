import { redirect } from "next/navigation";

export const metadata = {
  title: "Files",
};

/** Team Library is Drive. Old bookmarks land on /files. */
export default function LibraryPage() {
  redirect("/files");
}
