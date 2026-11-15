import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { IssueFormModal } from '../components/issues/IssueFormModal';
import { IssueDetail } from '../components/issues/IssueDetail';
import {
  listIssues, getIssueSummary, bulkCloseIssues, bulkDownloadIssuesPdf, bulkDownloadIssuesXls, downloadIssuePdf, downloadIssueXls,
  listReminders, broadcastReminder, sendUserReminder, warnUser,
  type IssueListItem, type IssueDetailItem,
} from '../lib/issues.api';
import { getMembers, getHierarchy, type ProjectHierarchy } from '../lib/projects.api';
import { useAuthStore } from '../store/auth.store';
import {
  STATUS_LABELS, PRIORITY_LABELS,
  ISSUE_STATUSES, ISSUE_PRIORITIES, ISSUE_TYPE_LABELS, DISCIPLINE_LABELS, CATEGORY_LABELS,
  isOverdue, formatDeadline, formatDateTime, getDeadlineTimer, isIssueManager,
} from '../lib/issue-constants';
import { ISSUE_STATUS_TONE, ISSUE_PRIORITY_TONE } from '../lib/status-tone';
import { StatusBadge } from '../components/ui/Badge';
import { apiErrorMessage } from '../lib/api';
import { Listbox } from '../components/ui/Listbox';
import { DESKTOP_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import { RecordList, RecordRow } from '../components/ui/RecordRow';
import { Menu } from '../components/ui/Menu';

type QuickFilter = 'all' | 'overdue' | 'critical' | 'mine';
type View = QuickFilter | 'resolved';
type Tab = 'issues' | 'dashboard' | 'reminders';

export default function IssuesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isManager = isIssueManager(currentUser?.companyRole);

  const [tab, setTab] = useState<Tab>('issues');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [search, setSearch] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [assignedTo, setAssignedTo] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [createOpen, setCreateOpen] = useState(searchParams.get('new') === '1');
  const [editIssue, setEditIssue] = useState<IssueDetailItem | null>(null);
  const [viewIssueId, setViewIssueId] = useState<string | null>(searchParams.get('issueId'));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Building/level grouping (same treatment as the Floor plans sidebar);
  // issues.building_id/level_id are already joined into buildingName/
  // levelName server-side (issues.service.ts findAll()), so unlike Floor
  // plans no per-row lookup against level_id alone is needed here; the
  // hierarchy tree is only needed for building/level ORDER (levelOrder)
  // and to scope the Level filter's options to the selected building.
  const [buildingFilter, setBuildingFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');

  const membersQuery = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => getMembers(projectId!),
    enabled: Boolean(projectId),
  });

  const hierarchyQuery = useQuery({
    queryKey: ['hierarchy', projectId],
    queryFn: () => getHierarchy(projectId!),
    enabled: Boolean(projectId),
  });

  const summaryQuery = useQuery({
    queryKey: ['issue-summary', projectId],
    queryFn: () => getIssueSummary(projectId!),
    enabled: Boolean(projectId),
  });

  const issuesQuery = useQuery({
    queryKey: ['issues', projectId, status, priority, quickFilter, search, assignedTo, discipline, dateFrom, dateTo],
    queryFn: () =>
      listIssues(projectId!, {
        perPage: 100,
        status: status || undefined,
        priority: priority || (quickFilter === 'critical' ? 'critical' : undefined),
        overdue: quickFilter === 'overdue' ? true : undefined,
        myIssues: quickFilter === 'mine' ? true : undefined,
        search: search || undefined,
        assignedTo: assignedTo || undefined,
        discipline: discipline || undefined,
        dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
        dateTo: dateTo ? new Date(dateTo).toISOString() : undefined,
      }),
    enabled: Boolean(projectId),
  });

  const hierarchy = useMemo(() => hierarchyQuery.data ?? [], [hierarchyQuery.data]);

  type IssueWithLocation = IssueListItem & {
    _building?: ProjectHierarchy;
    _level?: ProjectHierarchy['levels'][number];
  };

  // Resolves each issue's building/level objects from the hierarchy tree
  // (for level-order sorting): an issue whose buildingId/levelId points
  // at a building/level no longer in the tree (deleted) resolves the same
  // as one with no building at all, and falls into "Unassigned" below.
  const issuesWithLocation = useMemo<IssueWithLocation[]>(() => {
    return (issuesQuery.data?.data ?? []).map((issue) => {
      if (!issue.buildingId) return issue;
      const building = hierarchy.find((b) => b.id === issue.buildingId);
      if (!building) return issue;
      const level = issue.levelId ? building.levels.find((l) => l.id === issue.levelId) : undefined;
      return { ...issue, _building: building, _level: level };
    });
  }, [issuesQuery.data, hierarchy]);

  const levelOptionsForFilter = useMemo(() => {
    const building = hierarchy.find((b) => b.id === buildingFilter);
    return [...(building?.levels ?? [])].sort((a, b) => a.levelOrder - b.levelOrder);
  }, [hierarchy, buildingFilter]);

  const filteredIssues = useMemo(() => {
    return issuesWithLocation.filter((issue) => {
      if (buildingFilter && issue._building?.id !== buildingFilter) return false;
      if (levelFilter && issue.levelId !== levelFilter) return false;
      return true;
    });
  }, [issuesWithLocation, buildingFilter, levelFilter]);

  // Grouped for render: buildings in hierarchy order, levels within each
  // sorted by levelOrder (not name), "Unassigned" bucket last; same
  // structure as FloorPlanViewer.tsx's groupedDrawings.
  const groupedIssues = useMemo(() => {
    const byBuilding = new Map<string, Map<string, { level?: ProjectHierarchy['levels'][number]; issues: IssueWithLocation[] }>>();
    const unassigned: IssueWithLocation[] = [];

    for (const issue of filteredIssues) {
      if (!issue._building) {
        unassigned.push(issue);
        continue;
      }
      if (!byBuilding.has(issue._building.id)) byBuilding.set(issue._building.id, new Map());
      const levelMap = byBuilding.get(issue._building.id)!;
      const levelKey = issue._level?.id ?? '__no-level__';
      if (!levelMap.has(levelKey)) levelMap.set(levelKey, { level: issue._level, issues: [] });
      levelMap.get(levelKey)!.issues.push(issue);
    }

    const buildingGroups = hierarchy
      .filter((b) => byBuilding.has(b.id))
      .map((b) => ({
        building: b,
        levelGroups: [...byBuilding.get(b.id)!.values()].sort(
          (a, b2) => (a.level?.levelOrder ?? Infinity) - (b2.level?.levelOrder ?? Infinity),
        ),
      }));

    return { buildingGroups, unassigned };
  }, [filteredIssues, hierarchy]);

  // Dashboard needs the full (unfiltered) project issue set to compute the
  // per-user KPI table and status/priority breakdown client-side; there's
  // no dedicated backend aggregate endpoint for those (only getSummary(),
  // which is project-wide totals, not per-user). Capped at 100 rows by the
  // backend's own perPage clamp (issues.service.ts findAll(): `Math.min(
  // query.perPage ?? 20, 100)`); see the "Deviations" note in the final
  // report for projects with more than 100 issues.
  const dashboardIssuesQuery = useQuery({
    queryKey: ['issues-dashboard', projectId],
    queryFn: () => listIssues(projectId!, { perPage: 100 }),
    enabled: Boolean(projectId) && isManager && tab === 'dashboard',
  });

  const remindersQuery = useQuery({
    queryKey: ['issue-reminders', projectId],
    queryFn: () => listReminders(projectId!, { perPage: 50 }),
    enabled: Boolean(projectId) && tab === 'reminders',
  });

  const bulkCloseMutation = useMutation({
    mutationFn: () => bulkCloseIssues(projectId!, [...selectedIds]),
    onSuccess: () => {
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['issues', projectId] });
      queryClient.invalidateQueries({ queryKey: ['issue-summary', projectId] });
      queryClient.invalidateQueries({ queryKey: ['issues-dashboard', projectId] });
    },
  });

  const [bulkDownloading, setBulkDownloading] = useState<'pdf' | 'xls' | null>(null);
  const [bulkDownloadError, setBulkDownloadError] = useState('');

  async function handleBulkDownloadPdf() {
    if (!projectId) return;
    setBulkDownloadError('');
    setBulkDownloading('pdf');
    try {
      await bulkDownloadIssuesPdf(projectId, [...selectedIds], `issues-export-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (err) {
      setBulkDownloadError(apiErrorMessage(err));
    } finally {
      setBulkDownloading(null);
    }
  }

  async function handleBulkDownloadXls() {
    if (!projectId) return;
    setBulkDownloadError('');
    setBulkDownloading('xls');
    try {
      await bulkDownloadIssuesXls(projectId, [...selectedIds], `issues-export-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (err) {
      setBulkDownloadError(apiErrorMessage(err));
    } finally {
      setBulkDownloading(null);
    }
  }

  // Assignee has its own dropdown; "More filters" holds the rest.
  const advancedActive = Boolean(discipline || dateFrom || dateTo);
  const activeFilterCount = [buildingFilter, levelFilter, status, priority, assignedTo].filter(Boolean).length + (advancedActive ? 1 : 0);
  function clearAdvanced() {
    setDiscipline('');
    setDateFrom('');
    setDateTo('');
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.size === filteredIssues.length ? new Set() : new Set(filteredIssues.map((r) => r.id))));
  }

  function handleExport() {
    exportIssuesToExcel(filteredIssues);
  }

  if (!projectId) return null;

  if (viewIssueId) {
    return (
      <>
        {/* No separate page header: the issue's own title is the heading. */}
        <IssueDetail
          projectId={projectId}
          issueId={viewIssueId}
          onBack={() => setViewIssueId(null)}
          onEdit={(issue) => setEditIssue(issue)}
        />
        {editIssue && (
          <IssueFormModal
            open={Boolean(editIssue)}
            onClose={() => setEditIssue(null)}
            projectId={projectId}
            members={membersQuery.data ?? []}
            hierarchy={hierarchyQuery.data ?? []}
            issue={editIssue}
          />
        )}
      </>
    );
  }

  const s = summaryQuery.data;
  const rows = issuesQuery.data?.data ?? [];
  const allSelected = filteredIssues.length > 0 && selectedIds.size === filteredIssues.length;

  // Views: one row of quick views with their counts, replacing the six
  // stat tiles and the separate quick-filter chips (Open, In progress and
  // Closed remain in the Status filter).
  const activeView: View | null = quickFilter !== 'all' ? quickFilter : status === 'resolved' ? 'resolved' : status ? null : 'all';
  const views: { key: View; label: string; count?: number }[] = [
    { key: 'all', label: 'All', count: s?.total },
    { key: 'mine', label: 'My issues' },
    { key: 'overdue', label: 'Overdue', count: s?.overdue },
    { key: 'critical', label: 'Critical', count: s?.critical },
    { key: 'resolved', label: 'Resolved', count: s?.resolved },
  ];
  function selectView(view: View) {
    if (view === 'resolved') {
      setQuickFilter('all');
      setStatus('resolved');
    } else {
      setQuickFilter(view);
      setStatus('');
    }
  }

  // Sections of the list: building and level, "No location" last; the
  // header is left out when everything sits in a single location-less group.
  const sections = [
    ...groupedIssues.buildingGroups.flatMap(({ building, levelGroups }) =>
      levelGroups.map(({ level, issues }) => ({
        key: `${building.id}:${level?.id ?? '__no-level__'}`,
        label: `${building.name} · ${level?.name ?? 'No level'}`,
        issues,
      })),
    ),
    ...(groupedIssues.unassigned.length > 0 ? [{ key: '__none__', label: 'No location', issues: groupedIssues.unassigned }] : []),
  ];
  const showSectionHeaders = !(sections.length === 1 && sections[0].key === '__none__');
  const members = membersQuery.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Project"
        title="Issues"
        subtitle={s ? `${s.total} issues · ${s.open} open · ${s.overdue} overdue` : undefined}
        actions={
          <>
            <button onClick={handleExport} disabled={filteredIssues.length === 0} className="btn-secondary">
              <ExportIcon /> Export to Excel
            </button>
            <button onClick={() => setCreateOpen(true)} className="btn-primary">
              <PlusIcon /> New issue
            </button>
          </>
        }
      />

      <div className="px-6 pt-4 flex items-center gap-2 border-b border-base-600">
        <TabButton active={tab === 'issues'} onClick={() => setTab('issues')}>Issues</TabButton>
        {isManager && <TabButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>Dashboard</TabButton>}
        <TabButton active={tab === 'reminders'} onClick={() => setTab('reminders')}>Reminders</TabButton>
      </div>

      {tab === 'issues' && (
        <div className="p-6 space-y-4">
          <div role="group" aria-label="Issue views" className="flex flex-wrap items-center gap-2">
            {views.map((v) => (
              <button
                key={v.key}
                type="button"
                aria-pressed={activeView === v.key}
                onClick={() => selectView(v.key)}
                className={`h-10 px-4 rounded-xl text-sm inline-flex items-center gap-2 transition-colors ${
                  activeView === v.key ? 'bg-ink-100 text-base-950 font-semibold' : 'text-ink-300 hover:bg-ink-100/5 hover:text-ink-100'
                }`}
              >
                {v.label}
                {v.count !== undefined && (
                  <span className={`text-xs tabular-nums ${activeView === v.key ? 'text-base-950/60' : 'text-ink-500'}`}>{v.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* Filters: search, then one dropdown per filter; the rarer ones
              (discipline, dates) sit behind "More filters". Phones get one
              Filters button instead of a row of dropdowns. */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative w-full md:w-72">
              <SearchIcon />
              <input
                className="field-input !h-10 !pl-12"
                placeholder="Search issues"
                aria-label="Search issues"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {!desktop && (
              <button
                type="button"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((v) => !v)}
                className="btn-secondary"
              >
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </button>
            )}
            <div className={desktop ? 'contents' : filtersOpen ? 'w-full grid grid-cols-1 gap-2' : 'hidden'}>
              <Listbox
                className={filterClass(status)}
                aria-label="Filter by status"
                value={status}
                onChange={(e) => { setStatus(e.target.value); setQuickFilter('all'); }}
              >
                <option value="">Status: all</option>
                {ISSUE_STATUSES.map((st) => (
                  <option key={st} value={st}>{STATUS_LABELS[st]}</option>
                ))}
              </Listbox>
              <Listbox className={filterClass(priority)} aria-label="Filter by priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="">Priority: all</option>
                {ISSUE_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </Listbox>
              <Listbox
                className={filterClass(buildingFilter)}
                aria-label="Filter by building"
                value={buildingFilter}
                onChange={(e) => { setBuildingFilter(e.target.value); setLevelFilter(''); }}
              >
                <option value="">Building: all</option>
                {hierarchy.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Listbox>
              {buildingFilter && (
                <Listbox className={filterClass(levelFilter)} aria-label="Filter by level" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
                  <option value="">Level: all</option>
                  {levelOptionsForFilter.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </Listbox>
              )}
              <Listbox className={filterClass(assignedTo)} aria-label="Filter by assignee" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                <option value="">Assignee: anyone</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</option>
                ))}
              </Listbox>
              <button
                type="button"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((v) => !v)}
                className={`btn-secondary !h-10 ${advancedActive ? '!border-blueprint/70 !text-ink-100' : ''}`}
              >
                <FiltersIcon /> More filters{advancedActive ? ' •' : ''}
              </button>
            </div>
          </div>

          {advancedOpen && (
            <div className="panel p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              <div>
                <label className="field-label" htmlFor="fDiscipline">Discipline</label>
                <Listbox id="fDiscipline" className="field-input" value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
                  <option value="">Any</option>
                  {Object.entries(DISCIPLINE_LABELS).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </Listbox>
              </div>
              <div>
                <label className="field-label" htmlFor="fDateFrom">Created from</label>
                <input id="fDateFrom" type="date" className="field-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="field-label" htmlFor="fDateTo">Created to</label>
                  <input id="fDateTo" type="date" className="field-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
                {advancedActive && (
                  <button onClick={clearAdvanced} className="btn-ghost !px-2 shrink-0" title="Clear these filters">
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Bulk actions appear only once something is selected. */}
          {desktop && selectedIds.size > 0 && (
            <div className="panel flex flex-wrap items-center gap-2 px-4 py-2">
              <span className="text-sm font-medium text-ink-100 mr-2">{selectedIds.size} selected</span>
              <button
                onClick={handleBulkDownloadPdf}
                disabled={bulkDownloading === 'pdf'}
                className="btn-secondary"
                title="A ZIP with each selected issue as its own PDF"
              >
                {bulkDownloading === 'pdf' ? 'Preparing…' : 'Download PDFs'}
              </button>
              <button
                onClick={handleBulkDownloadXls}
                disabled={bulkDownloading === 'xls'}
                className="btn-secondary"
                title="A ZIP with each selected issue as its own Excel file"
              >
                {bulkDownloading === 'xls' ? 'Preparing…' : 'Download Excel files'}
              </button>
              <button
                onClick={() => { if (confirm(`Close ${selectedIds.size} issue(s)?`)) bulkCloseMutation.mutate(); }}
                disabled={bulkCloseMutation.isPending}
                className="btn-secondary"
              >
                {bulkCloseMutation.isPending ? 'Closing…' : 'Close issues'}
              </button>
              <button onClick={() => setSelectedIds(new Set())} className="btn-ghost ml-auto">Clear selection</button>
            </div>
          )}
          {bulkDownloadError && <p className="field-error">{bulkDownloadError}</p>}
          {bulkCloseMutation.isError && <p className="field-error">{apiErrorMessage(bulkCloseMutation.error)}</p>}
          {bulkCloseMutation.isSuccess && (
            <p className="text-xs text-ok">
              Closed {bulkCloseMutation.data.closed} issue(s).
              {bulkCloseMutation.data.skipped > 0 && (
                <> {bulkCloseMutation.data.skipped} skipped. Only the issues you raised can be closed this way.</>
              )}
            </p>
          )}

          {issuesQuery.isLoading && <p className="text-sm text-ink-500">Loading issues…</p>}
          {issuesQuery.isSuccess && rows.length === 0 && (
            <div className="panel p-10 text-center text-sm text-ink-500">No issues match this view.</div>
          )}
          {issuesQuery.isSuccess && rows.length > 0 && filteredIssues.length === 0 && (
            <div className="panel p-10 text-center text-sm text-ink-500">No issues match these filters.</div>
          )}

          {/* The list: one table-like panel on desktop, grouped by
              building and level (levels in levelOrder), "No location" last;
              phones get the compact two-line register. */}
          {filteredIssues.length > 0 && (desktop ? (
            <div className="panel overflow-hidden" role="table" aria-label="Issues">
              <div role="row" className="flex items-center gap-4 pl-6 pr-2 h-11 border-b border-ink-100/10 text-eyebrow font-medium uppercase text-ink-500">
                <span role="columnheader" className="w-5">
                  <input type="checkbox" aria-label={`Select all ${filteredIssues.length} issues`} checked={allSelected} onChange={toggleSelectAll} />
                </span>
                <span role="columnheader" className="flex-1">Issue</span>
                <span role="columnheader" className="w-28">Priority</span>
                <span role="columnheader" className="w-40">Status</span>
                <span role="columnheader" className="w-44">Assignee</span>
                <span role="columnheader" className="w-36">Due</span>
                <span role="columnheader" className="w-10"><span className="sr-only">Actions</span></span>
              </div>
              {sections.map((section) => (
                <div key={section.key} role="rowgroup">
                  {showSectionHeaders && (
                    <div className="px-6 py-2 bg-ink-100/[0.03] border-b border-ink-100/10 text-xs font-semibold text-ink-300">
                      {section.label} <span className="ml-2 font-normal text-ink-500">{section.issues.length}</span>
                    </div>
                  )}
                  {section.issues.map((issue) => (
                    <IssueRow
                      key={issue.id}
                      projectId={projectId}
                      issue={issue}
                      selected={selectedIds.has(issue.id)}
                      onToggleSelect={() => toggleSelect(issue.id)}
                      onOpen={() => setViewIssueId(issue.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {sections.map((section) => (
                <div key={section.key}>
                  {showSectionHeaders && <div className="text-xs font-semibold text-ink-300 px-2 py-2">{section.label}</div>}
                  <IssueRecordList label={section.label} issues={section.issues} onOpen={setViewIssueId} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === 'dashboard' && isManager && (
        <IssueDashboard projectId={projectId!} summary={s} dashboardIssues={dashboardIssuesQuery.data?.data ?? []} isLoading={dashboardIssuesQuery.isLoading} />
      )}

      {tab === 'reminders' && (
        <RemindersPanel
          projectId={projectId}
          isManager={isManager}
          members={membersQuery.data ?? []}
          reminders={remindersQuery.data?.data ?? []}
          isLoading={remindersQuery.isLoading}
        />
      )}

      <IssueFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projectId={projectId}
        members={membersQuery.data ?? []}
        hierarchy={hierarchyQuery.data ?? []}
      />
    </>
  );
}

// ── Excel export (client-side, SheetJS) ─────────────────────────────────
// Phase 7: xlsx is a large dependency that every user previously paid for in
// the main bundle on every page load, even if they never export. Dynamic
// import moves that cost to the moment a user actually clicks "Export".
async function exportIssuesToExcel(issues: IssueListItem[]) {
  const XLSX = await import('xlsx');
  const rows = issues.map((i) => ({
    'Issue #': i.issueNumber ?? i.id,
    Title: i.title,
    Status: STATUS_LABELS[i.status],
    Priority: PRIORITY_LABELS[i.priority],
    Type: ISSUE_TYPE_LABELS[i.issueType],
    Category: i.category ? CATEGORY_LABELS[i.category] : '',
    Discipline: i.discipline ? DISCIPLINE_LABELS[i.discipline] : '',
    Assignee: i.assignedToName ?? '',
    Location: i.locationName ?? i.buildingName ?? '',
    Deadline: i.deadline ? formatDeadline(i.deadline) : '',
    Created: formatDateTime(i.createdAt),
    Closed: i.closedAt ? formatDateTime(i.closedAt) : '',
  }));
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Issues');
  XLSX.writeFile(workbook, `issues-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ── Manager-only dashboard ────────────────────────────────────────────────
interface UserKpiRow {
  userId: string;
  name: string;
  raised: number;
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  overdue: number;
  avgCloseDays: number | null;
}

function computeUserKpis(issues: IssueListItem[]): UserKpiRow[] {
  const map = new Map<string, UserKpiRow & { closeDurationsMs: number[] }>();
  function row(id: string, name: string) {
    if (!map.has(id)) {
      map.set(id, {
        userId: id, name, raised: 0, open: 0, inProgress: 0, resolved: 0, closed: 0, overdue: 0,
        avgCloseDays: null, closeDurationsMs: [],
      });
    }
    return map.get(id)!;
  }
  for (const issue of issues) {
    if (issue.createdBy) row(issue.createdBy, issue.createdByName ?? 'Unknown').raised += 1;
    if (issue.assignedTo) {
      const r = row(issue.assignedTo, issue.assignedToName ?? 'Unknown');
      if (issue.status === 'open') r.open += 1;
      if (issue.status === 'in_progress' || issue.status === 'assigned') r.inProgress += 1;
      if (issue.status === 'resolved') r.resolved += 1;
      if (issue.status === 'closed') r.closed += 1;
      if (isOverdue(issue.deadline, issue.status)) r.overdue += 1;
      if (issue.status === 'closed' && issue.closedAt) {
        r.closeDurationsMs.push(new Date(issue.closedAt).getTime() - new Date(issue.createdAt).getTime());
      }
    }
  }
  return [...map.values()]
    .map((r) => ({
      ...r,
      avgCloseDays: r.closeDurationsMs.length
        ? r.closeDurationsMs.reduce((a, b) => a + b, 0) / r.closeDurationsMs.length / (1000 * 60 * 60 * 24)
        : null,
    }))
    .sort((a, b) => b.raised + b.open + b.inProgress - (a.raised + a.open + a.inProgress));
}

function IssueDashboard({
  projectId,
  summary,
  dashboardIssues,
  isLoading,
}: {
  projectId: string;
  summary?: { total: number; open: number; inProgress: number; resolved: number; closed: number; critical: number; overdue: number };
  dashboardIssues: IssueListItem[];
  isLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const kpis = useMemo(() => computeUserKpis(dashboardIssues), [dashboardIssues]);
  const completion = summary && summary.total > 0 ? Math.round((summary.closed / summary.total) * 100) : 0;

  const [warnedUserId, setWarnedUserId] = useState<string | null>(null);
  const warnMutation = useMutation({
    mutationFn: (userId: string) => warnUser(projectId, userId),
    onSuccess: (_result, userId) => {
      setWarnedUserId(userId);
      queryClient.invalidateQueries({ queryKey: ['issues-dashboard', projectId] });
    },
  });

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of dashboardIssues) counts[i.status] = (counts[i.status] ?? 0) + 1;
    return counts;
  }, [dashboardIssues]);

  const priorityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of dashboardIssues) counts[i.priority] = (counts[i.priority] ?? 0) + 1;
    return counts;
  }, [dashboardIssues]);

  const maxStatusCount = Math.max(1, ...Object.values(statusCounts));
  const maxPriorityCount = Math.max(1, ...Object.values(priorityCounts));

  return (
    <div className="p-6 space-y-6">
      <p className="text-xs text-ink-500">
        Per-user KPIs and the breakdowns below are computed from the {dashboardIssues.length} most recent issues
        (backend list endpoint caps at 100 per page, so projects with more issues than that won’t be fully represented here).
      </p>

      {/* Stat tiles */}
      {summary && (
        <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
          <StatTile label="Critical" value={summary.critical} tone="danger" onClick={() => {}} />
          <StatTile label="Open" value={summary.open} onClick={() => {}} />
          <StatTile label="In progress" value={summary.inProgress} onClick={() => {}} />
          <StatTile label="Resolved" value={summary.resolved} onClick={() => {}} />
          <StatTile label="Overdue" value={summary.overdue} tone="danger" onClick={() => {}} />
          <StatTile label="Closed" value={summary.closed} onClick={() => {}} />
          <StatTile label="Completion" value={completion} suffix="%" onClick={() => {}} />
        </div>
      )}

      {isLoading && <p className="text-sm text-ink-500">Loading dashboard data…</p>}

      {/* Per-user KPI table */}
      <div>
        <div className="field-label">Per-user workload</div>
        <div className="panel overflow-x-auto" tabIndex={0}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-500 border-b border-base-600">
                <th className="p-2">User</th>
                <th className="p-2 text-right">Raised</th>
                <th className="p-2 text-right">Open</th>
                <th className="p-2 text-right">In progress</th>
                <th className="p-2 text-right">Resolved</th>
                <th className="p-2 text-right">Closed</th>
                <th className="p-2 text-right">Overdue</th>
                <th className="p-2 text-right">Avg close time</th>
                <th className="p-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {kpis.map((k) => (
                <tr key={k.userId} className="border-b border-base-700 last:border-0">
                  <td className="p-2 text-ink-100 font-medium">{k.name}</td>
                  <td className="p-2 text-right tabular-nums">{k.raised}</td>
                  <td className="p-2 text-right tabular-nums">{k.open}</td>
                  <td className="p-2 text-right tabular-nums">{k.inProgress}</td>
                  <td className="p-2 text-right tabular-nums">{k.resolved}</td>
                  <td className="p-2 text-right tabular-nums">{k.closed}</td>
                  <td className={`p-2 text-right tabular-nums ${k.overdue > 0 ? 'text-danger' : ''}`}>{k.overdue}</td>
                  <td className="p-2 text-right tabular-nums">{k.avgCloseDays != null ? `${k.avgCloseDays.toFixed(1)}d` : '—'}</td>
                  <td className="p-2 text-right">
                    {warnedUserId === k.userId && warnMutation.isSuccess ? (
                      <span className="text-xs text-ink-500">
                        {warnMutation.data?.warned ? `Warned (${warnMutation.data.warned})` : 'No overdue issues'}
                      </span>
                    ) : (
                      <button
                        onClick={() => warnMutation.mutate(k.userId)}
                        className="btn-secondary !py-2 !px-2 "
                        disabled={k.overdue === 0 || (warnMutation.isPending && warnedUserId === k.userId)}
                        title={k.overdue === 0 ? "No overdue issues to warn about" : undefined}
                      >
                        {warnMutation.isPending && warnedUserId === k.userId ? 'Warning…' : 'Warn'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {kpis.length === 0 && !isLoading && (
                <tr><td colSpan={9} className="p-4 text-center text-ink-500">No data yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Status / priority breakdown: plain CSS bars (no charting library
          in this repo's dependency tree; see ReportsPage.tsx / package.json,
          confirmed before implementing; a new charting dependency was
          intentionally not added). */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="field-label">By status</div>
          <div className="panel p-4 space-y-2">
            {Object.entries(statusCounts).map(([st, count]) => (
              <BarRow key={st} label={STATUS_LABELS[st as keyof typeof STATUS_LABELS] ?? st} value={count} max={maxStatusCount} />
            ))}
            {Object.keys(statusCounts).length === 0 && <p className="text-xs text-ink-500">No data yet.</p>}
          </div>
        </div>
        <div>
          <div className="field-label">By priority</div>
          <div className="panel p-4 space-y-2">
            {Object.entries(priorityCounts).map(([pr, count]) => (
              <BarRow key={pr} label={PRIORITY_LABELS[pr as keyof typeof PRIORITY_LABELS] ?? pr} value={count} max={maxPriorityCount} />
            ))}
            {Object.keys(priorityCounts).length === 0 && <p className="text-xs text-ink-500">No data yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 shrink-0 text-ink-300 truncate">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-base-700 overflow-hidden">
        <div className="h-full bg-signal rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-right tabular-nums text-ink-500">{value}</span>
    </div>
  );
}

// ── Reminders tab ─────────────────────────────────────────────────────────
function RemindersPanel({
  projectId,
  isManager,
  members,
  reminders,
  isLoading,
}: {
  projectId: string;
  isManager: boolean;
  members: { userId: string; firstName?: string; lastName?: string; email?: string }[];
  reminders: Awaited<ReturnType<typeof listReminders>>['data'];
  isLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [userReminderTarget, setUserReminderTarget] = useState('');
  const [userReminderMessage, setUserReminderMessage] = useState('');

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['issue-reminders', projectId] });
  }

  const broadcastMutation = useMutation({
    mutationFn: () => broadcastReminder(projectId, broadcastMessage.trim()),
    onSuccess: () => { setBroadcastMessage(''); invalidate(); },
  });

  const userReminderMutation = useMutation({
    mutationFn: () => sendUserReminder(projectId, userReminderTarget, userReminderMessage.trim()),
    onSuccess: () => { setUserReminderTarget(''); setUserReminderMessage(''); invalidate(); },
  });

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {isManager && (
        <div className="grid grid-cols-2 gap-4">
          <div className="panel p-4 space-y-2">
            <div className="field-label !mb-0">Broadcast reminder</div>
            <p className="text-xs text-ink-500">Sends to every open (non-closed) issue in this project.</p>
            <textarea
              className="field-input min-h-[64px]"
              placeholder="Reminder message…"
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
            />
            <button
              onClick={() => broadcastMutation.mutate()}
              disabled={!broadcastMessage.trim() || broadcastMutation.isPending}
              className="btn-primary !px-4 !py-2 "
            >
              {broadcastMutation.isPending ? 'Sending…' : 'Send broadcast'}
            </button>
            {broadcastMutation.isError && <p className="field-error">{apiErrorMessage(broadcastMutation.error)}</p>}
            {broadcastMutation.isSuccess && <p className="text-xs text-ok">Sent to {broadcastMutation.data.remindersSent} issue(s).</p>}
          </div>

          <div className="panel p-4 space-y-2">
            <div className="field-label !mb-0">Per-user reminder</div>
            <p className="text-xs text-ink-500">Sends to one user's open issues only.</p>
            <Listbox className="field-input" aria-label="Reminder recipient" value={userReminderTarget} onChange={(e) => setUserReminderTarget(e.target.value)}>
              <option value="">Select user…</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</option>
              ))}
            </Listbox>
            <textarea
              className="field-input min-h-[64px]"
              placeholder="Reminder message…"
              value={userReminderMessage}
              onChange={(e) => setUserReminderMessage(e.target.value)}
            />
            <button
              onClick={() => userReminderMutation.mutate()}
              disabled={!userReminderTarget || !userReminderMessage.trim() || userReminderMutation.isPending}
              className="btn-primary !px-4 !py-2 "
            >
              {userReminderMutation.isPending ? 'Sending…' : 'Send reminder'}
            </button>
            {userReminderMutation.isError && <p className="field-error">{apiErrorMessage(userReminderMutation.error)}</p>}
            {userReminderMutation.isSuccess && <p className="text-xs text-ok">Sent to {userReminderMutation.data.remindersSent} issue(s).</p>}
          </div>
        </div>
      )}

      <div>
        <div className="field-label">Reminder log</div>
        {isLoading && <p className="text-sm text-ink-500">Loading…</p>}
        <div className="space-y-2">
          {reminders.map((r) => (
            <div key={r.id} className="panel p-4 text-xs">
              <div className="flex items-center gap-2 text-ink-500 mb-2">
                <span className="font-medium text-ink-300">{r.sentByName ?? 'Someone'}</span>
                <span>→</span>
                <span>{r.sentToName ?? 'All open issues'}</span>
                {r.issueNumber && <span className="text-ink-500">· {r.issueNumber}</span>}
                <span className="ml-auto">{formatDateTime(r.createdAt)}</span>
              </div>
              <p className="text-ink-100">{r.message}</p>
            </div>
          ))}
          {reminders.length === 0 && !isLoading && <p className="text-sm text-ink-500">No reminders sent yet.</p>}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm border-b-2 transition-colors -mb-px ${
        active ? 'border-signal text-blueprint font-medium' : 'border-transparent text-ink-500 hover:text-ink-100'
      }`}
    >
      {children}
    </button>
  );
}

// The manager Dashboard tab's stat tiles.
function StatTile({ label, value, onClick, tone, suffix }: { label: string; value: number; onClick: () => void; tone?: 'danger'; suffix?: string }) {
  return (
    <button onClick={onClick} className="panel p-4 text-left hover:border-blueprint transition-colors">
      <div className="text-xs text-ink-500 mb-0 font-medium">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone === 'danger' && value > 0 ? 'text-danger' : 'text-ink-100'}`}>
        {value}{suffix}
      </div>
    </button>
  );
}

// A filter dropdown as a rounded button; it takes the accent edge while a
// value is chosen, so active filters are visible at a glance.
function filterClass(value: string) {
  return `field-input !h-10 !w-full md:!w-auto !rounded-full !px-4 ${value ? '!border-blueprint/70 !text-ink-100' : ''}`;
}

// Phones: the compact two-line register (see RecordRow).
function IssueRecordList({ label, issues, onOpen }: { label: string; issues: IssueListItem[]; onOpen: (id: string) => void }) {
  return (
    <RecordList label={label}>
      {issues.map((issue) => {
        const timer = getDeadlineTimer(issue.deadline, issue.status);
        const where = issue.locationName && issue.locationName.trim().toLowerCase() !== issue.title.trim().toLowerCase() ? issue.locationName : undefined;
        return (
          <RecordRow
            key={issue.id}
            marker={PRIORITY_MARKER[issue.priority]}
            title={issue.title}
            meta={[
              issue.issueNumber ?? issue.id.slice(0, 8),
              issue.status === 'open' ? undefined : STATUS_LABELS[issue.status],
              PRIORITY_LABELS[issue.priority],
              issue.discipline ? DISCIPLINE_LABELS[issue.discipline] : undefined,
              where,
            ].filter(Boolean).join(' · ')}
            due={timer.label}
            dueTone={timer.state === 'overdue' ? 'danger' : timer.state === 'warn' ? 'warn' : 'muted'}
            owner={issue.assignedToName ?? undefined}
            onClick={() => onOpen(issue.id)}
          />
        );
      })}
    </RecordList>
  );
}

// Severity bar colour per priority; the priority is also named in its own
// column, so colour is never the only signal.
const PRIORITY_MARKER: Record<IssueListItem['priority'], string> = {
  critical: 'bg-danger',
  high: 'bg-high',
  medium: 'bg-warn',
  low: 'bg-base-600',
};

const DUE_TONE: Record<string, string> = {
  overdue: 'text-danger',
  warn: 'text-warn',
  ok: 'text-ink-300',
  closed: 'text-ink-500',
};

// "Building · Level · Location", without repeating a location that just
// restates the title.
function issueWhere(issue: IssueListItem): string {
  const location = issue.locationName && issue.locationName.trim().toLowerCase() !== issue.title.trim().toLowerCase() ? issue.locationName : undefined;
  return [issue.buildingName, issue.levelName, location].filter(Boolean).join(' · ');
}

// One issue: the title reads first (up to two lines), with its number,
// location and discipline under it; then priority, status, assignee and
// due date in their own columns, and a ⋯ menu for quick actions.
function IssueRow({
  projectId, issue, selected, onToggleSelect, onOpen,
}: {
  projectId: string;
  issue: IssueListItem;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}) {
  const timer = getDeadlineTimer(issue.deadline, issue.status);
  const where = issueWhere(issue);
  const number = issue.issueNumber ?? issue.id.slice(0, 8);
  const [downloadError, setDownloadError] = useState('');

  async function download(kind: 'pdf' | 'xls') {
    setDownloadError('');
    try {
      if (kind === 'pdf') await downloadIssuePdf(projectId, issue.id, `${number}.pdf`);
      else await downloadIssueXls(projectId, issue.id, `${number}.xlsx`);
    } catch (err) {
      setDownloadError(apiErrorMessage(err));
    }
  }

  return (
    <div role="row" className={`relative flex items-center gap-4 pl-6 pr-2 py-4 border-b border-ink-100/10 last:border-b-0 transition-colors hover:bg-ink-100/[0.03] ${selected ? 'bg-blueprint/5' : ''}`}>
      <span aria-hidden="true" className={`absolute left-0 top-4 bottom-4 w-1 rounded-r-full ${PRIORITY_MARKER[issue.priority]}`} />
      <span role="cell" className="w-5 shrink-0">
        <input type="checkbox" aria-label={`Select issue ${number}`} checked={selected} onChange={onToggleSelect} />
      </span>
      <button role="cell" type="button" onClick={onOpen} className="flex-1 min-w-0 text-left">
        <span className="block text-sm font-semibold text-ink-100 line-clamp-2">{issue.title}</span>
        <span className="mt-0 flex items-center gap-2 text-xs text-ink-500 min-w-0">
          <span className="font-mono text-ink-300 shrink-0">{number}</span>
          {issue.discipline && DISCIPLINE_LABELS[issue.discipline] && (<><span aria-hidden="true">·</span><span className="shrink-0">{DISCIPLINE_LABELS[issue.discipline]}</span></>)}
          {/* Location last, so it is what shortens when space runs out. */}
          {where && (<><span aria-hidden="true">·</span><PinIcon /><span className="truncate">{where}</span></>)}
        </span>
        {downloadError && <span className="block mt-0 text-xs text-danger">{downloadError}</span>}
      </button>
      <span role="cell" className="w-28 shrink-0"><StatusBadge tone={ISSUE_PRIORITY_TONE[issue.priority]} label={PRIORITY_LABELS[issue.priority]} /></span>
      <span role="cell" className="w-40 shrink-0"><StatusBadge tone={ISSUE_STATUS_TONE[issue.status]} label={STATUS_LABELS[issue.status]} /></span>
      <span role="cell" className="w-44 shrink-0"><Assignee name={issue.assignedToName} /></span>
      <span role="cell" className="w-36 shrink-0">
        <span className={`block text-xs font-medium ${DUE_TONE[timer.state] ?? 'text-ink-300'}`}>{timer.state === 'overdue' ? timer.label : formatDeadline(issue.deadline)}</span>
        {timer.state !== 'overdue' && timer.state !== 'closed' && issue.deadline && <span className="block text-xs text-ink-500">{timer.label} left</span>}
      </span>
      <span role="cell" className="w-10 shrink-0">
        <Menu
          label={`Actions for ${number}`}
          buttonClassName="w-10 h-10 rounded-lg grid place-items-center text-ink-300 hover:bg-ink-100/5 hover:text-ink-100"
          buttonContent={<DotsIcon />}
          sections={[
            { items: [{ label: 'Open issue', icon: <OpenIcon />, onSelect: onOpen }] },
            {
              heading: 'Download',
              items: [
                { label: 'PDF report', icon: <ExportIcon />, onSelect: () => download('pdf') },
                { label: 'Excel (XLS)', icon: <ExportIcon />, onSelect: () => download('xls') },
              ],
            },
          ]}
        />
      </span>
    </div>
  );
}

// An initial "avatar" and the name, or a muted "Unassigned".
function Assignee({ name }: { name?: string }) {
  if (!name) return <span className="text-xs text-ink-500">Unassigned</span>;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
  return (
    <span className="flex items-center gap-2 min-w-0">
      <span className="w-8 h-8 rounded-full grid place-items-center shrink-0 bg-ink-100/10 ring-1 ring-ink-100/15 text-eyebrow font-semibold text-ink-100">{initials}</span>
      <span className="text-xs text-ink-300 truncate">{name}</span>
    </span>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}
function FiltersIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" strokeLinejoin="round" /><circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}
function DotsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}
function OpenIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v12M7 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 21h14" strokeLinecap="round" />
    </svg>
  );
}
