/** Wire types for GET /api/scouting/media/list — shared by the route and the pit photo wall. */

export type ScoutMediaQuotaSummary = {
  items: number;
  bytes: number;
  maxItems: number;
  maxBytes: number;
  share: number;
  label: string;
};

export type ScoutMediaListItem = {
  clientId: string;
  eventKey: string;
  teamKey: string;
  teamNumber: number | null;
  teamNickname: string | null;
  kind: string;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  thumbWidth: number | null;
  thumbHeight: number | null;
  hasThumb: boolean;
  capturedBy: string;
  capturedByName: string | null;
  capturedAt: string;
  entryId: string | null;
  entryClientId: string | null;
  tags: string[];
  /** Metadata-only URLs — bytes are never inlined in the listing. */
  url: string;
  thumbUrl: string;
  canDelete: boolean;
};

export type ScoutMediaListView =
  | { status: "setup_required"; eventKey: null; message: string; items: []; orgId: string }
  | {
      status: "empty" | "live";
      orgId: string;
      eventKey: string;
      teamKey: string | null;
      items: ScoutMediaListItem[];
      truncated: boolean;
      viewer: { userId: string; role: string };
      quota: ScoutMediaQuotaSummary;
      generatedAt: string;
    };
