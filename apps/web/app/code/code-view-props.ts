import { type Dispatch, type SetStateAction } from "react";
import type { Narration } from "../../lib/agent-narration/narration";
import type { BugbotScanTarget } from "../../lib/bugbot";
import type { CockpitPrefs } from "../../lib/cockpit/prefs";
import type { CodeCoachNextAction, CodeCoachRelatedLink } from "../../lib/code/code-related";
import type {
  BugbotFinding,
  BugbotHistoryRow,
  BugbotMeta,
  BugbotMode,
  BugbotPhase,
  BugbotReview,
  Dismissal,
  FixedFinding,
  GitHubRepoOption,
  Proposal,
  Review,
  ScanCoverage,
  ScanPlan,
  ScanProgress,
} from "./code-model";

export type CodeReadyViewProps = {
  orgId: string;
  related: "build" | "ai";
  embedded: boolean;
  relatedLinks: CodeCoachRelatedLink[];
  budgetsHref: string;
  keysHref: string;
  githubHref: string;
  showMeteredBanner: boolean;
  cutoffCode: string | null;
  nextActions: CodeCoachNextAction[];
  message: string | null;
  hasSource: boolean;
  path: string;
  setPath: Dispatch<SetStateAction<string>>;
  content: string;
  setContent: Dispatch<SetStateAction<string>>;
  setReview: Dispatch<SetStateAction<Review | null>>;
  setProposal: Dispatch<SetStateAction<Proposal | null>>;
  setMessage: Dispatch<SetStateAction<string | null>>;
  busy: boolean;
  runReview: () => void;
  runPropose: () => void;
  runBugbot: (options?: { mode?: BugbotMode; phase?: BugbotPhase; scanRepo?: boolean }) => void;
  review: Review | null;
  proposal: Proposal | null;
  coachNarrations: Narration[];
  bugbotMode: BugbotMode;
  setBugbotMode: Dispatch<SetStateAction<BugbotMode>>;
  bugbotMeta: BugbotMeta | null;
  includeScanTests: boolean;
  setIncludeScanTests: Dispatch<SetStateAction<boolean>>;
  cockpit: CockpitPrefs;
  instructions: string;
  setInstructions: Dispatch<SetStateAction<string>>;
  githubConnected: boolean;
  githubLogin: string | null;
  selectedRepo: string;
  setSelectedRepo: Dispatch<SetStateAction<string>>;
  repos: GitHubRepoOption[];
  setSelectedRef: Dispatch<SetStateAction<string>>;
  githubEmptyReason: string | null;
  robotFiles: string[];
  loadGithubFile: (filePath: string) => void;
  treeTruncated: boolean;
  planLoading: boolean;
  scanPlan: ScanPlan | null;
  showCoverage: boolean;
  setShowCoverage: Dispatch<SetStateAction<boolean>>;
  scanPlanReason: string | null;
  lastScan: BugbotScanTarget | null;
  requestWritePr: () => void;
  writePrConfirming: boolean;
  progress: ScanProgress | null;
  coverage: ScanCoverage | null;
  delta: { new: number; known: number; fixed: number } | null;
  fixedFindings: FixedFinding[];
  bugbot: BugbotReview | null;
  dismissTarget: BugbotFinding | null;
  setDismissTarget: Dispatch<SetStateAction<BugbotFinding | null>>;
  dismissReason: string;
  setDismissReason: Dispatch<SetStateAction<string>>;
  submitDismissal: () => void;
  bugbotNarrations: Narration[];
  dismissals: Dismissal[];
  restoreDismissal: (fingerprint: string) => void;
  history: BugbotHistoryRow[];
};
