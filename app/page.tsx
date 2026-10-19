"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { DEFAULT_SETTINGS, PRIORITIES, Settings } from "@/lib/defaults";

type Lead = {
  id: string;
  title?: string;
  company?: string;
  contact?: string;
  platform?: string;
  profile?: string;
  status?: string;
  priority?: string;
  link?: string;
  terms?: string;
  dateAdded?: string;
  override?: string;
  summary?: string;
  remarks?: string;
  taskLink?: string;
  synced?: string;
  createdBy?: string;
  updatedBy?: string;
  ownerId?: string | null;
};

type LogEntry = {
  id: string;
  leadId: string;
  date: string;
  type?: string;
  summary?: string;
  next?: string;
  createdBy?: string;
  updatedBy?: string;
};

type Derived = {
  last: string;
  next: string;
  fs: string;
  days: number | null;
  count: number;
  due: boolean;
  active: boolean;
};

type LeadRow = Lead & { d: Derived };
type User = { id: string; name: string; email: string; role: "manager" | "member"; created_at?: string; lead_count?: number };
type Tab = "dashboard" | "leads" | "log" | "export" | "settings" | "guide" | "team";
type LeadForm = Omit<Lead, "id" | "createdBy" | "updatedBy">;

const tabs: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "leads", label: "Leads" },
  { id: "log", label: "Follow-up log" },
  { id: "export", label: "Task export" },
  { id: "settings", label: "Settings" },
  { id: "guide", label: "Guide" },
  { id: "team", label: "Team" }
];
const statuses = ["All", "Overdue", "Due Today", "This Week", "Upcoming", "Needs date", "Closed"];
const columns = ["Task Name", "Description", "Due Date", "Priority", "Labels", "Project / List", "Link", "Lead ID"] as const;
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + Number(days || 0));
  return value.toISOString().slice(0, 10);
};
const dayDifference = (a: string, b: string) =>
  Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86400000);
const formatDate = (date?: string, year = false) =>
  date
    ? new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        ...(year ? { year: "numeric" as const } : {}),
        timeZone: "UTC"
      })
    : "";

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error || `Request failed (${response.status})`, response.status);
  return body as T;
}

const importAliases: Record<string, string> = {
  title: "title",
  jobtitle: "title",
  jobtiltle: "title",
  position: "title",
  role: "title",
  company: "company",
  companyname: "company",
  organization: "company",
  contact: "contact",
  client: "contact",
  contactclient: "contact",
  clientname: "contact",
  platform: "platform",
  source: "platform",
  portal: "platform",
  profile: "profile",
  account: "profile",
  status: "status",
  stage: "status",
  priority: "priority",
  link: "link",
  url: "link",
  email: "link",
  contactlink: "link",
  contactlinkemail: "link",
  terms: "terms",
  compensation: "terms",
  compensationterms: "terms",
  budget: "terms",
  salary: "terms",
  rate: "terms",
  dateadded: "dateAdded",
  date: "dateAdded",
  added: "dateAdded",
  nextfollowup: "override",
  nextfollowupoverride: "override",
  followup: "override",
  override: "override",
  jobdescription: "summary",
  jobsummary: "summary",
  jobsummaryjdlink: "summary",
  description: "summary",
  jd: "summary",
  jdlink: "summary",
  summary: "summary",
  remarks: "remarks",
  notes: "remarks",
  note: "remarks",
  comments: "remarks",
  tasklink: "taskLink",
  task: "taskLink"
};

function importDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }
  const text = String(value ?? "").trim();
  const displayDate = text.match(/^(\d{1,2})-([a-z]{3})-(\d{4})$/i);
  if (displayDate) {
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
      .indexOf(displayDate[2].toLowerCase()) + 1;
    if (month) return `${displayDate[3]}-${String(month).padStart(2, "0")}-${displayDate[1].padStart(2, "0")}`;
  }
  const slashDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashDate) return `${slashDate[3]}-${slashDate[2].padStart(2, "0")}-${slashDate[1].padStart(2, "0")}`;
  return text;
}

function mapImportRows(rows: unknown[][]): Record<string, string>[] {
  let headerIndex = -1;
  let headers: string[] = [];
  for (let index = 0; index < Math.min(rows.length, 10); index += 1) {
    const candidate = (rows[index] ?? []).map((header) => String(header ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (candidate.some((header) => importAliases[header] === "title" || importAliases[header] === "company")) {
      headerIndex = index;
      headers = candidate;
      break;
    }
  }
  if (headerIndex < 0) throw new Error('Could not find a "Job Title" or "Company" column in the first 10 rows.');

  return rows.slice(headerIndex + 1).map((values) => {
    const lead: Record<string, string> = {};
    headers.forEach((header, index) => {
      const key = importAliases[header];
      if (!key || values[index] === undefined || values[index] === null || values[index] === "") return;
      const value = key === "dateAdded" || key === "override"
        ? importDate(values[index])
        : String(values[index]).trim();
      if (value) lead[key] = value;
    });
    return lead.title || lead.company ? lead : null;
  }).filter((lead): lead is Record<string, string> => lead !== null);
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted && char === '"' && input[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("The CSV contains an unclosed quoted cell.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error("CSV must contain a header row and at least one lead.");
  const imported = mapImportRows(rows);
  if (!imported.length) throw new Error("No rows contain a lead title or company.");
  return imported;
}

async function parseImportFile(file: File): Promise<Record<string, string>[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") return parseCsv(await file.text());
  if (extension !== "xlsx" && extension !== "xls") {
    throw new Error("Choose a .xlsx, .xls, or .csv file.");
  }
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error("The spreadsheet does not contain a worksheet.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheet], {
    header: 1,
    defval: "",
    raw: true,
    blankrows: false
  });
  const imported = mapImportRows(rows);
  if (!imported.length) throw new Error("No rows contain a lead title or company.");
  return imported;
}

function csvValue(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export default function Home() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState("");
  const [actor, setActor] = useState("");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [team, setTeam] = useState<User[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [ownerFilter, setOwnerFilter] = useState("All");
  const [leadEditor, setLeadEditor] = useState<Lead | null | undefined>(undefined);
  const [logLead, setLogLead] = useState("");
  const [csvText, setCsvText] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const importFileInput = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<Settings>(DEFAULT_SETTINGS);
  const [logDraft, setLogDraft] = useState({
    date: today(),
    leadId: "",
    type: "Email",
    next: "",
    summary: ""
  });

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  }, []);

  const refresh = useCallback(async () => {
    const [leadRows, entries, prefs] = await Promise.all([
      api<Lead[]>("/api/leads"),
      api<LogEntry[]>("/api/log"),
      api<Settings>("/api/settings")
    ]);
    setLeads(leadRows);
    setLog(entries);
    setSettings(prefs);
    setSettingsDraft(prefs);
  }, []);

  useEffect(() => {
    const initialTab = window.location.hash.slice(1) as Tab;
    if (tabs.some((item) => item.id === initialTab)) setTab(initialTab);
    api<{ user: User | null }>("/api/auth/me")
      .then(async ({ user }) => {
        if (!user) {
          window.location.assign("/login");
          return;
        }
        setCurrentUser(user);
        setActor(user.name);
        if (initialTab === "team" && user.role !== "manager") setTab("dashboard");
        if (user.role === "manager") {
          const members = await api<User[]>("/api/team");
          setTeam(members);
        }
        await refresh();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          window.location.assign("/login");
          return;
        }
        setLoadError(error instanceof Error ? error.message : "Could not load tracker data.");
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  const rows = useMemo<LeadRow[]>(() => {
    const currentDay = today();
    return leads
      .filter((lead) => lead.title || lead.company)
      .map((lead) => {
        const entries = log.filter((item) => item.leadId === lead.id);
        const latest = entries.reduce((last, item) => item.date > last ? item.date : last, "");
        const last = latest || lead.dateAdded || "";
        const status = settings.statuses.find((item) => item.name === lead.status);
        const active = status?.active ?? true;
        const next = active ? lead.override || (last ? addDays(last, status?.cadence ?? 3) : "") : "";
        const fs = !active ? "Closed" : !next ? "Needs date" : next < currentDay ? "Overdue" :
          next === currentDay ? "Due Today" : next <= addDays(currentDay, settings.weekWindow) ? "This Week" : "Upcoming";
        return {
          ...lead,
          d: {
            last,
            next,
            fs,
            days: next ? dayDifference(next, currentDay) : null,
            count: entries.length,
            due: Boolean(next && next <= addDays(currentDay, settings.exportWindow) && lead.synced !== next),
            active
          }
        };
      });
  }, [leads, log, settings]);

  const exportRows = useMemo(() => rows.filter((row) => row.d.due).sort((a, b) => a.d.next.localeCompare(b.d.next)).map((lead) => ({
    lead,
    "Task Name": `Follow up: ${lead.company || ""} - ${lead.title || ""}${lead.contact ? ` (${lead.contact})` : ""}`,
    Description: `Status: ${lead.status || ""} | Last contact: ${lead.d.last ? formatDate(lead.d.last, true) : "n/a"} | Profile: ${lead.profile || ""}${lead.remarks ? ` | Notes: ${lead.remarks}` : ""}`,
    "Due Date": lead.d.next,
    Priority: lead.priority || "Medium",
    Labels: (lead.platform || "lead").toLowerCase(),
    "Project / List": settings.project,
    Link: lead.link || "",
    "Lead ID": lead.id
  })), [rows, settings]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const order: Record<string, number> = {
      Overdue: 0, "Due Today": 1, "This Week": 2, Upcoming: 3, "Needs date": 4, Closed: 5
    };
    return rows.filter((row) =>
      (statusFilter === "All" || row.d.fs === statusFilter) &&
      (currentUser?.role !== "manager" || ownerFilter === "All" ||
        (ownerFilter === "Unassigned" ? !row.ownerId : row.ownerId === ownerFilter)) &&
      (!needle || [row.company, row.title, row.contact, row.id, row.remarks].join(" ").toLowerCase().includes(needle))
    ).sort((a, b) => (order[a.d.fs] - order[b.d.fs]) || a.d.next.localeCompare(b.d.next));
  }, [rows, query, statusFilter, ownerFilter, currentUser?.role]);

  const mutate = async (path: string, method: string, data?: unknown, id?: string) => {
    await api(path, {
      method,
      body: JSON.stringify({ ...(id ? { id } : {}), ...(data === undefined ? {} : { data }) })
    });
    await refresh();
  };

  const saveLead = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (leadEditor === undefined) return;
    const form = new FormData(event.currentTarget);
    const data = Object.fromEntries(form.entries()) as Record<string, string>;
    const existing = leadEditor;
    try {
      if (existing) {
        await mutate("/api/leads", "PUT", data, existing.id);
      } else {
        await mutate("/api/leads", "POST", data);
      }
      setLeadEditor(undefined);
      notify(existing ? "Lead saved" : "Lead added");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save lead.");
    }
  };

  const saveLog = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const entry: LogEntry = {
      ...logDraft,
      id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
    };
    try {
      await mutate("/api/log", "POST", entry);
      setLogDraft({ date: today(), leadId: "", type: "Email", next: "", summary: "" });
      setLogLead("");
      notify("Follow-up logged");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not log follow-up.");
    }
  };

  const deleteLead = async (lead: Lead) => {
    if (!window.confirm(`Delete ${lead.company || lead.title || lead.id} and its follow-up history?`)) return;
    try {
      await mutate(`/api/leads/${encodeURIComponent(lead.id)}`, "DELETE");
      setLeadEditor(undefined);
      notify("Lead deleted");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not delete lead.");
    }
  };

  const deleteLog = async (entry: LogEntry) => {
    if (!window.confirm("Delete this follow-up entry?")) return;
    try {
      await mutate(`/api/log/${encodeURIComponent(entry.id)}`, "DELETE");
      notify("Follow-up entry deleted");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not delete follow-up entry.");
    }
  };

  const saveSettings = async () => {
    try {
      await mutate("/api/settings", "PUT", settingsDraft);
      notify("Settings saved");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save settings.");
    }
  };

  const saveSynced = async (lead: LeadRow) => {
    try {
      const { d: _derived, id, createdBy: _createdBy, updatedBy: _updatedBy, ...data } = lead;
      await mutate("/api/leads", "PUT", { ...data, synced: lead.d.next }, id);
      notify("Marked synced");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not mark task as synced.");
    }
  };

  const downloadCsv = async () => {
    const value = [columns.map(csvValue).join(","), ...exportRows.map((row) =>
      columns.map((column) => csvValue(row[column as keyof typeof row])).join(",")
    )].join("\r\n");
    try {
      await navigator.clipboard.writeText(value);
      notify("CSV copied to clipboard");
    } catch {
      const url = URL.createObjectURL(new Blob([value], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `task-export-${today()}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    }
  };

  const importCsv = async () => {
    setImporting(true);
    setImportError("");
    try {
      const imported = importFile ? await parseImportFile(importFile) : parseCsv(csvText);
      if (!imported.length) throw new Error("No rows contain a lead title or company.");
      const failed: string[] = [];
      let saved = 0;
      for (const [index, lead] of imported.entries()) {
        try {
          await api("/api/leads", {
            method: "POST",
            body: JSON.stringify({
              data: {
                ...lead,
                status: lead.status || "New Lead",
                priority: lead.priority || "Medium",
                platform: lead.platform || "Other",
                profile: lead.profile || settings.profiles[0] || "",
                dateAdded: lead.dateAdded || today()
              }
            })
          });
          saved += 1;
        } catch (error) {
          failed.push(`Row ${index + 1} (${lead.title || lead.company}): ${error instanceof Error ? error.message : "Import failed."}`);
        }
      }
      if (saved) {
        try {
          await refresh();
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not refresh tracker data.";
          setImportError(`${saved} lead${saved === 1 ? " was" : "s were"} saved, but the tracker could not refresh: ${message} Reload before importing again to avoid duplicates.`);
          notify("Some leads were saved, but the tracker could not refresh");
          return;
        }
      }
      setCsvText("");
      setImportFile(null);
      if (importFileInput.current) importFileInput.current.value = "";
      if (failed.length) {
        const details = failed.slice(0, 5).join("\n");
        setImportError(`${saved} of ${imported.length} leads imported. Import only the failed rows if retrying, to avoid duplicates.\n${details}${failed.length > 5 ? `\nAnd ${failed.length - 5} more failed rows.` : ""}`);
        notify(`${saved} of ${imported.length} leads imported; ${failed.length} failed`);
      } else {
        setImportOpen(false);
        notify(`${saved} lead${saved === 1 ? "" : "s"} imported`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not import leads.";
      setImportError(message);
      notify(message);
    } finally {
      setImporting(false);
    }
  };

  const changeTab = (value: Tab) => {
    setTab(value);
    window.history.replaceState(null, "", `#${value}`);
    window.scrollTo(0, 0);
  };
  const logout = async () => {
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
      window.location.assign("/login");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not sign out.");
    }
  };
  const changeRole = async (member: User, role: User["role"]) => {
    try {
      const updated = await api<User>("/api/team", {
        method: "PUT",
        body: JSON.stringify({ userId: member.id, role })
      });
      setTeam((previous) => previous.map((item) => item.id === updated.id ? { ...item, role: updated.role } : item));
      notify(`${updated.name} is now a ${updated.role}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not update team role.");
    }
  };
  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/auth/password", {
        method: "PUT",
        body: JSON.stringify({
          currentPassword: form.get("currentPassword"),
          newPassword: form.get("newPassword")
        })
      });
      formElement.reset();
      notify("Password changed");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not change password.");
    }
  };

  const header = (title: string, subtitle?: string, actions?: ReactNode) => (
    <div className="head">
      <div><h2>{title}</h2>{subtitle && <div className="sub">{subtitle}</div>}</div>
      <div className="row">{actions}</div>
    </div>
  );
  const addButton = <button className="btn primary" onClick={() => setLeadEditor(null)}>Add lead</button>;
  const pill = (value: string) => <span className={`pill s-${value.replace(/\s/g, "")}`}>{value}</span>;
  const leadName = (id: string) => {
    const lead = leads.find((item) => item.id === id);
    return lead ? `${lead.company || ""} – ${lead.title || ""}` : "ID not found";
  };

  const renderDashboard = () => {
    const isManager = currentUser?.role === "manager";
    if (!rows.length && !isManager) return <>{header("Dashboard")}<div className="empty"><h3>No leads yet</h3><p>Add your first lead and follow-ups will appear here.</p>{addButton}</div></>;
    const counts = (key: string) => rows.filter((row) => row.d.fs === key).length;
    const activeRows = rows.filter((row) => row.d.active);
    const overdue = counts("Overdue");
    const dueToday = counts("Due Today");
    const kpis: { label: string; value: number; icon: string; status?: string; target?: Tab; tone: string }[] = [
      { label: isManager ? "Team active leads" : "Active leads", value: activeRows.length, icon: "↗", tone: "blue" },
      { label: "Overdue", value: overdue, icon: "!", status: "Overdue", tone: "rose" },
      { label: "Due today", value: dueToday, icon: "◷", status: "Due Today", tone: "amber" },
      { label: "Due this week", value: counts("This Week"), icon: "▦", status: "This Week", tone: "violet" },
      { label: "Need a date", value: counts("Needs date"), icon: "＋", status: "Needs date", tone: "slate" },
      { label: "Tasks to export", value: exportRows.length, icon: "↥", target: "export", tone: "mint" }
    ];
    const weekStart = addDays(today(), -6);
    const teamStats = isManager
      ? [
          ...team.map((member) => {
            const memberRows = rows.filter((row) => row.ownerId === member.id);
            const memberLeadIds = new Set(memberRows.map((row) => row.id));
            return {
              id: member.id,
              name: member.name,
              leads: memberRows.length,
              active: memberRows.filter((row) => row.d.active).length,
              overdue: memberRows.filter((row) => row.d.fs === "Overdue").length,
              dueToday: memberRows.filter((row) => row.d.fs === "Due Today").length,
              touchpoints: log.filter((entry) => memberLeadIds.has(entry.leadId) && entry.date >= weekStart && entry.date <= today()).length
            };
          }),
          ...(rows.some((row) => !row.ownerId) ? [{
            id: "Unassigned",
            name: "Unassigned",
            leads: rows.filter((row) => !row.ownerId).length,
            active: rows.filter((row) => !row.ownerId && row.d.active).length,
            overdue: rows.filter((row) => !row.ownerId && row.d.fs === "Overdue").length,
            dueToday: rows.filter((row) => !row.ownerId && row.d.fs === "Due Today").length,
            touchpoints: log.filter((entry) => rows.some((row) => !row.ownerId && row.id === entry.leadId) && entry.date >= weekStart && entry.date <= today()).length
          }] : [])
        ].sort((a, b) => a.name.localeCompare(b.name))
      : [];
    const work = rows.filter((row) => ["Overdue", "Due Today", "This Week"].includes(row.d.fs))
      .sort((a, b) => a.d.next.localeCompare(b.d.next));
    const statusColors = ["#4674d4", "#8a68d4", "#de8c3c", "#3b9c86", "#d65f68", "#78859b"];
    const pipeline = settings.statuses.map((item, index) => ({
      name: item.name,
      count: rows.filter((row) => row.status === item.name).length,
      color: statusColors[index % statusColors.length]
    })).filter((item) => item.count > 0);
    const pipelineStops: string[] = [];
    let offset = 0;
    pipeline.forEach((item) => {
      const end = offset + item.count / Math.max(rows.length, 1) * 100;
      pipelineStops.push(`${item.color} ${offset}% ${end}%`);
      offset = end;
    });
    const recent = [...log].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
    const weekActivity = log.filter((entry) => entry.date >= addDays(today(), -6) && entry.date <= today()).length;
    const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";
    const focusFilter = (status: string) => {
      setStatusFilter(status);
      setQuery("");
      changeTab("leads");
    };
    const focusMember = (memberId: string) => {
      setOwnerFilter(memberId);
      setStatusFilter("All");
      setQuery("");
      changeTab("leads");
    };
    const listCounts = (values: string[], key: "platform" | "profile") => {
      const ranked = values.map((value) => ({
        value,
        count: activeRows.filter((row) => row[key] === value).length
      })).filter((item) => item.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);
      return ranked.length
        ? ranked.map((item) => <div className="cnt" key={item.value}><span>{item.value}</span><b>{item.count}</b></div>)
        : <p className="muted source-empty">No activity yet</p>;
    };
    return <>
      {header("Dashboard", isManager ? "Your team's hiring pipeline, at a glance." : "Your hiring pipeline, at a glance.", addButton)}
      <section className="dash-hero">
        <div className="hero-copy">
          <span className="eyebrow"><span className="live-dot"/> {isManager ? "TEAM PIPELINE OVERVIEW" : "LIVE PIPELINE OVERVIEW"}</span>
          <h2>{greeting}{actor.trim() ? `, ${actor.trim()}` : ""}.</h2>
          <p>{overdue ? `Your ${isManager ? "team has" : "have"} ${overdue} follow-up${overdue === 1 ? "" : "s"} that could use your attention.` : `${isManager ? "Your team's" : "Your"} follow-ups are looking clear. Keep the conversation moving.`}</p>
          <div className="hero-actions">
            {overdue > 0
              ? <button className="hero-button" onClick={() => focusFilter("Overdue")}>Review overdue <span>→</span></button>
              : <button className="hero-button" onClick={() => changeTab("leads")}>{isManager ? "View team leads" : "View your leads"} <span>→</span></button>}
            <span className="hero-date">{formatDate(today(), true)}</span>
          </div>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit orbit-one"/><div className="orbit orbit-two"/>
          <div className="orbit-core"><span>ACTIVE</span><b>{activeRows.length}</b><small>leads</small></div>
          <span className="orbit-point point-one"/><span className="orbit-point point-two"/><span className="orbit-point point-three"/>
        </div>
        <div className="hero-foot"><span><i className="hero-pulse"/> Pipeline is up to date</span><span>{weekActivity} touchpoint{weekActivity === 1 ? "" : "s"} this week</span></div>
      </section>
      <div className="metric-grid">{kpis.map((metric) => (
        <button
          className={`metric-card tone-${metric.tone}`}
          key={metric.label}
          onClick={() => metric.status ? focusFilter(metric.status) : metric.target ? changeTab(metric.target) : changeTab("leads")}
        >
          <span className="metric-top"><span className="metric-icon">{metric.icon}</span><span className="metric-arrow">↗</span></span>
          <b>{metric.value}</b><span className="metric-label">{metric.label}</span>
        </button>
      ))}</div>
      {isManager && <section className="panel team-dashboard-panel">
        <div className="section-heading"><div><span className="section-kicker">TEAM ACTIVITY</span><h3>Team performance</h3></div>
          <button className="text-link" onClick={() => changeTab("team")}>Manage team <span>→</span></button>
        </div>
        {teamStats.length ? <div className="tw team-performance-table"><table>
          <thead><tr>{["Team member", "Leads", "Active", "Overdue", "Due today", "Touchpoints · 7 days"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{teamStats.map((member) => <tr className={member.id === "Unassigned" ? "" : "click"} key={member.id}
            onClick={() => { if (member.id !== "Unassigned") focusMember(member.id); }}>
            <td><b>{member.name}</b>{member.id === currentUser?.id && <span className="team-you">You</span>}</td>
            <td className="team-number">{member.leads}</td><td className="team-number">{member.active}</td>
            <td><span className={member.overdue ? "overdue-count" : "team-number"}>{member.overdue}</span></td>
            <td className="team-number">{member.dueToday}</td><td className="team-number">{member.touchpoints}</td>
          </tr>)}</tbody>
        </table></div> : <div className="activity-empty">No team members yet. Invite your team to register to see their stats here.</div>}
      </section>}
      <div className="dashboard-grid">
        <section className="panel follow-panel">
          <div className="section-heading"><div><span className="section-kicker">YOUR NEXT MOVES</span><h3>Follow-ups to work</h3></div>
            <button className="text-link" onClick={() => focusFilter("All")}>View all leads <span>→</span></button>
          </div>
          {work.length ? <div className="follow-list">{work.slice(0, 5).map((row) => (
            <button className="follow-item" key={row.id} onClick={() => setLeadEditor(row)}>
              <span className={`follow-marker marker-${row.d.fs === "Overdue" ? "rose" : row.d.fs === "Due Today" ? "amber" : "blue"}`}/>
              <span className="follow-company"><b>{row.company || row.title || "Untitled lead"}</b><small>{row.company ? row.title : row.platform || "Lead"}{row.contact ? ` · ${row.contact}` : ""}</small></span>
              <span className="follow-due">{pill(row.d.fs)}<small>{row.d.days === 0 ? "Today" : row.d.days! < 0 ? `${Math.abs(row.d.days!)} days late` : `In ${row.d.days} days`}</small></span>
              <span className="follow-chevron">›</span>
            </button>
          ))}</div> : <div className="calm-state"><span>✦</span><div><b>All caught up</b><small>No follow-ups need attention right now.</small></div></div>}
          {work.length > 5 && <div className="list-footer">Showing 5 of {work.length} follow-ups</div>}
        </section>
        <section className="panel pipeline-panel">
          <div className="section-heading"><div><span className="section-kicker">OPPORTUNITY MIX</span><h3>Pipeline health</h3></div><span className="panel-menu">•••</span></div>
          <div className="pipeline-overview">
            <div className="pipeline-donut" style={{ background: pipelineStops.length ? `conic-gradient(${pipelineStops.join(", ")})` : "var(--sunken)" }}>
              <div className="donut-center"><b>{rows.length}</b><span>total leads</span></div>
            </div>
            <div className="pipeline-legend">{pipeline.slice(0, 5).map((item) => (
              <div className="legend-row" key={item.name}><i style={{ background: item.color }}/><span>{item.name}</span><b>{item.count}</b></div>
            ))}</div>
          </div>
          <div className="pipeline-summary"><span><i className="summary-dot summary-active"/>Active <b>{activeRows.length}</b></span><span><i className="summary-dot summary-closed"/>Closed <b>{counts("Closed")}</b></span></div>
        </section>
      </div>
      <div className="dashboard-grid dashboard-lower">
        <section className="panel source-panel">
          <div className="section-heading"><div><span className="section-kicker">WHERE THEY COME FROM</span><h3>Lead sources</h3></div><button className="text-link" onClick={() => changeTab("settings")}>Manage <span>→</span></button></div>
          <div className="source-columns"><div className="source-list"><span className="source-label">PLATFORM</span>{listCounts(settings.platforms.slice(0, 5), "platform")}</div>
            <div className="source-list"><span className="source-label">PROFILE</span>{listCounts(settings.profiles, "profile")}</div></div>
        </section>
        <section className="panel activity-panel">
          <div className="section-heading"><div><span className="section-kicker">RECENT TOUCHPOINTS</span><h3>Latest activity</h3></div><button className="text-link" onClick={() => changeTab("log")}>Open log <span>→</span></button></div>
          {recent.length ? <div className="activity-list">{recent.map((entry) => <button className="activity-item" key={entry.id} onClick={() => { setLogLead(entry.leadId); changeTab("log"); }}>
            <span className="activity-date"><b>{formatDate(entry.date).split(" ")[0]}</b><small>{formatDate(entry.date).split(" ")[1]}</small></span>
            <span className="activity-copy"><b>{leadName(entry.leadId)}</b><small>{entry.type || "Touchpoint"}{entry.summary ? ` · ${entry.summary}` : ""}</small></span>
            <span className="activity-chevron">›</span>
          </button>)}</div> : <div className="activity-empty">Log a contact to see your latest activity here.</div>}
        </section>
      </div>
    </>;
  };

  const renderLeads = () => <>
    {header("Leads", `${filteredRows.length} shown`, <><button className="btn" onClick={() => setImportOpen(true)}>Import leads</button>{addButton}</>)}
    <div className="tools">
      <input type="search" placeholder="Search company, title, contact" aria-label="Search leads" value={query} onChange={(event) => setQuery(event.target.value)}/>
      <select aria-label="Filter by follow-up status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
        {statuses.map((value) => <option key={value}>{value}</option>)}
      </select>
      {currentUser?.role === "manager" && <select aria-label="Filter by team member" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
        <option>All</option>{team.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
        {rows.some((lead) => !lead.ownerId) && <option>Unassigned</option>}
      </select>}
    </div>
    <div className="tw"><table><thead><tr>{["ID", "Company / role", "Platform", "Profile", "Status", "Priority", "Last contact", "Next follow-up", "Follow-up"].map((value) => <th key={value}>{value}</th>)}</tr></thead>
      <tbody>{filteredRows.length ? filteredRows.map((row) => <tr className="click" key={row.id} onClick={() => setLeadEditor(row)}>
        <td className="mono">{row.id}</td><td><b>{row.company}</b><br/><span className="muted">{row.title}</span>{row.createdBy && <><br/><span className="muted byline">Added by {row.createdBy}</span></>}</td>
        <td>{row.platform}</td><td>{row.profile}</td><td>{row.status}</td><td>{row.priority === "High" ? <span className="hi">High</span> : row.priority}</td>
        <td className="mono">{formatDate(row.d.last) || "—"}</td><td className="mono">{formatDate(row.d.next) || "—"}</td><td>{pill(row.d.fs)}</td>
      </tr>) : <tr><td colSpan={9}><div className="empty">{leads.length ? "No leads match this filter." : "No leads yet. Use Add lead to create the first one."}</div></td></tr>}</tbody>
    </table></div>
  </>;

  const renderLog = () => {
    const ordered = [...log].sort((a, b) => b.date.localeCompare(a.date));
    return <>
      {header("Follow-up log", "Every touchpoint. Last contact and next follow-up update on the lead.")}
      <form className="panel log-form" onSubmit={saveLog}>
        <div className="fgrid log-grid">
          <label className="f">Date<input type="date" required value={logDraft.date} onChange={(event) => setLogDraft({ ...logDraft, date: event.target.value })}/></label>
          <label className="f">Lead<select required value={logDraft.leadId} onChange={(event) => setLogDraft({ ...logDraft, leadId: event.target.value })}><option value=""/>{rows.map((row) => <option value={row.id} key={row.id}>{row.id} · {row.company || row.title}</option>)}</select></label>
          <label className="f">Contact type<select value={logDraft.type} onChange={(event) => setLogDraft({ ...logDraft, type: event.target.value })}>{settings.contactTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
          <label className="f">Next step<input value={logDraft.next} onChange={(event) => setLogDraft({ ...logDraft, next: event.target.value })}/></label>
          <label className="f full">Summary / outcome<input value={logDraft.summary} onChange={(event) => setLogDraft({ ...logDraft, summary: event.target.value })}/></label>
        </div><div className="row end"><button className="btn primary">Add to log</button></div>
      </form>
      <div className="tw"><table><thead><tr>{["Date", "Lead", "Type", "Summary / outcome", "Next step", ""].map((value, index) => <th key={`${value}-${index}`}>{value}</th>)}</tr></thead>
        <tbody>{ordered.length ? ordered.map((entry) => <tr key={entry.id}><td className="mono">{formatDate(entry.date, true)}</td><td><span className="mono muted">{entry.leadId}</span><br/>{leadName(entry.leadId)}{entry.createdBy && <><br/><span className="muted byline">Logged by {entry.createdBy}</span></>}</td>
          <td>{entry.type}</td><td>{entry.summary}</td><td>{entry.next}</td><td><button className="btn small danger" onClick={() => deleteLog(entry)}>Delete</button></td></tr>) : <tr><td colSpan={6}><div className="empty">Nothing logged yet. Add a contact above.</div></td></tr>}</tbody>
      </table></div>
    </>;
  };

  const renderExport = () => <>
    {header("Task export", `Leads due within ${settings.exportWindow} day(s) that are not yet synced`,
      exportRows.length > 0 && <><button className="btn" onClick={downloadCsv}>Copy / save CSV</button><button className="btn primary" onClick={async () => {
        for (const row of exportRows) await saveSynced(row.lead);
      }}>Mark all synced</button></>)}
    {exportRows.length ? <>
      <div className="tw export-table"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}<th/></tr></thead>
        <tbody>{exportRows.map((row) => <tr key={row["Lead ID"]}>{columns.map((column) => <td className={column === "Due Date" ? "mono" : ""} key={column}>{column === "Due Date" ? formatDate(row[column], true) : row[column]}</td>)}
          <td><button className="btn small" onClick={() => saveSynced(row.lead)}>Mark synced</button></td></tr>)}</tbody>
      </table></div>
      <label className="f csv-label">CSV preview<textarea className="csv" readOnly value={[columns.map(csvValue).join(","), ...exportRows.map((row) => columns.map((column) => csvValue(row[column as keyof typeof row])).join(","))].join("\n")}/></label>
    </> : <div className="empty"><h3>Nothing to export</h3><p>No lead is due within the export window, or every due lead is already marked synced.</p></div>}
  </>;

  const updateSettingsList = (key: "platforms" | "profiles" | "contactTypes", value: string) =>
    setSettingsDraft((previous) => ({ ...previous, [key]: value.split("\n").map((item) => item.trim()).filter(Boolean) }));

  const renderSettings = () => <>
    {header("Settings", "Cadence is the number of days after the last contact.", currentUser?.role === "manager" && <button className="btn primary" onClick={saveSettings}>Save settings</button>)}
    <div className="grid settings-grid">
      <section className="panel"><h3>Statuses and cadence</h3><div className="srow muted setting-heading"><span>Status</span><span>Days</span><span>Active</span></div>
        {settingsDraft.statuses.map((item, index) => <div className="srow" key={`${item.name}-${index}`}>
          <input disabled={currentUser?.role !== "manager"} value={item.name} aria-label="Status name" onChange={(event) => setSettingsDraft((previous) => ({ ...previous, statuses: previous.statuses.map((status, at) => at === index ? { ...status, name: event.target.value } : status) }))}/>
          <input disabled={currentUser?.role !== "manager"} type="number" min="0" value={item.cadence} aria-label="Cadence in days" onChange={(event) => setSettingsDraft((previous) => ({ ...previous, statuses: previous.statuses.map((status, at) => at === index ? { ...status, cadence: Math.max(0, Number(event.target.value)) } : status) }))}/>
          <input disabled={currentUser?.role !== "manager"} type="checkbox" checked={item.active} aria-label="Active" onChange={(event) => setSettingsDraft((previous) => ({ ...previous, statuses: previous.statuses.map((status, at) => at === index ? { ...status, active: event.target.checked } : status) }))}/>
        </div>)}
        <p className="muted note">Inactive statuses count as closed. Renaming a status does not rename it on existing leads.</p>
      </section>
      <section className="panel slist"><h3>Lists and windows</h3>
        <label className="f">Platforms (one per line)<textarea disabled={currentUser?.role !== "manager"} rows={5} value={settingsDraft.platforms.join("\n")} onChange={(event) => updateSettingsList("platforms", event.target.value)}/></label>
        <label className="f">Profiles (one per line)<textarea disabled={currentUser?.role !== "manager"} rows={3} value={settingsDraft.profiles.join("\n")} onChange={(event) => updateSettingsList("profiles", event.target.value)}/></label>
        <label className="f">Contact types (one per line)<textarea disabled={currentUser?.role !== "manager"} rows={5} value={settingsDraft.contactTypes.join("\n")} onChange={(event) => updateSettingsList("contactTypes", event.target.value)}/></label>
        <div className="fgrid"><label className="f">Export window (days)<input disabled={currentUser?.role !== "manager"} type="number" min="0" value={settingsDraft.exportWindow} onChange={(event) => setSettingsDraft({ ...settingsDraft, exportWindow: Math.max(0, Number(event.target.value)) })}/></label>
          <label className="f">“This week” window (days)<input disabled={currentUser?.role !== "manager"} type="number" min="1" value={settingsDraft.weekWindow} onChange={(event) => setSettingsDraft({ ...settingsDraft, weekWindow: Math.max(1, Number(event.target.value)) })}/></label>
          <label className="f full">Task project / list name<input disabled={currentUser?.role !== "manager"} value={settingsDraft.project} onChange={(event) => setSettingsDraft({ ...settingsDraft, project: event.target.value })}/></label>
        </div>
      </section>
    </div>
    {currentUser?.role === "manager" && <p className="muted note">Only managers can change shared settings.</p>}
    <section className="panel password-panel"><h3>Change your password</h3>
      <form className="password-form" onSubmit={changePassword}>
        <label className="f">Current password<input name="currentPassword" type="password" autoComplete="current-password" required/></label>
        <label className="f">New password<input name="newPassword" type="password" autoComplete="new-password" minLength={12} required/></label>
        <button className="btn">Update password</button>
      </form>
      <p className="muted note">Use at least 12 characters with uppercase, lowercase, and a number.</p>
    </section>
  </>;

  const renderTeam = () => {
    const sortedTeam = [...team].sort((a, b) => a.name.localeCompare(b.name));
    const ownedRows = (userId: string) => rows.filter((lead) => lead.ownerId === userId);
    return <>
      {header("Team", "Shared visibility across your team. Members can access only their own leads.", <span className="role-chip">MANAGER VIEW</span>)}
      <div className="team-summary">
        <div className="team-summary-card"><span>TEAM MEMBERS</span><b>{team.filter((member) => member.role === "member").length}</b><small>with member access</small></div>
        <div className="team-summary-card"><span>TEAM LEADS</span><b>{rows.length}</b><small>visible to managers</small></div>
        <div className="team-summary-card"><span>NEED ATTENTION</span><b>{rows.filter((lead) => lead.d.fs === "Overdue" || lead.d.fs === "Due Today").length}</b><small>overdue or due today</small></div>
      </div>
      <section className="panel team-panel">
        <div className="section-heading"><div><span className="section-kicker">ACCOUNT ACCESS</span><h3>People and ownership</h3></div></div>
        {team.length ? <div className="team-table-wrap"><table className="team-table"><thead><tr><th>Teammate</th><th>Role</th><th>Leads</th><th>Overdue</th><th>Recently added</th></tr></thead>
          <tbody>{sortedTeam.map((member) => {
            const memberRows = ownedRows(member.id);
            const overdueCount = memberRows.filter((lead) => lead.d.fs === "Overdue").length;
            return <tr key={member.id}>
              <td><span className="member-avatar">{member.name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span className="member-identity"><b>{member.name}{member.id === currentUser?.id ? " (you)" : ""}</b><small>{member.email}</small></span></td>
              <td><select className="role-select" aria-label={`Role for ${member.name}`} value={member.role} disabled={member.id === currentUser?.id} onChange={(event) => changeRole(member, event.target.value as User["role"])}>
                <option value="member">Member</option><option value="manager">Manager</option>
              </select></td>
              <td><b className="team-number">{memberRows.length}</b></td>
              <td><span className={overdueCount ? "overdue-count" : "team-number"}>{overdueCount}</span></td>
              <td className="muted">{member.created_at ? formatDate(member.created_at.slice(0, 10), true) : "—"}</td>
            </tr>;
          })}</tbody>
        </table></div> : <div className="empty">No accounts registered yet.</div>}
        <p className="team-footnote">New registrations start as members. Promote trusted teammates to manager here. Leads created before team sign-in are not assigned to a member; managers can still view them.</p>
      </section>
    </>;
  };

  const guide = [
    ["Add a lead", "Use Add lead on the Dashboard or Leads tab. Fill in a title or company and the lead details."],
    ["Log every touchpoint", "Use Follow-up log to record contact dates, types, outcomes, and next steps."],
    ["Follow-up date", "The next date is the last contact plus the cadence for the lead’s status. Set a date override when needed."],
    ["Work the list", "Statuses are grouped into Overdue, Due today, This week, Upcoming, Needs date, and Closed."],
    ["Task export", "Copy the CSV into your task manager, then mark imported tasks as synced to avoid duplicates."],
    ["Audit trail", "Lead and log records show who created them and who most recently edited them."]
  ];
  const renderGuide = () => <>{header("Guide", "How this tracker works")}<div className="guide">{guide.map(([title, content]) => <section key={title}><h3>{title}</h3><p>{content}</p></section>)}</div></>;

  const activeView = {
    dashboard: renderDashboard,
    leads: renderLeads,
    log: renderLog,
    export: renderExport,
    settings: renderSettings,
    guide: renderGuide,
    team: currentUser?.role === "manager" ? renderTeam : renderDashboard
  }[tab]();

  return <div className="shell">
  <aside className="rail">
    <div className="brand"><h1>Lead Follow-up Tracker</h1><p>As of {formatDate(today(), true)}</p></div>
    <nav className="tabs" aria-label="Sections">{tabs.filter((item) => item.id !== "team" || currentUser?.role === "manager").map((item) => {
      const count = item.id === "leads" ? rows.length : item.id === "log" ? log.length : item.id === "export" ? exportRows.length : null;
      return <button key={item.id} className="tab" aria-current={tab === item.id ? "page" : undefined} onClick={() => changeTab(item.id)}>
        <span>{item.label}</span>{count !== null && <span className="n">{count}</span>}
      </button>;
    })}</nav>
    {currentUser && <div className="account-block"><span className="account-avatar">{currentUser.name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
      <span className="account-copy"><b>{currentUser.name}</b><small>{currentUser.email}</small><i>{currentUser.role}</i></span>
      <button className="signout-button" onClick={logout} aria-label="Sign out" title="Sign out">↪</button>
    </div>}
  </aside>
    <main>
      {loadError ? <div className="banner error-banner">Could not load tracker: {loadError}. Check PostgreSQL and DATABASE_URL, then reload.</div> : null}
      {loading ? <div className="empty">Loading your tracker…</div> : activeView}
    </main>

    {leadEditor !== undefined && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setLeadEditor(undefined); }}>
      <form className="drawer" onSubmit={saveLead}>
        <div className="row drawer-heading"><h3>{leadEditor ? leadEditor.company || leadEditor.title || leadEditor.id : "New lead"}</h3>{leadEditor && <span className="mono muted">{leadEditor.id}</span>}</div>
        <div className="fgrid">
          <label className="f full">Job title<input name="title" defaultValue={leadEditor?.title || ""}/></label>
          <label className="f">Company<input name="company" defaultValue={leadEditor?.company || ""}/></label>
          <label className="f">Contact / client<input name="contact" defaultValue={leadEditor?.contact || ""}/></label>
          <label className="f">Platform<select name="platform" defaultValue={leadEditor?.platform || ""}><option value=""/>{settings.platforms.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="f">Profile<select name="profile" defaultValue={leadEditor?.profile || ""}><option value=""/>{settings.profiles.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="f">Status<select name="status" defaultValue={leadEditor?.status || settings.statuses[0]?.name}>{settings.statuses.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>
          <label className="f">Priority<select name="priority" defaultValue={leadEditor?.priority || "Medium"}>{PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="f">Contact link / email<input name="link" defaultValue={leadEditor?.link || ""}/></label>
          <label className="f">Compensation / terms<input name="terms" defaultValue={leadEditor?.terms || ""}/></label>
          <label className="f">Date added<input type="date" name="dateAdded" defaultValue={leadEditor?.dateAdded || today()}/></label>
          <label className="f">Next follow-up override<input type="date" name="override" defaultValue={leadEditor?.override || ""}/></label>
          <label className="f full">Job summary / JD link<textarea name="summary" defaultValue={leadEditor?.summary || ""}/></label>
          <label className="f full">Remarks<textarea name="remarks" defaultValue={leadEditor?.remarks || ""}/></label>
          <label className="f full">Task link<input name="taskLink" defaultValue={leadEditor?.taskLink || ""}/></label>
        </div>
        {leadEditor && (() => {
          const detail = rows.find((item) => item.id === leadEditor.id);
          return <div className="auto">
            <span>Last contact<b>{formatDate(detail?.d.last, true) || "—"}</b></span>
            <span>Follow-ups logged<b>{detail?.d.count ?? 0}</b></span>
            <span>Next follow-up<b>{formatDate(detail?.d.next, true) || "—"}</b></span>
            <span>Status<b>{detail?.d.fs}</b></span>
            <span>Added by<b>{leadEditor.createdBy || "—"}</b></span>
            <span>Edited by<b>{leadEditor.updatedBy || "—"}</b></span>
          </div>;
        })()}
        <div className="row end drawer-actions">
          <button type="button" className="btn" onClick={() => setLeadEditor(undefined)}>Cancel</button>
          {leadEditor && <button type="button" className="btn danger" onClick={() => deleteLead(leadEditor)}>Delete</button>}
          {leadEditor && <button type="button" className="btn" onClick={() => { setLogLead(leadEditor.id); setLogDraft({ ...logDraft, leadId: leadEditor.id }); setLeadEditor(undefined); changeTab("log"); }}>Log a contact</button>}
          <button className="btn primary">Save</button>
        </div>
      </form>
    </div>}

    {importOpen && <div className="overlay" onMouseDown={(event) => { if (!importing && event.target === event.currentTarget) setImportOpen(false); }}>
      <section className="drawer import-drawer"><div className="row drawer-heading"><h3>Import leads</h3><span className="mono muted">{leads.length} leads</span></div>
        <p className="muted">Choose a .xlsx, .xls, or .csv file, or paste CSV below. Include a header row with a Job Title or Company column. The first worksheet is used.</p>
        <label className="f">Spreadsheet or CSV file<input ref={importFileInput} type="file" accept=".xlsx,.xls,.csv" disabled={importing} onChange={(event) => { setImportFile(event.target.files?.[0] ?? null); setCsvText(""); setImportError(""); }}/></label>
        {importFile && <p className="muted">Selected: {importFile.name}</p>}
        <label className="f">Or paste CSV data<textarea className="import-text" disabled={importing} value={csvText} onChange={(event) => { setCsvText(event.target.value); setImportFile(null); if (importFileInput.current) importFileInput.current.value = ""; setImportError(""); }} placeholder={'title,company,contact,platform,profile,status,priority\nSenior Product Engineer,Acme Labs,Jane,LinkedIn,Product,Contacted / Applied,High'}/></label>
        {importError && <p role="alert" className="error-banner import-error">{importError}</p>}
        <div className="row end drawer-actions"><button className="btn" disabled={importing} onClick={() => setImportOpen(false)}>Cancel</button><button className="btn primary" disabled={importing || (!importFile && !csvText.trim())} onClick={importCsv}>{importing ? "Importing…" : "Import"}</button></div>
      </section>
    </div>}
    {toast && <div role="status" className="toast">{toast}</div>}
  </div>;
}
