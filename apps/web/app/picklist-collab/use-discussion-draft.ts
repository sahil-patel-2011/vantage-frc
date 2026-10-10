"use client";
import { useEffect } from "react";
export type ReportDiscussionDraft = (key: string, dirty: boolean) => void;
export function useDiscussionDraft(key: string, dirty: boolean, report?: ReportDiscussionDraft) {
  useEffect(() => { report?.(key, dirty); return () => report?.(key, false); }, [key, dirty, report]);
}
