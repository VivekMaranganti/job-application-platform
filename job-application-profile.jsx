import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Upload, X, FileText, Plus, Check, RotateCcw, ShieldCheck, Sparkles, Loader2,
  MapPin, Briefcase, DollarSign, Clock, ChevronDown, ChevronUp, Building2, Eye,
} from "lucide-react";
import mammoth from "mammoth";

/* ---------------------------------------------------------
   Design notes (dossier / case-file system)
   - Paper base, ink text, deep-ledger-green primary accent
   - Bronze "manual" stamp vs green "auto" stamp
   - Tabs rendered as physical folder tabs
   - Fraunces (display) + Inter (body) + IBM Plex Mono (data/labels)
--------------------------------------------------------- */

const FONT_LINK_ID = "dossier-fonts";
function useFonts() {
  useEffect(() => {
    if (document.getElementById(FONT_LINK_ID)) return;
    const link = document.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap";
    document.head.appendChild(link);
  }, []);
}

const LEVELS = [
  "Entry level",
  "Mid level",
  "Senior",
  "Staff / Principal",
  "Manager",
  "Director",
  "Executive / VP",
];

const WORK_ARRANGEMENTS = ["Remote", "Hybrid", "Onsite"];
const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Internship"];
const COMPANY_SIZES = ["Startup (1–50)", "Small–mid (51–500)", "Large (501–5,000)", "Enterprise (5,000+)"];
const DATE_POSTED_OPTIONS = ["Any time", "Past 24 hours", "Past week", "Past month"];

const RACE_OPTIONS = [
  "American Indian or Alaska Native",
  "Asian",
  "Black or African American",
  "Hispanic or Latino",
  "Native Hawaiian or Other Pacific Islander",
  "White",
  "Two or more races",
  "Prefer not to answer",
];

const REQUIRED_FIELDS = [
  {
    id: "work_auth",
    label: "Work authorization",
    question: "Are you legally authorized to work in the country where this position is located?",
    type: "yesno",
  },
  {
    id: "sponsorship",
    label: "Visa sponsorship",
    question: "Will you now or in the future require sponsorship for employment visa status?",
    type: "yesno",
  },
  {
    id: "veteran",
    label: "Veteran status",
    question: "Please indicate your veteran status.",
    type: "select",
    options: ["Not a protected veteran", "Identify as a protected veteran", "Prefer not to answer"],
  },
  {
    id: "disability",
    label: "Disability status",
    question: "Please indicate your disability status.",
    type: "select",
    options: ["Yes, I have a disability", "No, I do not have a disability", "Prefer not to answer"],
  },
  {
    id: "race_ethnicity",
    label: "Race / ethnicity",
    question: "Voluntary self-identification of race or ethnicity.",
    type: "select",
    options: RACE_OPTIONS,
  },
  {
    id: "gender",
    label: "Gender identity",
    question: "Voluntary self-identification of gender.",
    type: "select",
    options: ["Male", "Female", "Non-binary", "Prefer not to answer"],
  },
  {
    id: "security_clearance",
    label: "Security clearance",
    question: "Do you currently hold a government security clearance?",
    type: "select",
    options: ["None", "Active clearance", "Inactive clearance", "Eligible for clearance"],
  },
  {
    id: "criminal_history",
    label: "Criminal history",
    question:
      "Some applications ask about criminal history. Rules on what may be asked, and when, vary by state and city.",
    type: "text",
    caution:
      "Because the legality of this question depends on where the job is located, we recommend answering it yourself on each application.",
  },
];

// ---------------------------------------------------------
// Mock job listings — stand-ins for what real ATS connectors
// (Greenhouse / Lever / Ashby feeds) would return. Each carries
// a sourceConnector so it's clear where it would come from.
// ---------------------------------------------------------
const MOCK_JOBS = [
  { id: "j1", title: "Senior Product Manager", company: "Northwind Analytics", location: "Austin, TX", remote: "Hybrid", employmentType: "Full-time", level: "Senior", salaryMin: 140000, salaryMax: 175000, companySize: "Small–mid (51–500)", industry: "Software", datePosted: daysAgo(2), sourceConnector: "Greenhouse" },
  { id: "j2", title: "Product Manager, Growth", company: "Fernwood Health", location: "Remote", remote: "Remote", employmentType: "Full-time", level: "Mid level", salaryMin: 115000, salaryMax: 135000, companySize: "Large (501–5,000)", industry: "Healthcare", datePosted: daysAgo(5), sourceConnector: "Lever" },
  { id: "j3", title: "Staff Product Manager", company: "Cascade Robotics", location: "Austin, TX", remote: "Onsite", employmentType: "Full-time", level: "Staff / Principal", salaryMin: 170000, salaryMax: 205000, companySize: "Startup (1–50)", industry: "Robotics", datePosted: daysAgo(1), sourceConnector: "Ashby" },
  { id: "j4", title: "Associate Product Manager", company: "Fernwood Health", location: "Remote", remote: "Remote", employmentType: "Full-time", level: "Entry level", salaryMin: 85000, salaryMax: 100000, companySize: "Large (501–5,000)", industry: "Healthcare", datePosted: daysAgo(20), sourceConnector: "Lever" },
  { id: "j5", title: "Product Marketing Manager", company: "Northwind Analytics", location: "Austin, TX", remote: "Hybrid", employmentType: "Contract", level: "Mid level", salaryMin: 90000, salaryMax: 110000, companySize: "Small–mid (51–500)", industry: "Software", datePosted: daysAgo(9), sourceConnector: "Greenhouse" },
  { id: "j6", title: "Director of Product", company: "Halcyon Freight", location: "Dallas, TX", remote: "Onsite", employmentType: "Full-time", level: "Director", salaryMin: 190000, salaryMax: 230000, companySize: "Enterprise (5,000+)", industry: "Logistics", datePosted: daysAgo(3), sourceConnector: "Workday" },
  { id: "j7", title: "Senior Product Manager, Platform", company: "Ridgeline Data", location: "Remote", remote: "Remote", employmentType: "Full-time", level: "Senior", salaryMin: 150000, salaryMax: 180000, companySize: "Small–mid (51–500)", industry: "Software", datePosted: daysAgo(1), sourceConnector: "Ashby" },
  { id: "j8", title: "Product Manager Intern", company: "Cascade Robotics", location: "Austin, TX", remote: "Onsite", employmentType: "Internship", level: "Internship", salaryMin: null, salaryMax: null, companySize: "Startup (1–50)", industry: "Robotics", datePosted: daysAgo(6), sourceConnector: "Ashby" },
];

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function datePostedCutoff(option) {
  const now = new Date();
  if (option === "Past 24 hours") return new Date(now - 1 * 86400000);
  if (option === "Past week") return new Date(now - 7 * 86400000);
  if (option === "Past month") return new Date(now - 30 * 86400000);
  return null;
}

// Returns { matched: [{job, reasons}], filtered: [{job, reasons}] }
function matchJobs(jobs, { locations, levels, titles, filters }) {
  const cutoff = datePostedCutoff(filters.datePosted);
  const locLower = locations.map((l) => l.toLowerCase());
  const wantsRemote = locLower.some((l) => l.includes("remote") || l.includes("anywhere"));
  const titleLower = titles.map((t) => t.toLowerCase());

  const matched = [];
  const filtered = [];

  jobs.forEach((job) => {
    const reasonsFor = [];
    const reasonsAgainst = [];

    // Location
    if (locations.length === 0) {
      reasonsFor.push("No location filter set");
    } else {
      const locMatch = locLower.some((l) => job.location.toLowerCase().includes(l)) || (wantsRemote && job.remote === "Remote");
      if (locMatch) reasonsFor.push(`Location: ${job.location}`);
      else reasonsAgainst.push(`Location (${job.location}) doesn't match your list`);
    }

    // Level
    if (levels.length === 0) {
      // no constraint
    } else if (levels.includes(job.level)) {
      reasonsFor.push(`Level: ${job.level}`);
    } else {
      reasonsAgainst.push(`Level (${job.level}) not in your selected levels`);
    }

    // Titles / keywords
    if (titleLower.length === 0) {
      // no constraint
    } else {
      const titleMatch = titleLower.some((t) => job.title.toLowerCase().includes(t));
      if (titleMatch) reasonsFor.push("Matches a target title");
      else reasonsAgainst.push("Title doesn't match your target titles");
    }

    // Work arrangement
    if (filters.workArrangement.length > 0) {
      if (filters.workArrangement.includes(job.remote)) reasonsFor.push(`Work style: ${job.remote}`);
      else reasonsAgainst.push(`Work style (${job.remote}) not selected`);
    }

    // Employment type
    if (filters.employmentType.length > 0) {
      if (filters.employmentType.includes(job.employmentType)) reasonsFor.push(`Type: ${job.employmentType}`);
      else reasonsAgainst.push(`Employment type (${job.employmentType}) not selected`);
    }

    // Company size
    if (filters.companySize.length > 0) {
      if (filters.companySize.includes(job.companySize)) reasonsFor.push(`Company size: ${job.companySize}`);
      else reasonsAgainst.push("Company size not selected");
    }

    // Salary
    if (filters.salaryMin) {
      const min = parseInt(filters.salaryMin, 10);
      if (job.salaryMax == null) {
        reasonsAgainst.push("Salary not listed");
      } else if (job.salaryMax >= min) {
        reasonsFor.push(`Salary up to $${job.salaryMax.toLocaleString()}`);
      } else {
        reasonsAgainst.push(`Salary below your $${min.toLocaleString()} minimum`);
      }
    }

    // Date posted
    if (cutoff) {
      if (new Date(job.datePosted) >= cutoff) reasonsFor.push("Recently posted");
      else reasonsAgainst.push("Posted before your date range");
    }

    // Industries
    if (filters.industries.length > 0) {
      if (filters.industries.includes(job.industry)) reasonsFor.push(`Industry: ${job.industry}`);
      else reasonsAgainst.push(`Industry (${job.industry}) not selected`);
    }

    // Excluded companies
    if (filters.excludeCompanies.some((c) => c.toLowerCase() === job.company.toLowerCase())) {
      reasonsAgainst.push("Company is on your exclude list");
    }

    if (reasonsAgainst.length === 0) {
      matched.push({ job, reasons: reasonsFor });
    } else {
      filtered.push({ job, reasons: reasonsAgainst });
    }
  });

  return { matched, filtered };
}

function Stamp({ mode }) {
  const isAuto = mode === "auto";
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: "0.12em",
        fontWeight: 500, padding: "3px 8px", borderRadius: 3,
        border: `1.5px solid ${isAuto ? "#2F5D50" : "#8A6D3B"}`,
        color: isAuto ? "#2F5D50" : "#8A6D3B", transform: "rotate(-2deg)",
        textTransform: "uppercase", userSelect: "none",
        background: isAuto ? "rgba(47,93,80,0.06)" : "rgba(138,109,59,0.08)",
      }}
    >
      {isAuto ? <ShieldCheck size={11} /> : <RotateCcw size={11} />}
      {isAuto ? "Auto" : "Manual"}
    </span>
  );
}

function Chip({ text, onRemove }) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, background: "#FFFFFF",
        border: "1px solid #DAD6CC", borderRadius: 999, padding: "5px 8px 5px 12px",
        fontSize: 13.5, color: "#1B1E23", fontFamily: "'Inter', sans-serif",
      }}
    >
      {text}
      <button
        onClick={onRemove}
        aria-label={`Remove ${text}`}
        style={{
          border: "none", background: "#F1EFE8", borderRadius: "50%", width: 18, height: 18,
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#6B6555",
        }}
      >
        <X size={11} />
      </button>
    </span>
  );
}

function ChipInput({ items, setItems, placeholder }) {
  const [value, setValue] = useState("");
  const addItem = () => {
    const v = value.trim();
    if (v && !items.includes(v)) setItems([...items, v]);
    setValue("");
  };
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: items.length ? 10 : 0 }}>
        {items.map((it) => (
          <Chip key={it} text={it} onRemove={() => setItems(items.filter((x) => x !== it))} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); addItem(); }
          }}
          placeholder={placeholder}
          style={inputStyle}
        />
        <button onClick={addItem} style={smallAddButtonStyle} aria-label="Add">
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

function ToggleGroup({ options, selected, onToggle }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            onClick={() => onToggle(opt)}
            style={{
              fontFamily: "'Inter', sans-serif", fontSize: 13.5, padding: "8px 14px", borderRadius: 999,
              border: active ? "1px solid #2F5D50" : "1px solid #DAD6CC",
              background: active ? "#2F5D50" : "#FFFFFF", color: active ? "#FAF9F5" : "#1B1E23",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {active && <Check size={13} />}
            {opt}
          </button>
        );
      })}
    </div>
  );
}

const inputStyle = {
  flex: 1, padding: "10px 12px", fontSize: 14, fontFamily: "'Inter', sans-serif",
  border: "1px solid #DAD6CC", borderRadius: 6, background: "#FFFFFF", color: "#1B1E23", outline: "none",
};

const smallAddButtonStyle = {
  border: "1px solid #2F5D50", background: "#2F5D50", color: "#FAF9F5", borderRadius: 6,
  width: 38, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
};

function SectionCard({ children }) {
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E4E0D6", borderRadius: 8, padding: "18px 20px", marginBottom: 14 }}>
      {children}
    </div>
  );
}

function Label({ children }) {
  return (
    <label
      style={{
        display: "block", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
        letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B6555", marginBottom: 8,
      }}
    >
      {children}
    </label>
  );
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

// ---------- Claude API helper ----------
async function callClaude(messageContent, maxTokens = 1000) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: messageContent }],
    }),
  });
  const data = await response.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return text;
}

function parseJsonLoose(text) {
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  return JSON.parse(cleaned);
}

async function getResumeContentBlock(resume) {
  // Returns a Claude API content block representing the resume.
  const isPdf = /\.pdf$/i.test(resume.name);
  if (isPdf) {
    const base64Data = resume.base64.split(",")[1];
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } };
  }
  // .doc / .docx — extract raw text with mammoth
  const arrayBuffer = await fetch(resume.base64).then((r) => r.arrayBuffer());
  const result = await mammoth.extractRawText({ arrayBuffer });
  return { type: "text", text: `Resume content:\n\n${result.value}` };
}

export default function JobProfileApp() {
  useFonts();

  const [tab, setTab] = useState("profile");
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState("idle");

  // Profile
  const [resume, setResume] = useState(null);
  const [locations, setLocations] = useState([]);
  const [levels, setLevels] = useState([]);
  const [titles, setTitles] = useState([]);
  const fileInputRef = useRef(null);

  // Filters
  const [salaryMin, setSalaryMin] = useState("");
  const [workArrangement, setWorkArrangement] = useState([]);
  const [employmentType, setEmploymentType] = useState([]);
  const [companySize, setCompanySize] = useState([]);
  const [industries, setIndustries] = useState([]);
  const [datePosted, setDatePosted] = useState("Any time");
  const [excludeCompanies, setExcludeCompanies] = useState([]);
  const [specialInstructions, setSpecialInstructions] = useState("");

  // Required info
  const [answers, setAnswers] = useState({});

  // Job feed / activity log
  const [jobStatuses, setJobStatuses] = useState({}); // { [jobId]: 'idle' | 'reviewing' | 'applied' }
  const [logEntries, setLogEntries] = useState([]);
  const [showFilteredOut, setShowFilteredOut] = useState(false);

  // Title derivation (inline within Required Information)
  const [titleStage, setTitleStage] = useState("idle"); // idle | loading | questions | finalizing | error | done
  const [titleError, setTitleError] = useState("");
  const [resumeSummary, setResumeSummary] = useState("");
  const [questions, setQuestions] = useState([]);
  const [questionAnswers, setQuestionAnswers] = useState({});
  const [addedTitles, setAddedTitles] = useState([]);
  const resumeBlockRef = useRef(null);

  // ---------- load ----------
  useEffect(() => {
    (async () => {
      try {
        const p = await window.storage.get("profile:data");
        if (p) {
          const d = JSON.parse(p.value);
          setLocations(d.locations || []);
          setLevels(d.levels || []);
          setTitles(d.titles || []);
        }
      } catch (e) {}
      try {
        const r = await window.storage.get("profile:resume");
        if (r) setResume(JSON.parse(r.value));
      } catch (e) {}
      try {
        const f = await window.storage.get("filters:data");
        if (f) {
          const d = JSON.parse(f.value);
          setSalaryMin(d.salaryMin || "");
          setWorkArrangement(d.workArrangement || []);
          setEmploymentType(d.employmentType || []);
          setCompanySize(d.companySize || []);
          setIndustries(d.industries || []);
          setDatePosted(d.datePosted || "Any time");
          setExcludeCompanies(d.excludeCompanies || []);
          setSpecialInstructions(d.specialInstructions || "");
        }
      } catch (e) {}
      try {
        const req = await window.storage.get("required-info:data");
        if (req) setAnswers(JSON.parse(req.value));
        else {
          const defaults = {};
          REQUIRED_FIELDS.forEach((f) => (defaults[f.id] = { mode: "manual", value: "" }));
          setAnswers(defaults);
        }
      } catch (e) {
        const defaults = {};
        REQUIRED_FIELDS.forEach((f) => (defaults[f.id] = { mode: "manual", value: "" }));
        setAnswers(defaults);
      }
      try {
        const js = await window.storage.get("jobs:statuses");
        if (js) setJobStatuses(JSON.parse(js.value));
      } catch (e) {}
      try {
        const log = await window.storage.get("activity:log");
        if (log) setLogEntries(JSON.parse(log.value));
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);

  // ---------- save (debounced) ----------
  const saveTimer = useRef(null);
  const persist = useCallback((key, value) => {
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await window.storage.set(key, JSON.stringify(value));
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1200);
      } catch (e) {
        setSaveState("idle");
      }
    }, 500);
  }, []);

  useEffect(() => { if (loaded) persist("profile:data", { locations, levels, titles }); }, [locations, levels, titles, loaded, persist]);
  useEffect(() => { if (loaded) persist("required-info:data", answers); }, [answers, loaded, persist]);
  useEffect(() => {
    if (!loaded) return;
    persist("filters:data", {
      salaryMin, workArrangement, employmentType, companySize, industries, datePosted, excludeCompanies, specialInstructions,
    });
  }, [salaryMin, workArrangement, employmentType, companySize, industries, datePosted, excludeCompanies, specialInstructions, loaded, persist]);
  useEffect(() => { if (loaded) persist("jobs:statuses", jobStatuses); }, [jobStatuses, loaded, persist]);
  useEffect(() => { if (loaded) persist("activity:log", logEntries); }, [logEntries, loaded, persist]);

  // ---------- handlers ----------
  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const record = { name: file.name, size: file.size, uploadedAt: new Date().toISOString(), base64: reader.result };
      setResume(record);
      setSaveState("saving");
      try {
        await window.storage.set("profile:resume", JSON.stringify(record));
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1200);
      } catch (e) { setSaveState("idle"); }
    };
    reader.readAsDataURL(file);
  };

  const removeResume = async () => {
    setResume(null);
    try { await window.storage.delete("profile:resume"); } catch (e) {}
  };

  const toggleLevel = (level) => setLevels((prev) => (prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]));
  const toggleFilter = (setter) => (opt) => setter((prev) => (prev.includes(opt) ? prev.filter((x) => x !== opt) : [...prev, opt]));
  const updateAnswer = (fieldId, patch) => setAnswers((prev) => ({ ...prev, [fieldId]: { ...prev[fieldId], ...patch } }));

  const setJobStatus = (jobId, status) => setJobStatuses((prev) => ({ ...prev, [jobId]: status }));

  const confirmApply = (job) => {
    const autoFields = REQUIRED_FIELDS.filter((f) => (answers[f.id] || {}).mode === "auto");
    const manualFields = REQUIRED_FIELDS.filter((f) => (answers[f.id] || {}).mode !== "auto");
    const entry = {
      id: `${job.id}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      jobTitle: job.title,
      company: job.company,
      source: job.sourceConnector,
      resumeSent: !!resume,
      fieldsSentAuto: autoFields.map((f) => f.label),
      fieldsPromptedManual: manualFields.map((f) => f.label),
      status: "Simulated — apply agent not yet connected",
    };
    setLogEntries((prev) => [entry, ...prev]);
    setJobStatus(job.id, "applied");
  };

  // ---------- title derivation flow (inline) ----------
  const startTitleDerivation = async () => {
    if (!resume) return;
    setTitleStage("loading");
    setTitleError("");
    setQuestionAnswers({});
    setAddedTitles([]);
    try {
      const resumeBlock = await getResumeContentBlock(resume);
      resumeBlockRef.current = resumeBlock;
      const prompt = {
        type: "text",
        text:
          "Analyze the attached resume for a job search tool. Respond with ONLY raw JSON (no markdown fences, no preamble) in this exact shape:\n" +
          '{"resume_summary": "one sentence describing the candidate\'s background", ' +
          '"suggested_titles": ["3-6 job titles that directly match their experience"], ' +
          '"questions": [{"question": "a clarifying question about direction/seniority/focus", "options": ["3-5 short answer options"]}]}\n' +
          "Include 2 to 4 questions that would meaningfully change which job titles to target next (e.g. individual contributor vs management track, staying in current specialty vs adjacent field, seniority level, industry focus). Keep options short (2-6 words each).",
      };
      const content = resumeBlock.type === "document" ? [resumeBlock, prompt] : [prompt, resumeBlock];
      const raw = await callClaude(content, 1000);
      const parsed = parseJsonLoose(raw);
      setResumeSummary(parsed.resume_summary || "");
      setQuestions(parsed.questions || []);
      setTitleStage("questions");
    } catch (e) {
      console.error(e);
      setTitleError("We couldn't read that resume automatically. You can try again or add titles manually.");
      setTitleStage("error");
    }
  };

  const submitTitleAnswers = async () => {
    setTitleStage("finalizing");
    try {
      const qaText = questions
        .map((q, i) => `Q: ${q.question}\nA: ${questionAnswers[i] || "(skipped)"}`)
        .join("\n\n");
      const prompt = {
        type: "text",
        text:
          "Based on the same resume and these clarifying answers, respond with ONLY raw JSON (no markdown fences) in this shape:\n" +
          '{"titles": ["5-10 recommended job titles to search for, ordered by best fit"]}\n\n' +
          `Clarifying answers:\n${qaText}`,
      };
      const resumeBlock = resumeBlockRef.current;
      const content = resumeBlock.type === "document" ? [resumeBlock, prompt] : [prompt, resumeBlock];
      const raw = await callClaude(content, 1000);
      const parsed = parseJsonLoose(raw);
      const newTitles = (parsed.titles || []).filter((t) => !titles.includes(t));
      setTitles((prev) => [...prev, ...newTitles]);
      setAddedTitles(newTitles);
      setTitleStage("done");
    } catch (e) {
      console.error(e);
      setTitleError("Something went wrong generating your title suggestions. You can try again or add titles manually.");
      setTitleStage("error");
    }
  };

  if (!loaded) {
    return (
      <div style={{ ...pageStyle, alignItems: "center", justifyContent: "center", display: "flex" }}>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#6B6555" }}>Loading dossier…</span>
      </div>
    );
  }

  const allQuestionsAnswered = questions.length > 0 && questions.every((_, i) => questionAnswers[i]);

  const { matched, filtered } = matchJobs(MOCK_JOBS, {
    locations, levels, titles,
    filters: { workArrangement, employmentType, companySize, salaryMin, datePosted, industries, excludeCompanies },
  });

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 20px 80px" }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#8A6D3B", marginBottom: 6 }}>
            Case File — Applicant Profile
          </div>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 32, color: "#1B1E23", margin: 0, letterSpacing: "-0.01em" }}>
            Your application dossier
          </h1>
          <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 14.5, color: "#6B6555", marginTop: 8, lineHeight: 1.5 }}>
            Everything here stays private to you. It's the information the search and apply agent will draw on.
          </p>
        </div>

        {/* Folder tabs */}
        <div style={{ display: "flex", gap: 4, position: "relative", zIndex: 1 }}>
          {[
            { id: "profile", label: "Profile" },
            { id: "filters", label: "Filters" },
            { id: "required", label: "Required information" },
            { id: "jobs", label: `Job feed${matched.length ? ` (${matched.length})` : ""}` },
            { id: "log", label: "Activity log" },
          ].map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, letterSpacing: "0.04em",
                  padding: "10px 18px 12px", border: "1px solid #E4E0D6",
                  borderBottom: active ? "1px solid #FFFFFF" : "1px solid #E4E0D6",
                  borderRadius: "8px 8px 0 0", background: active ? "#FFFFFF" : "#F1EFE8",
                  color: active ? "#1B1E23" : "#8B8676", cursor: "pointer", marginBottom: -1,
                  transform: active ? "translateY(0)" : "translateY(3px)", transition: "transform 120ms ease",
                }}
              >
                {t.label}
              </button>
            );
          })}
          <div style={{ flex: 1, borderBottom: "1px solid #E4E0D6", marginBottom: -1 }} />
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5,
            color: saveState === "idle" ? "transparent" : "#6B6555", alignSelf: "center",
            paddingRight: 4, minWidth: 60, textAlign: "right", transition: "color 200ms",
          }}>
            {saveState === "saving" ? "saving…" : saveState === "saved" ? "saved ✓" : ""}
          </div>
        </div>

        {/* Content panel */}
        <div style={{ border: "1px solid #E4E0D6", borderTop: "none", borderRadius: "0 0 8px 8px", background: "#FFFFFF", padding: "24px 22px" }}>
          {tab === "profile" && (
            <div>
              <Label>Resume</Label>
              <SectionCard>
                {!resume ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
                    style={{ border: "1.5px dashed #C9C3B3", borderRadius: 6, padding: "28px 16px", textAlign: "center", cursor: "pointer", color: "#6B6555" }}
                  >
                    <Upload size={20} style={{ marginBottom: 8 }} />
                    <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 14 }}>Click to upload, or drag your resume here</div>
                    <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: "#9A9484", marginTop: 4 }}>PDF or Word document</div>
                    <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files?.[0])} />
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 6, background: "#F1EFE8", display: "flex", alignItems: "center", justifyContent: "center", color: "#2F5D50", flexShrink: 0 }}>
                      <FileText size={18} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, color: "#1B1E23", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{resume.name}</div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#9A9484" }}>
                        {formatBytes(resume.size)} · uploaded {new Date(resume.uploadedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button onClick={() => fileInputRef.current?.click()} style={ghostButtonStyle}>Replace</button>
                    <button onClick={removeResume} style={ghostButtonStyle}>Remove</button>
                    <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files?.[0])} />
                  </div>
                )}
              </SectionCard>

              <Label>Locations you'll work in</Label>
              <SectionCard>
                <ChipInput items={locations} setItems={setLocations} placeholder="e.g. Austin, TX or Remote — press Enter" />
              </SectionCard>

              <Label>Position level</Label>
              <SectionCard>
                <ToggleGroup options={LEVELS} selected={levels} onToggle={toggleLevel} />
              </SectionCard>

              <Label>Target titles or keywords</Label>
              <SectionCard>
                <ChipInput items={titles} setItems={setTitles} placeholder="e.g. Product Manager — press Enter" />
                <div style={{ marginTop: 12, fontFamily: "'Inter', sans-serif", fontSize: 12.5, color: "#8B8676" }}>
                  Prefer to derive these from your resume? Head to the{" "}
                  <button onClick={() => setTab("required")} style={inlineLinkStyle}>Required information</button> tab.
                </div>
              </SectionCard>
            </div>
          )}

          {tab === "filters" && (
            <div>
              <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13.5, color: "#6B6555", marginTop: 0, marginBottom: 18, lineHeight: 1.5 }}>
                These narrow down which postings the agent surfaces and applies to.
              </p>

              <Label>Work arrangement</Label>
              <SectionCard>
                <ToggleGroup options={WORK_ARRANGEMENTS} selected={workArrangement} onToggle={toggleFilter(setWorkArrangement)} />
              </SectionCard>

              <Label>Employment type</Label>
              <SectionCard>
                <ToggleGroup options={EMPLOYMENT_TYPES} selected={employmentType} onToggle={toggleFilter(setEmploymentType)} />
              </SectionCard>

              <Label>Company size</Label>
              <SectionCard>
                <ToggleGroup options={COMPANY_SIZES} selected={companySize} onToggle={toggleFilter(setCompanySize)} />
              </SectionCard>

              <Label>Minimum salary (optional)</Label>
              <SectionCard>
                <input
                  value={salaryMin}
                  onChange={(e) => setSalaryMin(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="e.g. 90000"
                  inputMode="numeric"
                  style={inputStyle}
                />
              </SectionCard>

              <Label>Date posted</Label>
              <SectionCard>
                <ToggleGroup options={DATE_POSTED_OPTIONS} selected={[datePosted]} onToggle={(opt) => setDatePosted(opt)} />
              </SectionCard>

              <Label>Industries of interest (optional)</Label>
              <SectionCard>
                <ChipInput items={industries} setItems={setIndustries} placeholder="e.g. Healthcare — press Enter" />
              </SectionCard>

              <Label>Companies to exclude (optional)</Label>
              <SectionCard>
                <ChipInput items={excludeCompanies} setItems={setExcludeCompanies} placeholder="e.g. Acme Corp — press Enter" />
              </SectionCard>

              <Label>Special instructions</Label>
              <SectionCard>
                <textarea
                  value={specialInstructions}
                  onChange={(e) => setSpecialInstructions(e.target.value)}
                  placeholder="Anything else the agent should factor in — e.g. prioritize roles that mention sponsorship, skip anything requiring a cover letter, favor 4-day workweeks…"
                  rows={4}
                  style={{ ...inputStyle, resize: "vertical", fontFamily: "'Inter', sans-serif", lineHeight: 1.5 }}
                />
              </SectionCard>
            </div>
          )}

          {tab === "required" && (
            <div>
              <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13.5, color: "#6B6555", marginTop: 0, marginBottom: 18, lineHeight: 1.5 }}>
                Applications often include standard EEO and voluntary disclosure questions. For each one, decide
                whether the agent can answer it for you, or whether you'd rather be prompted every time.
              </p>

              <SectionCard>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 14.5, color: "#1B1E23" }}>
                      Derive job titles from your resume
                    </div>
                    <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "#8B8676", marginTop: 2 }}>
                      A short set of questions to translate your resume into target titles.
                    </div>
                  </div>
                  {titleStage === "idle" && (
                    <button
                      onClick={startTitleDerivation}
                      disabled={!resume}
                      style={{ ...primaryButtonStyle, opacity: resume ? 1 : 0.45, cursor: resume ? "pointer" : "not-allowed" }}
                    >
                      <Sparkles size={14} /> {resume ? "Suggest titles" : "Upload a resume first"}
                    </button>
                  )}
                </div>

                {titleStage === "loading" && (
                  <div style={{ padding: "20px 0 4px", textAlign: "center", color: "#6B6555", fontFamily: "'Inter', sans-serif" }}>
                    <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
                    <div style={{ marginTop: 8, fontSize: 13.5 }}>Reading your resume…</div>
                  </div>
                )}

                {titleStage === "questions" && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #E4E0D6" }}>
                    {resumeSummary && (
                      <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "#8B8676", marginTop: 0, marginBottom: 16, lineHeight: 1.5 }}>{resumeSummary}</p>
                    )}
                    {questions.map((q, i) => (
                      <div key={i} style={{ marginBottom: 16 }}>
                        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 600, color: "#1B1E23", marginBottom: 8 }}>{q.question}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {q.options.map((opt) => (
                            <button
                              key={opt}
                              onClick={() => setQuestionAnswers((prev) => ({ ...prev, [i]: opt }))}
                              style={modeButtonStyle(questionAnswers[i] === opt)}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={submitTitleAnswers}
                        disabled={!allQuestionsAnswered}
                        style={{ ...primaryButtonStyle, opacity: allQuestionsAnswered ? 1 : 0.45, cursor: allQuestionsAnswered ? "pointer" : "not-allowed" }}
                      >
                        Get title suggestions
                      </button>
                      <button onClick={() => setTitleStage("idle")} style={ghostButtonStyle}>Cancel</button>
                    </div>
                  </div>
                )}

                {titleStage === "finalizing" && (
                  <div style={{ padding: "20px 0 4px", textAlign: "center", color: "#6B6555", fontFamily: "'Inter', sans-serif" }}>
                    <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
                    <div style={{ marginTop: 8, fontSize: 13.5 }}>Putting together your title list…</div>
                  </div>
                )}

                {titleStage === "error" && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #E4E0D6" }}>
                    <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13.5, color: "#8A6D3B", margin: 0 }}>{titleError}</p>
                    <button onClick={() => setTitleStage("idle")} style={{ ...ghostButtonStyle, marginTop: 10 }}>Try again</button>
                  </div>
                )}

                {titleStage === "done" && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #E4E0D6" }}>
                    {addedTitles.length > 0 ? (
                      <>
                        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13.5, color: "#1B1E23", marginBottom: 8 }}>
                          Added to your Profile tab:
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                          {addedTitles.map((t) => (
                            <span key={t} style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, background: "#F1EFE8", borderRadius: 999, padding: "5px 12px" }}>{t}</span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13.5, color: "#8B8676", margin: 0 }}>
                        No new titles to add — your list already covers these.
                      </p>
                    )}
                    <button onClick={() => setTitleStage("idle")} style={ghostButtonStyle}>Done</button>
                  </div>
                )}
              </SectionCard>

              {REQUIRED_FIELDS.map((field) => {
                const answer = answers[field.id] || { mode: "manual", value: "" };
                return (
                  <SectionCard key={field.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 14.5, color: "#1B1E23" }}>{field.label}</div>
                        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "#8B8676", marginTop: 2 }}>{field.question}</div>
                      </div>
                      <Stamp mode={answer.mode} />
                    </div>

                    {field.caution && (
                      <div style={{
                        fontFamily: "'Inter', sans-serif", fontSize: 12, color: "#8A6D3B",
                        background: "rgba(138,109,59,0.08)", border: "1px solid rgba(138,109,59,0.25)",
                        borderRadius: 5, padding: "7px 10px", marginTop: 10,
                      }}>
                        {field.caution}
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <button onClick={() => updateAnswer(field.id, { mode: "auto" })} style={modeButtonStyle(answer.mode === "auto")}>Answer automatically</button>
                      <button onClick={() => updateAnswer(field.id, { mode: "manual" })} style={modeButtonStyle(answer.mode === "manual")}>I'll enter it myself</button>
                    </div>

                    {answer.mode === "auto" && (
                      <div style={{ marginTop: 12 }}>
                        {field.type === "yesno" && (
                          <select value={answer.value} onChange={(e) => updateAnswer(field.id, { value: e.target.value })} style={inputStyle}>
                            <option value="">Select an answer…</option>
                            <option value="Yes">Yes</option>
                            <option value="No">No</option>
                          </select>
                        )}
                        {field.type === "select" && (
                          <select value={answer.value} onChange={(e) => updateAnswer(field.id, { value: e.target.value })} style={inputStyle}>
                            <option value="">Select an answer…</option>
                            {field.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                        )}
                        {field.type === "text" && (
                          <input value={answer.value} onChange={(e) => updateAnswer(field.id, { value: e.target.value })} placeholder="Your standard answer" style={inputStyle} />
                        )}
                      </div>
                    )}

                    {answer.mode === "manual" && (
                      <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12.5, color: "#9A9484", marginTop: 10 }}>
                        You'll be prompted for this answer during each application.
                      </div>
                    )}
                  </SectionCard>
                );
              })}
            </div>
          )}

          {tab === "jobs" && (
            <div>
              <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13.5, color: "#6B6555", marginTop: 0, marginBottom: 4, lineHeight: 1.5 }}>
                Pulled from company career pages via ATS connectors (Greenhouse, Lever, Ashby, Workday). This is
                sample data standing in for live listings until the real connectors are wired up.
              </p>
              <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#9A9484", marginTop: 0, marginBottom: 18 }}>
                {matched.length} of {MOCK_JOBS.length} sample postings match your profile and filters
              </p>

              {matched.length === 0 && (
                <SectionCard>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13.5, color: "#8B8676" }}>
                    Nothing matched. Try widening your Filters or Profile settings.
                  </div>
                </SectionCard>
              )}

              {matched.map(({ job, reasons }) => {
                const status = jobStatuses[job.id] || "idle";
                return (
                  <SectionCard key={job.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 15, color: "#1B1E23" }}>{job.title}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                          <span style={metaStyle}><Building2 size={12} /> {job.company}</span>
                          <span style={metaStyle}><MapPin size={12} /> {job.location} · {job.remote}</span>
                          {job.salaryMax && <span style={metaStyle}><DollarSign size={12} /> {job.salaryMin.toLocaleString()}–{job.salaryMax.toLocaleString()}</span>}
                          <span style={metaStyle}><Clock size={12} /> {new Date(job.datePosted).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#8B8676", alignSelf: "flex-start" }}>
                        via {job.sourceConnector}
                      </span>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                      {reasons.map((r) => (
                        <span key={r} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: "#2F5D50", background: "rgba(47,93,80,0.08)", border: "1px solid rgba(47,93,80,0.2)", borderRadius: 4, padding: "3px 7px" }}>
                          {r}
                        </span>
                      ))}
                    </div>

                    {status === "idle" && (
                      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                        <button onClick={() => setJobStatus(job.id, "reviewing")} style={primaryButtonStyle}>Apply</button>
                        <button onClick={() => setJobStatus(job.id, "skipped")} style={ghostButtonStyle}>Skip</button>
                      </div>
                    )}

                    {status === "skipped" && (
                      <div style={{ marginTop: 12, fontFamily: "'Inter', sans-serif", fontSize: 12.5, color: "#9A9484" }}>
                        Skipped. <button onClick={() => setJobStatus(job.id, "idle")} style={inlineLinkStyle}>Undo</button>
                      </div>
                    )}

                    {status === "reviewing" && (
                      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #E4E0D6" }}>
                        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13.5, fontWeight: 600, color: "#1B1E23", marginBottom: 8 }}>
                          Before this goes anywhere
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 18, fontFamily: "'Inter', sans-serif", fontSize: 13, color: "#6B6555", lineHeight: 1.7 }}>
                          <li>{resume ? `Resume: ${resume.name}` : "No resume uploaded — add one in the Profile tab"}</li>
                          <li>Auto-filled fields: {REQUIRED_FIELDS.filter((f) => (answers[f.id] || {}).mode === "auto").map((f) => f.label).join(", ") || "none set"}</li>
                          <li>You'll be prompted live for: {REQUIRED_FIELDS.filter((f) => (answers[f.id] || {}).mode !== "auto").map((f) => f.label).join(", ") || "nothing — all fields are automatic"}</li>
                        </ul>
                        <div style={{
                          fontFamily: "'Inter', sans-serif", fontSize: 12, color: "#8A6D3B", background: "rgba(138,109,59,0.08)",
                          border: "1px solid rgba(138,109,59,0.25)", borderRadius: 5, padding: "7px 10px", margin: "10px 0",
                        }}>
                          The live apply agent isn't connected yet, so confirming here just records what would have
                          been sent — nothing is actually submitted to {job.company}.
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => confirmApply(job)} style={primaryButtonStyle}>Confirm (simulated)</button>
                          <button onClick={() => setJobStatus(job.id, "idle")} style={ghostButtonStyle}>Cancel</button>
                        </div>
                      </div>
                    )}

                    {status === "applied" && (
                      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6, fontFamily: "'Inter', sans-serif", fontSize: 12.5, color: "#2F5D50" }}>
                        <Check size={13} /> Recorded in your Activity log (simulated)
                      </div>
                    )}
                  </SectionCard>
                );
              })}

              {filtered.length > 0 && (
                <div style={{ marginTop: 22 }}>
                  <button
                    onClick={() => setShowFilteredOut((v) => !v)}
                    style={{ ...ghostButtonStyle, display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    {showFilteredOut ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    {filtered.length} postings didn't match — {showFilteredOut ? "hide" : "show"}
                  </button>
                  {showFilteredOut && (
                    <div style={{ marginTop: 12 }}>
                      {filtered.map(({ job, reasons }) => (
                        <div key={job.id} style={{ padding: "10px 14px", borderBottom: "1px solid #E4E0D6", opacity: 0.75 }}>
                          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13.5, color: "#1B1E23" }}>
                            {job.title} · <span style={{ color: "#8B8676" }}>{job.company}</span>
                          </div>
                          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: "#9A9484", marginTop: 2 }}>
                            {reasons.join(" · ")}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "log" && (
            <div>
              <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13.5, color: "#6B6555", marginTop: 0, marginBottom: 18, lineHeight: 1.5 }}>
                A private record of exactly what was sent, where, and when. Only you can see this.
              </p>
              {logEntries.length === 0 && (
                <SectionCard>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13.5, color: "#8B8676" }}>
                    Nothing logged yet — entries appear here once you confirm an application from the Job feed.
                  </div>
                </SectionCard>
              )}
              {logEntries.map((entry) => (
                <SectionCard key={entry.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 14.5, color: "#1B1E23" }}>{entry.jobTitle}</div>
                      <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "#8B8676", marginTop: 2 }}>{entry.company} · via {entry.source}</div>
                    </div>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: "#9A9484", alignSelf: "flex-start" }}>
                      {new Date(entry.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <div style={{ marginTop: 10, fontFamily: "'Inter', sans-serif", fontSize: 12.5, color: "#6B6555", lineHeight: 1.7 }}>
                    <div><Eye size={11} style={{ marginRight: 5, verticalAlign: -1 }} />Resume sent: {entry.resumeSent ? "Yes" : "No"}</div>
                    <div>Auto-sent fields: {entry.fieldsSentAuto.join(", ") || "none"}</div>
                    <div>Prompted manually: {entry.fieldsPromptedManual.join(", ") || "none"}</div>
                  </div>
                  <div style={{
                    fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: "#8A6D3B",
                    marginTop: 10, textTransform: "uppercase", letterSpacing: "0.06em",
                  }}>
                    {entry.status}
                  </div>
                </SectionCard>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
    </div>
  );
}

const pageStyle = {
  minHeight: "100vh", background: "#FAF9F5",
  backgroundImage: "radial-gradient(circle at 1px 1px, rgba(27,30,35,0.035) 1px, transparent 0)",
  backgroundSize: "22px 22px",
};

const metaStyle = {
  display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "'Inter', sans-serif",
  fontSize: 12.5, color: "#6B6555",
};

const ghostButtonStyle = {
  fontFamily: "'Inter', sans-serif", fontSize: 12.5, padding: "7px 12px", borderRadius: 6,
  border: "1px solid #DAD6CC", background: "#FFFFFF", color: "#6B6555", cursor: "pointer", whiteSpace: "nowrap",
};

const primaryButtonStyle = {
  fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600, padding: "9px 14px", borderRadius: 6,
  border: "1px solid #2F5D50", background: "#2F5D50", color: "#FAF9F5", display: "inline-flex",
  alignItems: "center", gap: 6, whiteSpace: "nowrap",
};

const inlineLinkStyle = {
  border: "none", background: "transparent", color: "#2F5D50", textDecoration: "underline",
  cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 12.5, padding: 0,
};

function modeButtonStyle(active) {
  return {
    fontFamily: "'Inter', sans-serif", fontSize: 12.5, padding: "7px 12px", borderRadius: 6,
    border: active ? "1px solid #2F5D50" : "1px solid #DAD6CC",
    background: active ? "#2F5D50" : "#FFFFFF", color: active ? "#FAF9F5" : "#6B6555", cursor: "pointer",
  };
}
