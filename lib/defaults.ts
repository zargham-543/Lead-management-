export type StatusConfig = { name: string; cadence: number; active: boolean };
export type Settings = {
  statuses: StatusConfig[];
  platforms: string[];
  profiles: string[];
  contactTypes: string[];
  exportWindow: number;
  weekWindow: number;
  project: string;
};

export const DEFAULT_SETTINGS: Settings = {
  statuses: [
    ["New Lead", 1, true],
    ["Contacted / Applied", 3, true],
    ["Awaiting Reply", 3, true],
    ["Verification Pending", 3, true],
    ["Intro Call Scheduled", 1, true],
    ["Intro Call Done", 2, true],
    ["Interview In Progress", 5, true],
    ["Offer Stage", 2, true],
    ["On Hold", 14, true],
    ["Hired / Won", 0, false],
    ["Rejected", 0, false],
    ["Dropped / Ghosted", 0, false]
  ].map(([name, cadence, active]) => ({
    name: String(name),
    cadence: Number(cadence),
    active: Boolean(active)
  })),
  platforms: ["Wellfound", "LinkedIn", "Direct Email", "Referral", "Upwork", "Indeed", "Other"],
  profiles: ["Tayiab", "Henrik"],
  contactTypes: ["Email", "LinkedIn Message", "Platform Message", "Call", "Interview", "Other"],
  exportWindow: 2,
  weekWindow: 7,
  project: "Lead Follow-ups"
};

export const PRIORITIES = ["High", "Medium", "Low"];
