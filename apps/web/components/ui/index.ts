// --- Existing primitives ---
export { EmptyState } from "./empty-state";
export { FormGrid, FormRow } from "./form-row";
export { PageHeader } from "./page-header";
export { Panel } from "./panel";
export { TabBar, type SoftTab } from "./tab-bar";
export { ToolStrip, type ToolStripItem } from "./tool-strip";

// --- New primitives (design-system) ---
export { Card } from "./card";
export { SectionHeading } from "./section-heading";
export { StatTile } from "./stat-tile";
export { Badge, type BadgeTone } from "./badge";
export { Button } from "./button";
export { Toolbar } from "./toolbar";

// State primitives
export {
  Skeleton,
  StatRowSkeleton,
  TableSkeleton,
  CardGridSkeleton,
  TextBlockSkeleton,
  SoftBlockSkeleton,
} from "./skeleton";
export { ErrorState } from "./error-state";
export { SetupChecklist, type SetupStep } from "./setup-checklist";
export { Shell, type ShellState } from "./shell";
export { ProgressMeter } from "./progress-meter";

// Leaf-page skeleton (PageHeader + hub breadcrumb + Shell state mapping)
export {
  ToolPage,
  ToolPageBreadcrumbs,
  type ToolPageError,
  type ToolPageSetup,
} from "./tool-page";
export {
  toolPageBreadcrumb,
  toolPageBreadcrumbText,
  type ToolPageCrumb,
} from "./tool-page-breadcrumb";

// Data
export { ExportButton, type CsvColumn } from "./export-button";

// Trust / provenance
export { AIAttribution } from "./ai-attribution";
export { ModelProvenance, type ModelProvenanceMeta } from "./model-provenance";
export { relativeTime } from "./relative-time";

// Overlays / feedback (ToastProvider + ConfirmProvider mount once in app/theme-provider.tsx)
export { ActionMenu, type ActionSpec } from "./action-menu";
export { Modal, useDialog } from "./modal";
export { ConfirmDialog, ConfirmProvider, useConfirm, type ConfirmOpts } from "./confirm-dialog";
export { ToastProvider, useToast } from "./toast";
