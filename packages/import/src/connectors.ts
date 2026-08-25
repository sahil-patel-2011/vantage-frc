/**
 * The source picker catalog: "Where is your data today?"
 *
 * One entry per tool a team might be switching from, including the ones we
 * CANNOT import. An honest "no export exists" is more useful than an omission,
 * because the alternative is a coach hunting for a button that isn't there.
 */

export type ConnectorId =
  | "ics"
  | "scout"
  | "hours"
  | "notion"
  | "purple_standard"
  | "qrscout_form"
  | "qrscout_entries"
  | "scoutradioz"
  | "trello"
  | "stims"
  | "lovat";

export type ConnectorCategory = "scouting" | "calendar" | "tasks" | "people" | "notes";

export type ConnectorDescriptor = {
  id: ConnectorId;
  title: string;
  /** The tool(s) this reads from. */
  from: string;
  /** What the user hands us. */
  fileType: string;
  /** Where the rows land in Vantage. */
  into: string;
  category: ConnectorCategory;
  /** Set when we cannot import from this tool — rendered instead of a file box. */
  unsupported?: string;
  /** How to get the file out of the source tool. */
  howToExport?: string;
  docsUrl?: string;
};

export const CONNECTORS: ConnectorDescriptor[] = [
  {
    id: "ics",
    title: "Calendar (ICS)",
    from: "Google Calendar, Outlook, Apple Calendar",
    fileType: "A .ics URL or pasted .ics text",
    into: "Team calendar",
    category: "calendar",
    howToExport: "In Google Calendar: Settings → your calendar → Secret address in iCal format.",
  },
  {
    id: "purple_standard",
    title: "The Purple Standard",
    from: "Any TPS-speaking scouting app",
    fileType: "TPS JSON (one entry, an array, or { entries: [...] })",
    into: "Match scouting entries",
    category: "scouting",
    howToExport:
      "Export from your current app in The Purple Standard format. Vantage also exports TPS, so a Vantage → TPS → Vantage round trip keeps every field both sides support.",
    docsUrl: "https://github.com/The-Purple-Warehouse/the-purple-standard",
  },
  {
    id: "qrscout_form",
    title: "QRScout form",
    from: "QRScout config.json",
    fileType: "config.json",
    into: "An unpublished scouting form draft",
    category: "scouting",
    howToExport: "In QRScout: Config → Download config, or take the config.json from your fork.",
    docsUrl: "https://github.com/frc2713/QRScout",
  },
  {
    id: "qrscout_entries",
    title: "QRScout scans",
    from: "QRScout QR payloads",
    fileType: "Scanned payload lines + the same config.json",
    into: "Match scouting entries",
    category: "scouting",
    howToExport:
      "Paste the lines your scanner collected. The config.json is required: it is what says which column is which.",
    docsUrl: "https://github.com/frc2713/QRScout",
  },
  {
    id: "scoutradioz",
    title: "Scoutradioz",
    from: "Scoutradioz raw export",
    fileType: "matchscouting / pitscouting JSON documents",
    into: "Match and pit scouting entries",
    category: "scouting",
    howToExport:
      "Scoutradioz → Reports → Export data. Layout-only elements (headers, spacers, text blocks) and derived formula metrics are not imported.",
    docsUrl: "https://scoutradioz.com",
  },
  {
    id: "scout",
    title: "Scouting CSV",
    from: "Google Sheets, ScoutingPASS, any spreadsheet",
    fileType: "CSV with a header row",
    into: "Match scouting entries",
    category: "scouting",
    howToExport: "File → Download → Comma-separated values. Save the column mapping as a preset to reuse next week.",
  },
  {
    id: "lovat",
    title: "Lovat",
    from: "Lovat scouting",
    fileType: "—",
    into: "—",
    category: "scouting",
    unsupported:
      "Lovat does not publish an export API or a documented download format, so there is nothing we can read reliably. " +
      "If your Lovat instance can produce a CSV, import it through Scouting CSV above and map the columns by hand — " +
      "we will not guess at an undocumented shape.",
    docsUrl: "https://lovatapp.com",
  },
  {
    id: "hours",
    title: "Hours CSV",
    from: "Lookout, GrizzlyTime, a shop sign-in sheet",
    fileType: "CSV with person, hours, and date columns",
    into: "Attendance and shop hours",
    category: "people",
  },
  {
    id: "trello",
    title: "Trello board",
    from: "A Trello board export",
    fileType: "Board JSON",
    into: "Build tasks",
    category: "tasks",
    howToExport:
      "Board menu → More → Print, export, and share → Export as JSON. You map each Trello list to a task status before anything is written.",
  },
  {
    id: "notion",
    title: "Notion JSON",
    from: "Exported Notion database pages",
    fileType: "Database JSON",
    into: "Calendar, knowledge, and tasks",
    category: "notes",
  },
  {
    id: "stims",
    title: "Roster CSV (STIMS)",
    from: "FIRST youth registration / Dashboard roster download",
    fileType: "Roster CSV with name and email columns",
    into: "A reviewed invite list — nothing is sent until you send it",
    category: "people",
    howToExport:
      "FIRST has no roster API, so download the CSV from your Dashboard. Column names differ by season, so we match headers by meaning and tell you what we found. Parent and guardian contact columns are never invited.",
  },
];

export function connectorById(id: string): ConnectorDescriptor | undefined {
  return CONNECTORS.find((connector) => connector.id === id);
}
