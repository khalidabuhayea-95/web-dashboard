"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Link2, Plus, X } from "lucide-react";

import ContentPicker, { ITEM_KIND_META, ITEM_KIND_ORDER } from "@/components/occasions/ContentPicker";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardSubtitle,
  CardTitle,
  Input,
  Label,
  Modal,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Textarea,
} from "@/components/ui";
import { publishNavBadge } from "@/lib/dashboard/navBadges";
import { ARAB_COUNTRIES, countryFlag, countryName } from "@/lib/occasions/countries";
import {
  addDays,
  gregorianToHijri,
  hijriMonthName,
  resolveOccurrences,
  supportsHijriCalendar,
  toArabicIndicDigits,
} from "@/lib/occasions/dates";

const KINDS = [
  { value: "islamic", label: "Islamic", labelAr: "إسلامية", color: "#0f766e" },
  { value: "national", label: "National", labelAr: "وطنية", color: "#1d4ed8" },
  { value: "international", label: "International", labelAr: "عالمية", color: "#7c3aed" },
  { value: "seasonal", label: "Seasonal", labelAr: "موسمية", color: "#ea580c" },
];
const KIND_BY_VALUE = new Map(KINDS.map((kind) => [kind.value, kind]));

const PHASE_META = {
  live: { label: "Live now", variant: "success" },
  boost: { label: "Boost active", variant: "success" },
  reminder: { label: "Reminder", variant: "warning" },
  upcoming: { label: "Upcoming", variant: "neutral" },
};

const VIEWS = [
  { value: "upcoming", label: "Upcoming" },
  { value: "calendar", label: "Calendar" },
  { value: "all", label: "All occasions" },
];

const GREGORIAN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDINALS = [
  { value: 1, label: "First" },
  { value: 2, label: "Second" },
  { value: 3, label: "Third" },
  { value: 4, label: "Fourth" },
  { value: -1, label: "Last" },
];

const EMPTY_FORM = {
  titleEn: "",
  titleAr: "",
  kind: "islamic",
  calendar: "hijri",
  month: 1,
  day: 1,
  useWeekdayRule: false,
  weekday: 5,
  weekOrdinal: -1,
  durationDays: 1,
  reminderLeadDays: 30,
  boostLeadDays: 14,
  countries: [],
  keywords: "",
  notes: "",
  emoji: "",
  color: "",
  enabled: true,
  boostEnabled: true,
  hoistCategories: true,
  dateOverrides: {},
};

function occasionToForm(occasion) {
  return {
    titleEn: occasion.titleEn || "",
    titleAr: occasion.titleAr || "",
    kind: occasion.kind || "islamic",
    calendar: occasion.calendar || "gregorian",
    month: occasion.month || 1,
    day: occasion.day ?? 1,
    useWeekdayRule: occasion.weekday !== null && occasion.weekday !== undefined && Boolean(occasion.weekOrdinal),
    weekday: occasion.weekday ?? 5,
    weekOrdinal: occasion.weekOrdinal ?? -1,
    durationDays: occasion.durationDays || 1,
    reminderLeadDays: occasion.reminderLeadDays ?? 30,
    boostLeadDays: occasion.boostLeadDays ?? 14,
    countries: Array.isArray(occasion.countries) ? occasion.countries : [],
    keywords: Array.isArray(occasion.keywords) ? occasion.keywords.join(", ") : "",
    notes: occasion.notes || "",
    emoji: occasion.emoji || "",
    color: occasion.color || "",
    enabled: occasion.enabled !== false,
    boostEnabled: occasion.boostEnabled !== false,
    hoistCategories: occasion.hoistCategories !== false,
    dateOverrides: occasion.dateOverrides && typeof occasion.dateOverrides === "object" ? { ...occasion.dateOverrides } : {},
  };
}

function formToRule(form) {
  const useWeekdayRule = form.calendar === "gregorian" && form.useWeekdayRule;
  return {
    calendar: form.calendar,
    month: Number(form.month),
    day: useWeekdayRule ? null : Number(form.day),
    weekday: useWeekdayRule ? Number(form.weekday) : null,
    weekOrdinal: useWeekdayRule ? Number(form.weekOrdinal) : null,
    durationDays: Number(form.durationDays),
    reminderLeadDays: Number(form.reminderLeadDays),
    boostLeadDays: Number(form.boostLeadDays),
  };
}

function formToPayload(form) {
  return {
    ...formToRule(form),
    titleEn: form.titleEn,
    titleAr: form.titleAr,
    kind: form.kind,
    countries: form.countries,
    keywords: form.keywords,
    notes: form.notes,
    emoji: form.emoji,
    color: form.color,
    enabled: form.enabled,
    boostEnabled: form.boostEnabled,
    hoistCategories: form.hoistCategories,
    dateOverrides: form.dateOverrides,
  };
}

function formatDate(iso, options = {}) {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(options.withYear === false ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

function whenLabel(next) {
  if (!next) return "—";
  if (next.daysUntil > 1) return `in ${next.daysUntil} days`;
  if (next.daysUntil === 1) return "tomorrow";
  if (next.daysUntil === 0) return "today";
  return `day ${1 - next.daysUntil}`;
}

function occasionColor(occasion) {
  return occasion.color || KIND_BY_VALUE.get(occasion.kind)?.color || "#64748b";
}

function toIso(date) {
  return date.toISOString().slice(0, 10);
}

// Six rows of seven days around the month, Sunday first, each cell tagged with its Hijri
// day so the grid reads in both calendars.
function buildMonthGrid(year, month, hijriOk) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first.getTime() - first.getUTCDay() * 86_400_000);
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start.getTime() + index * 86_400_000);
    const iso = toIso(date);
    let hijri = null;
    if (hijriOk) {
      try {
        hijri = gregorianToHijri(iso);
      } catch {
        hijri = null;
      }
    }
    cells.push({
      iso,
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month - 1,
      hijri,
    });
  }
  return cells;
}

function ReadinessBadge({ occasion }) {
  if (occasion.needsContent) return <Badge variant="warning">Needs content</Badge>;
  if (!occasion.itemCount) return <Badge variant="neutral">No content</Badge>;
  return <Badge variant="neutral">{occasion.itemCount} linked</Badge>;
}

function PhaseBadge({ next, enabled }) {
  if (!enabled) return <Badge variant="neutral">Disabled</Badge>;
  const phase = PHASE_META[next?.phase] || PHASE_META.upcoming;
  return <Badge variant={phase.variant}>{phase.label}</Badge>;
}

export default function OccasionsClient({ role }) {
  const canEdit = role === "admin";

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("upcoming");
  const [kindFilter, setKindFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });

  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [modalError, setModalError] = useState("");

  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState("");
  const [picker, setPicker] = useState(null);

  const hijriOk = useMemo(() => supportsHijriCalendar(), []);

  const loadOccasions = useCallback(async () => {
    setError("");
    try {
      const params = new URLSearchParams({ from: `${cursor.year}-01-01`, to: `${cursor.year}-12-31` });
      const response = await fetch(`/api/admin/occasions?${params}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load the occasions.");
      setData(payload);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [cursor.year]);

  useEffect(() => {
    loadOccasions();
  }, [loadOccasions]);

  const loadItems = useCallback(async (occasionId) => {
    setItemsLoading(true);
    setItemsError("");
    try {
      const response = await fetch(`/api/admin/occasions/${occasionId}/items`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load linked content.");
      setItems(payload.items || []);
    } catch (loadError) {
      setItemsError(loadError.message);
    } finally {
      setItemsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!editingId || editingId === "new") return;
    loadItems(editingId);
  }, [editingId, loadItems]);

  const refreshBadge = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/occasions/count", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.counts) publishNavBadge("/occasions", payload.counts);
    } catch {
      // The sidebar poll catches up within half a minute.
    }
  }, []);

  const occasions = useMemo(() => data?.occasions || [], [data]);
  const occasionById = useMemo(() => new Map(occasions.map((occasion) => [occasion.id, occasion])), [occasions]);
  const editing = editingId === "new" ? { id: "new" } : editingId ? occasionById.get(editingId) || null : null;

  const countryOptions = useMemo(() => {
    const codes = new Set();
    occasions.forEach((occasion) => (occasion.countries || []).forEach((code) => codes.add(code)));
    return Array.from(codes).sort((a, b) => countryName(a).localeCompare(countryName(b)));
  }, [occasions]);

  const matchesFilters = useCallback(
    (occasion) => {
      if (kindFilter !== "all" && occasion.kind !== kindFilter) return false;
      if (countryFilter === "global") return (occasion.countries || []).length === 0;
      if (countryFilter !== "all" && !(occasion.countries || []).includes(countryFilter)) return false;
      return true;
    },
    [kindFilter, countryFilter]
  );

  const upcomingRows = useMemo(
    () =>
      occasions
        .filter((occasion) => occasion.next && matchesFilters(occasion))
        .sort((a, b) => a.next.startIso.localeCompare(b.next.startIso) || a.sortOrder - b.sortOrder),
    [occasions, matchesFilters]
  );

  const allRows = useMemo(() => occasions.filter(matchesFilters), [occasions, matchesFilters]);

  const summary = useMemo(() => {
    let needsContent = 0;
    let reminding = 0;
    let live = 0;
    occasions.forEach((occasion) => {
      if (!occasion.enabled || !occasion.next) return;
      if (["reminder", "boost", "live"].includes(occasion.next.phase)) reminding += 1;
      if (occasion.next.phase === "live") live += 1;
      if (occasion.needsContent) needsContent += 1;
    });
    return { needsContent, reminding, live };
  }, [occasions]);

  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month, hijriOk), [cursor, hijriOk]);

  const occurrencesByDay = useMemo(() => {
    const map = new Map();
    if (!data?.occurrences || grid.length === 0) return map;
    const gridStart = grid[0].iso;
    const gridEnd = grid[grid.length - 1].iso;
    data.occurrences.forEach((occurrence) => {
      const occasion = occasionById.get(occurrence.occasionId);
      if (!occasion || !matchesFilters(occasion)) return;
      if (occurrence.endIso < gridStart || occurrence.startIso > gridEnd) return;
      let iso = occurrence.startIso < gridStart ? gridStart : occurrence.startIso;
      const last = occurrence.endIso > gridEnd ? gridEnd : occurrence.endIso;
      while (iso <= last) {
        const list = map.get(iso) || [];
        list.push({ occasion, occurrence, isStart: iso === occurrence.startIso });
        map.set(iso, list);
        iso = addDays(iso, 1);
      }
    });
    return map;
  }, [data, grid, occasionById, matchesFilters]);

  // The next three occurrences of the rule being edited, so the admin can pin the real
  // (moon-sighted / moved) dates without leaving the form.
  const overrideRows = useMemo(() => {
    const todayIso = data?.today?.iso || toIso(new Date());
    try {
      return resolveOccurrences({ ...formToRule(form), dateOverrides: {} }, { fromIso: todayIso, toIso: addDays(todayIso, 365 * 3) }).slice(0, 3);
    } catch {
      return [];
    }
  }, [form, data]);

  const openEditor = (occasion) => {
    setEditingId(occasion.id);
    setForm(occasionToForm(occasion));
    setStatus("");
    setModalError("");
    setItems([]);
  };

  const openCreate = () => {
    setEditingId("new");
    setForm(EMPTY_FORM);
    setStatus("");
    setModalError("");
    setItems([]);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditingId(null);
    setPicker(null);
  };

  const patchField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const save = async () => {
    setSaving(true);
    setModalError("");
    setStatus("");
    try {
      const creating = editingId === "new";
      const response = await fetch(creating ? "/api/admin/occasions" : `/api/admin/occasions/${editingId}`, {
        method: creating ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(formToPayload(form)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not save the occasion.");
      await loadOccasions();
      await refreshBadge();
      if (creating) setEditingId(payload.occasion.id);
      setForm(occasionToForm(payload.occasion));
      setStatus("Saved.");
    } catch (saveError) {
      setModalError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing || editing.id === "new") return;
    if (!window.confirm(`Delete "${editing.titleEn}" and its linked content?`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/occasions/${editing.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not delete.");
      setEditingId(null);
      await loadOccasions();
      await refreshBadge();
    } catch (deleteError) {
      setModalError(deleteError.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (occasion, enabled) => {
    setError("");
    try {
      const response = await fetch(`/api/admin/occasions/${occasion.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not update.");
      await loadOccasions();
      await refreshBadge();
    } catch (toggleError) {
      setError(toggleError.message);
    }
  };

  const linkItems = async (links) => {
    if (!editing || editing.id === "new" || links.length === 0) return;
    setPicker(null);
    setItemsError("");
    try {
      const response = await fetch(`/api/admin/occasions/${editing.id}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: links }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not link the content.");
      setItems(payload.items || []);
      if (payload.counts) publishNavBadge("/occasions", payload.counts);
      await loadOccasions();
    } catch (linkError) {
      setItemsError(linkError.message);
    }
  };

  const unlinkItem = async (item) => {
    if (!editing || editing.id === "new") return;
    setItemsError("");
    try {
      const response = await fetch(`/api/admin/occasions/${editing.id}/items`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not unlink.");
      setItems(payload.items || []);
      if (payload.counts) publishNavBadge("/occasions", payload.counts);
      await loadOccasions();
    } catch (unlinkError) {
      setItemsError(unlinkError.message);
    }
  };

  const shiftMonth = (delta) => {
    setCursor((current) => {
      const index = current.month - 1 + delta;
      const year = current.year + Math.floor(index / 12);
      const month = ((index % 12) + 12) % 12 + 1;
      return { year, month };
    });
  };

  const today = data?.today;
  const itemsByKind = useMemo(() => {
    const map = new Map();
    items.forEach((item) => {
      const list = map.get(item.kind) || [];
      list.push(item);
      map.set(item.kind, list);
    });
    return map;
  }, [items]);
  const pickerExistingIds = useMemo(
    () => new Set((picker ? itemsByKind.get(picker.kind) || [] : []).map((item) => item.itemId)),
    [picker, itemsByKind]
  );
  const editingKeywords = useMemo(
    () =>
      String(form.keywords || "")
        .split(/[,\n]/)
        .map((keyword) => keyword.trim())
        .filter(Boolean),
    [form.keywords]
  );

  const renderRow = (occasion, { showKind }) => (
    <TableRow key={occasion.id} className="cursor-pointer" onClick={() => openEditor(occasion)}>
      <TableCell>
        <div className="flex items-center gap-3">
          <span className="w-7 text-center text-lg leading-none" aria-hidden="true">
            {occasion.emoji || "📅"}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{occasion.titleEn}</span>
              <span dir="rtl" className="text-xs text-muted-foreground">
                {occasion.titleAr}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {showKind ? `${KIND_BY_VALUE.get(occasion.kind)?.label || occasion.kind} · ` : ""}
              {(occasion.countries || []).length
                ? occasion.countries.map((code) => `${countryFlag(code)} ${countryName(code)}`).join(", ")
                : "All countries"}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        {occasion.next ? (
          <div>
            <div>{formatDate(occasion.next.startIso)}</div>
            <div className="text-xs text-muted-foreground">
              <span dir="rtl">{occasion.next.hijriAr}</span>
              {occasion.next.estimated ? " · estimated" : ""}
              {occasion.durationDays > 1 ? ` · ${occasion.durationDays} days` : ""}
            </div>
          </div>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">{whenLabel(occasion.next)}</TableCell>
      <TableCell>
        <PhaseBadge next={occasion.next} enabled={occasion.enabled} />
      </TableCell>
      <TableCell>
        <ReadinessBadge occasion={occasion} />
      </TableCell>
      <TableCell onClick={(event) => event.stopPropagation()}>
        <Switch
          checked={occasion.enabled}
          disabled={!canEdit}
          onChange={(next) => toggleEnabled(occasion, next)}
          aria-label={`${occasion.titleEn} enabled`}
        />
      </TableCell>
    </TableRow>
  );

  const renderTable = (rows, { showKind }) => (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Occasion</TableHeaderCell>
          <TableHeaderCell>Next date</TableHeaderCell>
          <TableHeaderCell>When</TableHeaderCell>
          <TableHeaderCell>Phase</TableHeaderCell>
          <TableHeaderCell>Content</TableHeaderCell>
          <TableHeaderCell>Enabled</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>{rows.map((occasion) => renderRow(occasion, { showKind }))}</TableBody>
    </Table>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" aria-hidden="true" />
              Occasions calendar
            </CardTitle>
            <CardSubtitle>
              Arabic and Islamic occasions with reminders. Content linked to an occasion leads the
              mobile app while the occasion is near.
              {today ? (
                <span className="mt-1 block">
                  Today: {formatDate(today.iso)}
                  {today.hijriAr ? <span dir="rtl"> · {today.hijriAr}</span> : null} · {today.timeZone}
                </span>
              ) : null}
            </CardSubtitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {summary.needsContent > 0 ? <Badge variant="warning">{summary.needsContent} need content</Badge> : null}
            {summary.live > 0 ? <Badge variant="success">{summary.live} live now</Badge> : null}
            {summary.reminding > 0 ? <Badge variant="neutral">{summary.reminding} in window</Badge> : null}
            {canEdit ? (
              <Button onClick={openCreate}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Add occasion
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="View">
              {VIEWS.map((entry) => (
                <Button
                  key={entry.value}
                  type="button"
                  variant={entry.value === view ? "primary" : "ghost"}
                  aria-pressed={entry.value === view}
                  onClick={() => setView(entry.value)}
                >
                  {entry.label}
                </Button>
              ))}
            </div>
            <span className="mx-1 hidden h-6 w-px bg-[var(--border)] sm:block" aria-hidden="true" />
            <Select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)} aria-label="Kind" className="w-auto">
              <option value="all">All kinds</option>
              {KINDS.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </Select>
            <Select value={countryFilter} onChange={(event) => setCountryFilter(event.target.value)} aria-label="Country" className="w-auto">
              <option value="all">All countries</option>
              <option value="global">Global only</option>
              {countryOptions.map((code) => (
                <option key={code} value={code}>
                  {countryFlag(code)} {countryName(code)}
                </option>
              ))}
            </Select>
          </div>

          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

          <div className="mt-4">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : occasions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No occasions yet. Run <code>npm run seed:occasions -- --create</code> or add one.
              </p>
            ) : view === "upcoming" ? (
              upcomingRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing matches these filters.</p>
              ) : (
                renderTable(upcomingRows, { showKind: true })
              )
            ) : view === "all" ? (
              renderTable(allRows, { showKind: true })
            ) : (
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <Button type="button" variant="ghost" onClick={() => shiftMonth(-1)} aria-label="Previous month">
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <div className="text-center">
                    <div className="text-base font-semibold">
                      {GREGORIAN_MONTHS[cursor.month - 1]} {cursor.year}
                    </div>
                    {hijriOk && grid.length ? (
                      <div dir="rtl" className="text-xs text-muted-foreground">
                        {(() => {
                          const first = grid.find((cell) => cell.inMonth)?.hijri;
                          const last = [...grid].reverse().find((cell) => cell.inMonth)?.hijri;
                          if (!first || !last) return null;
                          const a = `${hijriMonthName(first.hm, "ar")} ${toArabicIndicDigits(first.hy)}`;
                          const b = `${hijriMonthName(last.hm, "ar")} ${toArabicIndicDigits(last.hy)}`;
                          return a === b ? a : `${a} – ${b}`;
                        })()}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        const iso = today?.iso || toIso(new Date());
                        setCursor({ year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) });
                      }}
                    >
                      Today
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => shiftMonth(1)} aria-label="Next month">
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl bg-[var(--border)]">
                  {WEEKDAY_LABELS.map((label) => (
                    <div key={label} className="bg-[var(--ds-surface)] px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {label}
                    </div>
                  ))}
                  {grid.map((cell) => {
                    const entries = occurrencesByDay.get(cell.iso) || [];
                    const isToday = today?.iso === cell.iso;
                    return (
                      <div
                        key={cell.iso}
                        className={`min-h-[96px] bg-[var(--ds-surface)] p-1.5 ${cell.inMonth ? "" : "opacity-45"}`}
                      >
                        <div className="flex items-baseline justify-between">
                          <span
                            className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold ${
                              isToday ? "bg-primary text-primary-foreground" : ""
                            }`}
                          >
                            {cell.day}
                          </span>
                          {cell.hijri ? (
                            <span dir="rtl" className="text-[10px] text-muted-foreground">
                              {cell.hijri.hd === 1
                                ? `${toArabicIndicDigits(cell.hijri.hd)} ${hijriMonthName(cell.hijri.hm, "ar")}`
                                : toArabicIndicDigits(cell.hijri.hd)}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 space-y-0.5">
                          {entries.slice(0, 3).map(({ occasion, occurrence, isStart }) => {
                            const color = occasionColor(occasion);
                            return (
                              <button
                                key={`${occasion.id}-${occurrence.startIso}`}
                                type="button"
                                onClick={() => openEditor(occasion)}
                                title={`${occasion.titleEn} · ${occasion.titleAr}${occurrence.estimated ? " (estimated)" : ""}`}
                                className={`block w-full truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight ${
                                  occasion.enabled ? "" : "line-through opacity-60"
                                }`}
                                style={{ background: `${color}1f`, color }}
                              >
                                {isStart ? `${occasion.emoji || ""} ` : "· "}
                                <span dir="rtl">{occasion.titleAr}</span>
                              </button>
                            );
                          })}
                          {entries.length > 3 ? (
                            <div className="px-1 text-[10px] text-muted-foreground">+{entries.length - 3} more</div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Modal open={Boolean(editing)} onClose={closeEditor} className="max-h-[90vh] w-[min(960px,94vw)] overflow-y-auto">
        {editing ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">
                  {editing.id === "new" ? "New occasion" : `${editing.emoji ? `${editing.emoji} ` : ""}${editing.titleEn}`}
                </h2>
                {editing.id !== "new" ? (
                  <p className="text-xs text-muted-foreground">
                    <span dir="rtl">{editing.titleAr}</span> · {editing.slug}
                    {editing.next ? (
                      <>
                        {" · "}
                        {formatDate(editing.next.startIso)} <span dir="rtl">({editing.next.hijriAr})</span> · {whenLabel(editing.next)}
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
              {editing.id !== "new" ? (
                <div className="flex flex-wrap gap-2">
                  <PhaseBadge next={editing.next} enabled={editing.enabled} />
                  <ReadinessBadge occasion={editing} />
                </div>
              ) : null}
            </div>
            {modalError ? <p className="text-sm text-destructive">{modalError}</p> : null}
            {status ? <p className="text-sm text-emerald-600">{status}</p> : null}

            <fieldset disabled={!canEdit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="oc-en">English title</Label>
                  <Input id="oc-en" value={form.titleEn} onChange={(event) => patchField("titleEn", event.target.value)} />
                </div>
                <div>
                  <Label htmlFor="oc-ar">Arabic title</Label>
                  <Input id="oc-ar" dir="rtl" value={form.titleAr} onChange={(event) => patchField("titleAr", event.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <Label htmlFor="oc-kind">Kind</Label>
                  <Select id="oc-kind" value={form.kind} onChange={(event) => patchField("kind", event.target.value)}>
                    {KINDS.map((kind) => (
                      <option key={kind.value} value={kind.value}>
                        {kind.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="oc-calendar">Calendar</Label>
                  <Select
                    id="oc-calendar"
                    value={form.calendar}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        calendar: event.target.value,
                        useWeekdayRule: event.target.value === "gregorian" ? current.useWeekdayRule : false,
                      }))
                    }
                  >
                    <option value="hijri">Hijri (Umm al-Qura)</option>
                    <option value="gregorian">Gregorian</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="oc-month">Month</Label>
                  <Select id="oc-month" value={form.month} onChange={(event) => patchField("month", Number(event.target.value))}>
                    {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                      <option key={month} value={month}>
                        {form.calendar === "hijri" ? `${hijriMonthName(month, "en")} · ${hijriMonthName(month, "ar")}` : GREGORIAN_MONTHS[month - 1]}
                      </option>
                    ))}
                  </Select>
                </div>
                {form.calendar === "gregorian" && form.useWeekdayRule ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="oc-ordinal">Week</Label>
                      <Select id="oc-ordinal" value={form.weekOrdinal} onChange={(event) => patchField("weekOrdinal", Number(event.target.value))}>
                        {ORDINALS.map((ordinal) => (
                          <option key={ordinal.value} value={ordinal.value}>
                            {ordinal.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="oc-weekday">Weekday</Label>
                      <Select id="oc-weekday" value={form.weekday} onChange={(event) => patchField("weekday", Number(event.target.value))}>
                        {WEEKDAY_LABELS.map((label, index) => (
                          <option key={label} value={index}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Label htmlFor="oc-day">Day</Label>
                    <Input id="oc-day" type="number" min={1} max={form.calendar === "hijri" ? 30 : 31} value={form.day} onChange={(event) => patchField("day", event.target.value)} />
                  </div>
                )}
              </div>
              {form.calendar === "gregorian" ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.useWeekdayRule} onChange={(event) => patchField("useWeekdayRule", event.target.checked)} />
                  Use a weekday rule (e.g. last Friday of November)
                </label>
              ) : null}

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="oc-duration">Duration (days)</Label>
                  <Input id="oc-duration" type="number" min={1} max={366} value={form.durationDays} onChange={(event) => patchField("durationDays", event.target.value)} />
                </div>
                <div>
                  <Label htmlFor="oc-reminder">Remind (days before)</Label>
                  <Input id="oc-reminder" type="number" min={0} max={365} value={form.reminderLeadDays} onChange={(event) => patchField("reminderLeadDays", event.target.value)} />
                </div>
                <div>
                  <Label htmlFor="oc-boost">Boost (days before)</Label>
                  <Input id="oc-boost" type="number" min={0} max={365} value={form.boostLeadDays} onChange={(event) => patchField("boostLeadDays", event.target.value)} />
                </div>
              </div>

              {overrideRows.length > 0 ? (
                <div className="space-y-2 rounded-2xl bg-[var(--ds-surface-2)] p-3">
                  <p className="text-sm font-medium">Actual dates</p>
                  <p className="text-xs text-muted-foreground">
                    {form.calendar === "hijri"
                      ? "Umm al-Qura predicts the start; enter the announced date once the moon is sighted."
                      : "Override a year when the date moves (a shifted school start, a moved holiday)."}
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {overrideRows.map((occurrence) => {
                      const current = form.dateOverrides?.[occurrence.overrideKey] || "";
                      return (
                        <div key={occurrence.overrideKey} className="rounded-lg bg-[var(--ds-surface)] p-2">
                          <div className="text-xs text-muted-foreground">
                            {form.calendar === "hijri" ? `${occurrence.overrideKey} AH` : occurrence.overrideKey} · computed {formatDate(occurrence.startIso, { withYear: false })}
                          </div>
                          <div className="mt-1 flex items-center gap-1">
                            <Input
                              type="date"
                              value={current}
                              onChange={(event) =>
                                setForm((state) => ({
                                  ...state,
                                  dateOverrides: { ...state.dateOverrides, [occurrence.overrideKey]: event.target.value },
                                }))
                              }
                              aria-label={`Actual date for ${occurrence.overrideKey}`}
                            />
                            {current ? (
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-destructive"
                                aria-label="Clear override"
                                onClick={() =>
                                  setForm((state) => {
                                    const next = { ...state.dateOverrides };
                                    delete next[occurrence.overrideKey];
                                    return { ...state, dateOverrides: next };
                                  })
                                }
                              >
                                <X className="h-4 w-4" aria-hidden="true" />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div>
                <Label>Countries</Label>
                <p className="mb-1.5 text-xs text-muted-foreground">Leave all unchecked for an occasion that applies everywhere.</p>
                <div className="flex flex-wrap gap-1.5">
                  {ARAB_COUNTRIES.map((country) => {
                    const checked = form.countries.includes(country.code);
                    return (
                      <button
                        key={country.code}
                        type="button"
                        aria-pressed={checked}
                        className={`badge cursor-pointer ${checked ? "badge-success" : ""}`}
                        onClick={() =>
                          patchField(
                            "countries",
                            checked ? form.countries.filter((code) => code !== country.code) : [...form.countries, country.code]
                          )
                        }
                      >
                        {countryFlag(country.code)} {country.en}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="oc-keywords">Keywords (comma separated)</Label>
                  <Textarea id="oc-keywords" rows={2} value={form.keywords} onChange={(event) => patchField("keywords", event.target.value)} />
                  <p className="field-help">Pre-fill the content pickers&apos; search, in Arabic and English.</p>
                </div>
                <div>
                  <Label htmlFor="oc-notes">Notes / content ideas</Label>
                  <Textarea id="oc-notes" rows={2} dir="auto" value={form.notes} onChange={(event) => patchField("notes", event.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <Label htmlFor="oc-emoji">Emoji</Label>
                  <Input id="oc-emoji" value={form.emoji} onChange={(event) => patchField("emoji", event.target.value)} />
                </div>
                <div>
                  <Label htmlFor="oc-color">Colour</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="oc-color"
                      type="color"
                      value={form.color || KIND_BY_VALUE.get(form.kind)?.color || "#64748b"}
                      onChange={(event) => patchField("color", event.target.value)}
                      aria-label="Colour"
                    />
                    {form.color ? (
                      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => patchField("color", "")}>
                        use kind colour
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">kind colour</span>
                    )}
                  </div>
                </div>
                <div className="col-span-2 flex flex-wrap items-center gap-4 pt-5">
                  <Switch checked={form.enabled} label="Enabled" onChange={(next) => patchField("enabled", next)} />
                  <Switch checked={form.boostEnabled} label="Boost on mobile" onChange={(next) => patchField("boostEnabled", next)} />
                  <Switch checked={form.hoistCategories} label="Hoist linked categories" onChange={(next) => patchField("hoistCategories", next)} />
                </div>
              </div>
            </fieldset>

            {canEdit ? (
              <div className="flex items-center justify-between gap-3 border-t pt-3">
                {editing.id !== "new" ? (
                  <button type="button" className="text-sm text-destructive underline" onClick={remove} disabled={saving}>
                    Delete occasion
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={closeEditor} disabled={saving}>
                    Close
                  </Button>
                  <Button type="button" onClick={save} disabled={saving}>
                    {saving ? "Saving…" : editing.id === "new" ? "Create" : "Save"}
                  </Button>
                </div>
              </div>
            ) : null}

            {editing.id !== "new" ? (
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-base font-semibold">
                    <Link2 className="h-4 w-4 text-primary" aria-hidden="true" /> Linked content
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {items.length} item{items.length === 1 ? "" : "s"} · shown first in the app from{" "}
                    {editing.next ? formatDate(editing.next.boostStartIso, { withYear: false }) : "—"}
                  </span>
                </div>
                {itemsError ? <p className="text-sm text-destructive">{itemsError}</p> : null}
                {itemsLoading && items.length === 0 ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {ITEM_KIND_ORDER.filter((kind) => !ITEM_KIND_META[kind].adminOnly || canEdit).map((kind) => {
                    const list = itemsByKind.get(kind) || [];
                    return (
                      <div key={kind} className="rounded-2xl bg-[var(--ds-surface-2)] p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">
                            {ITEM_KIND_META[kind].label}
                            <span className="ml-1.5 text-xs text-muted-foreground">{list.length}</span>
                          </span>
                          <Button type="button" variant="ghost" onClick={() => setPicker({ kind, nonce: Date.now() })}>
                            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Add
                          </Button>
                        </div>
                        {list.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Nothing linked.</p>
                        ) : (
                          <ul className="space-y-1">
                            {list.map((item) => (
                              <li key={item.id} className="flex items-center gap-2 rounded-lg bg-[var(--ds-surface)] px-2 py-1">
                                {item.thumbnailUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={item.thumbnailUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" loading="lazy" />
                                ) : (
                                  <span className="h-8 w-8 shrink-0 rounded bg-[var(--ds-surface-2)]" aria-hidden="true" />
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm">{item.title}</span>
                                  <span className="block truncate text-[11px] text-muted-foreground">
                                    {item.titleAr ? <span dir="rtl">{item.titleAr} · </span> : null}
                                    {item.subtitle}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-destructive"
                                  aria-label={`Unlink ${item.title}`}
                                  onClick={() => unlinkItem(item)}
                                >
                                  <X className="h-4 w-4" aria-hidden="true" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {picker && editing && editing.id !== "new" ? (
        <ContentPicker
          key={picker.nonce}
          open
          kind={picker.kind}
          keywords={editingKeywords}
          existingIds={pickerExistingIds}
          role={role}
          onClose={() => setPicker(null)}
          onConfirm={linkItems}
        />
      ) : null}
    </div>
  );
}
