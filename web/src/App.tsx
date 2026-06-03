import { useEffect, useMemo, useState } from "react"
import {
  Bath,
  BedDouble,
  Bot,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  FilePlus2,
  Home,
  Ruler,
  Link2,
  ListFilter,
  LockKeyhole,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  PanelRightClose,
  PhoneCall,
  Plus,
  Route,
  Search,
  Send,
  Settings,
  Share2,
  Trash2,
  SlidersHorizontal,
  Upload,
  UserRound,
} from "lucide-react"
import "./App.css"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  groupListingsByArea,
  toClientRoute,
  type AgentRoute,
  type Listing,
  type ListingStatus,
  type ViewingPlan,
  type ViewingTour,
} from "./domain"
import * as api from "./api"
import { pingExtension, importViaTab, waitForImportResult, storeTokenInExtension } from "./extensionBridge"
import { initAuth, getStoredToken, signOut, type ButlerUser } from "./auth"
import { SignIn } from "./SignIn"
import { SchedulingProgress } from "./components/SchedulingProgress"

type View = "workspace" | "conversations" | "route" | "settings"
type SidePanel = "map" | "route" | "listing" | null
type PlanDraft = Pick<ViewingPlan, "title" | "clientName" | "clientWhatsapp" | "brief">
type TourDraft = Pick<ViewingTour, "title" | "targetDate" | "timeWindow" | "command">

type TimelineSlot = {
  listingId: string
  condoName: string
  date: string
  time: string
}

const statusTone: Record<ListingStatus, string> = {
  imported: "border-[#dddddd] bg-white text-[#222222]",
  contacting: "border-[#d8efff] bg-[#f1f9ff] text-[#0369a1]",
  confirmed: "border-[#d7f4df] bg-[#f3fbf5] text-[#177245]",
  "needs-attention": "border-[#ffd5de] bg-[#fff5f7] text-[#c13515]",
  "not-fitting": "border-[#e4e4e4] bg-[#f7f7f7] text-[#6a6a6a]",
}

const statusDot: Record<ListingStatus, string> = {
  imported: "bg-[#b0b0b0]",
  contacting: "bg-[#0ea5e9]",
  confirmed: "bg-[#22c55e]",
  "needs-attention": "bg-[#ff385c]",
  "not-fitting": "bg-[#9ca3af]",
}

const schedulingLabel: Record<ListingStatus, string> = {
  imported: "Not Started",
  contacting: "Scheduling",
  confirmed: "Scheduled",
  "needs-attention": "Needs You",
  "not-fitting": "Not Started",
}

const schedulingTone: Record<ListingStatus, string> = {
  imported: "border-[#dddddd] bg-white text-[#6a6a6a]",
  contacting: "border-[#d8efff] bg-[#f1f9ff] text-[#0369a1]",
  confirmed: "border-[#d7f4df] bg-[#f3fbf5] text-[#177245]",
  "needs-attention": "border-[#ffd5de] bg-[#fff5f7] text-[#c13515]",
  "not-fitting": "border-[#dddddd] bg-white text-[#6a6a6a]",
}

const navItems: Array<{ id: View; label: string; icon: typeof Home }> = [
  { id: "workspace", label: "Workspace", icon: Home },
  { id: "conversations", label: "Conversations", icon: MessageCircle },
  { id: "settings", label: "AI rules", icon: Settings },
]

const defaultTour: ViewingTour = {
  id: "",
  planId: "",
  title: "New Tour",
  targetDate: "Today",
  timeWindow: "10:00 AM - 4:30 PM",
  command: "",
}
const unreadByAgent: Record<string, number> = {}

function App({ onSignOut, currentUser }: { onSignOut: () => void; currentUser: ButlerUser | null }) {
  const [view, setView] = useState<View>("workspace")
  const [workspacePlans, setWorkspacePlans] = useState<ViewingPlan[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [workspaceTours, setWorkspaceTours] = useState<ViewingTour[]>([])
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null)
  const [sidePanel, setSidePanel] = useState<SidePanel>(null)
  const [newPlanOpen, setNewPlanOpen] = useState(false)
  const [newTourOpen, setNewTourOpen] = useState(false)
  const [listingItems, setListingItems] = useState<Listing[]>([])
  const [importText, setImportText] = useState("")
  const [schedulingStarted, setSchedulingStarted] = useState(false)
  const [schedulingRunning, setSchedulingRunning] = useState(false)
  /** Live run row from /scheduling-runs/:id; drives <SchedulingProgress />. */
  const [schedulingRun, setSchedulingRun] = useState<api.SchedulingRun | null>(null)
  /** Step catalogue from /scheduling-steps; fetched once on mount. */
  const [schedulingSteps, setSchedulingSteps] = useState<api.SchedulingStepDef[]>([])
  const [, setTimelineSlots] = useState<TimelineSlot[]>([])

  const activePlan = workspacePlans.find((plan) => plan.id === selectedPlanId) ?? null
  const activeTour = workspaceTours[0] ?? null
  const selectedListing = listingItems.find((listing) => listing.id === selectedListingId) ?? null
  const hasUnreadConversations = Object.values(unreadByAgent).some((count) => count > 0)
  const groupedListings = useMemo(() => {
    // Group by area, then sort:
    //   - within each area: ascending by suggestedTime start (so the agent
    //     reads the day top-to-bottom in chronological order); listings
    //     without a suggestedTime sink to the bottom of their group.
    //   - across areas: areas appear in the order of their earliest
    //     suggestedTime so the overall list is also chronologically sorted.
    //   - if no listing has a suggestedTime yet (pre-scheduling), fall back
    //     to alphabetical area order, which is what `Object.entries` of
    //     a string-keyed object effectively gives us already.
    const groups = groupListingsByArea(listingItems)

    // helper: minutes-since-midnight from "HH:MM – HH:MM" / undefined
    const startMin = (l: Listing): number => {
      const t = l.suggestedTime
      if (!t || typeof t !== 'string') return Number.POSITIVE_INFINITY
      const m = t.match(/(\d{1,2}):(\d{2})/)
      if (!m) return Number.POSITIVE_INFINITY
      return Number(m[1]) * 60 + Number(m[2])
    }

    // sort each area's listings by suggestedTime start
    const sorted: Record<string, Listing[]> = {}
    const areaEarliest = new Map<string, number>()
    for (const [area, items] of Object.entries(groups)) {
      const ordered = [...items].sort((a, b) => startMin(a) - startMin(b))
      sorted[area] = ordered
      areaEarliest.set(area, startMin(ordered[0]))
    }

    // Re-key into a fresh object whose insertion order = area earliest
    // suggestedTime asc; areas with no scheduled time keep alpha tail order.
    const orderedAreas = Object.keys(sorted).sort((a, b) => {
      const ta = areaEarliest.get(a) ?? Number.POSITIVE_INFINITY
      const tb = areaEarliest.get(b) ?? Number.POSITIVE_INFINITY
      if (ta !== tb) return ta - tb
      return a.localeCompare(b)
    })
    const out: Record<string, Listing[]> = {}
    for (const a of orderedAreas) out[a] = sorted[a]
    return out
  }, [listingItems])
  const tourItems = useMemo(
    () =>
      workspaceTours.map((tour, index) => ({
        id: tour.id,
        title: tour.title,
        meta: `${tour.targetDate} · ${index === 0 ? listingItems.length : 0} listings`,
        active: index === 0,
      })),
    [listingItems.length, workspaceTours],
  )
  const tourStats = useMemo(
    () => [
      { label: "Listings", value: listingItems.length.toString() },
      { label: "Confirmed", value: listingItems.filter((listing) => listing.status === "confirmed").length.toString() },
      { label: "Needs attention", value: listingItems.filter((listing) => listing.status === "needs-attention").length.toString(), alert: true },
    ],
    [listingItems],
  )

  // ── Load plans from backend on mount ──
  useEffect(() => {
    api.fetchPlans().then((plans) => {
      if (plans.length) {
        setWorkspacePlans(plans)
        // Auto-select if there's only one plan
        if (plans.length === 1) {
          openPlan(plans[0].id)
        }
      }
    }).catch(() => { /* fallback: stays empty */ })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load static scheduling step catalogue (for progress UI labels) ──
  // The list is small + immutable, so we cache it on the api module side too.
  // Failing here just means progress UI uses fallback labels — not fatal.
  useEffect(() => {
    api
      .fetchSchedulingSteps()
      .then(setSchedulingSteps)
      .catch((e) => console.warn('[scheduling-steps] fetch failed:', e))
  }, [])

  const createPlan = async (draft: PlanDraft) => {
    try {
      const plan = await api.createPlan({
        title: draft.title.trim() || "Untitled buying plan",
        clientName: draft.clientName.trim() || "New client",
        clientWhatsapp: draft.clientWhatsapp?.trim() || undefined,
        brief: draft.brief.trim() || "Buyer requirements to be confirmed.",
      })
      setWorkspacePlans((current) => [plan, ...current])
    } catch (e) {
      // Same rationale as createTour: silently fabricating a local plan
      // causes downstream 404s for every tour/listing/scheduling call.
      console.error('[createPlan] failed:', e)
      alert(
        'Failed to create plan on backend: ' +
          (e instanceof Error ? e.message : String(e)) +
          '\nCheck backend logs and try again.',
      )
      return
    }

    setSelectedPlanId(null)
    setWorkspaceTours([])
    setListingItems([])
    setSelectedListingId(null)
    setSidePanel(null)
    setSchedulingStarted(false)
    setTimelineSlots([])
    setView("workspace")
  }

  const createTour = async (draft: TourDraft) => {
    if (!activePlan) return

    try {
      const tour = await api.createTour(activePlan.id, {
        title: draft.title.trim() || defaultTour.title,
        targetDate: draft.targetDate.trim() || defaultTour.targetDate,
        timeWindow: draft.timeWindow.trim() || defaultTour.timeWindow,
        command: draft.command.trim() || defaultTour.command,
      })
      setWorkspaceTours([tour])
      // Load listings from backend
      const backendListings = await api.fetchListings(tour.id)
      setListingItems(backendListings)
    } catch (e) {
      // Do NOT silently fabricate a local tour — it leads to "Tour not found"
      // the moment the user does anything network-y (import, scheduling, ...)
      // because the backend never saw this tour.
      console.error('[createTour] failed:', e)
      alert(
        'Failed to create tour on backend: ' +
          (e instanceof Error ? e.message : String(e)) +
          '\nCheck backend logs and try again.',
      )
      return
    }
    setImportText("")
    setSelectedListingId(null)
    setSidePanel(null)
    setSchedulingStarted(false)
    setSchedulingRunning(false)
    setTimelineSlots([])
  }

  const openPlan = async (planId: string) => {
    setSelectedPlanId(planId)
    setSelectedListingId(null)
    setSidePanel(null)

    try {
      const tours = await api.fetchToursByPlan(planId)
      if (tours.length) {
        setWorkspaceTours(tours)
        const tourListings = await api.fetchListings(tours[0].id)
        setListingItems(tourListings)
        // If any listing already has a final scheduling outcome, treat the
        // scheduling as "already done" so the UI shows the proper status
        // labels and time slots instead of "Not Started".
        const alreadyScheduled = tourListings.some(
          (l) => l.status === 'confirmed' || l.status === 'needs-attention',
        )
        setSchedulingStarted(alreadyScheduled)
        setSchedulingRunning(false)
        const slots: TimelineSlot[] = tourListings
          .filter((l) => l.status === 'confirmed' && l.suggestedTime)
          .map((l) => ({
            listingId: l.id,
            condoName: l.condo,
            date: tours[0].targetDate,
            time: l.suggestedTime!,
          }))
        setTimelineSlots(slots)
      } else {
        setWorkspaceTours([])
        setListingItems([])
        setSchedulingStarted(false)
        setSchedulingRunning(false)
        setTimelineSlots([])
      }
    } catch {
      // If API fails, keep existing state if same plan
      if (workspaceTours[0]?.planId !== planId) {
        setWorkspaceTours([])
        setListingItems([])
        setSchedulingStarted(false)
        setSchedulingRunning(false)
        setTimelineSlots([])
      }
    }
  }

  const backToPlans = () => {
    setSelectedPlanId(null)
    setSidePanel(null)
    setSelectedListingId(null)
    setSchedulingStarted(false)
    setTimelineSlots([])
  }

  const toggleRoute = () => {
    setView("workspace")
    setSidePanel((current) => (current === "route" ? null : "route"))
  }

  const toggleMap = () => {
    setView("workspace")
    setSidePanel((current) => (current === "map" ? null : "map"))
  }

  const startScheduling = async () => {
    setSchedulingStarted(true)
    setSchedulingRunning(true)
    setSchedulingRun(null)
    setSidePanel("route")

    if (!activeTour) { setSchedulingRunning(false); return }

    // 1) Seed mock conversations + buyer slots so the scheduler has real input
    try {
      const seed = await api.seedTourConversations(activeTour.id)
      console.log('[scheduling] seed result:', seed)
      // After seeding, listings on backend now have status='contacting' / availability filled.
      // Pull the fresh state into the UI immediately so each row shows "Scheduling".
      try {
        const seeded = await api.fetchListings(activeTour.id)
        if (seeded.length) setListingItems(seeded)
      } catch { /* keep current state */ }
    } catch (e) {
      console.warn('[scheduling] seed failed (continuing with whatever state we have):', e)
    }

    // 2) Kick off the real scheduler on backend
    let runId: string | null = null
    try {
      const run = await api.startSchedulingRun(activeTour.id)
      runId = run.id
      setSchedulingRun(run)
    } catch (e) {
      console.error('[scheduling] start failed:', e)
      setSchedulingRunning(false)
      return
    }

    // 3) Poll until completed/failed. We keep polling at 800ms — fast enough
    //    that the progress bar doesn't feel stuck on a single step, slow
    //    enough to not hammer the backend.
    pollSchedulingRun(runId)
  }

  /**
   * Drive the SchedulingProgress component by polling the run row. Updates
   * `schedulingRun` on every tick, then on completed/failed pulls fresh
   * listings + clears the running flag. Used by both the initial start
   * and the retry path.
   */
  const pollSchedulingRun = (runId: string) => {
    const startedAt = Date.now()
    const POLL_TIMEOUT_MS = 60_000
    const poll = setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        console.warn('[scheduling] poll timeout, giving up on run', runId)
        clearInterval(poll)
        setSchedulingRunning(false)
        return
      }
      try {
        const updated = await api.getSchedulingRun(runId)
        setSchedulingRun(updated)
        if (updated.status === 'completed' || updated.status === 'failed') {
          clearInterval(poll)
          if (updated.status === 'completed' && activeTour) {
            const fresh = await api.fetchListings(activeTour.id)
            if (fresh.length) setListingItems(fresh)
            const slots: TimelineSlot[] = fresh
              .filter((l) => l.status === 'confirmed' && l.suggestedTime)
              .map((l) => ({
                listingId: l.id,
                condoName: l.condo,
                date: activeTour?.targetDate ?? defaultTour.targetDate,
                time: l.suggestedTime!,
              }))
            setTimelineSlots(slots)
          }
          setSchedulingRunning(false)
          console.log('[scheduling] run', runId, 'finished:', updated.status, updated.result)
        }
      } catch (err) {
        console.warn('[scheduling] poll error, will retry:', err)
      }
    }, 800)
  }

  /**
   * User clicked "Retry from failed step" in the SchedulingProgress UI.
   * Backend resumes from the first non-'done' step.
   */
  const retryScheduling = async () => {
    if (!schedulingRun) return
    setSchedulingRunning(true)
    try {
      const refreshed = await api.retrySchedulingRun(schedulingRun.id)
      setSchedulingRun(refreshed)
      pollSchedulingRun(refreshed.id)
    } catch (e) {
      console.error('[scheduling] retry failed:', e)
      setSchedulingRunning(false)
    }
  }

  const toggleListing = (id: string) => {
    if (sidePanel === "listing" && selectedListingId === id) {
      setSelectedListingId(null)
      setSidePanel(null)
      return
    }

    setSelectedListingId(id)
    setSidePanel("listing")
  }

  const deleteListingItem = (id: string) => {
    setListingItems((current) => current.filter((listing) => listing.id !== id))
    if (selectedListingId === id) {
      setSelectedListingId(null)
      setSidePanel(null)
    }
    // Delete on backend
    if (activeTour) {
      api.deleteListing(activeTour.id, id).catch(() => {})
    }
  }

  const selectConversationListing = (id: string) => {
    setSelectedListingId(id)
  }

  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-[#f7f8fa] text-[#222222]">
      <AppHeader view={view} onChangeView={setView} onNewPlan={() => setNewPlanOpen(true)} hasUnreadConversations={hasUnreadConversations} onSignOut={onSignOut} currentUser={currentUser} />

      {view === "workspace" && activePlan && <PlanTopBar plan={activePlan} tour={activeTour} onBackToPlans={backToPlans} schedulingStarted={schedulingStarted} listings={listingItems} />}
      {view === "route" && activePlan && activeTour && <PlanTopBar plan={activePlan} tour={activeTour} onBackToPlans={backToPlans} schedulingStarted={schedulingStarted} listings={listingItems} />}

      <section className="min-h-0 flex-1 overflow-hidden">
        {view === "workspace" && !activePlan && (
          <WorkspaceHome plans={workspacePlans} onNewPlan={() => setNewPlanOpen(true)} onSelectPlan={openPlan} />
        )}
        {view === "workspace" && activePlan && !activeTour && (
          <PlanEmptyState plan={activePlan} onNewTour={() => setNewTourOpen(true)} />
        )}
        {view === "workspace" && activePlan && activeTour && (
          <PlanWorkspace
            activeTour={activeTour}
            groupedListings={groupedListings}
            listings={listingItems}
            selectedListing={selectedListing}
            sidePanel={sidePanel}
            tourItems={tourItems}
            tourStats={tourStats}
            schedulingStarted={schedulingStarted}
            schedulingRunning={schedulingRunning}
            schedulingRun={schedulingRun}
            schedulingSteps={schedulingSteps}
            onClosePanel={() => setSidePanel(null)}
            onSelectListing={toggleListing}
            onDeleteListing={deleteListingItem}
            importText={importText}
            setImportText={setImportText}
            onToggleRoute={toggleRoute}
            onToggleMap={toggleMap}
            onNewTour={() => setNewTourOpen(true)}
            onStartScheduling={startScheduling}
            onRetryScheduling={retryScheduling}
            onImportListings={(imported) => setListingItems((prev) => {
              const map = new Map(prev.map((l) => [l.id, l]))
              for (const l of imported) map.set(l.id, l)
              return [...map.values()]
            })}
          />
        )}
        {view === "conversations" && <ScrollablePage><Conversations listings={listingItems} selectedListing={selectedListing ?? listingItems[0] ?? null} activeTour={activeTour} onSelectListing={selectConversationListing} /></ScrollablePage>}
        {view === "route" && <ScrollablePage><AgentRouteView /></ScrollablePage>}
        {view === "settings" && <ScrollablePage><SettingsView /></ScrollablePage>}
      </section>

      <NewPlanDialog open={newPlanOpen} onOpenChange={setNewPlanOpen} onCreate={createPlan} />
      <NewTourDialog open={newTourOpen} onOpenChange={setNewTourOpen} onCreate={createTour} />
    </main>
  )
}

function AppHeader({
  view,
  onChangeView,
  onNewPlan,
  hasUnreadConversations,
  onSignOut,
  currentUser,
}: {
  view: View
  onChangeView: (view: View) => void
  onNewPlan: () => void
  hasUnreadConversations: boolean
  onSignOut: () => void
  currentUser: ButlerUser | null
}) {
  return (
    <header className="z-40 shrink-0 border-b border-[#e8e8e8] bg-white">
      <div className="flex h-16 items-center gap-4 px-5 lg:px-6">
        <button
          className="flex cursor-pointer items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2"
          onClick={() => onChangeView("workspace")}
        >
          <span className="grid size-9 place-items-center rounded-xl bg-[#ff385c] text-white shadow-sm">
            <Bot className="size-5" />
          </span>
          <span className="hidden text-left sm:block">
            <span className="block text-base font-bold tracking-[-0.2px]">Bulter</span>
            <span className="block text-[11px] font-semibold text-[#6a6a6a]">AI PA for property agents</span>
          </span>
        </button>

        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {navItems.map((item) => {
            const Icon = item.icon
            const hasUnread = item.id === "conversations" && hasUnreadConversations
            return (
              <button
                key={item.id}
                onClick={() => onChangeView(item.id)}
                className={`inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2 ${
                  view === item.id
                    ? hasUnread
                      ? "bg-[#222222] text-[#ff385c]"
                      : "bg-[#222222] text-white"
                    : hasUnread
                      ? "text-[#ff385c] hover:bg-[#fff5f7]"
                      : "text-[#6a6a6a] hover:bg-[#f2f2f2] hover:text-[#222222]"
                }`}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="hidden items-center gap-2 rounded-xl border border-[#dddddd] bg-white px-3 py-2 lg:flex">
          <Search className="size-4 text-[#6a6a6a]" />
          <span className="w-44 truncate text-sm font-medium text-[#6a6a6a]">Search plans, tours or listings</span>
        </div>

        <button
          onClick={onNewPlan}
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#ff385c] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#e00b41] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">New plan</span>
        </button>

        <div className="hidden items-center gap-2 rounded-xl border border-[#dddddd] px-3 py-2 xl:flex">
          <UserRound className="size-4 text-[#6a6a6a]" />
          <div className="text-xs">
            <p className="font-bold">{currentUser?.displayName || 'Guest'}</p>
            <button
              onClick={onSignOut}
              className="cursor-pointer text-[#6a6a6a] underline-offset-2 hover:text-[#ff385c] hover:underline"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}

function PlanTopBar({
  plan,
  tour,
  onBackToPlans,
  schedulingStarted,
  listings,
}: {
  plan: ViewingPlan
  tour: ViewingTour | null
  onBackToPlans: () => void
  schedulingStarted: boolean
  listings: Listing[]
}) {
  const total = listings.length

  return (
    <section className="z-30 shrink-0 border-b border-[#e8e8e8] bg-white px-5 py-3 lg:px-6">
      <div className="flex items-center justify-between gap-6 min-w-0">
        {/* Breadcrumb */}
        <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-[#6a6a6a] min-w-0">
          <button
            onClick={onBackToPlans}
            className="cursor-pointer rounded-lg px-2 py-1 text-[#6a6a6a] transition-colors hover:bg-[#f2f2f2] hover:text-[#222222] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2"
          >
            Workspace
          </button>
          <ChevronRight className="size-4" />
          <span className="truncate text-[#222222]">{plan.title}</span>
          <ChevronRight className="size-4" />
          <span className="truncate text-[#222222]">{tour?.title ?? "No tour yet"}</span>
        </div>

        {/* Scheduling progress bar */}
        {schedulingStarted && total > 0 && (
          <div className="shrink-0 flex items-center gap-1">
            {[
              ...listings.filter((l) => l.status === "confirmed"),
              ...listings.filter((l) => l.status === "contacting" || l.status === "needs-attention"),
              ...listings.filter((l) => l.status !== "confirmed" && l.status !== "contacting" && l.status !== "needs-attention"),
            ].map((listing) => (
              <div
                key={listing.id}
                className={`h-2 w-8 rounded-full transition-all duration-500 ${
                  listing.status === "confirmed"
                    ? "bg-[#22c55e]"
                    : listing.status === "contacting" || listing.status === "needs-attention"
                    ? "bg-[#ff385c]/40"
                    : "bg-[#e8e8e8]"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function WorkspaceHome({
  plans,
  onNewPlan,
  onSelectPlan,
}: {
  plans: ViewingPlan[]
  onNewPlan: () => void
  onSelectPlan: (id: string) => void
}) {
  return (
    <div className="h-full overflow-y-auto px-5 py-6 lg:px-6">
      <section className="mx-auto flex min-h-full max-w-6xl flex-col">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-[#ff385c]">Workspace</p>
            <h1 className="mt-2 text-4xl font-bold tracking-[-0.48px]">Start from a clean plan board.</h1>
            <p className="mt-3 max-w-none whitespace-nowrap text-sm leading-6 text-[#6a6a6a]">
              Create a client plan first. Tours, imported listings, AI scheduling and route sharing will appear only after a plan is selected.
            </p>
          </div>
        </div>

        {plans.length === 0 ? (
          <div className="mt-8 grid flex-1 place-items-center rounded-[36px] border border-dashed border-[#dddddd] bg-white p-8 text-center shadow-sm">
            <div className="max-w-lg">
              <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-[#fff5f7] text-[#ff385c]">
                <FilePlus2 className="size-7" />
              </div>
              <h2 className="mt-5 text-2xl font-bold tracking-[-0.3px]">No plans in this workspace yet.</h2>
              <p className="mt-3 text-sm leading-6 text-[#6a6a6a]">
                Keep the workspace empty until an Agent creates a client-specific plan. This prevents mock tours and listings from appearing before the workflow starts.
              </p>
              <button
                onClick={onNewPlan}
                className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-[#222222] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[#ff385c] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2"
              >
                Create new plan <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {plans.map((plan) => (
              <button
                key={plan.id}
                onClick={() => onSelectPlan(plan.id)}
                className="group cursor-pointer rounded-[28px] border border-[#eeeeee] bg-white p-5 text-left shadow-sm transition hover:border-[#222222] hover:shadow-[0_14px_36px_rgba(0,0,0,0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="grid size-11 place-items-center rounded-2xl bg-[#fff5f7] text-[#ff385c]">
                    <Building2 className="size-5" />
                  </div>
                  <span className="rounded-full bg-[#f7f7f7] px-3 py-1 text-xs font-bold text-[#6a6a6a]">No tour yet</span>
                </div>
                <h2 className="mt-5 text-xl font-bold tracking-[-0.2px] group-hover:text-[#ff385c]">{plan.title}</h2>
                <p className="mt-1 text-sm font-semibold text-[#6a6a6a]">{plan.clientName}</p>
                <p className="mt-4 line-clamp-3 text-sm leading-6 text-[#6a6a6a]">{plan.brief}</p>
                <div className="mt-5 flex items-center justify-between border-t border-[#eeeeee] pt-4 text-sm font-bold">
                  <span>Open plan</span>
                  <ChevronRight className="size-4 text-[#b0b0b0] transition-transform group-hover:translate-x-1 group-hover:text-[#222222]" />
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function PlanEmptyState({ plan, onNewTour }: { plan: ViewingPlan; onNewTour: () => void }) {
  return (
    <div className="h-full overflow-y-auto px-5 py-6 lg:px-6">
      <section className="mx-auto grid min-h-full max-w-6xl place-items-center">
        <div className="grid w-full gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-stretch">
          <div className="rounded-[36px] bg-white p-8 shadow-[rgba(0,0,0,0.02)_0px_0px_0px_1px,rgba(0,0,0,0.04)_0px_2px_8px]">
            <p className="text-sm font-bold text-[#ff385c]">Selected plan</p>
            <h1 className="mt-3 text-4xl font-bold tracking-[-0.5px]">{plan.title}</h1>
            <p className="mt-2 text-sm font-semibold text-[#6a6a6a]">Client: {plan.clientName}</p>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-[#6a6a6a]">{plan.brief}</p>

            <div className="mt-8 rounded-[28px] border border-dashed border-[#dddddd] bg-[#fafafa] p-6 text-center">
              <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-white text-[#ff385c] shadow-sm">
                <Route className="size-6" />
              </div>
              <h2 className="mt-4 text-2xl font-bold tracking-[-0.25px]">This plan has no tours yet.</h2>
              <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">
                Create the first tour before showing Property Listing, map, route and AI scheduling controls.
              </p>
              <button
                onClick={onNewTour}
                className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-[#ff385c] px-5 py-3 text-sm font-bold text-white shadow-[0_10px_24px_rgba(255,56,92,0.24)] transition-colors hover:bg-[#e00b41] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2"
              >
                Create First Tour For This Plan <Plus className="size-4" />
              </button>
            </div>
          </div>

          <aside className="rounded-[36px] bg-[#222222] p-6 text-white">
            <p className="text-sm font-bold text-white/60">Flow guard</p>
            <div className="mt-5 space-y-4">
              {[
                ["1", "Add Tour for this plan"],
                ["2", "Import PropertyGuru listings"],
                ["3", "Run AI auto scheduling"],
                ["4", "Generate final viewing route"],
              ].map(([step, label]) => (
                <div key={step} className="flex items-center gap-3 rounded-2xl bg-white/8 p-3">
                  <span className="grid size-8 place-items-center rounded-full bg-white text-xs font-bold text-[#222222]">{step}</span>
                  <span className="text-sm font-bold">{label}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>
    </div>
  )
}

function PlanWorkspace({
  activeTour,
  groupedListings,
  listings: workspaceListings,
  selectedListing,
  sidePanel,
  tourItems,
  tourStats,
  schedulingStarted,
  schedulingRunning,
  schedulingRun,
  schedulingSteps,
  onClosePanel,
  onSelectListing,
  onDeleteListing,
  importText,
  setImportText,
  onToggleRoute,
  onToggleMap,
  onNewTour,
  onStartScheduling,
  onRetryScheduling,
  onImportListings,
}: {
  activeTour: ViewingTour
  groupedListings: Record<string, Listing[]>
  listings: Listing[]
  selectedListing: Listing | null
  sidePanel: SidePanel
  tourItems: Array<{ id: string; title: string; meta: string; active: boolean }>
  tourStats: Array<{ label: string; value: string; alert?: boolean }>
  schedulingStarted: boolean
  schedulingRunning: boolean
  schedulingRun: api.SchedulingRun | null
  schedulingSteps: api.SchedulingStepDef[]
  onClosePanel: () => void
  onSelectListing: (id: string) => void
  onDeleteListing: (id: string) => void
  importText: string
  setImportText: (value: string) => void
  onToggleRoute: () => void
  onToggleMap: () => void
  onNewTour: () => void
  onStartScheduling: () => void
  onRetryScheduling: () => void
  onImportListings: (listings: Listing[]) => void
}) {
  // Area · Status filter (purely client-side; resets when underlying listings change)
  const [filterOpen, setFilterOpen] = useState(false)
  const [areaFilter, setAreaFilter] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = useState<ListingStatus[]>([])

  const allAreas = useMemo(() => {
    const s = new Set<string>()
    for (const l of workspaceListings) if (l.area) s.add(l.area)
    return Array.from(s).sort()
  }, [workspaceListings])
  const allStatuses = useMemo(() => {
    const s = new Set<ListingStatus>()
    for (const l of workspaceListings) s.add(l.status)
    return Array.from(s)
  }, [workspaceListings])

  const filteredGroupedListings = useMemo(() => {
    if (areaFilter.length === 0 && statusFilter.length === 0) return groupedListings
    const out: Record<string, Listing[]> = {}
    for (const [area, items] of Object.entries(groupedListings)) {
      if (areaFilter.length && !areaFilter.includes(area)) continue
      const kept = statusFilter.length ? items.filter((l) => statusFilter.includes(l.status)) : items
      if (kept.length) out[area] = kept
    }
    return out
  }, [groupedListings, areaFilter, statusFilter])

  const filterCount = areaFilter.length + statusFilter.length
  const toggleArea = (a: string) =>
    setAreaFilter((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]))
  const toggleStatus = (s: ListingStatus) =>
    setStatusFilter((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  const clearFilters = () => { setAreaFilter([]); setStatusFilter([]) }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
      <PlanSidebar tourItems={tourItems} tourStats={tourStats} onNewTour={onNewTour} />

      <div className={`grid min-h-0 transition-[grid-template-columns] duration-200 ${sidePanel ? "xl:grid-cols-[minmax(0,1fr)_400px]" : "xl:grid-cols-[minmax(0,1fr)_0px]"}`}>
        <section className="flex min-h-0 flex-col overflow-hidden px-5 py-5 lg:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold tracking-[-0.2px]">Property Listing</h2>
            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <button
                  onClick={() => setFilterOpen((o) => !o)}
                  className={`toolbar-button focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2 ${filterCount > 0 || filterOpen ? "border-[#222222] bg-[#222222] text-white" : "bg-white"}`}
                  aria-expanded={filterOpen}
                >
                  <ListFilter className="size-4" /> Area · Status
                  {filterCount > 0 && (
                    <span className={`ml-1 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-bold ${filterCount > 0 && !filterOpen ? "bg-white text-[#222222]" : "bg-[#ff385c] text-white"}`}>
                      {filterCount}
                    </span>
                  )}
                </button>
                {filterOpen && (
                  <>
                    {/* click-outside catcher */}
                    <div className="fixed inset-0 z-10" onClick={() => setFilterOpen(false)} />
                    <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 w-72 rounded-2xl border border-[#e8e8e8] bg-white p-4 shadow-[0_18px_60px_rgba(0,0,0,0.16)]">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold">Filter</p>
                        <button onClick={clearFilters} className="text-xs font-semibold text-[#6a6a6a] hover:text-[#222222]" disabled={filterCount === 0}>
                          Clear
                        </button>
                      </div>

                      <p className="mt-3 text-xs font-bold text-[#6a6a6a]">AREA</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {allAreas.length === 0 && <span className="text-xs text-[#6a6a6a]">(no areas)</span>}
                        {allAreas.map((a) => {
                          const active = areaFilter.includes(a)
                          return (
                            <button
                              key={a}
                              onClick={() => toggleArea(a)}
                              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${active ? "border-[#222222] bg-[#222222] text-white" : "border-[#dddddd] bg-white text-[#222222] hover:border-[#222222]"}`}
                            >
                              {a}
                            </button>
                          )
                        })}
                      </div>

                      <p className="mt-3 text-xs font-bold text-[#6a6a6a]">STATUS</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {allStatuses.length === 0 && <span className="text-xs text-[#6a6a6a]">(no listings)</span>}
                        {allStatuses.map((s) => {
                          const active = statusFilter.includes(s)
                          return (
                            <button
                              key={s}
                              onClick={() => toggleStatus(s)}
                              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${active ? "border-[#222222] bg-[#222222] text-white" : "border-[#dddddd] bg-white text-[#222222] hover:border-[#222222]"}`}
                            >
                              {schedulingLabel[s]}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <button onClick={onToggleMap} className={`toolbar-button focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2 ${sidePanel === "map" ? "border-[#222222] bg-[#222222] text-white" : "bg-white"}`}>
                <MapIcon className="size-4" /> Map
              </button>
              <button onClick={onToggleRoute} className={`toolbar-button focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2 ${sidePanel === "route" ? "border-[#222222] bg-[#222222] text-white" : "bg-white"}`}>
                <Route className="size-4" /> Route
              </button>
            </div>
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-6 pb-28">
              {Object.entries(filteredGroupedListings).length === 0 && filterCount > 0 && (
                <div className="rounded-2xl border border-dashed border-[#dddddd] bg-[#fafafa] p-6 text-center text-sm text-[#6a6a6a]">
                  No listings match the current filter.
                  <button onClick={clearFilters} className="ml-2 font-bold text-[#ff385c] hover:underline">Clear filter</button>
                </div>
              )}
              {Object.entries(filteredGroupedListings).map(([area, areaListings]) => (
                <ListingGroup
                  key={area}
                  area={area}
                  listings={areaListings}
                  selectedListingId={selectedListing?.id ?? null}
                  onSelectListing={onSelectListing}
                  schedulingStarted={schedulingStarted}
                />
              ))}
            </div>
          </div>

          <div className="shrink-0 pt-4">
            {/* Phase 1 §8.6 — replaces the old standalone spinner with a
                named-step progress panel. Only visible while a run is in
                flight or has just finished/failed. */}
            {(schedulingRunning || schedulingRun) && (
              <div className="pb-3">
                <SchedulingProgress
                  run={schedulingRun}
                  steps={schedulingSteps}
                  onRetry={onRetryScheduling}
                />
              </div>
            )}
            <TourActionDock
              activeTour={activeTour}
              importText={importText}
              setImportText={setImportText}
              schedulingStarted={schedulingStarted}
              schedulingRunning={schedulingRunning}
              onStartScheduling={onStartScheduling}
              onImportListings={onImportListings}
            />
          </div>
        </section>

        <ContextPanel
          listings={workspaceListings}
          sidePanel={sidePanel}
          selectedListing={selectedListing}
          activeTourId={activeTour.id}
          onClose={onClosePanel}
          onDeleteListing={onDeleteListing}
        />
      </div>
    </div>
  )
}

function PlanSidebar({
  tourItems,
  tourStats,
  onNewTour,
}: {
  tourItems: Array<{ id: string; title: string; meta: string; active: boolean }>
  tourStats: Array<{ label: string; value: string; alert?: boolean }>
  onNewTour: () => void
}) {
  return (
    <aside className="hidden min-h-0 border-r border-[#e8e8e8] bg-white p-4 lg:block">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-[#6a6a6a]">Tours</h2>
        <button
          onClick={onNewTour}
          className="grid size-8 cursor-pointer place-items-center rounded-lg bg-[#ff385c] text-white transition-colors hover:bg-[#e00b41] focus:outline-none focus:ring-2 focus:ring-[#222222] focus:ring-offset-2"
          aria-label="Create new tour"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {tourItems.map((tour) => (
          <button
            key={tour.id}
            className={`w-full cursor-pointer rounded-2xl p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-[#222222] focus:ring-offset-2 ${
              tour.active ? "bg-[#222222] text-white" : "hover:bg-[#f7f7f7]"
            }`}
          >
            <p className="truncate text-sm font-bold">{tour.title}</p>
            <p className={`mt-1 text-xs font-medium ${tour.active ? "text-white/70" : "text-[#6a6a6a]"}`}>{tour.meta}</p>
          </button>
        ))}
      </div>

      <div className="mt-5 rounded-2xl border border-[#eeeeee] bg-[#fafafa] p-3">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#6a6a6a]">Tour progress</p>
        <div className="mt-3 space-y-3">
          {tourStats.map((stat) => (
            <div key={stat.label} className="flex items-center justify-between text-sm">
              <span className="font-medium text-[#6a6a6a]">{stat.label}</span>
              <span className={`font-bold ${stat.alert ? "text-[#c13515]" : "text-[#222222]"}`}>{stat.value}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}

function TourActionDock({
  activeTour,
  importText,
  setImportText,
  schedulingStarted,
  schedulingRunning,
  onStartScheduling,
  onImportListings,
}: {
  activeTour: ViewingTour
  importText: string
  setImportText: (value: string) => void
  schedulingStarted: boolean
  schedulingRunning: boolean
  onStartScheduling: () => void
  onImportListings: (listings: Listing[]) => void
}) {
  const [scheduleConfigOpen, setScheduleConfigOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importStatus, setImportStatus] = useState<string>("")
  const [extensionInstalled, setExtensionInstalled] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    pingExtension().then(async (ok) => {
      if (cancelled) return
      setExtensionInstalled(ok)
      // Belt-and-suspenders: also push the user token here, in addition to
      // the AppRoot-level effect. Covers the case where the extension was
      // installed/reloaded AFTER the user signed in (so AppRoot's user-change
      // effect already ran when the extension wasn't reachable yet).
      if (ok) {
        const token = getStoredToken()
        if (token) {
          await storeTokenInExtension(token).catch(() => {})
        }
      }
    })
    return () => { cancelled = true }
  }, [])
  const [selectedDates, setSelectedDates] = useState<string[]>([activeTour.targetDate])
  const [startTime, setStartTime] = useState("10:00")
  const [endTime, setEndTime] = useState("16:30")
  const [customRequirement, setCustomRequirement] = useState(activeTour.command)
  const dateOptions = [activeTour.targetDate, "Tomorrow", "Fri", "Sat"]

  const toggleDate = (date: string) => {
    setSelectedDates((current) =>
      current.includes(date) ? current.filter((item) => item !== date) : [...current, date],
    )
  }

  return (
    <div className="sticky bottom-4 z-20">
      <div className="relative">
        {scheduleConfigOpen && (
          <section className="absolute bottom-[calc(100%+0.75rem)] right-0 w-full max-w-2xl rounded-[28px] border border-[#e8e8e8] bg-white/95 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.16)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-bold"><Settings className="size-4 text-[#ff385c]" /> AI scheduling settings</p>
                <p className="mt-1 text-xs font-semibold text-[#6a6a6a]">Choose dates, time window, and custom scheduling requirements.</p>
              </div>
              <button
                onClick={() => setScheduleConfigOpen(false)}
                className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-xl border border-[#dddddd] text-[#6a6a6a] transition-colors hover:border-[#222222] hover:text-[#222222] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2"
                aria-label="Close scheduling settings"
              >
                <PanelRightClose className="size-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6a6a6a]"><Calendar className="size-3.5" /> Dates</p>
                <div className="flex flex-wrap gap-2">
                  {dateOptions.map((date) => {
                    const active = selectedDates.includes(date)
                    return (
                      <button
                        key={date}
                        onClick={() => toggleDate(date)}
                        className={`cursor-pointer rounded-full border px-3 py-2 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2 ${active ? "border-[#222222] bg-[#222222] text-white" : "border-[#dddddd] bg-white text-[#6a6a6a] hover:border-[#222222] hover:text-[#222222]"}`}
                      >
                        {date}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#6a6a6a]">
                  Start time
                  <input
                    type="time"
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                    className="mt-2 h-11 w-full rounded-2xl border border-[#dddddd] bg-white px-3 text-[13px] font-semibold normal-case tracking-normal text-[#222222] outline-none transition focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10"
                  />
                </label>
                <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#6a6a6a]">
                  End time
                  <input
                    type="time"
                    value={endTime}
                    onChange={(event) => setEndTime(event.target.value)}
                    className="mt-2 h-11 w-full rounded-2xl border border-[#dddddd] bg-white px-3 text-[13px] font-semibold normal-case tracking-normal text-[#222222] outline-none transition focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10"
                  />
                </label>
              </div>

              <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#6a6a6a]">
                Custom requirement
                <textarea
                  value={customRequirement}
                  onChange={(event) => setCustomRequirement(event.target.value)}
                  className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-[#dddddd] bg-white p-3 text-sm font-medium leading-6 normal-case tracking-normal text-[#222222] outline-none transition focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10"
                  placeholder="Tell AI how to schedule this tour..."
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#fafafa] p-3">
                <p className="text-xs font-semibold text-[#6a6a6a]">
                  {selectedDates.length || 0} dates · {startTime} - {endTime}
                </p>
                <button
                  onClick={() => setScheduleConfigOpen(false)}
                  className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#222222] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#ff385c] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2"
                >
                  Confirm <CheckCircle2 className="size-4" />
                </button>
              </div>
            </div>
          </section>
        )}

        {extensionInstalled === false && (
          <div className="mb-3 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-[13px] text-amber-900">
            <CircleAlert className="size-4 flex-none" />
            <div className="flex-1 min-w-0">
              Install <span className="font-semibold">Butler PG Importer</span> to enable
              <span className="font-semibold"> Import via Extension</span> (more reliable than the server-side scraper, also pulls agent contact).
            </div>
            <a
              href="https://chromewebstore.google.com/detail/melnenopfkellcalpdbopiickpmidjld"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-none rounded-xl bg-amber-900 px-3 py-1.5 text-xs font-semibold text-amber-50 hover:bg-amber-950"
            >
              Install
            </a>
          </div>
        )}

        <section className="rounded-[28px] border border-white/70 bg-white/90 p-3 shadow-[0_16px_48px_rgba(0,0,0,0.16)] backdrop-blur-xl">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <label className="flex min-w-0 flex-1 items-center gap-3">
              <input
                value={importText}
                onChange={(event) => {
                  // Normalize on input: collapse internal whitespace/newlines
                  // (common when pasting multi-line URLs from chat apps) but do
                  // NOT trim — preserve the leading/trailing positions so the
                  // cursor behaves intuitively while typing.
                  const v = event.target.value.replace(/\s+/g, " ")
                  setImportText(v)
                }}
                className="h-12 min-w-0 flex-1 rounded-2xl border border-[#dddddd] bg-white px-4 text-sm font-medium outline-none transition focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10"
                aria-label="PropertyGuru listing URL"
                placeholder="Paste a PropertyGuru listing URL"
              />
            </label>

            <div className="flex flex-wrap justify-stretch gap-2 xl:justify-end">
              {/* Original path — server-side Playwright scraper. Always available
                  for environments where the backend can reach PG (e.g. local dev). */}
              <button
                onClick={async () => {
                  const url = importText.trim()
                  if (!url) return
                  if (!activeTour?.id) {
                    alert('Please create or open a tour first.')
                    return
                  }
                  console.log('[import:server] tourId=', activeTour.id, 'url=', url)
                  setImporting(true)
                  setImportStatus("Importing via server (Playwright)…")
                  try {
                    const result = await api.importListingsForTour(activeTour.id, url)
                    console.log('[import:server] stats:', result.stats)
                    onImportListings(result.listings)
                    setImportText("")
                    setImportStatus("")
                  } catch (err) {
                    console.error('[import:server] FAILED:', err)
                    setImportStatus(err instanceof Error ? err.message : String(err))
                  } finally {
                    setImporting(false)
                  }
                }}
                disabled={importing || !importText.trim()}
                className={`inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#222222] focus:ring-offset-2 sm:flex-none ${importing || !importText.trim() ? "cursor-not-allowed bg-[#b0b0b0]" : "bg-[#222222] hover:bg-[#ff385c]"}`}
              >
                {importing ? (
                  <>Importing... <span className="inline-block size-4 animate-spin rounded-full border-2 border-white border-t-transparent" /></>
                ) : (
                  <>Import URL <Upload className="size-4" /></>
                )}
              </button>

              {/* Extension path — opens PG in a new tab, runs advanced+reveal in
                  the user's logged-in browser, posts to backend, closes the tab. */}
              <button
                onClick={async () => {
                  const url = importText.trim()
                  if (!url) return
                  if (!activeTour?.id) {
                    alert('Please create or open a tour first.')
                    return
                  }
                  if (!extensionInstalled) {
                    alert('Butler PG Importer extension is not installed or not connected.')
                    return
                  }
                  console.log('[import:ext] tourId=', activeTour.id, 'url=', url)
                  setImporting(true)
                  setImportStatus("Opening PropertyGuru in a new tab…")
                  try {
                    // Belt-and-suspenders: make sure the extension has the
                    // current user token right before we hand off to it.
                    const token = getStoredToken()
                    if (token) {
                      await storeTokenInExtension(token).catch(() => {})
                    }
                    const { taskId } = await importViaTab({
                      tourId: activeTour.id,
                      url,
                      reveal: true,
                    })
                    setImportStatus("Extracting via extension…")
                    const result = await waitForImportResult(taskId)
                    if (!result.ok) throw new Error(result.error || 'Extension import failed')
                    const fresh = await api.fetchListings(activeTour.id)
                    onImportListings(fresh)
                    if (result.importedId) {
                      setTimeout(() => {
                        const el = document.getElementById(`listing-${result.importedId}`)
                        if (el) {
                          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                          el.classList.add('butler-just-imported')
                          setTimeout(() => el.classList.remove('butler-just-imported'), 2000)
                        }
                      }, 100)
                    }
                    setImportText("")
                    setImportStatus("")
                  } catch (err) {
                    console.error('[import:ext] FAILED:', err)
                    setImportStatus(err instanceof Error ? err.message : String(err))
                  } finally {
                    setImporting(false)
                  }
                }}
                disabled={importing || !importText.trim() || !extensionInstalled}
                title={!extensionInstalled ? 'Install Butler PG Importer extension first' : 'Import via the Butler Chrome extension'}
                className={`inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-[#222222] focus:ring-offset-2 sm:flex-none ${
                  importing || !importText.trim() || !extensionInstalled
                    ? 'cursor-not-allowed bg-[#e5e7eb] text-[#9ca3af]'
                    : 'bg-[#2563eb] text-white hover:bg-[#1d4ed8]'
                }`}
              >
                <Link2 className="size-4" />
                Import via Extension
              </button>

              <div className="inline-flex flex-[1.4] sm:flex-none">
                <button
                  onClick={onStartScheduling}
                  disabled={schedulingRunning}
                  className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-l-2xl px-5 py-3 text-sm font-bold text-white shadow-[0_10px_24px_rgba(255,56,92,0.28)] transition-colors focus:outline-none focus:ring-2 focus:ring-[#222222] focus:ring-offset-2 ${schedulingRunning ? "cursor-not-allowed bg-[#b0b0b0] shadow-none" : "bg-[#ff385c] hover:bg-[#e00b41]"}`}
                >
                  {/* When schedulingRunning, the SchedulingProgress panel
                      above already shows the live state. The button itself
                      just stays disabled with a neutral label so the user's
                      attention stays on the progress card. */}
                  {schedulingRunning ? (
                    <>Scheduling…</>
                  ) : schedulingStarted ? (
                    <>Re-run AI scheduling <Send className="size-4" /></>
                  ) : (
                    <>Start AI scheduling <Send className="size-4" /></>
                  )}
                </button>
                <button
                  onClick={() => setScheduleConfigOpen((open) => !open)}
                  className={`grid min-w-12 cursor-pointer place-items-center rounded-r-2xl border-l border-white/25 px-3 text-white shadow-[0_10px_24px_rgba(255,56,92,0.28)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2 ${scheduleConfigOpen ? "bg-[#c13515]" : "bg-[#ff385c] hover:bg-[#e00b41]"}`}
                  aria-label="Configure AI scheduling"
                  aria-expanded={scheduleConfigOpen}
                >
                  <Settings className="size-4" />
                </button>
              </div>
            </div>
          </div>
          {importStatus && (
            <div className="mt-2 px-1 text-xs text-[#666]">{importStatus}</div>
          )}
        </section>
      </div>
    </div>
  )
}

function ListingGroup({
  area,
  listings: areaListings,
  selectedListingId,
  onSelectListing,
  schedulingStarted,
}: {
  area: string
  listings: Listing[]
  selectedListingId: string | null
  onSelectListing: (id: string) => void
  schedulingStarted: boolean
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <MapPin className="size-4 text-[#ff385c]" />
        <h3 className="text-sm font-bold uppercase tracking-[0.1em] text-[#6a6a6a]">{area}</h3>
        <span className="rounded-full bg-[#eeeeee] px-2 py-0.5 text-xs font-bold text-[#6a6a6a]">{areaListings.length}</span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[#e8e8e8] bg-white shadow-sm">
        {areaListings.map((listing) => (
          <ListingRow
            key={listing.id}
            listing={listing}
            active={listing.id === selectedListingId}
            onSelect={() => onSelectListing(listing.id)}
            schedulingStarted={schedulingStarted}
          />
        ))}
      </div>
    </section>
  )
}

function ListingRow({ listing, active, onSelect, schedulingStarted }: { listing: Listing; active: boolean; onSelect: () => void; schedulingStarted: boolean }) {
  const priceStr = typeof listing.price === 'string' ? listing.price : String(listing.price ?? '')
  const formattedPrice = priceStr.replace("$", "S$ ")
  const sqftLabel = typeof listing.sqft === 'number' && Number.isFinite(listing.sqft)
    ? listing.sqft.toLocaleString()
    : String(listing.sqft ?? 0)
  const displayStatus = schedulingStarted ? listing.status : "imported"
  const displayLabel = schedulingTone[displayStatus]
  const statusText = schedulingStarted ? schedulingLabel[listing.status] : "Not Started"

  return (
    <button
      id={`listing-${listing.id}`}
      onClick={onSelect}
      className={`grid w-full cursor-pointer gap-4 border-b border-[#eeeeee] p-4 text-left transition-colors last:border-b-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#222222] lg:grid-cols-[72px_minmax(200px,1.2fr)_minmax(240px,1fr)_minmax(110px,0.5fr)_minmax(140px,0.6fr)] lg:items-center ${
        active ? "bg-[#fff5f7]" : "hover:bg-[#fafafa]"
      }`}
    >
      <img src={listing.imageUrl} alt={listing.condo} className="h-16 w-full rounded-xl object-cover lg:h-14 lg:w-[72px]" />

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`size-2.5 shrink-0 rounded-full ${schedulingStarted ? statusDot[listing.status] : "bg-[#b0b0b0]"}`} />
          <h4 className="truncate font-bold tracking-[-0.15px]">{listing.condo}</h4>
        </div>
        <p className="mt-1 truncate text-sm text-[#6a6a6a]">{listing.address}</p>
      </div>

      <div className="flex flex-nowrap items-center gap-3 overflow-hidden">
        <div className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-[#222222]">
          <BedDouble className="size-4 shrink-0 text-[#9ca3af]" />
          <span className="whitespace-nowrap">{listing.beds}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-[#222222]">
          <Bath className="size-4 shrink-0 text-[#9ca3af]" />
          <span className="whitespace-nowrap">{listing.baths}</span>
        </div>
        <span className="shrink-0 text-[#dddddd]">·</span>
        <div className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-[#222222]">
          <Ruler className="size-4 shrink-0 text-[#9ca3af]" />
          <span className="whitespace-nowrap">{sqftLabel} sqft</span>
        </div>
        <span className="shrink-0 text-[#dddddd]">·</span>
        <div className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-[#6a6a6a]">
          <span className="whitespace-nowrap">S$ {listing.psf} psf</span>
        </div>
      </div>

      <div>
        <p className="text-base font-bold tracking-[-0.2px] text-[#222222]">{formattedPrice}</p>
      </div>

      <div className="flex flex-col items-center gap-1">
        {schedulingStarted && listing.status === "confirmed" && listing.suggestedTime ? (
          <p className="whitespace-nowrap text-sm font-bold text-[#6a6a6a]">{listing.suggestedTime}</p>
        ) : (
          <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-bold ${displayLabel}`}>
            {statusText}
          </span>
        )}
      </div>
    </button>
  )
}

export function ViewingTimeline({ slots, listings }: { slots: TimelineSlot[]; listings: Listing[] }) {
  const sortedSlots = slots.slice().sort((a, b) => a.time.localeCompare(b.time))

  const getListingStatus = (listingId: string): ListingStatus => {
    return listings.find((l) => l.id === listingId)?.status ?? "imported"
  }

  return (
    <aside className="lg:sticky lg:top-5 h-fit">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2.5">
        <div className="grid size-7 place-items-center rounded-lg bg-[#222222]">
          <Calendar className="size-3.5 text-white" />
        </div>
        <div>
          <h3 className="text-sm font-bold tracking-[-0.1px] text-[#222222]">Viewing Schedule</h3>
          {sortedSlots.length > 0 && (
            <p className="text-[11px] text-[#9ca3af]">{sortedSlots.length} confirmed</p>
          )}
        </div>
      </div>

      {sortedSlots.length === 0 ? (
        /* Empty state */
        <div className="rounded-2xl border border-dashed border-[#e0e0e0] bg-[#fafafa] px-5 py-8 text-center">
          <div className="mx-auto mb-3 grid size-9 place-items-center rounded-xl border border-[#e8e8e8] bg-white shadow-sm">
            <Calendar className="size-4 text-[#b0b0b0]" />
          </div>
          <p className="text-xs font-semibold text-[#6a6a6a]">AI is contacting agents</p>
          <p className="mt-1 text-[11px] leading-4 text-[#b0b0b0]">Confirmed slots will<br />appear here</p>
        </div>
      ) : (
        <div className="relative">
          {/* Continuous vertical line */}
          <div className="absolute left-[15px] top-3 bottom-3 w-px bg-gradient-to-b from-[#222222]/20 via-[#222222]/10 to-transparent" />

          <div className="space-y-0">
            {sortedSlots.map((slot, index) => {
              const status = getListingStatus(slot.listingId)
              const isConfirmed = status === "confirmed"

              return (
                <div key={`${slot.listingId}-${index}`} className="relative flex items-start gap-4 pb-5 last:pb-0">
                  {/* Node */}
                  <div className="relative z-10 mt-0.5 shrink-0">
                    {isConfirmed ? (
                      <div className="size-[30px] rounded-full border-4 border-white bg-[#222222] shadow-[0_0_0_1px_#e0e0e0]" />
                    ) : (
                      <div className="size-[30px] rounded-full border-4 border-white bg-[#e8e8e8] shadow-[0_0_0_1px_#e0e0e0]" />
                    )}
                    {/* Order number */}
                    <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold ${isConfirmed ? "text-white" : "text-[#9ca3af]"}`}>
                      {index + 1}
                    </span>
                  </div>

                  {/* Content card */}
                  <div className={`min-w-0 flex-1 rounded-xl border p-3 transition-colors ${
                    isConfirmed
                      ? "border-[#e8e8e8] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
                      : "border-[#f0f0f0] bg-[#fafafa]"
                  }`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`text-xs font-bold tracking-[-0.1px] ${isConfirmed ? "text-[#ff385c]" : "text-[#b0b0b0]"}`}>
                          {isConfirmed ? slot.time : "Pending"}
                        </p>
                        <p className="mt-0.5 truncate text-sm font-semibold text-[#222222]">{slot.condoName}</p>
                      </div>
                      {isConfirmed && (
                        <div className="mt-0.5 shrink-0 rounded-md bg-[#f3fbf5] px-1.5 py-0.5">
                          <CheckCircle2 className="size-3.5 text-[#22c55e]" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Summary footer */}
          {sortedSlots.length > 0 && (
            <div className="mt-4 rounded-xl border border-[#f0f0f0] bg-[#fafafa] px-3 py-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[#9ca3af]">Total duration</p>
                <p className="text-xs font-bold text-[#222222]">~{sortedSlots.length * 45} min</p>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <p className="text-xs text-[#9ca3af]">Est. travel</p>
                <p className="text-xs font-bold text-[#222222]">~{sortedSlots.length * 15} min</p>
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

function ContextPanel({
  listings: panelListings,
  sidePanel,
  selectedListing,
  activeTourId,
  onClose,
  onDeleteListing,
}: {
  listings: Listing[]
  sidePanel: SidePanel
  selectedListing: Listing | null
  activeTourId: string
  onClose: () => void
  onDeleteListing: (id: string) => void
}) {
  return (
    <aside className={`min-h-0 overflow-hidden border-l border-[#e8e8e8] bg-white transition-opacity duration-200 ${sidePanel ? "opacity-100" : "pointer-events-none opacity-0"}`}>
      {sidePanel === "map" && <MapPanel listings={panelListings} onClose={onClose} />}
      {sidePanel === "route" && <RoutePanel tourId={activeTourId} onClose={onClose} />}
      {sidePanel === "listing" && selectedListing && <ListingDetailPanel listing={selectedListing} onClose={onClose} onDeleteListing={onDeleteListing} />}
      {sidePanel === "listing" && !selectedListing && <EmptyPanel onClose={onClose} />}
    </aside>
  )
}

function PanelHeader({ title, description, icon: Icon, onClose }: { title: string; description: string; icon: typeof MapIcon; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[#eeeeee] p-4">
      <div>
        <p className="flex items-center gap-2 text-base font-bold tracking-[-0.15px] text-[#ff385c]"><Icon className="size-5" /> {title}</p>
        {description && <p className="mt-1 text-sm leading-5 text-[#6a6a6a]">{description}</p>}
      </div>
      <button onClick={onClose} className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-xl border border-[#dddddd] hover:border-[#222222]" aria-label="Close panel">
        <PanelRightClose className="size-4" />
      </button>
    </div>
  )
}

function ListingDetailPanel({
  listing,
  onClose,
  onDeleteListing,
}: {
  listing: Listing
  onClose: () => void
  onDeleteListing: (id: string) => void
}) {
  const [messages, setMessages] = useState<import("./domain").ConversationMessage[]>([])

  useEffect(() => {
    const convId = `conv-${listing.id}`
    api.fetchConversationMessages(convId).then(setMessages).catch(() => setMessages([]))
  }, [listing.id])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Listing details" description="" icon={Building2} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="overflow-hidden rounded-2xl">
          <img src={listing.imageUrl} alt={listing.title} className="h-48 w-full object-cover" />
        </div>
        <div className="mt-4 space-y-4">
          <div>
            <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone[listing.status]}`}>{listing.statusLabel}</span>
            <h2 className="mt-3 text-2xl font-bold tracking-[-0.35px]">{listing.title}</h2>
            <p className="mt-1 text-sm font-medium text-[#6a6a6a]">{listing.address}</p>
          </div>

          {listing.attentionReason && (
            <div className="rounded-2xl border border-[#ffd5de] bg-[#fff5f7] p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-[#c13515]"><CircleAlert className="size-4" /> Agent decision needed</p>
              <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">{listing.attentionReason}</p>
              <div className="mt-3 flex gap-2">
                <button className="cursor-pointer rounded-lg bg-[#222222] px-3 py-2 text-xs font-bold text-white hover:bg-[#ff385c]">Approve reply</button>
                <button className="cursor-pointer rounded-lg border border-[#dddddd] px-3 py-2 text-xs font-bold hover:border-[#222222]">Move to another tour</button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <InfoTile icon={Calendar} label="Suggested time" value={listing.suggestedTime ?? "Pending"} />
            <InfoTile icon={Building2} label="Unit" value={listing.unitNo} />
            <InfoTile icon={UserRound} label="Co-agent" value={listing.coAgent.name} />
            <InfoTile icon={PhoneCall} label="Phone" value={listing.coAgent.phone} />
          </div>

          <a
            href={listing.propertyGuruUrl}
            target="_blank"
            rel="noreferrer"
            className="flex cursor-pointer items-center justify-between rounded-2xl border border-[#dddddd] p-4 text-sm font-bold transition-colors hover:border-[#222222] focus:outline-none focus:ring-2 focus:ring-[#222222] focus:ring-offset-2"
          >
            <span className="flex items-center gap-2"><Building2 className="size-4 text-[#ff385c]" /> Open in PropertyGuru</span>
            <ExternalLink className="size-4" />
          </a>

          <button
            onClick={() => onDeleteListing(listing.id)}
            className="flex w-full cursor-pointer items-center justify-between rounded-2xl border border-[#ffd5de] bg-[#fff5f7] p-4 text-sm font-bold text-[#c13515] transition-colors hover:border-[#c13515] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c13515] focus-visible:ring-offset-2"
          >
            <span className="flex items-center gap-2"><Trash2 className="size-4" /> Delete listing</span>
            <span className="text-xs font-semibold text-[#c13515]/70">Remove from tour</span>
          </button>

          <div className="rounded-2xl bg-[#f7f7f7] p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold"><MessageCircle className="size-4" /> Listing conversation</p>
            <div className="space-y-3">
              {messages.map((message) => (
                <div key={message.id} className="rounded-xl bg-white p-3">
                  <p className="text-xs font-bold text-[#6a6a6a]">{message.senderName} · {message.timestamp}</p>
                  <p className="mt-1 text-sm leading-6">{message.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoTile({ icon: Icon, label, value }: { icon: typeof Calendar; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#eeeeee] p-3">
      <Icon className="mb-2 size-4 text-[#ff385c]" />
      <p className="text-xs font-semibold text-[#6a6a6a]">{label}</p>
      <p className="mt-1 truncate font-bold">{value}</p>
    </div>
  )
}

function MapPanel({ listings: panelListings, onClose }: { listings: Listing[]; onClose: () => void }) {
  const grouped = groupListingsByArea(panelListings)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Tour map" description="" icon={MapIcon} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="relative min-h-[360px] overflow-hidden rounded-2xl bg-white shadow-[rgba(0,0,0,0.02)_0px_0px_0px_1px,rgba(0,0,0,0.04)_0px_2px_6px]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,#ffe4ea_0,transparent_24%),radial-gradient(circle_at_75%_32%,#f2f2f2_0,transparent_25%),radial-gradient(circle_at_45%_78%,#fff0f4_0,transparent_28%)]" />
          {[
            ["East Coast", "left-[18%] top-[24%]", 2],
            ["Tanjong Rhu", "left-[52%] top-[38%]", 1],
            ["CBD", "left-[63%] top-[58%]", 1],
            ["Harbourfront", "left-[27%] top-[72%]", 1],
          ].map(([label, position, count]) => (
            <div key={label} className={`absolute ${position} rounded-full bg-[#ff385c] px-3 py-2 text-xs font-bold text-white shadow-[rgba(0,0,0,0.18)_0px_6px_18px]`}>
              {label} · {count}
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {Object.entries(grouped).map(([area, items]) => (
            <div key={area} className="rounded-2xl border border-[#eeeeee] p-4">
              <div className="flex items-center justify-between">
                <p className="font-bold">{area}</p>
                <span className="rounded-full bg-[#f2f2f2] px-2 py-1 text-xs font-bold text-[#6a6a6a]">{items.length}</span>
              </div>
              <div className="mt-3 space-y-2">
                {items.map((listing) => (
                  <a key={listing.id} href={listing.googleMapsUrl} target="_blank" rel="noreferrer" className="flex cursor-pointer items-center justify-between rounded-xl bg-[#fafafa] px-3 py-2 text-sm font-semibold hover:bg-[#f2f2f2]">
                    <span className="truncate">{listing.condo}</span>
                    <ExternalLink className="size-3.5 shrink-0 text-[#6a6a6a]" />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function RoutePanel({ tourId, onClose }: { tourId: string; onClose: () => void }) {
  const emptyRoute: AgentRoute = { id: "", planId: "", tourId: "", title: "No Route", date: "", stops: [] }
  const [route, setRoute] = useState<AgentRoute>(emptyRoute)

  useEffect(() => {
    if (!tourId) return
    api.generateRoute(tourId).then(setRoute).catch((e) => {
      console.warn('[RoutePanel] generateRoute failed:', e)
      setRoute(emptyRoute)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Tour route" description="当前 Tour 的路线预览，在右侧面板中查看。" icon={Route} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="rounded-2xl border border-[#eeeeee] bg-[#fafafa] p-4">
          <p className="text-sm font-bold text-[#ff385c]">{route.date}</p>
          <h2 className="mt-1 text-xl font-bold tracking-[-0.25px]">{route.title}</h2>
          <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">Internal route includes unit, co-agent and notes for agent use.</p>
        </div>

        <div className="mt-4 space-y-3">
          {route.stops.map((stop, index) => (
            <div key={stop.id} className="rounded-2xl border border-[#eeeeee] bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-bold">{stop.time}</p>
                  <p className="text-xs font-bold text-[#6a6a6a]">Stop {index + 1}</p>
                </div>
                <span className="rounded-full bg-[#fff5f7] px-2.5 py-1 text-xs font-bold text-[#c13515]">{stop.area}</span>
              </div>
              <h3 className="mt-3 text-sm font-bold leading-5">{stop.title}</h3>
              <p className="mt-1 text-sm leading-5 text-[#6a6a6a]">{stop.condo} · {stop.address}</p>
              <p className="mt-3 text-xs font-semibold text-[#222222]">Unit {stop.unitNo} · {stop.coAgentName}</p>
              <a href={stop.googleMapsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full border border-[#dddddd] px-3 py-2 text-xs font-bold hover:border-[#222222]">
                Google Maps <ExternalLink className="size-3.5" />
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function EmptyPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Listing details" description="Select a listing to inspect details." icon={Building2} onClose={onClose} />
      <div className="grid flex-1 place-items-center p-6 text-center text-sm font-medium text-[#6a6a6a]">No listing selected.</div>
    </div>
  )
}

function NewPlanDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (draft: PlanDraft) => void
}) {
  const [title, setTitle] = useState("")
  const [clientName, setClientName] = useState("")
  const [clientWhatsapp, setClientWhatsapp] = useState("")
  const [brief, setBrief] = useState("")

  const submitPlan = () => {
    onCreate({ title, clientName, clientWhatsapp: clientWhatsapp ? `+65 ${clientWhatsapp}` : undefined, brief })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-3xl p-0">
        <DialogHeader className="border-b border-[#eeeeee] p-6 pb-4">
          <DialogTitle className="flex items-center gap-2 text-2xl font-bold tracking-[-0.3px]"><FilePlus2 className="size-5 text-[#ff385c]" /> New client plan</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 p-6 md:grid-cols-2">
          <label className="block text-sm font-bold">
            Plan name
            <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 w-full rounded-xl border border-[#dddddd] px-3 py-2.5 text-sm font-medium outline-none focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10" />
          </label>
          <label className="block text-sm font-bold">
            Client / family
            <input value={clientName} onChange={(event) => setClientName(event.target.value)} className="mt-2 w-full rounded-xl border border-[#dddddd] px-3 py-2.5 text-sm font-medium outline-none focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10" />
          </label>
          <label className="block text-sm font-bold md:col-span-2">
            Client WhatsApp <span className="font-semibold text-[#6a6a6a]">(Optional)</span>
            <div className="mt-2 flex overflow-hidden rounded-xl border border-[#dddddd] bg-white focus-within:border-[#222222] focus-within:ring-2 focus-within:ring-[#222222]/10">
              <span className="inline-flex items-center border-r border-[#dddddd] bg-[#fafafa] px-3 text-sm font-bold text-[#222222]">+65</span>
              <input
                value={clientWhatsapp}
                onChange={(event) => setClientWhatsapp(event.target.value.replace(/[^0-9\s]/g, ""))}
                className="min-w-0 flex-1 px-3 py-2.5 text-sm font-medium outline-none"
                inputMode="tel"
                placeholder="9123 4567"
              />
            </div>
          </label>
          <label className="block text-sm font-bold md:col-span-2">
            Buyer brief
            <textarea value={brief} onChange={(event) => setBrief(event.target.value)} className="mt-2 min-h-28 w-full resize-none rounded-xl border border-[#dddddd] px-3 py-2.5 text-sm font-medium leading-6 outline-none focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10" />
          </label>
        </div>
        <DialogFooter className="border-t border-[#eeeeee] p-6 pt-4">
          <DialogClose className="cursor-pointer rounded-xl border border-[#dddddd] px-4 py-2.5 text-sm font-bold hover:border-[#222222]">Cancel</DialogClose>
          <button onClick={submitPlan} className="cursor-pointer rounded-xl bg-[#ff385c] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#e00b41] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2">Create plan</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NewTourDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (draft: TourDraft) => void
}) {
  const [title, setTitle] = useState(defaultTour.title)
  const [command, setCommand] = useState(defaultTour.command)

  const submitTour = () => {
    onCreate({ title, targetDate: defaultTour.targetDate, timeWindow: defaultTour.timeWindow, command })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-3xl p-0">
        <DialogHeader className="border-b border-[#eeeeee] p-6 pb-4">
          <DialogTitle className="flex items-center gap-2 text-2xl font-bold tracking-[-0.3px]"><Route className="size-5 text-[#ff385c]" /> Add tour</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 p-6">
          <label className="block text-sm font-bold">
            Tour name
            <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 w-full rounded-xl border border-[#dddddd] px-3 py-2.5 text-sm font-medium outline-none focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10" />
          </label>
          <label className="block text-sm font-bold">
            AI tour instructions
            <textarea value={command} onChange={(event) => setCommand(event.target.value)} className="mt-2 min-h-28 w-full resize-none rounded-xl border border-[#dddddd] px-3 py-2.5 text-sm font-medium leading-6 outline-none focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10" />
          </label>
        </div>
        <DialogFooter className="border-t border-[#eeeeee] p-6 pt-4">
          <DialogClose className="cursor-pointer rounded-xl border border-[#dddddd] px-4 py-2.5 text-sm font-bold hover:border-[#222222]">Cancel</DialogClose>
          <button onClick={submitTour} className="cursor-pointer rounded-xl bg-[#ff385c] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#e00b41] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2">Create tour</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ScrollablePage({ children }: { children: React.ReactNode }) {
  return <div className="h-full overflow-y-auto px-5 py-6 lg:px-6">{children}</div>
}

function Conversations({
  listings: conversationListings,
  selectedListing,
  activeTour,
  onSelectListing,
}: {
  listings: Listing[]
  selectedListing: Listing | null
  activeTour: ViewingTour | null
  onSelectListing: (id: string) => void
}) {
  const [aiAgentEnabled, setAiAgentEnabled] = useState(true)
  const [liveMessages, setLiveMessages] = useState<import("./domain").ConversationMessage[]>([])
  const [msgInput, setMsgInput] = useState("")

  // Load conversations from backend
  useEffect(() => {
    if (!activeTour) {
      setLiveMessages([])
      return
    }
    api.fetchConversations(activeTour.id).then((convs) => {
      const allMsgs = convs.flatMap((c) => c.messages)
      setLiveMessages(allMsgs)
    }).catch(() => setLiveMessages([]))
  }, [activeTour?.id])

  if (!selectedListing || conversationListings.length === 0) {
    return (
      <div className="grid min-h-[520px] place-items-center rounded-[32px] border border-dashed border-[#dddddd] bg-white p-8 text-center">
        <div className="max-w-md">
          <MessageCircle className="mx-auto size-10 text-[#ff385c]" />
          <h1 className="mt-4 text-2xl font-bold tracking-[-0.25px]">No conversations yet.</h1>
          <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">Create a plan and its first tour before AI PA starts contacting co-agents.</p>
        </div>
      </div>
    )
  }

  const channelGroups = conversationListings.reduce<Record<string, Listing[]>>((groups, listing) => {
    const key = listing.coAgent.name
    groups[key] = [...(groups[key] ?? []), listing]
    return groups
  }, {})
  const selectedAgentName = selectedListing.coAgent.name
  const activeAgentListings = channelGroups[selectedAgentName] ?? [selectedListing]
  const activeListingIds = new Set(activeAgentListings.map((listing) => listing.id))
  const activeMessages = liveMessages.filter((message) => activeListingIds.has(message.listingId))
  const discussionMessages = activeMessages.length ? activeMessages : liveMessages.filter((message) => message.listingId === selectedListing.id)
  const scheduleDate = activeTour?.targetDate ?? defaultTour.targetDate

  const handleSend = async () => {
    if (!msgInput.trim()) return
    const convId = `conv-${selectedListing.id}`
    try {
      const msg = await api.sendMessage(convId, msgInput.trim())
      setLiveMessages((prev) => [...prev, msg])
    } catch {
      // Fallback: add locally
      setLiveMessages((prev) => [...prev, {
        id: `m-${Date.now()}`,
        listingId: selectedListing.id,
        sender: 'agent',
        senderName: 'Dave Shen',
        body: msgInput.trim(),
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      }])
    }
    setMsgInput("")
  }

  return (
    <div className="grid h-[calc(100vh-7rem)] min-h-[620px] gap-5 lg:grid-cols-[290px_minmax(0,1fr)_330px]">
      <aside className="min-h-0 overflow-y-auto rounded-[28px] border border-[#eeeeee] bg-white p-4">
        <div className="space-y-2">
          {Object.entries(channelGroups).map(([agentName, agentListings]) => {
            const active = agentName === selectedAgentName
            const unreadCount = unreadByAgent[agentName] ?? 0
            return (
              <button
                key={agentName}
                onClick={() => onSelectListing(agentListings[0].id)}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-[18px] p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2 ${active ? "bg-[#222222] text-white" : "hover:bg-[#f7f7f7]"}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{agentName}</span>
                  <span className={`mt-1 block truncate text-xs ${active ? "text-white/70" : "text-[#6a6a6a]"}`}>
                    {agentListings.length} listing{agentListings.length > 1 ? "s" : ""} · {agentListings.map((listing) => listing.condo).join(", ")}
                  </span>
                </span>
                {unreadCount > 0 && (
                  <span className="grid min-w-7 shrink-0 place-items-center rounded-full bg-[#ff385c] px-2 py-1 text-xs font-bold text-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </aside>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-[#eeeeee] bg-white">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#eeeeee] p-5">
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#6a6a6a]">Current listing</p>
            <h1 className="mt-1 truncate text-2xl font-bold tracking-[-0.3px]">{selectedListing.title}</h1>
            <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">{selectedListing.condo} · {selectedListing.address}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={aiAgentEnabled}
            onClick={() => setAiAgentEnabled((enabled) => !enabled)}
            className={`inline-flex shrink-0 cursor-pointer items-center gap-3 rounded-full border px-4 py-3 text-sm font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2 ${aiAgentEnabled ? "border-[#dddddd] bg-white text-[#222222]" : "border-[#dddddd] bg-white text-[#6a6a6a] hover:border-[#222222] hover:text-[#222222]"}`}
          >
            <span>AI Agent</span>
            <span className={`relative h-6 w-12 rounded-full transition-colors ${aiAgentEnabled ? "bg-[#34A853]" : "bg-[#dddddd]"}`}>
              <span className={`absolute left-1 top-1 size-4 rounded-full bg-white shadow-sm transition-transform ${aiAgentEnabled ? "translate-x-6" : "translate-x-0"}`} />
            </span>
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 pb-6">
          {discussionMessages.map((message) => {
            const isAgentSide = message.sender === "agent" || message.sender === "ai"
            return (
              <div key={message.id} className={`flex ${isAgentSide ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-[20px] p-4 ${isAgentSide ? "bg-[#222222] text-white" : "bg-[#f7f7f7] text-[#222222]"}`}>
                  <p className={`text-xs font-bold ${isAgentSide ? "text-white/70" : "text-[#6a6a6a]"}`}>{message.senderName} · {message.timestamp}</p>
                  <p className="mt-2 text-sm leading-6">{message.body}</p>
                </div>
              </div>
            )
          })}
        </div>
        <div className="shrink-0 border-t border-[#eeeeee] bg-white p-5">
          <div className="flex items-center gap-3 rounded-full border border-[#dddddd] px-4 py-3">
            <input
              className="flex-1 bg-transparent text-sm outline-none"
              placeholder={`Message to ${selectedAgentName}`}
              value={msgInput}
              onChange={(e) => setMsgInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
            />
            <button onClick={handleSend} className="grid size-9 cursor-pointer place-items-center rounded-full bg-[#ff385c] text-white hover:bg-[#e00b41]">
              <Send className="size-4" />
            </button>
          </div>
        </div>
      </section>

      <aside className="min-h-0 space-y-4 overflow-y-auto rounded-[28px] bg-[#f7f7f7] p-4">
        <h2 className="text-xl font-bold">Viewing details</h2>
        <div className="rounded-[20px] bg-white p-4">
          <p className="flex items-center gap-2 text-sm font-bold"><Calendar className="size-4 text-[#ff385c]" /> Scheduled slot</p>
          <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">{scheduleDate} · {selectedListing.suggestedTime ?? "Pending"}</p>
        </div>
        <div className="rounded-[20px] bg-white p-4">
          <p className="flex items-center gap-2 text-sm font-bold"><Building2 className="size-4 text-[#ff385c]" /> Listing info</p>
          <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">Unit {selectedListing.unitNo} · {selectedListing.beds} bed · {selectedListing.price}</p>
          <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">{selectedListing.summary}</p>
          <a
            href={selectedListing.propertyGuruUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-[#dddddd] px-4 py-3 text-sm font-bold text-[#222222] transition-colors hover:border-[#222222] hover:bg-[#f7f7f7] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2"
          >
            Open in PropertyGuru <ExternalLink className="size-4" />
          </a>
        </div>
        <div className="rounded-[20px] bg-white p-4">
          <p className="flex items-center gap-2 text-sm font-bold"><PhoneCall className="size-4 text-[#ff385c]" /> Co-agent</p>
          <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">{selectedListing.coAgent.name} · {selectedListing.coAgent.phone}</p>
          <p className="mt-1 text-sm leading-6 text-[#6a6a6a]">{selectedListing.coAgent.agency}</p>
        </div>
      </aside>
    </div>
  )
}

function AgentRouteView() {
  const emptyRoute: AgentRoute = { id: "", planId: "", tourId: "", title: "No Route", date: "", stops: [] }
  const [liveRoute, setLiveRoute] = useState<AgentRoute>(emptyRoute)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const clientRoute = toClientRoute(liveRoute)

  // Load route from backend on mount
  useEffect(() => {
    api.generateRoute('tour-001').then((route) => {
      setLiveRoute(route)
    }).catch(() => {})
  }, [])

  const handleGenerateRoute = async () => {
    try {
      const route = await api.generateRoute('tour-001')
      setLiveRoute(route)
    } catch { /* keep current route */ }
  }

  const handleShare = async () => {
    try {
      const result = await api.shareRoute(liveRoute.id)
      setShareUrl(result.shareUrl)
    } catch { /* ignore */ }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <section className="rounded-[32px] bg-white p-6 shadow-[rgba(0,0,0,0.02)_0px_0px_0px_1px,rgba(0,0,0,0.04)_0px_2px_6px,rgba(0,0,0,0.1)_0px_4px_8px]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-bold text-[#ff385c]"><Route className="size-4" /> Routes inside current tour</p>
              <h1 className="mt-2 text-4xl font-bold tracking-[-0.44px]">{liveRoute.title}</h1>
              <p className="mt-2 text-sm font-medium text-[#6a6a6a]">Internal route includes co-agent, phone, unit-no and notes.</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={handleGenerateRoute} className="inline-flex cursor-pointer items-center gap-2 rounded-[20px] border border-[#dddddd] bg-white px-5 py-3 text-sm font-bold transition-colors hover:border-[#222222]">
                Generate Route <Route className="size-4" />
              </button>
              <button onClick={handleShare} className="inline-flex cursor-pointer items-center gap-2 rounded-[20px] border border-[#ffd5de] bg-[#fff5f7] px-5 py-3 text-sm font-bold text-[#c13515]">
                Share to Client <Share2 className="size-4" />
              </button>
            </div>
          </div>
          {shareUrl && (
            <div className="mt-3 rounded-[16px] border border-[#d7f4df] bg-[#f3fbf5] px-4 py-3 text-sm font-bold text-[#177245]">
              Share link created: {shareUrl}
            </div>
          )}
          <div className="mt-7 space-y-4">
            {liveRoute.stops.map((stop, index) => (
              <div key={stop.id} className="grid gap-4 rounded-[24px] border border-[#eeeeee] p-4 md:grid-cols-[90px_minmax(0,1fr)_220px] md:items-center">
                <div>
                  <p className="text-2xl font-bold">{stop.time}</p>
                  <p className="text-xs font-bold text-[#6a6a6a]">Stop {index + 1}</p>
                </div>
                <div>
                  <h3 className="text-lg font-bold">{stop.title}</h3>
                  <p className="mt-1 text-sm text-[#6a6a6a]">{stop.condo} · {stop.address}</p>
                  <p className="mt-2 text-sm font-semibold">Unit {stop.unitNo} · {stop.coAgentName} · {stop.coAgentPhone}</p>
                </div>
                <a href={stop.googleMapsUrl} target="_blank" rel="noreferrer" className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full border border-[#dddddd] px-4 py-2 text-sm font-bold hover:border-[#222222]">
                  Google Maps <ExternalLink className="size-4" />
                </a>
              </div>
            ))}
          </div>
        </section>

        <ClientShareView route={clientRoute} />
      </div>
      <BackendContracts />
    </div>
  )
}

function ClientShareView({ route }: { route: ReturnType<typeof toClientRoute> }) {
  return (
    <section className="rounded-[32px] bg-white p-6 shadow-[rgba(0,0,0,0.02)_0px_0px_0px_1px,rgba(0,0,0,0.04)_0px_2px_6px,rgba(0,0,0,0.1)_0px_4px_8px]">
      <div className="rounded-[28px] bg-[#fff7f9] p-6">
        <p className="flex items-center gap-2 text-sm font-bold text-[#c13515]"><LockKeyhole className="size-4" /> Tour share route · redacted client view</p>
        <h1 className="mt-2 text-4xl font-bold tracking-[-0.44px]">{route.title}</h1>
        <p className="mt-3 text-sm leading-6 text-[#6a6a6a]">{route.privacyNotice}</p>
      </div>
      <div className="mt-6 space-y-4">
        {route.stops.map((stop, index) => (
          <div key={stop.id} className="rounded-[24px] border border-[#eeeeee] p-5">
            <p className="text-sm font-bold text-[#ff385c]">{stop.time} · Stop {index + 1}</p>
            <h2 className="mt-2 text-xl font-bold">{stop.title}</h2>
            <p className="mt-1 text-sm text-[#6a6a6a]">{stop.condo} · {stop.area}</p>
            <p className="mt-3 text-sm font-medium">{stop.address}</p>
            <a href={stop.googleMapsUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-full border border-[#dddddd] px-4 py-2 text-sm font-bold hover:border-[#222222]">
              Open location <ExternalLink className="size-4" />
            </a>
          </div>
        ))}
      </div>
      <div className="mt-6 rounded-[20px] border border-[#d7f4df] bg-[#f3fbf5] p-4">
        <p className="flex items-center gap-2 text-sm font-bold text-[#177245]"><CheckCircle2 className="size-4" /> Privacy check passed</p>
        <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">This contract contains no co-agent names, phone numbers, unit numbers, WhatsApp messages or internal notes.</p>
      </div>
    </section>
  )
}

function SettingsView() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-[32px] bg-white p-6 shadow-[rgba(0,0,0,0.02)_0px_0px_0px_1px,rgba(0,0,0,0.04)_0px_2px_6px,rgba(0,0,0,0.1)_0px_4px_8px]">
        <p className="flex items-center gap-2 text-sm font-bold text-[#ff385c]"><SlidersHorizontal className="size-4" /> AI PA configuration</p>
        <h1 className="mt-2 text-4xl font-bold tracking-[-0.44px]">Default skills plus your custom rules.</h1>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {[
            ["Scheduling policy", "Group same condo together, preserve drive buffers, avoid lunch gap unless requested."],
            ["Escalation policy", "Pause for tenant handover, price negotiation, incomplete owner access or conflicting instructions."],
            ["Communication tone", "Concise, polite and professional. AI PA never reveals buyer private notes."],
            ["Backend adapter", "Settings will be saved through GET/PUT /ai-pa/settings with typed constraints."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-[24px] border border-[#eeeeee] p-5">
              <h2 className="text-lg font-bold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">{body}</p>
            </div>
          ))}
        </div>
        <label className="mt-6 block text-sm font-bold">Custom instructions</label>
        <textarea
          className="mt-2 min-h-36 w-full resize-none rounded-[20px] border border-[#dddddd] p-4 text-sm leading-6 outline-none focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10"
          defaultValue="For East Coast condos, prefer morning slots. If a co-agent asks for buyer profile, say I will confirm with Dave before sharing. Never disclose client budget in WhatsApp."
        />
      </section>
      <BackendContracts />
    </div>
  )
}

function BackendContracts() {
  const contracts = [
    { area: "Plans / tours / listings", endpoints: ["GET /plans", "POST /plans", "GET /plans/:planId", "GET /plans/:planId/tours", "POST /plans/:planId/tours", "GET /tours/:tourId/listings"] },
    { area: "AI scheduling", endpoints: ["POST /tours/:tourId/scheduling-runs", "GET /scheduling-runs/:runId", "POST /attention-items/:itemId/resolve"] },
    { area: "Conversations", endpoints: ["GET /tours/:tourId/conversations", "GET /conversations/:id/messages", "POST /conversations/:id/messages"] },
    { area: "Route sharing", endpoints: ["POST /tours/:tourId/routes/generate", "GET /routes/:routeId", "POST /routes/:routeId/share", "GET /share/routes/:shareToken"] },
  ]

  return (
    <aside className="h-fit rounded-[32px] bg-[#f7f7f7] p-5">
      <p className="flex items-center gap-2 text-sm font-bold"><Link2 className="size-4 text-[#ff385c]" /> Backend interfaces reserved</p>
      <div className="mt-4 space-y-3">
        {contracts.map((group) => (
          <details key={group.area} className="rounded-[18px] bg-white p-4" open={group.area === "Plans / tours / listings" || group.area === "Route sharing"}>
            <summary className="cursor-pointer text-sm font-bold">{group.area}</summary>
            <div className="mt-3 space-y-2">
              {group.endpoints.map((endpoint) => (
                <code key={endpoint} className="block rounded-lg bg-[#f7f7f7] px-3 py-2 text-xs text-[#222222]">{endpoint}</code>
              ))}
            </div>
          </details>
        ))}
      </div>
    </aside>
  )
}

export default function AppRoot() {
  const [user, setUser] = useState<ButlerUser | null>(null)
  const [loading, setLoading] = useState(true)

  // Subscribe to Supabase auth session. Fires once with the initial session
  // (could be null if signed out, or a restored session from localStorage),
  // then again on every sign-in / sign-out / refresh.
  useEffect(() => {
    let unsub: (() => void) | undefined
    void initAuth((u) => {
      setUser(u)
      setLoading(false)
    }).then((un) => { unsub = un })
    return () => { unsub?.() }
  }, [])

  // Whenever we have a signed-in user (or after a token refresh), push the
  // current access_token into the extension. AsyncLocalStorage on the
  // backend uses this token to identify the user; the extension's content
  // script attaches it to all backend writes.
  useEffect(() => {
    if (!user) return
    const token = getStoredToken()
    if (!token) return
    void storeTokenInExtension(token).catch(() => {
      // Extension not installed or not yet reachable — banner in App surfaces this.
    })
  }, [user])

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f7f8fa] text-sm text-[#6a6a6a]">
        Loading…
      </div>
    )
  }

  if (!user) return <SignIn />
  return (
    <App
      key={user.userId}
      onSignOut={() => { void signOut() }}
      currentUser={user}
    />
  )
}
