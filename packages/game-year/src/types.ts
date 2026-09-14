/** Year-agnostic FRC game pack. Scoring keys stay empty until a real manual exists. */

export type GameFieldType =
  | "number"
  | "boolean"
  | "text"
  | "select"
  | "drivetrain_type"
  | "robot_image";

export type GameField = {
  key: string;
  label: string;
  type: GameFieldType;
  required?: boolean;
  options?: string[];
  helpText?: string;
};

export type GameSchema = {
  title: string;
  fields: GameField[];
};

export type GameYearStatus = "published" | "awaiting_manual";

/** Student-readable brief taken only from a published manual / pack. */
export type GameYearBrief = {
  headline: string;
  whatWeKnow: readonly string[];
  scoutFirst: readonly string[];
  designQuestions: readonly string[];
};

export type GameYearPack = {
  year: number;
  gameName: string;
  seasonTheme: string;
  status: GameYearStatus;
  /** Official scoring keys from the game manual. Empty when the manual is not out. */
  scoringKeys: string[];
  matchSchema: GameSchema;
  pitSchema: GameSchema;
  strategyTemplates: string[];
  /** Present only when `status` is published. */
  brief?: GameYearBrief;
};

export type SchemaDefinition = {
  title: string;
  fields: GameField[];
};
