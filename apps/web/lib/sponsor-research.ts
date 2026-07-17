export type ExistingSponsorProfile = { industry: string | null; tier: string; stateProv: string | null };
export type ProspectCategory = { category: string; rationale: string };

/**
 * Static playbook of company categories that commonly sponsor FRC teams.
 * This is a heuristic starter list, not a live web search — there is no
 * outbound network call here. Swap in a real search-backed provider later
 * behind `suggestProspectCategories` without changing callers.
 */
const SPONSOR_CATEGORY_PLAYBOOK: { category: string; typicallySponsors: string; askRationale: string }[] = [
  {
    category: "Local manufacturing & machine shops",
    typicallySponsors: "in-kind machining, raw stock, or cash",
    askRationale: "Manufacturers often sponsor FRC teams for the direct pipeline into future machinists and engineers.",
  },
  {
    category: "Engineering & consulting firms",
    typicallySponsors: "cash and mentor time",
    askRationale: "Engineering firms frequently fund STEM outreach and provide mentors with directly relevant skills.",
  },
  {
    category: "Hardware & tool suppliers",
    typicallySponsors: "discounted tools and fasteners",
    askRationale: "Tool and hardware suppliers commonly offer team discounts or in-kind donations to robotics programs.",
  },
  {
    category: "Aerospace & defense contractors",
    typicallySponsors: "cash grants and mentorship",
    askRationale: "Many aerospace and defense companies run dedicated FIRST sponsorship and mentoring programs.",
  },
  {
    category: "Local technology companies",
    typicallySponsors: "cash and software licenses",
    askRationale: "Tech employers value the programming/CAD skills FRC students bring and often run community-giving programs.",
  },
  {
    category: "Credit unions & community banks",
    typicallySponsors: "cash sponsorship",
    askRationale: "Community financial institutions often fund local youth STEM programs as part of community reinvestment.",
  },
  {
    category: "Automotive & motorsport suppliers",
    typicallySponsors: "in-kind parts and cash",
    askRationale: "Automotive suppliers have obvious overlap with robot drivetrain and fabrication needs.",
  },
  {
    category: "3D printing & rapid prototyping shops",
    typicallySponsors: "in-kind printing services",
    askRationale: "Prototyping shops can donate print time, which directly offsets a real team cost.",
  },
  {
    category: "Healthcare systems & medical device companies",
    typicallySponsors: "cash sponsorship",
    askRationale: "Larger regional employers, including healthcare systems, often have community/STEM giving budgets.",
  },
  {
    category: "Energy & utility companies",
    typicallySponsors: "cash grants",
    askRationale: "Utilities frequently run structured STEM grant programs with published application cycles.",
  },
];

export function suggestProspectCategories(existingSponsors: ExistingSponsorProfile[], limit = 5): ProspectCategory[] {
  const representedIndustries = new Set(
    existingSponsors.map((s) => s.industry?.trim().toLowerCase()).filter((v): v is string => Boolean(v)),
  );
  const isNovel = (category: string) => {
    const lower = category.toLowerCase();
    return ![...representedIndustries].some((industry) => lower.includes(industry));
  };
  const novel = SPONSOR_CATEGORY_PLAYBOOK.filter((entry) => isNovel(entry.category));
  const chosen = (novel.length >= limit ? novel : SPONSOR_CATEGORY_PLAYBOOK).slice(0, limit);
  return chosen.map((entry) => ({
    category: entry.category,
    rationale: `${entry.askRationale} Typically gives via ${entry.typicallySponsors}.`,
  }));
}
