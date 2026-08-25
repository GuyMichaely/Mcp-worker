import type { AppConfig, PolicyDecision, PolicyRequest, PolicyRule } from "./schema.js";
import { subjectSpecificity, subjectsMatch } from "./path-policy.js";

type Match = { rule: PolicyRule; specificity: number };

function wildcardMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function matchRule(rule: PolicyRule, request: PolicyRequest): Match | null {
  if (!rule.capabilities.includes(request.capability)) return null;
  if (rule.tools && !rule.tools.some((tool) => wildcardMatch(tool, request.tool))) return null;
  if (rule.subjects && !rule.subjects.some((subject) => subjectsMatch(subject, request.subject))) return null;

  let specificity = 10;
  if (rule.tools) specificity += Math.max(...rule.tools.map((tool) => tool.replaceAll("*", "").length));
  if (rule.subjects) specificity += Math.max(...rule.subjects.map(subjectSpecificity));
  return { rule, specificity };
}

export function evaluatePolicy(config: AppConfig, request: PolicyRequest): PolicyDecision {
  const profile = config.profiles[config.activeProfile];
  if (!profile) throw new Error(`Unknown active profile: ${config.activeProfile}`);
  const matches = profile.rules.map((rule) => matchRule(rule, request)).filter((match): match is Match => Boolean(match));
  const denial = matches.filter(({ rule }) => rule.decision === "deny").sort((a, b) => b.specificity - a.specificity)[0];
  const selected = denial ?? matches.sort((a, b) => b.specificity - a.specificity)[0];
  return {
    decision: selected?.rule.decision ?? profile.defaultDecision,
    profile: config.activeProfile,
    ruleId: selected?.rule.id ?? null,
    request
  };
}
