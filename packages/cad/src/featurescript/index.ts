/**
 * One FeatureScript custom feature per part.
 *
 * - `part-schema` is the structured definition the agent fills in.
 * - `generate` turns it into a single valid FeatureScript source string plus the
 *   parameter map that makes a later dimension change a parameter edit.
 * - `preview` is the zero-call dry run the DFM checks and the user inspect first.
 * - `verification` is the two-call readback (bounding box + one iso view).
 */

export * from "./part-schema";
export * from "./generate";
export * from "./preview";
export * from "./verification";
