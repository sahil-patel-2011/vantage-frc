import type { Metadata } from "next";
import { readHostedOnshapeEnvFlags } from "../../lib/cad/hosted-auth";
import CadCheckerClient from "./cad-checker-client";
import "./cad-checker.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CAD checker",
  description:
    "Check a DXF drawing before it goes to the shop: units, layers, dimensions, title block and text size, each with why and how to fix it. The file is read on your device and never uploaded.",
};

export default function CadCheckerPage() {
  // Whether this deployment can connect Onshape at all. Read here, from the real configuration,
  // so the Onshape section never offers a Connect button that leads nowhere.
  return <CadCheckerClient onshapeConfigured={readHostedOnshapeEnvFlags().oauthConfigured} />;
}
