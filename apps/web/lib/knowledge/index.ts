// Team knowledge wiki — domain helpers + action parsing (framework-free).

export {
  KNOWLEDGE_TEMPLATE_KINDS,
  MAX_BODY,
  MAX_SLUG,
  MAX_TAG,
  MAX_TAGS,
  MAX_TITLE,
  TEMPLATE_KIND_LABEL,
  type KnowledgeLink,
  type KnowledgePageDetail,
  type KnowledgePageSummary,
  type KnowledgeSearchHit,
  type KnowledgeTemplateKind,
  type KnowledgeWikiAction,
  type KnowledgeWikiView,
} from "./types";
export {
  KNOWLEDGE_TEMPLATES,
  applyKnowledgeTemplate,
  templateByKind,
  type KnowledgeTemplate,
} from "./templates";
export { knowledgeHitHref, slugifyTitle, snippetFrom } from "./helpers";
export {
  applyKnowledgeWikiAction,
  getKnowledgePage,
  listKnowledgePages,
  loadKnowledgeWikiView,
  searchKnowledgeCorpus,
} from "./compute-wiki";
export {
  KNOWLEDGE_RELATED_LINKS,
  knowledgeRelatedLinks,
  knowledgeSetupNextActions,
  type KnowledgeRelatedId,
  type KnowledgeRelatedLink,
  type KnowledgeSetupNextAction,
} from "./knowledge-related";

import {
  KNOWLEDGE_TEMPLATE_KINDS,
  MAX_BODY,
  MAX_TAG,
  MAX_TAGS,
  MAX_TITLE,
  type KnowledgeTemplateKind,
  type KnowledgeWikiAction,
} from "./types";
import { slugifyTitle } from "./helpers";

function requiredText(value: unknown, label: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function optionalText(value: unknown, max: number) {
  if (value == null) return "";
  const text = String(value);
  if (text.length > max) throw new Error(`Body must be ${max} characters or fewer`);
  return text;
}

function uuid(value: unknown, label: string) {
  const text = requiredText(value, label, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function templateKind(value: unknown): KnowledgeTemplateKind {
  const text = String(value ?? "blank") as KnowledgeTemplateKind;
  if (!KNOWLEDGE_TEMPLATE_KINDS.includes(text)) throw new Error("Invalid template kind");
  return text;
}

function parseTags(value: unknown): string[] {
  if (value == null) return [];
  const raw = Array.isArray(value) ? value : String(value).split(",");
  const tags = raw
    .map((t) => String(t).trim().toLowerCase().slice(0, MAX_TAG))
    .filter(Boolean);
  const unique = [...new Set(tags)];
  if (unique.length > MAX_TAGS) throw new Error(`At most ${MAX_TAGS} tags`);
  return unique;
}

function optionalSeason(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1992 || n > 2100) throw new Error("Season year is invalid");
  return n;
}

export function parseKnowledgeWikiAction(input: unknown): KnowledgeWikiAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid wiki action");
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "upsert_page": {
      const fromTemplate =
        body.fromTemplate != null && body.fromTemplate !== ""
          ? templateKind(body.fromTemplate)
          : null;
      const rawTitle = String(body.title ?? "").trim();
      if (!fromTemplate && !rawTitle) throw new Error("Title is required");
      if (rawTitle.length > MAX_TITLE) throw new Error(`Title must be ${MAX_TITLE} characters or fewer`);
      const slugInput = String(body.slug ?? "").trim();
      return {
        action,
        orgId,
        id: body.id ? uuid(body.id, "Page") : null,
        title: rawTitle,
        slug: slugInput ? slugifyTitle(slugInput) : "",
        body: optionalText(body.body, MAX_BODY),
        templateKind: templateKind(body.templateKind ?? fromTemplate ?? "blank"),
        seasonYear: optionalSeason(body.seasonYear),
        tags: parseTags(body.tags),
        pinned: Boolean(body.pinned),
        fromTemplate,
      };
    }

    case "delete_page":
      return { action, orgId, id: uuid(body.id, "Page") };

    case "link": {
      const targetType = requiredText(body.targetType, "Target type", 40);
      if (targetType !== "decision" && targetType !== "design_review") {
        throw new Error("Invalid link target type");
      }
      const noteRaw = body.note == null ? null : String(body.note).trim();
      if (noteRaw && noteRaw.length > 500) throw new Error("Link note must be 500 characters or fewer");
      return {
        action,
        orgId,
        pageId: uuid(body.pageId, "Page"),
        targetType,
        targetId: uuid(body.targetId, "Target"),
        note: noteRaw || null,
      };
    }

    case "unlink":
      return { action, orgId, linkId: uuid(body.linkId, "Link") };

    default:
      throw new Error("Unsupported wiki action");
  }
}
