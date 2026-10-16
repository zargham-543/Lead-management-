"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
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
type Tab = "dashboard" | "leads" | "log" | "export" | "settings" | "guide";
type LeadForm = Omit<Lead, "id" | "createdBy" | "updatedBy">;

const tabs: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "leads", label: "Leads" },
  { id: "log", label: "Follow-up log" },
  { id: "export", label: "Task export" },
  { id: "settings", label: "Settings" },
  { id: "guide", label: "Guide" }
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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
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

  const aliases: Record<string, string> = {
    title: "title",
    jobtitle: "title",
    company: "company",
    contact: "contact",
    client: "contact",
    platform: "platform",
    profile: "profile",
    status: "status",
    priority: "priority",
    link: "link",
    url: "link",
    email: "link",
    terms: "terms",
    compensation: "terms",
    dateadded: "dateAdded",
    date: "dateAdded",
    nextfollowupoverride: "override",
    override: "override",
    jobsummary: "summary",
    summary: "summary",
    remarks: "remarks",
    tasklink: "taskLink",
    task: "taskLink"
  };
  const headers = rows[0].map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return rows.slice(1).map((values) => {
    const lead: Record<string, string> = {};
    headers.forEach((header, index) => {
      const key = aliases[header];
      if (key && values[index]) lead[key] = values[index];
    });
    if (!lead.title && !lead.company) return null;
    return lead;
  }).filter((lead): lead is Record<string, string> => lead !== null);
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
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [leadEditor, setLeadEditor] = useState<Lead | null | undefined>(undefined);
  const [logLead, setLogLead] = useState("");
  const [csvText, setCsvText] = useState("");
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
    const savedName = window.localStorage.getItem("leadTrackerUser");
    setActor(savedName || "");
    const initialTab = window.location.hash.slice(1) as Tab;
    if (tabs.some((item) => item.id === initialTab)) setTab(initialTab);
    refresh()
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : "Could not load tracker data."))
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
      (!needle || [row.company, row.title, row.contact, row.id, row.remarks].join(" ").toLowerCase().includes(needle))
    ).sort((a, b) => (order[a.d.fs] - order[b.d.fs]) || a.d.next.localeCompare(b.d.next));
  }, [rows, query, statusFilter]);

  const mutate = async (path: string, method: string, data?: unknown, id?: string) => {
    if (!actor.trim()) throw new Error("Enter your name before saving changes.");
    await api(path, {
      method,
      body: JSON.stringify({ actor: actor.trim(), ...(id ? { id } : {}), ...(data === undefined ? {} : { data }) })
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
    let imported: Record<string, string>[];
    try {
      imported = parseCsv(csvText);
      if (!imported.length) throw new Error("No rows contain a lead title or company.");
      if (!actor.trim()) throw new Error("Enter your name before importing.");
      for (const lead of imported) {
        await mutate("/api/leads", "POST", {
          ...lead,
          status: lead.status || "New Lead",
          priority: lead.priority || "Medium",
          platform: lead.platform || "Other",
          profile: lead.profile || settings.profiles[0] || "",
          dateAdded: lead.dateAdded || today()
        });
      }
      setCsvText("");
      setImportOpen(false);
      notify(`${imported.length} lead${imported.length === 1 ? "" : "s"} imported`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not import CSV.");
    }
  };

  const changeTab = (value: Tab) => {
    setTab(value);
    window.history.replaceState(null, "", `#${value}`);
    window.scrollTo(0, 0);
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
    if (!rows.length) return <>{header("Dashboard")}<div className="empty"><h3>No leads yet</h3><p>Add your first lead and follow-ups will appear here.</p>{addButton}</div></>;
    const counts = (key: string) => rows.filter((row) => row.d.fs === key).length;
    const activeRows = rows.filter((row) => row.d.active);
    const kpis = [
      ["Active leads", activeRows.length], ["Overdue", counts("Overdue")], ["Due today", counts("Due Today")],
      ["Due this week", counts("This Week")], ["Need a date", counts("Needs date")], ["Tasks to export", exportRows.length]
    ];
    const work = rows.filter((row) => ["Overdue", "Due Today", "This Week"].includes(row.d.fs))
      .sort((a, b) => a.d.next.localeCompare(b.d.next));
    const max = Math.max(1, ...settings.statuses.map((item) => rows.filter((row) => row.status === item.name).length));
    const listCounts = (values: string[], key: "platform" | "profile") => values.map((value) => (
      <div className="cnt" key={value}><span>{value}</span><b>{activeRows.filter((row) => row[key] === value).length}</b></div>
    ));
    return <>
      {header("Dashboard", "Everything updates as you edit leads and log contacts.", addButton)}
      <div className="kpis">{kpis.map(([label, value]) => (
        <div className={`kpi ${label === "Overdue" && Number(value) > 0 ? "hot" : ""}`} key={label}><b>{value}</b><span>{label}</span></div>
      ))}</div>
      <div className="grid">
        <div className="stack">
          <section className="panel"><h3>Follow-ups to work</h3>
            {work.length ? <div className="tw inner-table"><table><tbody>{work.map((row) => (
              <tr className="click" key={row.id} onClick={() => setLeadEditor(row)}>
                <td>{pill(row.d.fs)}</td><td><b>{row.company}</b><br/><span className="muted">{row.title}</span></td>
                <td className="mono">{formatDate(row.d.next)}<br/><span className="muted">{row.d.days === 0 ? "today" : row.d.days! < 0 ? `${Math.abs(row.d.days!)}d late` : `in ${row.d.days}d`}</span></td>
                <td>{row.priority === "High" ? <span className="hi">High</span> : row.priority}</td>
              </tr>
            ))}</tbody></table></div> : <p className="muted">Nothing due in the next {settings.weekWindow} days.</p>}
          </section>
          <section className="panel"><h3>By platform and profile (active)</h3><div className="two"><div>{listCounts(settings.platforms, "platform")}</div><div>{listCounts(settings.profiles, "profile")}</div></div></section>
        </div>
        <section className="panel"><h3>Pipeline by status</h3>
          {settings.statuses.map((item) => {
            const count = rows.filter((row) => row.status === item.name).length;
            return <div className={`bar ${count ? "" : "zero"}`} key={item.name}><span className="l">{item.name}</span><span className="t"><i style={{ width: `${count / max * 100}%` }}/></span><span className="v">{count}</span></div>;
          })}
          <div className="cnt total"><span>Total</span><b>{rows.length}</b></div>
        </section>
      </div>
    </>;
  };

  const renderLeads = () => <>
    {header("Leads", `${filteredRows.length} shown`, <><button className="btn" onClick={() => setImportOpen(true)}>Import CSV</button>{addButton}</>)}
    <div className="tools">
      <input type="search" placeholder="Search company, title, contact" aria-label="Search leads" value={query} onChange={(event) => setQuery(event.target.value)}/>
      <select aria-label="Filter by follow-up status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
        {statuses.map((value) => <option key={value}>{value}</option>)}
      </select>
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
    {header("Settings", "Cadence is the number of days after the last contact.", <button className="btn primary" onClick={saveSettings}>Save settings</button>)}
    <div className="grid settings-grid">
      <section className="panel"><h3>Statuses and cadence</h3><div className="srow muted setting-heading"><span>Status</span><span>Days</span><span>Active</span></div>
        {settingsDraft.statuses.map((item, index) => <div className="srow" key={`${item.name}-${index}`}>
          <input value={item.name} aria-label="Status name" onChange={(event) => setSettingsDraft((previous) => ({ ...previous, statuses: previous.statuses.map((status, at) => at === index ? { ...status, name: event.target.value } : status) }))}/>
          <input type="number" min="0" value={item.cadence} aria-label="Cadence in days" onChange={(event) => setSettingsDraft((previous) => ({ ...previous, statuses: previous.statuses.map((status, at) => at === index ? { ...status, cadence: Math.max(0, Number(event.target.value)) } : status) }))}/>
          <input type="checkbox" checked={item.active} aria-label="Active" onChange={(event) => setSettingsDraft((previous) => ({ ...previous, statuses: previous.statuses.map((status, at) => at === index ? { ...status, active: event.target.checked } : status) }))}/>
        </div>)}
        <p className="muted note">Inactive statuses count as closed. Renaming a status does not rename it on existing leads.</p>
      </section>
      <section className="panel slist"><h3>Lists and windows</h3>
        <label className="f">Platforms (one per line)<textarea rows={5} value={settingsDraft.platforms.join("\n")} onChange={(event) => updateSettingsList("platforms", event.target.value)}/></label>
        <label className="f">Profiles (one per line)<textarea rows={3} value={settingsDraft.profiles.join("\n")} onChange={(event) => updateSettingsList("profiles", event.target.value)}/></label>
        <label className="f">Contact types (one per line)<textarea rows={5} value={settingsDraft.contactTypes.join("\n")} onChange={(event) => updateSettingsList("contactTypes", event.target.value)}/></label>
        <div className="fgrid"><label className="f">Export window (days)<input type="number" min="0" value={settingsDraft.exportWindow} onChange={(event) => setSettingsDraft({ ...settingsDraft, exportWindow: Math.max(0, Number(event.target.value)) })}/></label>
          <label className="f">“This week” window (days)<input type="number" min="1" value={settingsDraft.weekWindow} onChange={(event) => setSettingsDraft({ ...settingsDraft, weekWindow: Math.max(1, Number(event.target.value)) })}/></label>
          <label className="f full">Task project / list name<input value={settingsDraft.project} onChange={(event) => setSettingsDraft({ ...settingsDraft, project: event.target.value })}/></label>
        </div>
      </section>
    </div>
  </>;

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
    guide: renderGuide
  }[tab]();

  return <div className="shell">
    <aside className="rail">
      <div className="brand"><h1>Lead Follow-up Tracker</h1><p>As of {formatDate(today(), true)}</p></div>
      <nav className="tabs" aria-label="Sections">{tabs.map((item) => {
        const count = item.id === "leads" ? rows.length : item.id === "log" ? log.length : item.id === "export" ? exportRows.length : null;
        return <button key={item.id} className="tab" aria-current={tab === item.id ? "page" : undefined} onClick={() => changeTab(item.id)}>
          <span>{item.label}</span>{count !== null && <span className="n">{count}</span>}
        </button>;
      })}</nav>
      <label className="f user-field">Your name<input value={actor} placeholder="Enter your name" onChange={(event) => {
        setActor(event.target.value);
        window.localStorage.setItem("leadTrackerUser", event.target.value);
      }}/></label>
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

    {importOpen && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setImportOpen(false); }}>
      <section className="drawer import-drawer"><div className="row drawer-heading"><h3>Import leads from CSV</h3><span className="mono muted">{leads.length} leads</span></div>
        <p className="muted">Include a header row. Supported fields: title, company, contact, platform, profile, status, priority, link, terms, dateAdded, override, summary, remarks, taskLink.</p>
        <label className="f">CSV data<textarea className="import-text" value={csvText} onChange={(event) => setCsvText(event.target.value)} placeholder={'title,company,contact,platform,profile,status,priority\nSenior Product Engineer,Acme Labs,Jane,LinkedIn,Product,Contacted / Applied,High'}/></label>
        <div className="row end drawer-actions"><button className="btn" onClick={() => setImportOpen(false)}>Cancel</button><button className="btn primary" onClick={importCsv}>Import</button></div>
      </section>
    </div>}
    {toast && <div role="status" className="toast">{toast}</div>}
  </div>;
}
