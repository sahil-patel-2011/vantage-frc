import { loadDriveListing } from "../api/drive/route";
import { withPagePaint } from "../../lib/page-org";
import FilesClient from "./files-client";
import type { Listing } from "./files-model";
import "./files.css";

export const metadata = {
  title: "Files",
  description:
    "Vantage Drive: one file space for the team and one for each person. Videos, CAD exports, print files, flyers, spreadsheets — shared to any email address with a link.",
};

export const dynamic = "force-dynamic";

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  const listing = await withPagePaint("/files", orgId, ({ client, userId, email, orgId: resolved }) =>
    loadDriveListing(client, {
      userId,
      email,
      requestedOrgId: resolved,
      scope: "team",
      folderId: null,
      view: "browse",
    }),
  );
  return <FilesClient initial={listing && listing.status === "ready" ? (listing as Listing) : null} />;
}
