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
  UserRound,
} from "lucide-react"
import "./App.css"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
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
import { SchedulingChat } from "./components/SchedulingChat"
import { t } from "./i18n"

type View = "workspace" | "route" | "settings"
type SidePanel = "map" | "route" | "listing" | "chat" | null
type PlanDraft = Pick<ViewingPlan, "title" | "clientName" | "clientWhatsapp" | "brief">
type TourDraft = Pick<ViewingTour, "title" | "targetDate" | "timeWindow" | "command">

type TimelineSlot = {
  listingId: string
  condoName: string
  date: string
  time: string
}

type RouteStage = "needs-listings" | "needs-review" | "ready" | "running" | "done" | "attention"
type ContentMode = "listings" | "ai"
type AppRoute =
  | { view: "workspace"; planId?: string; tourId?: string }
  | { view: "settings" }

function parseHashRoute(hash = window.location.hash): AppRoute {
  const clean = hash.replace(/^#\/?/, "")
  const parts = clean.split("/").filter(Boolean)
  if (parts[0] === "settings") return { view: "settings" }
  if (parts[0] === "plans" && parts[1]) {
    return {
      view: "workspace",
      planId: decodeURIComponent(parts[1]),
      tourId: parts[2] === "routes" && parts[3] ? decodeURIComponent(parts[3]) : undefined,
    }
  }
  return { view: "workspace" }
}

function routeToHash(route: AppRoute) {
  if (route.view === "settings") return "#/settings"
  if (route.planId && route.tourId) {
    return `#/plans/${encodeURIComponent(route.planId)}/routes/${encodeURIComponent(route.tourId)}`
  }
  if (route.planId) return `#/plans/${encodeURIComponent(route.planId)}`
  return "#/plans"
}

function setHashRoute(route: AppRoute, mode: "push" | "replace" = "push") {
  const next = routeToHash(route)
  if (window.location.hash === next) return
  if (mode === "replace") {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${next}`)
  } else {
    window.location.hash = next
  }
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
  imported: "未排期",
  contacting: "排期中",
  confirmed: "已安排",
  "needs-attention": "需处理",
  "not-fitting": "未安排",
}

const schedulingTone: Record<ListingStatus, string> = {
  imported: "border-[#dddddd] bg-white text-[#6a6a6a]",
  contacting: "border-[#d8efff] bg-[#f1f9ff] text-[#0369a1]",
  confirmed: "border-[#d7f4df] bg-[#f3fbf5] text-[#177245]",
  "needs-attention": "border-[#ffd5de] bg-[#fff5f7] text-[#c13515]",
  "not-fitting": "border-[#dddddd] bg-white text-[#6a6a6a]",
}

const navItems: Array<{ id: View; label: string; icon: typeof Home }> = [
  { id: "workspace", label: t("clientPlans"), icon: Home },
  { id: "settings", label: t("settings"), icon: Settings },
]

const defaultTour: ViewingTour = {
  id: "",
  planId: "",
  title: "新看房线路",
  targetDate: new Date().toISOString().slice(0, 10),
  timeWindow: "",
  command: "",
}

function getRouteStage(listings: Listing[], schedulingRunning: boolean, schedulingRun: api.SchedulingRun | null): RouteStage {
  if (schedulingRunning || schedulingRun?.status === "running") return "running"
  if (schedulingRun?.status === "completed" || listings.some((listing) => listing.status === "confirmed")) {
    return listings.some((listing) => listing.status === "needs-attention") ? "attention" : "done"
  }
  if (listings.length === 0) return "needs-listings"
  if (listings.some((listing) => !listing.coAgent.phone || listing.status === "needs-attention")) return "needs-review"
  return "ready"
}

function getRouteStageCopy(stage: RouteStage) {
  const map: Record<RouteStage, { label: string; title: string; description: string; cta: string }> = {
    "needs-listings": {
      label: "需要导入房源",
      title: "先从 PropertyGuru 添加房源",
      description: "这条线路还没有房源。通过 Chrome 插件导入房源后，Butler 才能读取对方中介信息并开始排期。",
      cta: "从 PropertyGuru 导入",
    },
    "needs-review": {
      label: "需要检查",
      title: "有房源资料需要补齐",
      description: "部分房源缺少对方中介电话或存在异常。先处理缺失信息，可以提升 AI 排期成功率。",
      cta: "检查房源",
    },
    ready: {
      label: "可以排期",
      title: "这条线路已准备好交给 AI",
      description: "Butler 会模拟联系对方中介，收集可看房时间，解决冲突，并自动生成看房路线。",
      cta: "开始 AI 排期",
    },
    running: {
      label: "AI 正在工作",
      title: "Butler 正在为这条线路排期",
      description: "你可以在右侧看到当前步骤和最近活动。当前为内部模拟，不会真实发送 WhatsApp。",
      cta: "查看 AI 工作",
    },
    done: {
      label: "路线已生成",
      title: "AI 排期完成",
      description: "已安排的房源会进入看房路线。你可以查看路线，或继续让 Butler 调整时间。",
      cta: "查看看房路线",
    },
    attention: {
      label: "需要处理",
      title: "AI 已完成，但有异常需要你决定",
      description: "部分房源无法自动安排。请查看原因，选择跳过、手动安排或让 AI 重新尝试。",
      cta: "处理异常",
    },
  }
  return map[stage]
}

function App({ onSignOut, currentUser }: { onSignOut: () => void; currentUser: ButlerUser | null }) {
  const initialRoute = useMemo(() => parseHashRoute(), [])
  const [view, setView] = useState<View>(() => initialRoute.view)
  const [workspacePlans, setWorkspacePlans] = useState<ViewingPlan[]>([])
  const [plansLoading, setPlansLoading] = useState(true)
  const [plansLoadError, setPlansLoadError] = useState<string | null>(null)
  const [planTourCounts, setPlanTourCounts] = useState<Record<string, number>>({})
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [workspaceTours, setWorkspaceTours] = useState<ViewingTour[]>([])
  const [activeTourId, setActiveTourId] = useState<string | null>(null)
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null)
  const [sidePanel, setSidePanel] = useState<SidePanel>(null)
  const [newPlanOpen, setNewPlanOpen] = useState(false)
  const [newTourOpen, setNewTourOpen] = useState(false)
  const [editingTour, setEditingTour] = useState<ViewingTour | null>(null)
  const [editingPlan, setEditingPlan] = useState<ViewingPlan | null>(null)
  const [tourDeleteTarget, setTourDeleteTarget] = useState<ViewingTour | null>(null)
  const [deletingTourId, setDeletingTourId] = useState<string | null>(null)
  const [deleteTourError, setDeleteTourError] = useState<string | null>(null)
  const [listingItems, setListingItems] = useState<Listing[]>([])
  const [tourListingCounts, setTourListingCounts] = useState<Record<string, number>>({})
  const [importText, setImportText] = useState("")
  const [schedulingStarted, setSchedulingStarted] = useState(false)
  const [schedulingRunning, setSchedulingRunning] = useState(false)
  /** Live run row from /scheduling-runs/:id; drives AI scheduling state. */
  const [schedulingRun, setSchedulingRun] = useState<api.SchedulingRun | null>(null)
  /** Step catalogue from /scheduling-steps; fetched once on mount. */
  const [schedulingSteps, setSchedulingSteps] = useState<api.SchedulingStepDef[]>([])
  /** Chat session id, set after a successful scheduling run completes. */
  const [chatSessionId, setChatSessionId] = useState<string | null>(null)
  const [aiFocusedListingId, setAiFocusedListingId] = useState<string | null>(null)
  const [, setTimelineSlots] = useState<TimelineSlot[]>([])
  const [routeHydrating, setRouteHydrating] = useState(
    () => initialRoute.view === "workspace" && Boolean(initialRoute.planId),
  )

  const activePlan = workspacePlans.find((plan) => plan.id === selectedPlanId) ?? null
  const activeTour = workspaceTours.find((tour) => tour.id === activeTourId) ?? workspaceTours[0] ?? null
  const selectedListing = listingItems.find((listing) => listing.id === selectedListingId) ?? null
  const routeStage = getRouteStage(listingItems, schedulingRunning, schedulingRun)
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
      workspaceTours.map((tour) => ({
        id: tour.id,
        title: tour.title,
        meta: `${formatTourAvailability(tour)} · ${tourListingCounts[tour.id] ?? (tour.id === activeTour?.id ? listingItems.length : 0)} listings`,
        active: tour.id === activeTour?.id,
      })),
    [activeTour?.id, listingItems.length, tourListingCounts, workspaceTours],
  )
  const tourStats = useMemo(
    () => [
      { label: "Listings", value: listingItems.length.toString() },
      { label: "Confirmed", value: listingItems.filter((listing) => listing.status === "confirmed").length.toString() },
      { label: "Needs attention", value: listingItems.filter((listing) => listing.status === "needs-attention").length.toString(), alert: true },
    ],
    [listingItems],
  )

  const setActiveTourListings = (tourId: string, listings: Listing[]) => {
    setListingItems(listings)
    setTourListingCounts((current) => ({ ...current, [tourId]: listings.length }))
  }

  useEffect(() => {
    if (!window.location.hash) setHashRoute({ view: "workspace" }, "replace")
    const onHashChange = () => {
      const route = parseHashRoute()
      setView(route.view)
      if (route.view === "workspace" && route.planId && route.planId !== selectedPlanId) {
        setRouteHydrating(true)
        void openPlan(route.planId, route.tourId)
      }
      if (route.view === "workspace" && route.planId === selectedPlanId && route.tourId && route.tourId !== activeTourId) {
        void selectTour(route.tourId)
      }
      if (route.view === "workspace" && !route.planId) {
        setRouteHydrating(false)
        backToPlans()
      }
    }
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTourId, selectedPlanId])

  const loadPlans = async () => {
    setPlansLoading(true)
    setPlansLoadError(null)
    try {
      const plans = await api.fetchPlans()
      setWorkspacePlans(plans)
      if (plans.length) {
        void refreshPlanTourCounts(plans)
        if (initialRoute.view === "workspace" && initialRoute.planId) {
          setRouteHydrating(true)
          void openPlan(initialRoute.planId, initialRoute.tourId)
        } else if (!window.location.hash || window.location.hash === "#/plans") {
          setRouteHydrating(false)
          setHashRoute({ view: "workspace" }, "replace")
        }
      }
    } catch (error) {
      setPlansLoadError(error instanceof Error ? error.message : "无法连接后端加载客户计划。")
      setRouteHydrating(false)
    } finally {
      setPlansLoading(false)
    }
  }

  // ── Load plans from backend on mount ──
  useEffect(() => {
    void loadPlans()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshPlanTourCounts = async (plans: ViewingPlan[]) => {
    const counts = await Promise.all(plans.map(async (plan) => {
      try {
        const tours = await api.fetchToursByPlan(plan.id)
        return [plan.id, tours.length] as const
      } catch {
        return [plan.id, 0] as const
      }
    }))
    setPlanTourCounts(Object.fromEntries(counts))
  }

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
      setPlanTourCounts((counts) => ({ ...counts, [plan.id]: 0 }))
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
    setActiveTourId(null)
    setListingItems([])
    setTourListingCounts({})
    setSelectedListingId(null)
    setSidePanel(null)
    setSchedulingStarted(false)
    setTimelineSlots([])
    setRouteHydrating(false)
    setHashRoute({ view: "workspace" })
  }

  const updatePlanDetails = async (planId: string, draft: PlanDraft) => {
    try {
      const plan = await api.updatePlan(planId, {
        title: draft.title.trim(),
        clientName: draft.clientName.trim(),
        clientWhatsapp: draft.clientWhatsapp?.trim() || undefined,
        brief: draft.brief.trim(),
      })
      setWorkspacePlans((plans) => plans.map((item) => item.id === plan.id ? plan : item))
      if (selectedPlanId === plan.id) {
        setSelectedPlanId(plan.id)
      }
      setEditingPlan(null)
    } catch (e) {
      console.error('[updatePlan] failed:', e)
      alert(
        '更新计划失败：' + (e instanceof Error ? e.message : String(e)) +
        '\n请确认后端服务已启动并连接 Supabase。',
      )
    }
  }

  const deletePlanItem = async (planId: string) => {
    try {
      await api.deletePlan(planId)
      setWorkspacePlans((plans) => plans.filter((plan) => plan.id !== planId))
      setPlanTourCounts((counts) => {
        const next = { ...counts }
        delete next[planId]
        return next
      })
      if (selectedPlanId === planId) {
        setSelectedPlanId(null)
        setWorkspaceTours([])
        setActiveTourId(null)
        setListingItems([])
        setTourListingCounts({})
        setSelectedListingId(null)
        setSidePanel(null)
        setSchedulingStarted(false)
        setSchedulingRunning(false)
        setSchedulingRun(null)
        setTimelineSlots([])
        setHashRoute({ view: "workspace" })
      }
      setEditingPlan(null)
    } catch (e) {
      console.error('[deletePlan] failed:', e)
      throw e
    }
  }

  const createTour = async (draft: TourDraft) => {
    if (!activePlan) return

    try {
      const tour = await api.createTour(activePlan.id, {
        title: draft.title.trim() || defaultTour.title,
        targetDate: draft.targetDate.trim(),
        timeWindow: draft.timeWindow.trim(),
        command: draft.command.trim() || defaultTour.command,
      })
      setWorkspaceTours((current) => [...current.filter((item) => item.id !== tour.id), tour])
      setPlanTourCounts((counts) => ({ ...counts, [activePlan.id]: (counts[activePlan.id] ?? workspaceTours.length) + 1 }))
      setActiveTourId(tour.id)
      // Load listings from backend
      const backendListings = await api.fetchListings(tour.id)
      setActiveTourListings(tour.id, backendListings)
      setHashRoute({ view: "workspace", planId: activePlan.id, tourId: tour.id })
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

  const updateTourDetails = async (tourId: string, draft: TourDraft) => {
    const updated = await api.updateTour(tourId, {
      title: draft.title.trim(),
      targetDate: draft.targetDate.trim(),
      timeWindow: draft.timeWindow.trim(),
      command: draft.command.trim(),
    })
    setWorkspaceTours((current) =>
      current.map((tour) => (tour.id === updated.id ? updated : tour)),
    )
    if (activeTour?.id === updated.id) {
      const refreshedListings = await api.fetchListings(updated.id)
      setActiveTourListings(updated.id, refreshedListings)
    }
    setEditingTour(null)
  }

  async function selectTour(tourId: string, tours = workspaceTours) {
    const tour = tours.find((item) => item.id === tourId)
    if (!tour || !activePlan) return

    setActiveTourId(tour.id)
    setSelectedListingId(null)
    setSidePanel(null)
    setSchedulingRun(null)
    setSchedulingRunning(false)
    setChatSessionId(null)
    setAiFocusedListingId(null)
    setHashRoute({ view: "workspace", planId: activePlan.id, tourId: tour.id })

    const tourListings = await api.fetchListings(tour.id)
    setActiveTourListings(tour.id, tourListings)
    const alreadyScheduled = tourListings.some(
      (l) => l.status === 'confirmed' || l.status === 'needs-attention',
    )
    setSchedulingStarted(alreadyScheduled)
    const slots: TimelineSlot[] = tourListings
      .filter((l) => l.status === 'confirmed' && l.suggestedTime)
      .map((l) => ({
        listingId: l.id,
        condoName: l.condo,
        date: parseScheduledSlot(l.suggestedTime!, tour.targetDate).date,
        time: parseScheduledSlot(l.suggestedTime!, tour.targetDate).time,
      }))
    setTimelineSlots(slots)
  }

  async function openPlan(planId: string, preferredTourId?: string) {
    setRouteHydrating(true)
    setSelectedPlanId(planId)
    setView("workspace")
    setActiveTourId(null)
    setWorkspaceTours([])
    setListingItems([])
    setTourListingCounts({})
    setSelectedListingId(null)
    setSidePanel(null)
    setSchedulingRun(null)
    setSchedulingRunning(false)
    setChatSessionId(null)
    setAiFocusedListingId(null)

    try {
      const tours = await api.fetchToursByPlan(planId)
      if (tours.length) {
        setWorkspaceTours(tours)
        const selectedTour = tours.find((tour) => tour.id === preferredTourId) ?? tours[0]
        setActiveTourId(selectedTour.id)
        setHashRoute({ view: "workspace", planId, tourId: selectedTour.id }, "replace")
        const listingSets = await Promise.all(tours.map(async (tour) => ({
          tourId: tour.id,
          listings: await api.fetchListings(tour.id),
        })))
        const counts = Object.fromEntries(listingSets.map((item) => [item.tourId, item.listings.length]))
        setTourListingCounts(counts)
        const tourListings = listingSets.find((item) => item.tourId === selectedTour.id)?.listings ?? []
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
                date: parseScheduledSlot(l.suggestedTime!, selectedTour.targetDate).date,
                time: parseScheduledSlot(l.suggestedTime!, selectedTour.targetDate).time,
              }))
        setTimelineSlots(slots)
      } else {
        setWorkspaceTours([])
        setActiveTourId(null)
        setListingItems([])
        setTourListingCounts({})
        setHashRoute({ view: "workspace", planId }, "replace")
        setSchedulingStarted(false)
        setSchedulingRunning(false)
        setTimelineSlots([])
      }
    } catch {
      // If API fails, keep existing state if same plan
      if (workspaceTours[0]?.planId !== planId) {
        setWorkspaceTours([])
        setActiveTourId(null)
        setListingItems([])
        setTourListingCounts({})
        setSchedulingStarted(false)
        setSchedulingRunning(false)
        setTimelineSlots([])
      }
    } finally {
      setRouteHydrating(false)
    }
  }

  function backToPlans() {
    setHashRoute({ view: "workspace" })
    setRouteHydrating(false)
    setSelectedPlanId(null)
    setActiveTourId(null)
    setSidePanel(null)
    setSelectedListingId(null)
    setSchedulingStarted(false)
    setTimelineSlots([])
  }

  const toggleRoute = () => {
    if (activePlan && activeTour) setHashRoute({ view: "workspace", planId: activePlan.id, tourId: activeTour.id })
    setView("workspace")
    setSidePanel((current) => (current === "route" ? null : "route"))
  }

  const toggleMap = () => {
    if (activePlan && activeTour) setHashRoute({ view: "workspace", planId: activePlan.id, tourId: activeTour.id })
    setView("workspace")
    setSidePanel((current) => (current === "map" ? null : "map"))
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
    setListingItems((current) => {
      const next = current.filter((listing) => listing.id !== id)
      if (activeTour) setTourListingCounts((counts) => ({ ...counts, [activeTour.id]: next.length }))
      return next
    })
    if (selectedListingId === id) {
      setSelectedListingId(null)
      setSidePanel(null)
    }
    // Delete on backend
    if (activeTour) {
      api.deleteListing(activeTour.id, id).catch(() => {})
    }
  }

  const requestDeleteTour = (tourId: string) => {
    const tour = workspaceTours.find((item) => item.id === tourId)
    if (!tour) return
    setDeleteTourError(null)
    setTourDeleteTarget(tour)
  }

  const deleteTourItem = async () => {
    const tour = tourDeleteTarget
    if (!tour || !activePlan) return

    try {
      setDeletingTourId(tour.id)
      setDeleteTourError(null)
      await api.deleteTour(tour.id)
      const nextTours = workspaceTours.filter((item) => item.id !== tour.id)
      setWorkspaceTours(nextTours)
      setPlanTourCounts((counts) => ({ ...counts, [tour.planId]: nextTours.length }))
      setTourListingCounts((current) => {
        const next = { ...current }
        delete next[tour.id]
        return next
      })
      setTourDeleteTarget(null)

      if (activeTour?.id !== tour.id) return

      const nextTour = nextTours[0] ?? null
      if (nextTour) {
        await selectTour(nextTour.id, nextTours)
      } else {
        setActiveTourId(null)
        setListingItems([])
        setSelectedListingId(null)
        setSidePanel(null)
        setSchedulingStarted(false)
        setSchedulingRunning(false)
        setSchedulingRun(null)
        setTimelineSlots([])
        setHashRoute({ view: "workspace", planId: activePlan.id })
      }
    } catch (e) {
      console.error('[deleteTour] failed:', e)
      setDeleteTourError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeletingTourId(null)
    }
  }

  const navigateView = (nextView: View) => {
    if (nextView === "workspace") {
      if (activePlan && activeTour) setHashRoute({ view: "workspace", planId: activePlan.id, tourId: activeTour.id })
      else if (activePlan) setHashRoute({ view: "workspace", planId: activePlan.id })
      else setHashRoute({ view: "workspace" })
    } else if (nextView === "settings") {
      setHashRoute({ view: "settings" })
    } else {
      setView(nextView)
    }
  }

  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-[#f7f8fa] text-[#222222]">
      <AppHeader view={view} onChangeView={navigateView} onNewPlan={() => setNewPlanOpen(true)} onSignOut={onSignOut} currentUser={currentUser} />

      {view === "workspace" && activePlan && <PlanTopBar plan={activePlan} tour={activeTour} onBackToPlans={backToPlans} schedulingStarted={schedulingStarted} listings={listingItems} />}
      {view === "route" && activePlan && activeTour && <PlanTopBar plan={activePlan} tour={activeTour} onBackToPlans={backToPlans} schedulingStarted={schedulingStarted} listings={listingItems} />}

      <section className="min-h-0 flex-1 overflow-hidden">
        {routeHydrating && (
          <RouteLoadingState />
        )}
        {!routeHydrating && view === "workspace" && !activePlan && plansLoading && (
          <PlansLoadingState />
        )}
        {!routeHydrating && view === "workspace" && !activePlan && !plansLoading && plansLoadError && (
          <PlansLoadErrorState error={plansLoadError} onRetry={loadPlans} />
        )}
        {!routeHydrating && view === "workspace" && !activePlan && !plansLoading && !plansLoadError && (
          <WorkspaceHome plans={workspacePlans} planTourCounts={planTourCounts} onNewPlan={() => setNewPlanOpen(true)} onSelectPlan={openPlan} onEditPlan={setEditingPlan} />
        )}
        {!routeHydrating && view === "workspace" && activePlan && !activeTour && (
          <PlanEmptyState plan={activePlan} onNewTour={() => setNewTourOpen(true)} />
        )}
        {!routeHydrating && view === "workspace" && activePlan && activeTour && (
          <PlanWorkspace
            key={`${activeTour.id}:${aiFocusedListingId ?? "default"}`}
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
            routeStage={routeStage}
            chatSessionId={chatSessionId}
            aiFocusedListingId={aiFocusedListingId}
            onClosePanel={() => setSidePanel(null)}
            onSelectListing={toggleListing}
            onDeleteListing={deleteListingItem}
            importText={importText}
            setImportText={setImportText}
            onToggleRoute={toggleRoute}
            onToggleMap={toggleMap}
            onNewTour={() => setNewTourOpen(true)}
            onSelectTour={(tourId) => {
              const tour = workspaceTours.find((item) => item.id === tourId)
              if (!tour) return
              if (tourId !== activeTour.id) void selectTour(tourId)
              setEditingTour(tour)
            }}
            onDeleteTour={requestDeleteTour}
            onProposalApplied={async () => {
              if (!activeTour) return
              try {
                const fresh = await api.fetchListings(activeTour.id)
                if (fresh.length) setActiveTourListings(activeTour.id, fresh)
              } catch (e) {
                console.warn('[chat] refresh after apply failed:', e)
              }
            }}
            onImportListings={async (imported, importedId) => {
              setListingItems(imported)
              if (activeTour) {
                setTourListingCounts((counts) => ({ ...counts, [activeTour.id]: imported.length }))
                const focusedId = imported.some((listing) => listing.id === importedId)
                  ? importedId
                  : imported[imported.length - 1]?.id
                setAiFocusedListingId(focusedId ?? null)
                setChatSessionId(null)
              }
            }}
          />
        )}
        {!routeHydrating && view === "route" && <ScrollablePage><AgentRouteView /></ScrollablePage>}
        {!routeHydrating && view === "settings" && <ScrollablePage><SettingsView /></ScrollablePage>}
      </section>

      <NewPlanDialog open={newPlanOpen} onOpenChange={setNewPlanOpen} onCreate={createPlan} />
      {editingPlan && (
        <EditPlanDialog plan={editingPlan} onOpenChange={(open) => { if (!open) setEditingPlan(null) }} onSave={updatePlanDetails} onDelete={deletePlanItem} />
      )}
      <NewTourDialog open={newTourOpen} onOpenChange={setNewTourOpen} onCreate={createTour} />
      {editingTour && (
        <EditTourDialog
          tour={editingTour}
          onOpenChange={(open) => { if (!open) setEditingTour(null) }}
          onSave={updateTourDetails}
        />
      )}
      <DeleteTourDialog
        tour={tourDeleteTarget}
        listingCount={tourDeleteTarget ? tourListingCounts[tourDeleteTarget.id] ?? 0 : 0}
        deleting={Boolean(tourDeleteTarget && deletingTourId === tourDeleteTarget.id)}
        error={deleteTourError}
        onOpenChange={(open) => {
          if (deletingTourId) return
          if (!open) setTourDeleteTarget(null)
        }}
        onConfirm={() => { void deleteTourItem() }}
      />
    </main>
  )
}

function AppHeader({
  view,
  onChangeView,
  onNewPlan,
  onSignOut,
  currentUser,
}: {
  view: View
  onChangeView: (view: View) => void
  onNewPlan: () => void
  onSignOut: () => void
  currentUser: ButlerUser | null
}) {
  return (
    <header className="z-40 shrink-0 border-b border-[#e8e8e8] bg-white">
      <div className="flex h-16 items-center gap-4 px-5 lg:grid lg:grid-cols-[260px_minmax(0,1fr)_auto] lg:px-0">
        <button
          className="flex cursor-pointer items-center gap-3 rounded-[6px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2 lg:ml-6"
          onClick={() => onChangeView("workspace")}
        >
          <span className="grid size-9 place-items-center rounded-[6px] bg-[#ff385c] text-white shadow-sm">
            <Bot className="size-5" />
          </span>
          <span className="hidden text-left sm:block">
            <span className="block text-base font-bold tracking-[-0.2px]">{t("appName")}</span>
            <span className="block text-[11px] font-semibold text-[#6a6a6a]">{t("appTagline")}</span>
          </span>
        </button>

        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                onClick={() => onChangeView(item.id)}
                className={`inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-[6px] px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2 ${
                  view === item.id
                    ? "bg-[#222222] text-white"
                    : "text-[#6a6a6a] hover:bg-[#f2f2f2] hover:text-[#222222]"
                }`}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:pr-6">
          <div className="hidden h-9 items-center gap-2 rounded-[6px] border border-[#dddddd] bg-white px-3 lg:flex">
            <Search className="size-4 text-[#6a6a6a]" />
            <span className="w-44 truncate text-sm font-medium leading-none text-[#6a6a6a]">搜索客户、线路或房源</span>
          </div>

          <button
            onClick={onNewPlan}
            className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[6px] bg-[#ff385c] px-4 text-sm font-bold leading-none text-white transition-colors hover:bg-[#e00b41] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2"
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline">新建计划</span>
          </button>

          <div className="hidden h-9 items-center gap-2 rounded-[6px] border border-[#dddddd] px-3 xl:flex">
            <UserRound className="size-4 text-[#6a6a6a]" />
            <div className="flex items-center gap-2 text-sm leading-none">
              <p className="max-w-28 truncate font-bold leading-none">{currentUser?.displayName || 'Guest'}</p>
              <button
                onClick={onSignOut}
                className="cursor-pointer text-xs leading-none text-[#6a6a6a] underline-offset-2 hover:text-[#ff385c] hover:underline"
              >
                退出
              </button>
            </div>
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
            className="cursor-pointer rounded-[6px] px-2 py-1 text-[#6a6a6a] transition-colors hover:bg-[#f2f2f2] hover:text-[#222222] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2"
          >
            客户计划
          </button>
          <ChevronRight className="size-4" />
          <span className="truncate text-[#222222]">{plan.title}</span>
          <ChevronRight className="size-4" />
          <span className="truncate text-[#222222]">{tour?.title ?? "还没有线路"}</span>
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

function PlansLoadingState() {
  return (
    <div className="grid h-full place-items-center px-5 py-6 lg:px-6">
      <div className="w-full max-w-md rounded-[6px] border border-[#eeeeee] bg-white p-6 text-center shadow-sm">
        <div className="mx-auto grid size-12 place-items-center rounded-[6px] bg-[#fff5f7] text-[#ff385c]">
          <FilePlus2 className="size-5" />
        </div>
        <h2 className="mt-4 text-xl font-bold tracking-[-0.2px]">正在加载客户计划</h2>
        <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">
          正在读取已有客户计划和看房线路数量。
        </p>
      </div>
    </div>
  )
}

function PlansLoadErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="grid h-full place-items-center px-5 py-6 lg:px-6">
      <div className="w-full max-w-md rounded-[6px] border border-[#f4c7cf] bg-white p-6 text-center shadow-sm">
        <div className="mx-auto grid size-12 place-items-center rounded-[6px] bg-[#fff5f7] text-[#ff385c]">
          <FilePlus2 className="size-5" />
        </div>
        <h2 className="mt-4 text-xl font-bold tracking-[-0.2px]">无法加载客户计划</h2>
        <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">
          后端服务暂时无法连接。已有计划不会因此被删除。
        </p>
        <p className="mt-2 break-words text-xs leading-5 text-[#9a3412]">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex cursor-pointer items-center rounded-[6px] bg-[#222222] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[#ff385c] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2"
        >
          重新连接
        </button>
      </div>
    </div>
  )
}

function WorkspaceHome({
  plans,
  planTourCounts,
  onNewPlan,
  onSelectPlan,
  onEditPlan,
}: {
  plans: ViewingPlan[]
  planTourCounts: Record<string, number>
  onNewPlan: () => void
  onSelectPlan: (id: string) => void
  onEditPlan: (plan: ViewingPlan) => void
}) {
  return (
    <div className="h-full overflow-y-auto px-5 py-6 lg:px-6">
      <section className="mx-auto flex min-h-full max-w-6xl flex-col">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-[#ff385c]">客户计划</p>
            <h1 className="mt-2 text-4xl font-bold tracking-[-0.48px]">先为买家创建一个看房计划。</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#6a6a6a]">
              每个客户计划可以包含多条看房线路。导入 PropertyGuru 房源后，Butler 会帮你协调中介并生成路线。
            </p>
          </div>
        </div>

        {plans.length === 0 ? (
          <div className="mt-8 grid flex-1 place-items-center rounded-[6px] border border-dashed border-[#dddddd] bg-white p-8 text-center shadow-sm">
            <div className="max-w-lg">
              <div className="mx-auto grid size-16 place-items-center rounded-[6px] bg-[#fff5f7] text-[#ff385c]">
                <FilePlus2 className="size-7" />
              </div>
              <h2 className="mt-5 text-2xl font-bold tracking-[-0.3px]">还没有客户计划。</h2>
              <p className="mt-3 text-sm leading-6 text-[#6a6a6a]">
                创建第一个客户计划后，你可以自由添加看房线路、导入房源，并让 AI 开始排期。
              </p>
              <button
                onClick={onNewPlan}
                className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-[6px] bg-[#222222] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[#ff385c] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2"
              >
                创建客户计划 <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {plans.map((plan) => {
              const tourCount = planTourCounts[plan.id] ?? 0
              return (
                <div
                  key={plan.id}
                  className="group flex min-h-[240px] flex-col rounded-[6px] border border-[#eeeeee] bg-white p-5 text-left shadow-sm transition hover:border-[#222222] hover:shadow-[0_14px_36px_rgba(0,0,0,0.08)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#9ca3af]">客户计划</p>
                      <h2 className="mt-2 line-clamp-2 text-xl font-bold tracking-[-0.2px] group-hover:text-[#ff385c]">{plan.title}</h2>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onEditPlan(plan)}
                        className="grid size-8 cursor-pointer place-items-center rounded-[6px] text-[#6a6a6a] transition-colors hover:bg-[#f2f2f2] hover:text-[#222222] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2"
                        aria-label={`编辑 ${plan.title}`}
                        title="编辑计划"
                      >
                        <SlidersHorizontal className="size-4" />
                      </button>
                      <span className="rounded-full bg-[#f7f7f7] px-3 py-1 text-xs font-bold text-[#6a6a6a]">
                        {tourCount > 0 ? `${tourCount} 条线路` : "待添加线路"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 min-h-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#6a6a6a]">
                      <span>{plan.clientName}</span>
                      {plan.clientWhatsapp && (
                        <>
                          <span className="text-[#d1d5db]">·</span>
                          <span>{plan.clientWhatsapp}</span>
                        </>
                      )}
                    </div>
                    <p className="mt-4 line-clamp-3 text-sm leading-6 text-[#6a6a6a]">{plan.brief || "暂无买家需求。"}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectPlan(plan.id)}
                    className="mt-auto flex w-full cursor-pointer items-center justify-between border-t border-[#eeeeee] pt-4 text-left text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2"
                  >
                    <span>打开计划</span>
                    <ChevronRight className="size-4 text-[#b0b0b0] transition-transform group-hover:translate-x-1 group-hover:text-[#222222]" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function RouteLoadingState() {
  return (
    <div className="grid h-full place-items-center px-5 py-6 lg:px-6">
      <div className="w-full max-w-md rounded-[6px] border border-[#eeeeee] bg-white p-6 text-center shadow-sm">
        <div className="mx-auto grid size-12 place-items-center rounded-[6px] bg-[#fff5f7] text-[#ff385c]">
          <Route className="size-5" />
        </div>
        <h2 className="mt-4 text-xl font-bold tracking-[-0.2px]">正在打开看房线路</h2>
        <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">
          正在根据 URL 加载对应的客户计划和线路。
        </p>
      </div>
    </div>
  )
}

function PlanEmptyState({ plan, onNewTour }: { plan: ViewingPlan; onNewTour: () => void }) {
  return (
    <div className="h-full overflow-y-auto px-5 py-6 lg:px-6">
      <section className="mx-auto grid min-h-full max-w-6xl place-items-center">
        <div className="grid w-full gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-stretch">
          <div className="rounded-[6px] bg-white p-8 shadow-[rgba(0,0,0,0.02)_0px_0px_0px_1px,rgba(0,0,0,0.04)_0px_2px_8px]">
            <p className="text-sm font-bold text-[#ff385c]">当前客户计划</p>
            <h1 className="mt-3 text-4xl font-bold tracking-[-0.5px]">{plan.title}</h1>
            <p className="mt-2 text-sm font-semibold text-[#6a6a6a]">客户：{plan.clientName}</p>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-[#6a6a6a]">{plan.brief}</p>

            <div className="mt-8 rounded-[6px] border border-dashed border-[#dddddd] bg-[#fafafa] p-6 text-center">
              <div className="mx-auto grid size-14 place-items-center rounded-[6px] bg-white text-[#ff385c] shadow-sm">
                <Route className="size-6" />
              </div>
              <h2 className="mt-4 text-2xl font-bold tracking-[-0.25px]">先创建一条看房线路。</h2>
              <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">
                线路可以按日期、区域或你的习惯自由创建。每条线路都有自己的房源、AI 排期和最终路线。
              </p>
              <button
                onClick={onNewTour}
                className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-[6px] bg-[#ff385c] px-5 py-3 text-sm font-bold text-white shadow-[0_10px_24px_rgba(255,56,92,0.24)] transition-colors hover:bg-[#e00b41] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2"
              >
                创建看房线路 <Plus className="size-4" />
              </button>
            </div>
          </div>

          <aside className="rounded-[6px] bg-[#222222] p-6 text-white">
            <p className="text-sm font-bold text-white/60">推荐流程</p>
            <div className="mt-5 space-y-4">
              {[
                ["1", "创建一条看房线路"],
                ["2", "通过 Chrome 插件导入房源"],
                ["3", "让 AI 模拟协调排期"],
                ["4", "自动生成看房路线"],
              ].map(([step, label]) => (
                <div key={step} className="flex items-center gap-3 rounded-[6px] bg-white/8 p-3">
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
  routeStage,
  chatSessionId,
  aiFocusedListingId,
  onClosePanel,
  onSelectListing,
  onDeleteListing,
  importText,
  setImportText,
  onToggleRoute,
  onToggleMap,
  onNewTour,
  onSelectTour,
  onDeleteTour,
  onImportListings,
  onProposalApplied,
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
  routeStage: RouteStage
  chatSessionId: string | null
  aiFocusedListingId: string | null
  onClosePanel: () => void
  onSelectListing: (id: string) => void
  onDeleteListing: (id: string) => void
  importText: string
  setImportText: (value: string) => void
  onToggleRoute: () => void
  onToggleMap: () => void
  onNewTour: () => void
  onSelectTour: (tourId: string) => void
  onDeleteTour: (tourId: string) => void
  onImportListings: (listings: Listing[], importedId?: string) => Promise<void>
  onProposalApplied: () => void
}) {
  // Area · Status filter (purely client-side; resets when underlying listings change)
  const [contentMode, setContentMode] = useState<ContentMode>(
    aiFocusedListingId ? "ai" : "listings",
  )
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
  const stageCopy = getRouteStageCopy(routeStage)
  const showContextPanel = contentMode === "listings" && sidePanel
  const toggleArea = (a: string) =>
    setAreaFilter((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]))
  const toggleStatus = (s: ListingStatus) =>
    setStatusFilter((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  const clearFilters = () => { setAreaFilter([]); setStatusFilter([]) }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
      <PlanSidebar tourItems={tourItems} tourStats={tourStats} onNewTour={onNewTour} onSelectTour={onSelectTour} onDeleteTour={onDeleteTour} />

      <div className={`grid min-h-0 transition-[grid-template-columns] duration-200 ${showContextPanel ? "xl:grid-cols-[minmax(0,1fr)_400px]" : "xl:grid-cols-[minmax(0,1fr)_0px]"}`}>
        <section className="flex min-h-0 flex-col overflow-hidden px-5 py-5 lg:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#717171]">Tour</p>
              <h1 className="mt-1 text-2xl font-bold tracking-[-0.3px]">{activeTour.title}</h1>
            </div>
            <div className="inline-flex rounded-[6px] border border-[#e8e8e8] bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => {
                  setContentMode("listings")
                  onClosePanel()
                }}
                className={`rounded-[6px] px-4 py-2 text-sm font-bold transition-colors ${contentMode === "listings" ? "bg-[#222222] text-white" : "text-[#717171] hover:text-[#222222]"}`}
              >
                房源列表
              </button>
              <button
                type="button"
                onClick={() => {
                  setContentMode("ai")
                  onClosePanel()
                }}
                className={`rounded-[6px] px-4 py-2 text-sm font-bold transition-colors ${contentMode === "ai" ? "bg-[#222222] text-white" : "text-[#717171] hover:text-[#222222]"}`}
              >
                AI 助手
              </button>
            </div>
          </div>

          <TourSummaryBar
            tour={activeTour}
            listings={workspaceListings}
          />

          {contentMode === "listings" ? (
            <>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold tracking-[-0.2px]">线路房源</h2>
                  <p className="mt-1 text-xs font-semibold text-[#717171]">{workspaceListings.length} 个房源 · 通过 Chrome 插件导入 PropertyGuru</p>
                </div>
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
                    <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 w-72 rounded-[6px] border border-[#e8e8e8] bg-white p-4 shadow-[0_18px_60px_rgba(0,0,0,0.16)]">
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
                <Route className="size-4" /> 看房路线
              </button>
            </div>
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-6 pb-28">
              {workspaceListings.length === 0 && (
                <ImportEmptyState />
              )}
              {workspaceListings.length > 0 && Object.entries(filteredGroupedListings).length === 0 && filterCount > 0 && (
                <div className="rounded-[6px] border border-dashed border-[#dddddd] bg-[#fafafa] p-6 text-center text-sm text-[#6a6a6a]">
                  没有符合筛选条件的房源。
                  <button onClick={clearFilters} className="ml-2 font-bold text-[#ff385c] hover:underline">清除筛选</button>
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
            <TourActionDock
              activeTour={activeTour}
              importText={importText}
              setImportText={setImportText}
              onImportListings={onImportListings}
            />
          </div>
            </>
          ) : (
            <AIAssistantWorkspace
              tourId={activeTour.id}
              listings={workspaceListings}
              routeStage={routeStage}
              stageCopy={stageCopy}
              schedulingStarted={schedulingStarted}
              schedulingRunning={schedulingRunning}
              focusedListingId={aiFocusedListingId}
              onProposalApplied={onProposalApplied}
            />
          )}
        </section>

        {contentMode === "listings" && (
          <ContextPanel
            listings={workspaceListings}
            sidePanel={sidePanel}
            selectedListing={selectedListing}
            activeTourId={activeTour.id}
            chatSessionId={chatSessionId}
            schedulingRun={schedulingRun}
            schedulingSteps={schedulingSteps}
            schedulingRunning={schedulingRunning}
            onClose={onClosePanel}
            onDeleteListing={onDeleteListing}
            onProposalApplied={onProposalApplied}
          />
        )}
      </div>
    </div>
  )
}

function TourSummaryBar({
  tour,
  listings,
}: {
  tour: ViewingTour
  listings: Listing[]
}) {
  const availability = formatTourAvailability(tour)
  const preference = tour.command.trim() || "未设置额外排期偏好"
  const confirmedCount = listings.filter((listing) => listing.status === "confirmed").length

  return (
    <section className="mt-4 grid gap-2 rounded-[6px] border border-[#e8e8e8] bg-white p-3 shadow-sm md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
      <div className="flex min-w-0 items-start gap-3 rounded-[6px] bg-[#fafafa] px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-[6px] bg-[#fff5f7] text-[#ff385c]">
          <Calendar className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9ca3af]">Available time</p>
          <p className="mt-1 truncate text-sm font-bold text-[#222222]" title={availability}>
            {availability}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 items-start gap-3 rounded-[6px] bg-[#fafafa] px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-[6px] bg-[#f2f2f2] text-[#555555]">
          <SlidersHorizontal className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9ca3af]">Preference</p>
          <p className="mt-1 truncate text-sm font-bold text-[#222222]" title={preference}>
            {preference}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-[6px] bg-[#fafafa] px-3 py-2.5 md:min-w-44">
        <span className="grid size-8 shrink-0 place-items-center rounded-[6px] bg-[#f3fbf5] text-[#177245]">
          <Building2 className="size-4" />
        </span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9ca3af]">Progress</p>
          <p className="mt-1 whitespace-nowrap text-sm font-bold text-[#222222]">
            {confirmedCount}/{listings.length} 已确认
          </p>
        </div>
      </div>

    </section>
  )
}

function PlanSidebar({
  tourItems,
  tourStats,
  onNewTour,
  onSelectTour,
  onDeleteTour,
}: {
  tourItems: Array<{ id: string; title: string; meta: string; active: boolean }>
  tourStats: Array<{ label: string; value: string; alert?: boolean }>
  onNewTour: () => void
  onSelectTour: (tourId: string) => void
  onDeleteTour: (tourId: string) => void
}) {
  return (
    <aside className="hidden min-h-0 border-r border-[#e8e8e8] bg-white p-4 lg:block">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-[#6a6a6a]">Tours</h2>
        <button
          onClick={onNewTour}
          className="grid size-8 cursor-pointer place-items-center rounded-[6px] bg-[#ff385c] text-white transition-colors hover:bg-[#e00b41] focus:outline-none focus:ring-2 focus:ring-[#222222] focus:ring-offset-2"
          aria-label="Create new tour"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {tourItems.map((tour) => (
          <div
            key={tour.id}
            className={`group flex w-full items-center gap-2 rounded-[6px] pr-2 transition-colors ${
              tour.active ? "bg-[#222222] text-white" : "hover:bg-[#f7f7f7]"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectTour(tour.id)}
              className={`min-w-0 flex-1 cursor-pointer rounded-[6px] px-3 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset ${
                tour.active ? "focus-visible:ring-white/70" : "focus-visible:ring-[#222222]"
              }`}
            >
              <p className="truncate text-sm font-bold">{tour.title}</p>
              <p className={`mt-1 text-xs font-medium ${tour.active ? "text-white/70" : "text-[#6a6a6a]"}`}>{tour.meta}</p>
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onDeleteTour(tour.id)
              }}
              className={`grid size-7 shrink-0 cursor-pointer place-items-center rounded-[6px] opacity-0 transition group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-[#c13515] focus:ring-offset-2 ${
                tour.active ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-[#9ca3af] hover:bg-[#fff5f7] hover:text-[#c13515]"
              }`}
              aria-label={`删除 ${tour.title}`}
              title="删除线路"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-[6px] border border-[#eeeeee] bg-[#fafafa] p-3">
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

function AIAssistantWorkspace({
  tourId,
  listings,
  routeStage,
  stageCopy,
  schedulingStarted,
  schedulingRunning,
  focusedListingId,
  onProposalApplied,
}: {
  tourId: string
  listings: Listing[]
  routeStage: RouteStage
  stageCopy: ReturnType<typeof getRouteStageCopy>
  schedulingStarted: boolean
  schedulingRunning: boolean
  focusedListingId: string | null
  onProposalApplied: () => void
}) {
  const [selectedListingId, setSelectedListingId] = useState<string | null>(
    focusedListingId ?? listings[0]?.id ?? null,
  )
  const [scheduleDraft, setScheduleDraft] = useState("")
  const [listingSessionIds, setListingSessionIds] = useState<Record<string, string>>({})
  const [submittingConstraint, setSubmittingConstraint] = useState(false)
  const [constraintError, setConstraintError] = useState<string | null>(null)
  const [submittedConstraintListingIds, setSubmittedConstraintListingIds] = useState<Set<string>>(
    () => new Set(),
  )
  const selectedListing = listings.find((listing) => listing.id === selectedListingId) ?? listings[0] ?? null
  const selectedListingSessionId = selectedListing
    ? listingSessionIds[selectedListing.id] ?? null
    : null
  const started = listings.length > 0
  const hasConfirmedSchedule =
    selectedListing?.status === "confirmed" && Boolean(selectedListing.suggestedTime)
  const hasAvailabilityMismatch =
    selectedListing?.status === "needs-attention" && selectedListing.statusLabel === "无法排期"
  const pendingConstraintListingId =
    selectedListing && !hasConfirmedSchedule && !hasAvailabilityMismatch && !schedulingRunning
      ? selectedListing.id
      : null
  const needsSingleListingBrief =
    started &&
    Boolean(selectedListing) &&
    !hasConfirmedSchedule &&
    !hasAvailabilityMismatch &&
    !schedulingRunning
  const constraintSubmitted =
    Boolean(selectedListing) && submittedConstraintListingIds.has(selectedListing.id)

  const submitTakeoverDecision = async (draft: string) => {
    if (!selectedListing || !draft.trim()) return
    setSubmittingConstraint(true)
    setConstraintError(null)
    try {
      let sessionId = listingSessionIds[selectedListing.id]
      if (!sessionId) {
        const session = await api.openSchedulingSession(
          tourId,
          undefined,
          selectedListing.id,
        )
        sessionId = session.id
      }
      await api.sendSchedulingMessage(
        sessionId,
        draft.trim(),
        { listingId: selectedListing.id },
      )
      setListingSessionIds((current) => ({
        ...current,
        [selectedListing.id]: sessionId,
      }))
    } catch (error) {
      setConstraintError(error instanceof Error ? error.message : "提交下一步决断失败")
    } finally {
      setSubmittingConstraint(false)
    }
  }

  const submitListingConstraint = async (draft: string) => {
    if (!selectedListing || !draft.trim()) return
    setSubmittingConstraint(true)
    setConstraintError(null)
    try {
      let sessionId = listingSessionIds[selectedListing.id]
      if (!sessionId) {
        const session = await api.openSchedulingSession(
          tourId,
          undefined,
          selectedListing.id,
        )
        sessionId = session.id
        setListingSessionIds((current) => ({
          ...current,
          [selectedListing.id]: session.id,
        }))
      }
      await api.sendSchedulingMessage(
        sessionId,
        draft.trim(),
        { listingId: selectedListing.id },
      )
      setSubmittedConstraintListingIds((current) => {
        const next = new Set(current)
        next.add(selectedListing.id)
        return next
      })
      setScheduleDraft("")
    } catch (error) {
      setConstraintError(error instanceof Error ? error.message : "提交排期偏好失败")
    } finally {
      setSubmittingConstraint(false)
    }
  }

  useEffect(() => {
    if (focusedListingId && listings.some((listing) => listing.id === focusedListingId)) {
      setSelectedListingId(focusedListingId)
    }
  }, [focusedListingId, listings])

  useEffect(() => {
    if (!selectedListing || !started) return
    let cancelled = false
    api.openSchedulingSession(tourId, undefined, selectedListing.id)
      .then(async (session) => {
        const [brief, history] = await Promise.all([
          api.fetchListingSchedulingBrief(tourId, selectedListing.id),
          api.fetchSessionMessages(session.id),
        ])
        return { session, brief, history }
      })
      .then(({ session, brief, history }) => {
        if (cancelled) return
        setListingSessionIds((current) => ({
          ...current,
          [selectedListing.id]: session.id,
        }))
        if (brief?.status === "ready" || history.messages.length > 0) {
          setSubmittedConstraintListingIds((current) => {
            const next = new Set(current)
            next.add(selectedListing.id)
            return next
          })
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[scheduling] could not load listing session:", error)
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedListing, started, tourId])

  return (
    <div className="mt-5 grid min-h-0 flex-1 gap-3 overflow-hidden xl:grid-cols-[280px_minmax(0,1.25fr)_minmax(280px,0.8fr)]">
      <ListingActivityRail
        listings={listings}
        selectedListingId={selectedListing?.id ?? null}
        schedulingStarted={schedulingStarted}
        selectable={started}
        pendingConstraintListingId={pendingConstraintListingId}
        onSelectListing={setSelectedListingId}
      />

      <>
          {hasAvailabilityMismatch ? (
            <UnschedulableListingPanel
              key={selectedListing?.id}
              tourId={tourId}
              listing={selectedListing}
            />
          ) : hasConfirmedSchedule ? (
            <CoAgentConversationPanel tourId={tourId} listing={selectedListing} />
          ) : needsSingleListingBrief && !constraintSubmitted ? (
            <AIPromptComposer
              draft={scheduleDraft}
              setDraft={setScheduleDraft}
              listings={selectedListing ? [selectedListing] : []}
              routeStage={routeStage}
              stageCopy={stageCopy}
              canStart={Boolean(selectedListing) && !submittingConstraint}
              title={`告诉 AI 如何安排 ${selectedListing?.condo || selectedListing?.title || "这套房源"}`}
              description="输入这套新房源的时间、顺序和路线限制。Butler 会理解你的要求，并提出对整条 tour 的调整方案。"
              submitLabel={submittingConstraint ? "正在分析…" : "提交排期偏好"}
              error={constraintError}
              onSubmit={submitListingConstraint}
            />
          ) : (
            <div className="min-h-0 overflow-hidden rounded-[6px] border border-[#eeeeee] bg-white shadow-sm">
              {selectedListingSessionId && selectedListing ? (
                <SchedulingChat
                  sessionId={selectedListingSessionId}
                  focusedListingId={selectedListing.id}
                  focusedListingName={selectedListing.condo || selectedListing.title}
                  focusedListingAvailability={selectedListing.availability}
                  onProposalApplied={onProposalApplied}
                />
              ) : (
                <ListingAIActivityPanel
                  listing={selectedListing}
                  schedulingRunning={schedulingRunning}
                  needsBrief={needsSingleListingBrief}
                />
              )}
            </div>
          )}
          <div className="min-h-0 overflow-hidden rounded-[6px] border border-[#eeeeee] bg-white shadow-sm">
            {hasAvailabilityMismatch && selectedListingSessionId && selectedListing ? (
              <SchedulingChat
                sessionId={selectedListingSessionId}
                focusedListingId={selectedListing.id}
                focusedListingName={selectedListing.condo || selectedListing.title}
                focusedListingAvailability={selectedListing.availability}
                onProposalApplied={onProposalApplied}
              />
            ) : hasAvailabilityMismatch ? (
              <ListingAIActivityPanel
                listing={selectedListing}
                schedulingRunning={false}
                decisionSending={submittingConstraint}
                decisionError={constraintError}
                onDecision={submitTakeoverDecision}
              />
            ) : hasConfirmedSchedule && selectedListingSessionId && selectedListing ? (
              <SchedulingChat
                sessionId={selectedListingSessionId}
                focusedListingId={selectedListing.id}
                focusedListingName={selectedListing.condo || selectedListing.title}
                focusedListingAvailability={selectedListing.availability}
                onProposalApplied={onProposalApplied}
              />
            ) : (
              <ListingAIActivityPanel
                listing={selectedListing}
                schedulingRunning={schedulingRunning}
                needsBrief={needsSingleListingBrief}
              />
            )}
          </div>
      </>
    </div>
  )
}

function ListingActivityRail({
  listings,
  selectedListingId,
  schedulingStarted,
  selectable,
  pendingConstraintListingId,
  onSelectListing,
}: {
  listings: Listing[]
  selectedListingId: string | null
  schedulingStarted: boolean
  selectable: boolean
  pendingConstraintListingId: string | null
  onSelectListing: (id: string) => void
}) {
  return (
    <aside className="min-h-0 overflow-y-auto rounded-[6px] border border-[#eeeeee] bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold tracking-[-0.2px]">房源</h2>
          <p className="mt-0.5 text-xs font-semibold text-[#717171]">
            {selectable ? "选择一个房源查看 AI 工作" : "排期开始后可查看 AI 工作"}
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {listings.length === 0 && (
          <div className="rounded-[6px] border border-dashed border-[#dddddd] bg-[#fafafa] p-3 text-xs leading-5 text-[#6a6a6a]">
            先在房源列表里导入 PropertyGuru listing，AI 才能开始协调。
          </div>
        )}
        {listings.map((listing) => (
          <ListingActivityCard
            key={listing.id}
            listing={listing}
            selected={selectable && listing.id === selectedListingId}
            schedulingStarted={schedulingStarted}
            selectable={selectable}
            pendingConstraint={listing.id === pendingConstraintListingId}
            onSelect={() => onSelectListing(listing.id)}
          />
        ))}
      </div>
    </aside>
  )
}

function ListingActivityCard({
  listing,
  selected,
  schedulingStarted,
  selectable,
  pendingConstraint,
  onSelect,
}: {
  listing: Listing
  selected: boolean
  schedulingStarted: boolean
  selectable: boolean
  pendingConstraint: boolean
  onSelect: () => void
}) {
  const hasContact = Boolean(listing.coAgent.phone)
  const status =
    pendingConstraint
      ? { label: "等待约束", detail: "告诉 Butler 这套房源应该如何安排", tone: "bg-[#fff8e7] text-[#8a5a00]" }
      : !hasContact
      ? { label: "缺少联系方式", detail: "需要补充对方中介电话", tone: "bg-[#fff5f7] text-[#c13515]" }
      : listing.status === "confirmed"
        ? { label: "已确认", detail: listing.suggestedTime ? `建议 ${listing.suggestedTime} 看房` : "对方中介已确认时间", tone: "bg-[#f3fbf5] text-[#177245]" }
        : listing.status === "needs-attention"
          ? { label: listing.statusLabel || "需要处理", detail: listing.attentionReason ?? "需要人工处理", tone: "bg-[#fff5f7] text-[#c13515]" }
          : schedulingStarted && listing.status === "imported"
            ? { label: "待加入 AI", detail: `为 ${listing.coAgent.name || "对方中介"} 补充排期要求`, tone: "bg-[#f2f2f2] text-[#717171]" }
          : schedulingStarted || listing.status === "contacting"
            ? { label: "正在协调", detail: `模拟联系 ${listing.coAgent.name || "对方中介"}`, tone: "bg-[#fff8e7] text-[#8a5a00]" }
            : { label: "等待 AI", detail: `准备联系 ${listing.coAgent.name || "对方中介"}`, tone: "bg-[#f2f2f2] text-[#717171]" }

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!selectable}
      className={`w-full rounded-[6px] border p-2.5 text-left transition-colors ${
        selected
          ? "border-[#222222] bg-[#222222] text-white"
          : selectable
            ? "cursor-pointer border-[#eeeeee] bg-white hover:border-[#222222]"
            : "cursor-default border-[#eeeeee] bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{listing.condo}</p>
          <p className={`mt-0.5 truncate text-xs font-semibold ${selected ? "text-white/65" : "text-[#717171]"}`}>{listing.area}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${status.tone}`}>{status.label}</span>
      </div>
      <p className={`mt-2 truncate text-xs font-semibold ${selected ? "text-white/70" : "text-[#9ca3af]"}`}>
        {listing.suggestedTime ?? status.detail}
      </p>
    </button>
  )
}

const schedulePromptChips = [
  "尽量把同一区域的房源排在一起",
  "优先安排已经确认可看的房源",
  "午饭时间 12:30-13:30 不安排看房",
  "如果对方中介时间冲突，先保留高优先级房源",
]

function AIPromptComposer({
  draft,
  setDraft,
  listings,
  routeStage,
  stageCopy,
  canStart,
  title = "告诉 AI 这次排期要怎么做",
  description,
  submitLabel = "开始 AI 排期",
  error,
  onSubmit,
}: {
  draft: string
  setDraft: (value: string) => void
  listings: Listing[]
  routeStage: RouteStage
  stageCopy: ReturnType<typeof getRouteStageCopy>
  canStart: boolean
  title?: string
  description?: string
  submitLabel?: string
  error?: string | null
  onSubmit: (draft: string) => void | Promise<void>
}) {
  return (
    <section className="min-h-0 overflow-hidden rounded-[6px] border border-[#eeeeee] bg-white shadow-sm">
      <div className="flex h-full min-h-0 flex-col p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-[6px] bg-[#fff5f7] text-[#ff385c]">
            <Bot className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#ff385c]">AI Schedule Brief</p>
            <h2 className="mt-1 text-2xl font-bold tracking-[-0.3px]">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">{description ?? stageCopy.description}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <AICheckRow ok={listings.length > 0} label={`${listings.length} 个房源`} />
          <AICheckRow ok={listings.some((listing) => listing.coAgent.phone)} label="中介联系方式" />
          <AICheckRow ok={routeStage !== "needs-listings"} label="可启动模拟排期" />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {schedulePromptChips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setDraft(draft ? `${draft}\n${chip}` : chip)}
              className="rounded-full border border-[#dddddd] bg-[#fafafa] px-3 py-1.5 text-xs font-bold text-[#555555] transition-colors hover:border-[#222222] hover:bg-white"
            >
              + {chip}
            </button>
          ))}
        </div>

        <div className="mt-4 min-h-0 flex-1">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="例如：这次客户下午 2 点后才有空，尽量从 Marina Bay 开始，Amber Park 如果时间冲突可以放到最后。"
            className="h-full min-h-[220px] w-full resize-none rounded-[6px] border border-[#dddddd] bg-[#fafafa] p-4 text-sm font-medium leading-6 text-[#222222] outline-none transition-colors focus:border-[#222222] focus:bg-white"
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-[#717171]">Butler 会用自然语言理解偏好，并生成可确认的调整方案。</p>
            {error && <p className="mt-1 text-xs font-semibold text-[#c13515]">{error}</p>}
          </div>
          <button
            type="button"
            onClick={() => void onSubmit(draft)}
            disabled={!canStart || !draft.trim()}
            className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[6px] bg-[#ff385c] px-6 py-3 text-sm font-bold text-white shadow-[0_10px_24px_rgba(255,56,92,0.24)] transition-colors hover:bg-[#e00b41] disabled:cursor-not-allowed disabled:bg-[#dddddd] disabled:text-[#717171] disabled:shadow-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2"
          >
            {submitLabel} <Send className="size-4" />
          </button>
        </div>
      </div>
    </section>
  )
}

function CoAgentConversationPanel({
  tourId,
  listing,
  embedded = false,
}: {
  tourId: string
  listing: Listing | null
  embedded?: boolean
}) {
  const [conversationState, setConversationState] = useState<{
    listingId: string
    conversation: api.Conversation | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!listing) return () => { cancelled = true }

    api.fetchConversations(tourId)
      .then((conversations) => {
        if (cancelled) return
        setConversationState({
          listingId: listing.id,
          conversation: conversations.find((item) => item.listingId === listing.id) ?? null,
          error: null,
        })
      })
      .catch((error) => {
        if (cancelled) return
        setConversationState({
          listingId: listing.id,
          conversation: null,
          error: error instanceof Error ? error.message : "加载对话失败",
        })
      })

    return () => { cancelled = true }
  }, [listing, tourId])

  const activeState = listing && conversationState?.listingId === listing.id
    ? conversationState
    : null
  const sellerAvailability = formatListingAvailability(listing?.availability)
  const conversationBody = (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {!listing ? (
        <p className="text-sm text-[#717171]">选择房源后显示对话。</p>
      ) : !activeState ? (
        <p className="text-sm text-[#717171]">正在加载 seed conversation...</p>
      ) : activeState.error ? (
        <p className="text-sm text-[#c13515]">{activeState.error}</p>
      ) : activeState.conversation?.messages.length ? (
        <div className="space-y-3">
          {activeState.conversation.messages.map((message) => (
            <CoAgentMessageBubble
              key={message.id}
              side={message.sender === "ai" ? "ai" : "agent"}
              text={message.body}
              muted={message.sender === "system"}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-[#717171]">该房源还没有 seed conversation。</p>
      )}
    </div>
  )

  if (embedded) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-[#eeeeee] bg-[#fafafa] px-5 py-3">
          <p className="truncate text-xs font-semibold text-[#717171]">
            {listing ? `${listing.coAgent.name || "对方中介"} · ${listing.coAgent.phone || "缺少电话"}` : "请选择房源"}
          </p>
          <p className="max-w-[55%] text-right text-xs font-semibold leading-5 text-[#555555]">
            卖家可用时间：{sellerAvailability}
          </p>
        </div>
        {conversationBody}
      </div>
    )
  }

  return (
    <section className="min-h-0 overflow-hidden rounded-[6px] border border-[#eeeeee] bg-white shadow-sm">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between gap-6 border-b border-[#eeeeee] px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold">AI 和对方中介的对话</h2>
            <p className="mt-1 truncate text-xs font-semibold text-[#717171]">
              {listing ? `${listing.coAgent.name || "对方中介"} · ${listing.coAgent.phone || "缺少电话"}` : "请选择房源"}
            </p>
          </div>
          <div className="flex max-w-[58%] shrink-0 items-start gap-2 rounded-[6px] bg-[#fafafa] px-3 py-2">
            <Calendar className="mt-0.5 size-4 shrink-0 text-[#ff385c]" />
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#9ca3af]">
                卖家可用时间
              </p>
              <p className="mt-0.5 text-xs font-semibold leading-5 text-[#555555]">
                {sellerAvailability}
              </p>
            </div>
          </div>
        </div>
        {conversationBody}
      </div>
    </section>
  )
}

function formatListingAvailability(windows?: Listing["availability"]): string {
  if (!windows?.length) return "尚未提供"
  return windows
    .map((window) => {
      const date = new Date(`${window.date}T00:00:00`)
      const dateLabel = Number.isNaN(date.getTime())
        ? window.date
        : date.toLocaleDateString("zh-SG", {
            month: "numeric",
            day: "numeric",
            weekday: "short",
          })
      return `${dateLabel} ${window.startTime}–${window.endTime}`
    })
    .join("；")
}

function CoAgentMessageBubble({ side, text, muted }: { side: "ai" | "agent"; text: string; muted?: boolean }) {
  const isAi = side === "ai"
  return (
    <div className={`flex ${isAi ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[82%] rounded-[6px] px-3.5 py-2 text-sm leading-6 ${isAi ? "rounded-br-md bg-[#222222] text-white" : muted ? "rounded-bl-md bg-[#fff5f7] text-[#c13515]" : "rounded-bl-md border border-[#eeeeee] bg-[#fafafa] text-[#222222]"}`}>
        {text}
      </div>
    </div>
  )
}

function getListingScheduleBullets(
  listing: Listing | null,
  needsBrief: boolean,
  schedulingRunning: boolean,
): Array<{ text: string; done?: boolean; active?: boolean }> {
  if (!listing) {
    return [{ text: "选择一个房源后显示它的安排动态。", active: true }]
  }

  if (needsBrief) {
    return [
      { text: `${listing.condo} 是排期开始后新增的房源。`, done: true },
      { text: "等待你补充这个房源的 AI Schedule Brief。", active: true },
      { text: "开始后 AI 会尽量保留已确认安排，只处理这个新房源的协调和插入。" },
    ]
  }

  if (listing.status === "confirmed") {
    return [
      { text: `已读取 ${listing.condo} 的 listing 信息和对方中介资料。`, done: true },
      { text: `确认对方中介 ${listing.coAgent.name || "对方中介"} 有可联系号码。`, done: true },
      { text: listing.suggestedTime ? `对方确认可看时间：${listing.suggestedTime}。` : "对方已确认可看时间。", done: true },
      { text: "AI 判断该时间不会破坏当前路线顺序，已写入看房安排。", done: true },
    ]
  }

  if (listing.status === "needs-attention" && listing.statusLabel === "无法排期") {
    return [
      { text: `已读取 ${listing.condo || listing.title} 的卖家中介可用时间。`, done: true },
      { text: "已与当前 Tour 的买家可看时间逐段比较。", done: true },
      { text: listing.attentionReason ?? "买家与卖家中介的时间没有至少 30 分钟重叠。", active: true },
      { text: "请修改买家可看时间，或联系卖家中介取得其他时段。" },
    ]
  }

  if (listing.status === "needs-attention") {
    return [
      { text: `已读取 ${listing.condo} 的 listing 信息和对方中介资料。`, done: true },
      { text: "AI 已尝试匹配客户时间窗、房源可约时间和路线顺序。", done: true },
      { text: listing.attentionReason ?? "出现时间冲突或信息不足，无法自动确认。", active: true },
      { text: "需要你决定：跳过、手动安排，或让 AI 用新的约束重新尝试。" },
    ]
  }

  if (schedulingRunning || listing.status === "contacting") {
    return [
      { text: `正在读取 ${listing.condo} 的 listing 信息和对方中介资料。`, done: true },
      { text: `正在模拟联系 ${listing.coAgent.name || "对方中介"} 确认可看时间。`, active: true },
      { text: "下一步会判断它是否能插入当前路线，并避免影响已确认房源。" },
    ]
  }

  return [
    { text: `已导入 ${listing.condo}，等待 AI 开始排期。`, done: true },
    { text: listing.coAgent.phone ? `已读取对方中介联系方式：${listing.coAgent.name || "对方中介"}。` : "缺少对方中介联系方式，需要补充后才能协调。", done: Boolean(listing.coAgent.phone), active: !listing.coAgent.phone },
    { text: "开始排期后，AI 会匹配客户可看时间、房源可约时间和路线顺序。" },
  ]
}

function ListingAIActivityPanel({
  listing,
  schedulingRunning,
  needsBrief = false,
  decisionSending = false,
  decisionError,
  onDecision,
}: {
  listing: Listing | null
  schedulingRunning: boolean
  needsBrief?: boolean
  decisionSending?: boolean
  decisionError?: string | null
  onDecision?: (draft: string) => Promise<void>
}) {
  const bullets = getListingScheduleBullets(listing, needsBrief, schedulingRunning)
  const [decisionDraft, setDecisionDraft] = useState("")

  const submitDecision = async () => {
    const text = decisionDraft.trim()
    if (!text || !onDecision || decisionSending) return
    await onDecision(text)
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[#eeeeee] px-4 py-3">
        <h2 className="text-sm font-bold">AI 动态 / 我的协作</h2>
        <p className="mt-1 text-xs font-semibold text-[#717171]">{listing?.condo ?? "当前房源"}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#717171]">安排步骤</p>
          <ul className="mt-4 space-y-4">
            {bullets.map((item) => (
              <li key={item.text} className="flex gap-3 text-sm leading-6">
                <span className={`mt-2 size-2 shrink-0 rounded-full ${item.active ? "bg-[#ff385c]" : item.done ? "bg-[#177245]" : "bg-[#d9d9d9]"}`} />
                <span className={item.active ? "font-semibold text-[#222222]" : "font-medium text-[#6a6a6a]"}>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {onDecision ? (
        <div className="border-t border-[#eeeeee] p-3">
          <p className="mb-2 text-xs font-semibold text-[#717171]">
            告诉 Butler 下一步怎么处理，例如调整买家时间、继续询问卖家，或暂时跳过这套房源。
          </p>
          <div className="flex items-end gap-2">
            <textarea
              value={decisionDraft}
              onChange={(event) => setDecisionDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void submitDecision()
                }
              }}
              rows={2}
              placeholder="输入你的下一步决断..."
              className="min-h-10 min-w-0 flex-1 resize-none rounded-[6px] border border-[#dddddd] px-3 py-2 text-sm leading-5 outline-none focus:border-[#222222]"
            />
            <button
              type="button"
              onClick={() => void submitDecision()}
              disabled={!decisionDraft.trim() || decisionSending}
              className="grid size-10 shrink-0 place-items-center rounded-[6px] bg-[#222222] text-white disabled:cursor-not-allowed disabled:bg-[#dddddd]"
              aria-label="提交下一步决断"
            >
              <Send className="size-4" />
            </button>
          </div>
          {decisionError && <p className="mt-2 text-xs font-semibold text-[#c13515]">{decisionError}</p>}
        </div>
      ) : listing?.status !== "needs-attention" && (
        <div className="border-t border-[#eeeeee] p-3">
          <div className="flex gap-2">
            <input
              placeholder="问 AI：这个房源为什么这样安排？"
              className="min-w-0 flex-1 rounded-[6px] border border-[#dddddd] px-3 py-2 text-sm outline-none focus:border-[#222222]"
            />
            <button className="grid size-10 shrink-0 place-items-center rounded-[6px] bg-[#222222] text-white">
              <Send className="size-4" />
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function UnschedulableListingPanel({
  tourId,
  listing,
}: {
  tourId: string
  listing: Listing | null
}) {
  const [activeTab, setActiveTab] = useState<"decision" | "conversation">("decision")
  if (!listing) return null

  const sellerAvailability = listing.availability?.length
    ? listing.availability
        .map((slot) => `${slot.date} ${slot.startTime}–${slot.endTime}`)
        .join("；")
    : "卖家中介尚未提供可用时间"

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[6px] border border-[#eeeeee] bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-[#eeeeee] px-5 py-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-full bg-[#fff5f3] text-[#c13515]">
          <Bot className="size-5" />
        </div>
        <div className="min-w-0">
          <h2 className="font-bold">Butler</h2>
          <p className="truncate text-sm font-semibold text-[#717171]">
            已完成 {listing.condo || listing.title} 的可排期检查
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <div className="flex rounded-[6px] border border-[#dddddd] bg-white p-1">
            <button
              type="button"
              onClick={() => setActiveTab("decision")}
              className={`rounded-[4px] px-3 py-1.5 text-xs font-bold transition-colors ${
                activeTab === "decision" ? "bg-[#222222] text-white" : "text-[#717171] hover:text-[#222222]"
              }`}
            >
              排期判断
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("conversation")}
              className={`rounded-[4px] px-3 py-1.5 text-xs font-bold transition-colors ${
                activeTab === "conversation" ? "bg-[#222222] text-white" : "text-[#717171] hover:text-[#222222]"
              }`}
            >
              中介对话
            </button>
          </div>
          <span className="rounded-full bg-[#fff5f3] px-3 py-1 text-xs font-bold text-[#c13515]">
            无法排期
          </span>
        </div>
      </div>

      {activeTab === "conversation" ? (
        <CoAgentConversationPanel tourId={tourId} listing={listing} embedded />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="rounded-[6px] border border-[#f7c7be] bg-[#fff8f6] p-5">
            <div className="flex items-start gap-3">
              <CircleAlert className="mt-0.5 size-5 shrink-0 text-[#c13515]" />
              <div>
                <h3 className="text-lg font-bold">这套房源目前不能加入 Tour</h3>
                <p className="mt-2 text-sm font-medium leading-6 text-[#555555]">
                  我已经比较了买家和卖家中介的可用时间，但没有找到至少 30 分钟的重叠时段。
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            <div className="rounded-[6px] border border-[#eeeeee] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#717171]">卖家中介可用时间</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#222222]">{sellerAvailability}</p>
            </div>
            <div className="rounded-[6px] border border-[#eeeeee] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#717171]">AI 判断</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#c13515]">
                {listing.attentionReason || "买家与卖家中介的可用时间没有重叠，当前无法排期。"}
              </p>
            </div>
          </div>

          <p className="mt-5 text-sm font-medium leading-6 text-[#717171]">
            请编辑 Tour 的买家可看时间，或联系卖家中介取得其他时段。时间产生交集后，AI 才会继续安排这套房源。
          </p>
        </div>
      )}
    </section>
  )
}

function AICheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[6px] border border-[#eeeeee] bg-white px-3 py-2 text-sm font-semibold text-[#555555]">
      <span className={`grid size-6 place-items-center rounded-full ${ok ? "bg-[#f3fbf5] text-[#177245]" : "bg-[#fff5f7] text-[#c13515]"}`}>
        {ok ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />}
      </span>
      {label}
    </div>
  )
}

function ImportEmptyState() {
  return (
    <div className="rounded-[6px] border border-dashed border-[#dddddd] bg-white p-8 text-center shadow-sm">
      <div className="mx-auto grid size-14 place-items-center rounded-[6px] bg-[#fff5f7] text-[#ff385c]">
        <Link2 className="size-6" />
      </div>
      <h3 className="mt-4 text-xl font-bold tracking-[-0.2px]">添加第一批 PropertyGuru 房源</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#6a6a6a]">
        粘贴 PropertyGuru 房源或搜索结果链接。Butler 会通过 Chrome 插件读取房源资料和对方中介联系方式。
      </p>
      <button
        type="button"
        onClick={() => document.getElementById("propertyguru-import")?.focus()}
        className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-[6px] bg-[#222222] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[#ff385c]"
      >
        粘贴链接开始导入 <ChevronRight className="size-4" />
      </button>
    </div>
  )
}

async function importListingsViaExtension({
  activeTour,
  url,
  onStatus,
  onImportListings,
}: {
  activeTour: ViewingTour
  url: string
  onStatus: (status: string) => void
  onImportListings: (listings: Listing[], importedId?: string) => Promise<void>
}) {
  onStatus("正在打开 PropertyGuru…")
  const token = getStoredToken()
  if (token) {
    await storeTokenInExtension(token).catch(() => {})
  }
  const { taskId } = await importViaTab({
    tourId: activeTour.id,
    url,
    reveal: true,
  })
  onStatus("正在读取房源和对方中介信息…")
  const result = await waitForImportResult(taskId)
  if (!result.ok) throw new Error(result.error || 'Extension import failed')
  const fresh = await api.fetchListings(activeTour.id)
  await onImportListings(fresh, result.importedId)
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
}

function TourActionDock({
  activeTour,
  importText,
  setImportText,
  onImportListings,
}: {
  activeTour: ViewingTour
  importText: string
  setImportText: (value: string) => void
  onImportListings: (listings: Listing[], importedId?: string) => Promise<void>
}) {
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
  return (
    <div className="sticky bottom-4 z-20">
      <div className="relative">
        {extensionInstalled === false && (
          <div className="mb-3 flex items-center gap-3 rounded-[6px] border border-amber-200 bg-amber-50/90 px-4 py-3 text-[13px] text-amber-900">
            <CircleAlert className="size-4 flex-none" />
            <div className="flex-1 min-w-0">
              需要安装 <span className="font-semibold">Butler PG Importer</span> 才能从 PropertyGuru 导入房源和对方中介联系方式。
            </div>
            <a
              href="https://chromewebstore.google.com/detail/melnenopfkellcalpdbopiickpmidjld"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-none rounded-[6px] bg-amber-900 px-3 py-1.5 text-xs font-semibold text-amber-50 hover:bg-amber-950"
            >
              安装插件
            </a>
          </div>
        )}

        <section className="rounded-[6px] border border-white/70 bg-white/90 p-3 shadow-[0_16px_48px_rgba(0,0,0,0.16)] backdrop-blur-xl">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <label className="flex min-w-0 flex-1 items-center gap-3">
              <input
                id="propertyguru-import"
                value={importText}
                onChange={(event) => {
                  // Normalize on input: collapse internal whitespace/newlines
                  // (common when pasting multi-line URLs from chat apps) but do
                  // NOT trim — preserve the leading/trailing positions so the
                  // cursor behaves intuitively while typing.
                  const v = event.target.value.replace(/\s+/g, " ")
                  setImportText(v)
                }}
                className="h-12 min-w-0 flex-1 rounded-[6px] border border-[#dddddd] bg-white px-4 text-sm font-medium outline-none transition focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10"
                aria-label="PropertyGuru listing URL"
                placeholder="粘贴 PropertyGuru 房源链接或搜索结果链接"
              />
            </label>

            <div className="flex flex-wrap justify-stretch gap-2 xl:justify-end">
              <button
                onClick={async () => {
                  const url = importText.trim()
                  if (!url) return
                  if (!activeTour?.id) {
                    alert('请先创建或打开一条看房线路。')
                    return
                  }
                  if (!extensionInstalled) {
                    alert('请先安装并启用 Butler PG Importer Chrome 插件。')
                    return
                  }
                  console.log('[import:ext] tourId=', activeTour.id, 'url=', url)
                  setImporting(true)
                  try {
                    await importListingsViaExtension({
                      activeTour,
                      url,
                      onStatus: setImportStatus,
                      onImportListings,
                    })
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
                title={!extensionInstalled ? '请先安装 Butler PG Importer Chrome 插件' : '通过 Chrome 插件导入'}
                className={`inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-[6px] px-4 py-3 text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-[#222222] focus:ring-offset-2 sm:flex-none ${
                  importing || !importText.trim() || !extensionInstalled
                    ? 'cursor-not-allowed bg-[#e5e7eb] text-[#9ca3af]'
                    : 'bg-[#e5e7eb] text-[#6b7280] hover:bg-[#dfe3ea] hover:text-[#222222]'
                }`}
              >
                <Link2 className="size-4" />
                {importing ? "Importing…" : "Import via Extension"}
              </button>
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
      <div className="overflow-hidden rounded-[6px] border border-[#e8e8e8] bg-white shadow-sm">
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
      <img src={listing.imageUrl} alt={listing.condo} className="h-16 w-full rounded-[6px] object-cover lg:h-14 lg:w-[72px]" />

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
        <div className="grid size-7 place-items-center rounded-[6px] bg-[#222222]">
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
        <div className="rounded-[6px] border border-dashed border-[#e0e0e0] bg-[#fafafa] px-5 py-8 text-center">
          <div className="mx-auto mb-3 grid size-9 place-items-center rounded-[6px] border border-[#e8e8e8] bg-white shadow-sm">
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
                  <div className={`min-w-0 flex-1 rounded-[6px] border p-3 transition-colors ${
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
            <div className="mt-4 rounded-[6px] border border-[#f0f0f0] bg-[#fafafa] px-3 py-2.5">
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
  chatSessionId,
  schedulingRun,
  schedulingSteps,
  schedulingRunning,
  onClose,
  onDeleteListing,
  onProposalApplied,
}: {
  listings: Listing[]
  sidePanel: SidePanel
  selectedListing: Listing | null
  activeTourId: string
  chatSessionId: string | null
  schedulingRun: api.SchedulingRun | null
  schedulingSteps: api.SchedulingStepDef[]
  schedulingRunning: boolean
  onClose: () => void
  onDeleteListing: (id: string) => void
  onProposalApplied: () => void
}) {
  return (
    <aside className={`min-h-0 overflow-hidden border-l border-[#e8e8e8] bg-white transition-opacity duration-200 ${sidePanel ? "opacity-100" : "pointer-events-none opacity-0"}`}>
      {sidePanel === "map" && <MapPanel listings={panelListings} onClose={onClose} />}
      {sidePanel === "route" && <RoutePanel tourId={activeTourId} onClose={onClose} />}
      {sidePanel === "listing" && selectedListing && <ListingDetailPanel listing={selectedListing} onClose={onClose} onDeleteListing={onDeleteListing} />}
      {sidePanel === "listing" && !selectedListing && <EmptyPanel onClose={onClose} />}
      {sidePanel === "chat" && (schedulingRunning || schedulingRun?.status === "running") && (
        <AIWorkPanel
          run={schedulingRun}
          steps={schedulingSteps}
          listings={panelListings}
          onClose={onClose}
        />
      )}
      {sidePanel === "chat" && !(schedulingRunning || schedulingRun?.status === "running") && chatSessionId && (
        <SchedulingChat
          sessionId={chatSessionId}
          onProposalApplied={onProposalApplied}
        />
      )}
      {sidePanel === "chat" && !(schedulingRunning || schedulingRun?.status === "running") && !chatSessionId && <EmptyPanel onClose={onClose} />}
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
      <button onClick={onClose} className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-[6px] border border-[#dddddd] hover:border-[#222222]" aria-label="Close panel">
        <PanelRightClose className="size-4" />
      </button>
    </div>
  )
}

function AIWorkPanel({
  run,
  steps,
  listings,
  onClose,
}: {
  run: api.SchedulingRun | null
  steps: api.SchedulingStepDef[]
  listings: Listing[]
  onClose: () => void
}) {
  const currentStep = steps.find((step) => step.key === run?.currentStep)
  const progress = Math.max(0, Math.min(100, run?.progress ?? 3))
  const fallbackSteps = steps.length ? steps : [
    { key: "prepare", label: "整理线路要求" },
    { key: "contacts", label: "检查中介联系方式" },
    { key: "coordinate", label: "模拟联系对方中介" },
    { key: "optimize", label: "解决时间冲突并生成路线" },
  ]
  const statusMap = run?.stepState ?? {}
  const sampleListings = listings.slice(0, 3)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="AI 工作中" description="当前为内部模拟，不会真实发送 WhatsApp。" icon={Bot} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="rounded-[6px] border border-[#ffd5de] bg-[#fff5f7] p-4">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#c13515]">当前步骤</p>
          <h2 className="mt-2 text-xl font-bold">{currentStep?.label ?? "启动 AI 排期任务"}</h2>
          <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">
            Butler 正在读取线路、房源和模拟沟通结果，完成后会自动生成看房路线。
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-[#ff385c] transition-[width] duration-300" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-xs font-semibold text-[#717171]">{progress}%</p>
        </div>

        <div className="mt-4 rounded-[6px] border border-[#eeeeee] bg-white p-4">
          <p className="text-sm font-bold">工作步骤</p>
          <div className="mt-3 space-y-3">
            {fallbackSteps.map((step) => {
              const state = statusMap[step.key] ?? (step.key === run?.currentStep ? "running" : "pending")
              return (
                <div key={step.key} className="flex items-center gap-3">
                  <span className={`grid size-6 place-items-center rounded-full ${
                    state === "done"
                      ? "bg-[#f3fbf5] text-[#177245]"
                      : state === "running"
                        ? "bg-[#fff5f7] text-[#ff385c]"
                        : state === "failed"
                          ? "bg-[#ff385c] text-white"
                          : "bg-[#f2f2f2] text-[#9ca3af]"
                  }`}>
                    {state === "running" ? <span className="size-2 animate-pulse rounded-full bg-current" /> : <CheckCircle2 className="size-3.5" />}
                  </span>
                  <span className="text-sm font-semibold text-[#222222]">{step.label}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-4 rounded-[6px] border border-[#eeeeee] bg-white p-4">
          <p className="text-sm font-bold">最近活动</p>
          <div className="mt-3 space-y-3">
            <ActivityLine text={`已读取 ${listings.length} 个房源，准备协调可看房时间。`} />
            {sampleListings.map((listing) => (
              <ActivityLine
                key={listing.id}
                text={`检查 ${listing.condo || listing.title} 的对方中介联系方式。`}
              />
            ))}
            <ActivityLine text="正在模拟发送看房时间请求，并等待对方中介回复。" active />
          </div>
        </div>
      </div>
    </div>
  )
}

function ActivityLine({ text, active }: { text: string; active?: boolean }) {
  return (
    <div className="flex gap-3 text-sm leading-6">
      <span className={`mt-2 size-2 shrink-0 rounded-full ${active ? "animate-pulse bg-[#ff385c]" : "bg-[#dddddd]"}`} />
      <span className={active ? "font-semibold text-[#222222]" : "text-[#6a6a6a]"}>{text}</span>
    </div>
  )
}

function AIWorkPanel({
  run,
  steps,
  listings,
  onClose,
}: {
  run: api.SchedulingRun | null
  steps: api.SchedulingStepDef[]
  listings: Listing[]
  onClose: () => void
}) {
  const currentStep = steps.find((step) => step.key === run?.currentStep)
  const progress = Math.max(0, Math.min(100, run?.progress ?? 3))
  const fallbackSteps = steps.length ? steps : [
    { key: "prepare", label: "整理线路要求" },
    { key: "contacts", label: "检查中介联系方式" },
    { key: "coordinate", label: "模拟联系对方中介" },
    { key: "optimize", label: "解决时间冲突并生成路线" },
  ]
  const statusMap = run?.stepState ?? {}
  const sampleListings = listings.slice(0, 3)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="AI 工作中" description="当前为内部模拟，不会真实发送 WhatsApp。" icon={Bot} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="rounded-[6px] border border-[#ffd5de] bg-[#fff5f7] p-4">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#c13515]">当前步骤</p>
          <h2 className="mt-2 text-xl font-bold">{currentStep?.label ?? "启动 AI 排期任务"}</h2>
          <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">
            Butler 正在读取线路、房源和模拟沟通结果，完成后会自动生成看房路线。
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-[#ff385c] transition-[width] duration-300" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-xs font-semibold text-[#717171]">{progress}%</p>
        </div>

        <div className="mt-4 rounded-[6px] border border-[#eeeeee] bg-white p-4">
          <p className="text-sm font-bold">工作步骤</p>
          <div className="mt-3 space-y-3">
            {fallbackSteps.map((step) => {
              const state = statusMap[step.key] ?? (step.key === run?.currentStep ? "running" : "pending")
              return (
                <div key={step.key} className="flex items-center gap-3">
                  <span className={`grid size-6 place-items-center rounded-full ${
                    state === "done"
                      ? "bg-[#f3fbf5] text-[#177245]"
                      : state === "running"
                        ? "bg-[#fff5f7] text-[#ff385c]"
                        : state === "failed"
                          ? "bg-[#ff385c] text-white"
                          : "bg-[#f2f2f2] text-[#9ca3af]"
                  }`}>
                    {state === "running" ? <span className="size-2 animate-pulse rounded-full bg-current" /> : <CheckCircle2 className="size-3.5" />}
                  </span>
                  <span className="text-sm font-semibold text-[#222222]">{step.label}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-4 rounded-[6px] border border-[#eeeeee] bg-white p-4">
          <p className="text-sm font-bold">最近活动</p>
          <div className="mt-3 space-y-3">
            <ActivityLine text={`已读取 ${listings.length} 个房源，准备协调可看房时间。`} />
            {sampleListings.map((listing) => (
              <ActivityLine
                key={listing.id}
                text={`检查 ${listing.condo || listing.title} 的对方中介联系方式。`}
              />
            ))}
            <ActivityLine text="正在模拟发送看房时间请求，并等待对方中介回复。" active />
          </div>
        </div>
      </div>
    </div>
  )
}

function ActivityLine({ text, active }: { text: string; active?: boolean }) {
  return (
    <div className="flex gap-3 text-sm leading-6">
      <span className={`mt-2 size-2 shrink-0 rounded-full ${active ? "animate-pulse bg-[#ff385c]" : "bg-[#dddddd]"}`} />
      <span className={active ? "font-semibold text-[#222222]" : "text-[#6a6a6a]"}>{text}</span>
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
        <div className="overflow-hidden rounded-[6px]">
          <img src={listing.imageUrl} alt={listing.title} className="h-48 w-full object-cover" />
        </div>
        <div className="mt-4 space-y-4">
          <div>
            <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone[listing.status]}`}>{listing.statusLabel}</span>
            <h2 className="mt-3 text-2xl font-bold tracking-[-0.35px]">{listing.title}</h2>
            <p className="mt-1 text-sm font-medium text-[#6a6a6a]">{listing.address}</p>
          </div>

          {listing.attentionReason && (
            <div className="rounded-[6px] border border-[#ffd5de] bg-[#fff5f7] p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-[#c13515]"><CircleAlert className="size-4" /> Agent decision needed</p>
              <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">{listing.attentionReason}</p>
              <div className="mt-3 flex gap-2">
                <button className="cursor-pointer rounded-[6px] bg-[#222222] px-3 py-2 text-xs font-bold text-white hover:bg-[#ff385c]">Approve reply</button>
                <button className="cursor-pointer rounded-[6px] border border-[#dddddd] px-3 py-2 text-xs font-bold hover:border-[#222222]">Move to another tour</button>
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
            className="flex cursor-pointer items-center justify-between rounded-[6px] border border-[#dddddd] p-4 text-sm font-bold transition-colors hover:border-[#222222] focus:outline-none focus:ring-2 focus:ring-[#222222] focus:ring-offset-2"
          >
            <span className="flex items-center gap-2"><Building2 className="size-4 text-[#ff385c]" /> Open in PropertyGuru</span>
            <ExternalLink className="size-4" />
          </a>

          <button
            onClick={() => onDeleteListing(listing.id)}
            className="flex w-full cursor-pointer items-center justify-between rounded-[6px] border border-[#ffd5de] bg-[#fff5f7] p-4 text-sm font-bold text-[#c13515] transition-colors hover:border-[#c13515] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c13515] focus-visible:ring-offset-2"
          >
            <span className="flex items-center gap-2"><Trash2 className="size-4" /> Delete listing</span>
            <span className="text-xs font-semibold text-[#c13515]/70">Remove from tour</span>
          </button>

          {messages.length > 0 && (
            <div className="rounded-[6px] bg-[#f7f7f7] p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-bold"><MessageCircle className="size-4" /> Listing conversation</p>
              <div className="space-y-3">
                {messages.map((message) => (
                  <div key={message.id} className="rounded-[6px] bg-white p-3">
                    <p className="text-xs font-bold text-[#6a6a6a]">{message.senderName} · {message.timestamp}</p>
                    <p className="mt-1 text-sm leading-6">{message.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoTile({ icon: Icon, label, value }: { icon: typeof Calendar; label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-[#eeeeee] p-3">
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
        <div className="relative min-h-[360px] overflow-hidden rounded-[6px] bg-white shadow-[rgba(0,0,0,0.02)_0px_0px_0px_1px,rgba(0,0,0,0.04)_0px_2px_6px]">
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
            <div key={area} className="rounded-[6px] border border-[#eeeeee] p-4">
              <div className="flex items-center justify-between">
                <p className="font-bold">{area}</p>
                <span className="rounded-full bg-[#f2f2f2] px-2 py-1 text-xs font-bold text-[#6a6a6a]">{items.length}</span>
              </div>
              <div className="mt-3 space-y-2">
                {items.map((listing) => (
                  <a key={listing.id} href={listing.googleMapsUrl} target="_blank" rel="noreferrer" className="flex cursor-pointer items-center justify-between rounded-[6px] bg-[#fafafa] px-3 py-2 text-sm font-semibold hover:bg-[#f2f2f2]">
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
        <div className="rounded-[6px] border border-[#eeeeee] bg-[#fafafa] p-4">
          <p className="text-sm font-bold text-[#ff385c]">{route.date}</p>
          <h2 className="mt-1 text-xl font-bold tracking-[-0.25px]">{route.title}</h2>
          <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">Internal route includes unit, co-agent and notes for agent use.</p>
        </div>

        <div className="mt-4 space-y-3">
          {route.stops.map((stop, index) => (
            <div key={stop.id} className="rounded-[6px] border border-[#eeeeee] bg-white p-4">
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

function DeleteTourDialog({
  tour,
  listingCount,
  deleting,
  error,
  onOpenChange,
  onConfirm,
}: {
  tour: ViewingTour | null
  listingCount: number
  deleting: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={Boolean(tour)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-[6px] p-0">
        <DialogHeader className="border-b border-[#eeeeee] p-5 pb-4">
          <DialogTitle className="flex items-center gap-2 text-xl font-bold tracking-[-0.2px]">
            <Trash2 className="size-5 text-[#c13515]" /> 删除看房线路？
          </DialogTitle>
          <DialogDescription className="text-sm font-medium leading-6 text-[#6a6a6a]">
            删除后，该线路里的房源、AI 排期记录和已生成路线都会一起删除，无法撤销。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 p-5">
          <div className="rounded-[6px] border border-[#eeeeee] bg-[#fafafa] p-4">
            <p className="text-base font-bold text-[#222222]">{tour?.title ?? ""}</p>
            <p className="mt-1 text-sm font-semibold text-[#6a6a6a]">
              {tour?.targetDate ?? ""} · {listingCount} 个房源
            </p>
          </div>
          {error && (
            <div className="rounded-[6px] border border-[#ffd6de] bg-[#fff5f7] px-3 py-2 text-sm font-semibold text-[#c13515]">
              删除失败：{error}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-[#eeeeee] p-5 pt-4">
          <DialogClose
            disabled={deleting}
            className="cursor-pointer rounded-[6px] border border-[#dddddd] px-4 py-2.5 text-sm font-bold hover:border-[#222222] disabled:cursor-not-allowed disabled:opacity-60"
          >
            取消
          </DialogClose>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="cursor-pointer rounded-[6px] bg-[#c13515] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#a12b11] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {deleting ? "删除中..." : "删除线路"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditPlanDialog({
  plan,
  onOpenChange,
  onSave,
  onDelete,
}: {
  plan: ViewingPlan
  onOpenChange: (open: boolean) => void
  onSave: (planId: string, draft: PlanDraft) => void
  onDelete: (planId: string) => Promise<void>
}) {
  const [title, setTitle] = useState(plan.title)
  const [clientName, setClientName] = useState(plan.clientName)
  const [clientWhatsapp, setClientWhatsapp] = useState((plan.clientWhatsapp ?? "").replace(/^\+65\s*/, ""))
  const [brief, setBrief] = useState(plan.brief)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const submitPlan = () => {
    onSave(plan.id, {
      title,
      clientName,
      clientWhatsapp: clientWhatsapp ? `+65 ${clientWhatsapp}` : undefined,
      brief,
    })
  }

  const deletePlan = async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      await onDelete(plan.id)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
      setDeleting(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-[6px] p-0">
        <DialogHeader className="border-b border-[#eeeeee] p-6 pb-4">
          <DialogTitle className="flex items-center gap-2 text-2xl font-bold tracking-[-0.3px]">
            <SlidersHorizontal className="size-5 text-[#ff385c]" /> 编辑客户计划
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 p-6 md:grid-cols-2">
          <label className="block text-sm font-bold">
            计划名称
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：Alicia 周末看房计划" className="mt-2 w-full rounded-[6px] border border-[#dddddd] px-3 py-2.5 text-sm font-medium outline-none focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10" />
          </label>
          <label className="block text-sm font-bold">
            客户 / 买家姓名
            <input value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="例如：Alicia Tan" className="mt-2 w-full rounded-[6px] border border-[#dddddd] px-3 py-2.5 text-sm font-medium outline-none focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10" />
          </label>
          <label className="block text-sm font-bold md:col-span-2">
            客户 WhatsApp <span className="font-semibold text-[#6a6a6a]">（可选）</span>
            <div className="mt-2 flex overflow-hidden rounded-[6px] border border-[#dddddd] bg-white focus-within:border-[#222222] focus-within:ring-2 focus-within:ring-[#222222]/10">
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
            买家需求
            <textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="例如：2房公寓，D09/D10，预算约 S$2.5M，偏好下午看房。" className="mt-2 min-h-28 w-full resize-none rounded-[6px] border border-[#dddddd] px-3 py-2.5 text-sm font-medium leading-6 outline-none focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10" />
          </label>
          {confirmDelete && (
            <div className="md:col-span-2 rounded-[6px] border border-[#ffd6de] bg-[#fff5f7] p-4">
              <p className="text-sm font-bold text-[#c13515]">确认删除整个客户计划？</p>
              <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">
                这会同时删除该计划下的所有看房线路、房源、AI 排期记录和路线。此操作无法撤销。
              </p>
              {deleteError && (
                <p className="mt-2 text-sm font-semibold text-[#c13515]">删除失败：{deleteError}</p>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="items-center justify-between border-t border-[#eeeeee] p-6 pt-4 sm:justify-between">
          <div className="mr-auto">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="cursor-pointer rounded-[6px] border border-[#ffd5de] bg-[#fff5f7] px-4 py-2.5 text-sm font-bold text-[#c13515] hover:border-[#c13515]"
              >
                删除计划
              </button>
            ) : (
              <button
                type="button"
                onClick={deletePlan}
                disabled={deleting}
                className="cursor-pointer rounded-[6px] bg-[#c13515] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#a12b11] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {deleting ? "删除中..." : "确认删除"}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <DialogClose
              disabled={deleting}
              className="cursor-pointer rounded-[6px] border border-[#dddddd] px-4 py-2.5 text-sm font-bold hover:border-[#222222] disabled:cursor-not-allowed disabled:opacity-60"
            >
              取消
            </DialogClose>
            <button
              onClick={submitPlan}
              disabled={deleting}
              className="cursor-pointer rounded-[6px] bg-[#ff385c] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#e00b41] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
            >
              保存修改
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      <DialogContent className="max-w-2xl rounded-[6px] p-0">
        <DialogHeader className="border-b border-[#eeeeee] p-6 pb-4">
          <DialogTitle className="flex items-center gap-2 text-2xl font-bold tracking-[-0.3px]"><FilePlus2 className="size-5 text-[#ff385c]" /> 创建客户计划</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 p-6 md:grid-cols-2">
          <label className="block text-sm font-bold">
            计划名称
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：Alicia 周末看房计划" className="mt-2 w-full rounded-[6px] border border-[#dddddd] px-3 py-2.5 text-sm font-medium outline-none focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10" />
          </label>
          <label className="block text-sm font-bold">
            客户 / 买家姓名
            <input value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="例如：Alicia Tan" className="mt-2 w-full rounded-[6px] border border-[#dddddd] px-3 py-2.5 text-sm font-medium outline-none focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10" />
          </label>
          <label className="block text-sm font-bold md:col-span-2">
            客户 WhatsApp <span className="font-semibold text-[#6a6a6a]">（可选）</span>
            <div className="mt-2 flex overflow-hidden rounded-[6px] border border-[#dddddd] bg-white focus-within:border-[#222222] focus-within:ring-2 focus-within:ring-[#222222]/10">
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
            买家需求
            <textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="例如：2房公寓，D09/D10，预算约 S$2.5M，偏好下午看房。" className="mt-2 min-h-28 w-full resize-none rounded-[6px] border border-[#dddddd] px-3 py-2.5 text-sm font-medium leading-6 outline-none focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10" />
          </label>
        </div>
        <DialogFooter className="border-t border-[#eeeeee] p-6 pt-4">
          <DialogClose className="cursor-pointer rounded-[6px] border border-[#dddddd] px-4 py-2.5 text-sm font-bold hover:border-[#222222]">取消</DialogClose>
          <button onClick={submitPlan} className="cursor-pointer rounded-[6px] bg-[#ff385c] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#e00b41] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2">创建计划</button>
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
  onCreate: (draft: TourDraft) => Promise<void>
}) {
  const [title, setTitle] = useState(defaultTour.title)
  const [command, setCommand] = useState(defaultTour.command)
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<api.AvailabilityParseResult | null>(null)

  useEffect(() => {
    if (open) return
    setTitle(defaultTour.title)
    setCommand(defaultTour.command)
    setError(null)
    setParsed(null)
  }, [open])

  const submitTour = async () => {
    if (!title.trim()) {
      setError("请填写线路名称。")
      return
    }
    if (!parsed?.serialized || !parsed.targetDate) {
      setError("请先在对话中告诉 AI 买家的可看时间。")
      return
    }
    await onCreate({
      title,
      targetDate: parsed.targetDate!,
      timeWindow: parsed.serialized!,
      command,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-[6px] p-0">
        <DialogHeader className="border-b border-[#eeeeee] p-6 pb-4">
          <DialogTitle className="flex items-center gap-2 text-2xl font-bold tracking-[-0.3px]"><Route className="size-5 text-[#ff385c]" /> 创建看房线路</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 p-6">
          <label className="block text-sm font-bold">
            线路名称
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：周六东海岸 5 套" className="mt-2 w-full rounded-[6px] border border-[#dddddd] px-3 py-2.5 text-sm font-medium outline-none focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10" />
          </label>
          <AvailabilityChat
            open={open}
            onParsedChange={(result) => {
              setParsed(result)
              setError(null)
            }}
          />
          <label className="block text-sm font-bold">
            AI 排期要求
            <textarea value={command} onChange={(event) => setCommand(event.target.value)} placeholder="例如：同一个 condo 尽量连续看，避免午饭时间，下午 5 点前结束。" className="mt-2 min-h-28 w-full resize-none rounded-[6px] border border-[#dddddd] px-3 py-2.5 text-sm font-medium leading-6 outline-none focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10" />
          </label>
          {error && <p className="text-sm font-semibold text-[#c13515]">{error}</p>}
        </div>
        <DialogFooter className="border-t border-[#eeeeee] p-6 pt-4">
          <DialogClose className="cursor-pointer rounded-[6px] border border-[#dddddd] px-4 py-2.5 text-sm font-bold hover:border-[#222222]">取消</DialogClose>
          <button onClick={() => void submitTour()} disabled={!parsed} className="cursor-pointer rounded-[6px] bg-[#ff385c] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#e00b41] disabled:cursor-not-allowed disabled:bg-[#dddddd] disabled:text-[#717171] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#222222] focus-visible:ring-offset-2">创建线路</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditTourDialog({
  tour,
  onOpenChange,
  onSave,
}: {
  tour: ViewingTour
  onOpenChange: (open: boolean) => void
  onSave: (tourId: string, draft: TourDraft) => Promise<void>
}) {
  const existingAvailability = useMemo(() => availabilityResultFromTour(tour), [tour])
  const [title, setTitle] = useState(tour.title)
  const [command, setCommand] = useState(tour.command)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<api.AvailabilityParseResult | null>(existingAvailability)

  const submit = async () => {
    if (!title.trim()) {
      setError("请填写线路名称。")
      return
    }
    if (!parsed?.serialized || !parsed.targetDate) {
      setError("请先在对话中确认买家的可看时间。")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(tour.id, {
        title,
        targetDate: parsed.targetDate!,
        timeWindow: parsed.serialized!,
        command,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-[6px] p-0">
        <DialogHeader className="border-b border-[#eeeeee] p-6 pb-4">
          <DialogTitle className="flex items-center gap-2 text-2xl font-bold tracking-[-0.3px]"><Route className="size-5 text-[#ff385c]" /> 编辑看房线路</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 p-6">
          <label className="block text-sm font-bold">线路名称<input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 w-full rounded-[6px] border border-[#dddddd] px-3 py-2.5 text-sm font-medium outline-none focus:border-[#222222]" /></label>
          <AvailabilityChat
            open
            initialSource={getTourAvailabilitySource(tour)}
            initialSummary={formatTourAvailability(tour)}
            initialResult={existingAvailability}
            onParsedChange={(result) => {
              setParsed(result)
              setError(null)
            }}
          />
          <label className="block text-sm font-bold">AI 排期要求<textarea value={command} onChange={(event) => setCommand(event.target.value)} className="mt-2 min-h-24 w-full resize-none rounded-[6px] border border-[#dddddd] px-3 py-2.5 text-sm font-medium leading-6 outline-none focus:border-[#222222]" /></label>
          {error && <p className="text-sm font-semibold text-[#c13515]">{error}</p>}
        </div>
        <DialogFooter className="border-t border-[#eeeeee] p-6 pt-4">
          <DialogClose disabled={saving} className="cursor-pointer rounded-[6px] border border-[#dddddd] px-4 py-2.5 text-sm font-bold hover:border-[#222222]">取消</DialogClose>
          <button type="button" onClick={() => void submit()} disabled={saving || !parsed} className="cursor-pointer rounded-[6px] bg-[#ff385c] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#e00b41] disabled:cursor-not-allowed disabled:bg-[#dddddd] disabled:text-[#717171]">{saving ? "保存中..." : "保存线路"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AvailabilityChat({
  open,
  initialSource,
  initialSummary,
  initialResult = null,
  onParsedChange,
}: {
  open: boolean
  initialSource?: string
  initialSummary?: string
  initialResult?: api.AvailabilityParseResult | null
  onParsedChange: (result: api.AvailabilityParseResult | null) => void
}) {
  const initialMessages = (): api.AvailabilityConversationMessage[] => initialSource
    ? [
        { role: "assistant", content: "这是当前 Tour 的买家可看时间。需要修改的话，直接告诉我新的日期或时间。" },
        { role: "user", content: initialSource },
        { role: "assistant", content: `当前已识别为：${initialSummary || initialSource}` },
      ]
    : [
        {
          role: "assistant",
          content: "买家什么时候可以看房？可以直接说“周六上午10点到下午4点半”或“每周六下午2点”。",
        },
      ]
  const [messages, setMessages] = useState<api.AvailabilityConversationMessage[]>(initialMessages)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [validResult, setValidResult] = useState<api.AvailabilityParseResult | null>(initialResult)

  useEffect(() => {
    if (!open) {
      setMessages(initialMessages())
      setDraft("")
      setSending(false)
      setValidResult(initialResult)
    }
  }, [open, initialSource, initialSummary, initialResult])

  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    const history = messages
    setMessages((current) => [...current, { role: "user", content: text }])
    setDraft("")
    setSending(true)
    setValidResult(null)
    onParsedChange(null)
    try {
      const result = await api.parseAvailability(text, singaporeToday(), history)
      const assistantText = result.status === "valid"
        ? `我理解为：${result.summary}。如果不对，请直接告诉我怎么修改。`
        : result.message || "我还缺少具体的日期或时间，请再补充一下。"
      setMessages((current) => [...current, { role: "assistant", content: assistantText }])
      if (result.status === "valid" && result.serialized && result.targetDate) {
        setValidResult(result)
        onParsedChange(result)
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: error instanceof Error ? error.message : "暂时无法理解，请稍后再试。",
        },
      ])
    } finally {
      setSending(false)
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold">买家可看日期与时间 <span className="text-[#c13515]">*</span></p>
          <p className="mt-1 text-xs font-medium text-[#717171]">和 AI 对话；信息不完整时，它会继续追问。</p>
        </div>
        {validResult && (
          <span className="shrink-0 rounded-full bg-[#f3fbf5] px-3 py-1 text-xs font-bold text-[#177245]">
            时间已确认
          </span>
        )}
      </div>

      <div className="mt-2 overflow-hidden rounded-[6px] border border-[#dddddd] bg-[#fafafa]">
        <div className="max-h-56 min-h-40 space-y-2 overflow-y-auto p-3">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-[6px] px-3 py-2 text-sm leading-5 ${
                message.role === "user"
                  ? "bg-[#222222] text-white"
                  : "border border-[#eeeeee] bg-white text-[#222222]"
              }`}>
                {message.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-[6px] border border-[#eeeeee] bg-white px-3 py-2 text-sm text-[#717171]">
                AI 正在理解...
              </div>
            </div>
          )}
        </div>
        <div className="flex items-end gap-2 border-t border-[#eeeeee] bg-white p-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            placeholder={validResult ? "需要修改？继续告诉 AI..." : "输入买家的 available time..."}
            rows={2}
            className="min-h-10 flex-1 resize-none rounded-[6px] border border-[#dddddd] px-3 py-2 text-sm font-medium leading-5 outline-none focus:border-[#222222]"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!draft.trim() || sending}
            className="grid size-10 shrink-0 place-items-center rounded-[6px] bg-[#222222] text-white hover:bg-black disabled:cursor-not-allowed disabled:bg-[#dddddd]"
            aria-label="发送可看时间"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </section>
  )
}

function readTourAvailabilityJson(tour: ViewingTour): {
  sourceText?: string
  summary?: string
  rules?: api.AvailabilityRule[]
} | null {
  try {
    const parsed = JSON.parse(tour.timeWindow) as {
      version?: number
      sourceText?: string
      summary?: string
      rules?: api.AvailabilityRule[]
    }
    return parsed.version === 1 ? parsed : null
  } catch {
    return null
  }
}

function getTourAvailabilitySource(tour: ViewingTour): string {
  return readTourAvailabilityJson(tour)?.sourceText || tour.timeWindow
}

function formatTourAvailability(tour: ViewingTour): string {
  return readTourAvailabilityJson(tour)?.summary || tour.timeWindow.replace(/\n+/g, ", ")
}

function availabilityResultFromTour(tour: ViewingTour): api.AvailabilityParseResult {
  const stored = readTourAvailabilityJson(tour)
  return {
    status: "valid",
    rules: stored?.rules || [],
    summary: stored?.summary || formatTourAvailability(tour),
    message: "已加载当前买家可看时间。",
    serialized: tour.timeWindow,
    targetDate: tour.targetDate,
  }
}

function singaporeToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function parseScheduledSlot(value: string, fallbackDate: string): { date: string; time: string } {
  const match = /^(\d{4}-\d{2}-\d{2})\s+(.+)$/.exec(value)
  return match ? { date: match[1], time: match[2] } : { date: fallbackDate, time: value }
}

function ScrollablePage({ children }: { children: React.ReactNode }) {
  return <div className="h-full overflow-y-auto px-5 py-6 lg:px-6">{children}</div>
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
        <section className="rounded-[6px] bg-white p-6 shadow-[rgba(0,0,0,0.02)_0px_0px_0px_1px,rgba(0,0,0,0.04)_0px_2px_6px,rgba(0,0,0,0.1)_0px_4px_8px]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-bold text-[#ff385c]"><Route className="size-4" /> Routes inside current tour</p>
              <h1 className="mt-2 text-4xl font-bold tracking-[-0.44px]">{liveRoute.title}</h1>
              <p className="mt-2 text-sm font-medium text-[#6a6a6a]">Internal route includes co-agent, phone, unit-no and notes.</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={handleGenerateRoute} className="inline-flex cursor-pointer items-center gap-2 rounded-[6px] border border-[#dddddd] bg-white px-5 py-3 text-sm font-bold transition-colors hover:border-[#222222]">
                Generate Route <Route className="size-4" />
              </button>
              <button onClick={handleShare} className="inline-flex cursor-pointer items-center gap-2 rounded-[6px] border border-[#ffd5de] bg-[#fff5f7] px-5 py-3 text-sm font-bold text-[#c13515]">
                Share to Client <Share2 className="size-4" />
              </button>
            </div>
          </div>
          {shareUrl && (
            <div className="mt-3 rounded-[6px] border border-[#d7f4df] bg-[#f3fbf5] px-4 py-3 text-sm font-bold text-[#177245]">
              Share link created: {shareUrl}
            </div>
          )}
          <div className="mt-7 space-y-4">
            {liveRoute.stops.map((stop, index) => (
              <div key={stop.id} className="grid gap-4 rounded-[6px] border border-[#eeeeee] p-4 md:grid-cols-[90px_minmax(0,1fr)_220px] md:items-center">
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
    <section className="rounded-[6px] bg-white p-6 shadow-[rgba(0,0,0,0.02)_0px_0px_0px_1px,rgba(0,0,0,0.04)_0px_2px_6px,rgba(0,0,0,0.1)_0px_4px_8px]">
      <div className="rounded-[6px] bg-[#fff7f9] p-6">
        <p className="flex items-center gap-2 text-sm font-bold text-[#c13515]"><LockKeyhole className="size-4" /> Tour share route · redacted client view</p>
        <h1 className="mt-2 text-4xl font-bold tracking-[-0.44px]">{route.title}</h1>
        <p className="mt-3 text-sm leading-6 text-[#6a6a6a]">{route.privacyNotice}</p>
      </div>
      <div className="mt-6 space-y-4">
        {route.stops.map((stop, index) => (
          <div key={stop.id} className="rounded-[6px] border border-[#eeeeee] p-5">
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
      <div className="mt-6 rounded-[6px] border border-[#d7f4df] bg-[#f3fbf5] p-4">
        <p className="flex items-center gap-2 text-sm font-bold text-[#177245]"><CheckCircle2 className="size-4" /> Privacy check passed</p>
        <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">This contract contains no co-agent names, phone numbers, unit numbers, WhatsApp messages or internal notes.</p>
      </div>
    </section>
  )
}

function SettingsView() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-[6px] bg-white p-6 shadow-[rgba(0,0,0,0.02)_0px_0px_0px_1px,rgba(0,0,0,0.04)_0px_2px_6px,rgba(0,0,0,0.1)_0px_4px_8px]">
        <p className="flex items-center gap-2 text-sm font-bold text-[#ff385c]"><SlidersHorizontal className="size-4" /> AI PA configuration</p>
        <h1 className="mt-2 text-4xl font-bold tracking-[-0.44px]">Default skills plus your custom rules.</h1>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {[
            ["Scheduling policy", "Group same condo together, preserve drive buffers, avoid lunch gap unless requested."],
            ["Escalation policy", "Pause for tenant handover, price negotiation, incomplete owner access or conflicting instructions."],
            ["Communication tone", "Concise, polite and professional. AI PA never reveals buyer private notes."],
            ["Backend adapter", "Settings will be saved through GET/PUT /ai-pa/settings with typed constraints."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-[6px] border border-[#eeeeee] p-5">
              <h2 className="text-lg font-bold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-[#6a6a6a]">{body}</p>
            </div>
          ))}
        </div>
        <label className="mt-6 block text-sm font-bold">Custom instructions</label>
        <textarea
          className="mt-2 min-h-36 w-full resize-none rounded-[6px] border border-[#dddddd] p-4 text-sm leading-6 outline-none focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10"
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
    <aside className="h-fit rounded-[6px] bg-[#f7f7f7] p-5">
      <p className="flex items-center gap-2 text-sm font-bold"><Link2 className="size-4 text-[#ff385c]" /> Backend interfaces reserved</p>
      <div className="mt-4 space-y-3">
        {contracts.map((group) => (
          <details key={group.area} className="rounded-[6px] bg-white p-4" open={group.area === "Plans / tours / listings" || group.area === "Route sharing"}>
            <summary className="cursor-pointer text-sm font-bold">{group.area}</summary>
            <div className="mt-3 space-y-2">
              {group.endpoints.map((endpoint) => (
                <code key={endpoint} className="block rounded-[6px] bg-[#f7f7f7] px-3 py-2 text-xs text-[#222222]">{endpoint}</code>
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
