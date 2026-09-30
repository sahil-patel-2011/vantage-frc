"use client";

import { createContext, useContext } from "react";

/** Embedded AI tools share workspace navigation; standalone tools keep their links. */
export const AiWorkspaceContext = createContext(false);
export function useAiWorkspace() { return useContext(AiWorkspaceContext); }
