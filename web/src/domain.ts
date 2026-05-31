export type ListingStatus =
  | "imported"
  | "contacting"
  | "confirmed"
  | "needs-attention"
  | "not-fitting"

export type MessageSender = "ai" | "agent" | "co-agent" | "system"

export interface AgentProfile {
  name: string
  ceaNumber: string
  verifiedPhone: string
  wabaNumber: string
  verificationStatus: "verified" | "pending"
}

export interface ViewingPlan {
  id: string
  title: string
  clientName: string
  clientWhatsapp?: string
  brief: string
}

export interface ViewingTour {
  id: string
  planId: string
  title: string
  targetDate: string
  timeWindow: string
  command: string
}

export interface CoAgent {
  name: string
  phone: string
  agency: string
}

export interface Listing {
  id: string
  title: string
  address: string
  area: string
  condo: string
  price: string
  beds: number
  baths: number
  sqft: number
  psf: string
  imageUrl: string
  status: ListingStatus
  statusLabel: string
  suggestedTime?: string
  unitNo: string
  coAgent: CoAgent
  googleMapsUrl: string
  propertyGuruUrl: string
  summary: string
  attentionReason?: string
}

export interface ConversationMessage {
  id: string
  listingId: string
  sender: MessageSender
  senderName: string
  body: string
  timestamp: string
}

export interface RouteStop {
  id: string
  listingId: string
  time: string
  title: string
  address: string
  area: string
  condo: string
  unitNo: string
  coAgentName: string
  coAgentPhone: string
  googleMapsUrl: string
  notes: string
}

export interface ClientRouteStop {
  id: string
  time: string
  title: string
  address: string
  area: string
  condo: string
  googleMapsUrl: string
}

export interface AgentRoute {
  id: string
  planId: string
  tourId: string
  title: string
  date: string
  stops: RouteStop[]
}

export interface ClientRoute {
  shareToken: string
  title: string
  date: string
  stops: ClientRouteStop[]
  privacyNotice: string
}

export function groupListingsByArea(items: Listing[]) {
  return items.reduce<Record<string, Listing[]>>((groups, listing) => {
    groups[listing.area] = [...(groups[listing.area] ?? []), listing]
    return groups
  }, {})
}

export function toClientRoute(route: AgentRoute): ClientRoute {
  return {
    shareToken: "share_sat_east_42",
    title: route.title,
    date: route.date,
    privacyNotice:
      "This customer view hides co-agent names, phone numbers, unit numbers, WhatsApp conversations, negotiation details and internal notes.",
    stops: route.stops.map(({ id, time, title, address, area, condo, googleMapsUrl }) => ({
      id,
      time,
      title,
      address,
      area,
      condo,
      googleMapsUrl,
    })),
  }
}

