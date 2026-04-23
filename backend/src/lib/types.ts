export type TourStatus =
  | 'DRAFT'
  | 'PLANNING'
  | 'COORDINATING'
  | 'READY_TO_SCHEDULE'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED';

export type TourListingStatus =
  | 'NOT_CONTACTED'
  | 'WAITING_REPLY'
  | 'AVAILABLE_SLOTS_RECEIVED'
  | 'UNAVAILABLE'
  | 'NEEDS_REVIEW'
  | 'SCHEDULED'
  | 'CANCELLED';

export type ExceptionSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export type BuyerAvailabilityPreference = 'PREFERRED' | 'AVAILABLE' | 'LAST_RESORT';

export type BuyerAvailabilityBlock = 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT';

export type OpposingAgentAvailabilitySource = 'CALL' | 'SMS' | 'WHATSAPP' | 'EMAIL' | 'MANUAL';

export type CoordinationEventKind =
  | 'MESSAGE'
  | 'STATUS_CHANGE'
  | 'AVAILABILITY_UPDATE'
  | 'NOTE'
  | 'HANDOFF'
  | 'SYSTEM';

export type CoordinationSenderRole =
  | 'BUYER_AGENT'
  | 'OPPOSING_AGENT'
  | 'BUYER'
  | 'SYSTEM';

export type CoordinationEventSource =
  | 'MANUAL'
  | 'WHATSAPP'
  | 'CALL'
  | 'SMS'
  | 'EMAIL'
  | 'SYSTEM';

export type CoordinationParsedIntent =
  | 'AVAILABLE'
  | 'UNAVAILABLE'
  | 'PROPOSED_TIME'
  | 'WAITING'
  | 'QUESTION'
  | 'UNCLEAR'
  | 'NEEDS_REVIEW';

export interface AvailabilitySlot {
  date: string;
  startTime: string;
  endTime: string;
}

export interface Agent {
  id: string;
  name: string;
  phone: string;
  email: string;
  agencyName: string;
}

export interface BuyerAvailability {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  preference: BuyerAvailabilityPreference;
  note?: string;
}

export interface OpposingAgentAvailability {
  id: string;
  agentName: string;
  listingId: string;
  slots: AvailabilitySlot[];
  lastUpdatedAt: string;
  source: OpposingAgentAvailabilitySource;
}

export interface TourListing {
  id: string;
  title: string;
  address: string;
  district?: string;
  askingPrice?: number;
  bedrooms?: number;
  bathrooms?: number;
  status: TourListingStatus;
  opposingAgentName: string;
  opposingAgentPhone: string;
  notes?: string;
}

export interface ScheduleItem {
  id: string;
  listingId: string;
  startAt: string;
  endAt: string;
  travelBufferMinutes: number;
  status: 'PROPOSED' | 'LOCKED' | 'CONFLICTED';
}

export interface ExceptionCard {
  id: string;
  tourId: string;
  listingId?: string;
  title: string;
  detail: string;
  severity: ExceptionSeverity;
  owner: 'BUYER_AGENT' | 'BUYER' | 'OPPOSING_AGENT';
  resolved: boolean;
}

export interface CoordinationEvent {
  id: string;
  tourId: string;
  listingId: string;
  kind: CoordinationEventKind;
  senderRole: CoordinationSenderRole;
  source: CoordinationEventSource;
  body?: string;
  summary?: string;
  parsedIntent?: CoordinationParsedIntent;
  relatedAvailabilityId?: string;
  relatedStatus?: TourListingStatus;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Tour {
  id: string;
  buyerName: string;
  buyerPhone: string;
  agent: Agent;
  status: TourStatus;
  targetDate: string;
  neighborhoods: string[];
  nextAction: string;
  listings: TourListing[];
  buyerAvailability: BuyerAvailability[];
  opposingAgentAvailability: OpposingAgentAvailability[];
  coordinationEvents: CoordinationEvent[];
  schedule: ScheduleItem[];
  exceptions: ExceptionCard[];
  createdAt: string;
  updatedAt: string;
}

export interface TourSummary {
  id: string;
  buyerName: string;
  status: TourStatus;
  targetDate: string;
  listingCount: number;
  openExceptionCount: number;
  nextAction: string;
  neighborhoods: string[];
}

export interface CreateTourInput {
  buyerName: string;
  buyerPhone?: string;
  targetDate: string;
  neighborhoods?: string[];
  nextAction?: string;
}

export interface UpdateTourInput {
  buyerName?: string;
  buyerPhone?: string;
  targetDate?: string;
  neighborhoods?: string[];
  nextAction?: string;
}

export interface CreateListingInput {
  title: string;
  address: string;
  district?: string;
  askingPrice?: number;
  bedrooms?: number;
  bathrooms?: number;
  opposingAgentName: string;
  opposingAgentPhone: string;
  notes?: string;
  status?: TourListingStatus;
}

export interface UpdateListingInput {
  title?: string;
  address?: string;
  district?: string;
  askingPrice?: number;
  bedrooms?: number;
  bathrooms?: number;
  opposingAgentName?: string;
  opposingAgentPhone?: string;
  notes?: string;
  status?: TourListingStatus;
}

export interface CreateBuyerAvailabilityInput {
  date: string;
  startTime: string;
  endTime: string;
  preference?: BuyerAvailabilityPreference;
  note?: string;
}

export interface UpdateBuyerAvailabilityInput {
  date?: string;
  startTime?: string;
  endTime?: string;
  preference?: BuyerAvailabilityPreference;
  note?: string;
}

export interface ReplaceBuyerAvailabilityInput {
  availability: CreateBuyerAvailabilityInput[];
}

export interface CreateOpposingAgentAvailabilityInput {
  agentName?: string;
  slots: AvailabilitySlot[];
  source?: OpposingAgentAvailabilitySource;
}

export interface UpdateOpposingAgentAvailabilityInput {
  agentName?: string;
  slots?: AvailabilitySlot[];
  source?: OpposingAgentAvailabilitySource;
}

export interface ReplaceOpposingAgentAvailabilityInput {
  availability: CreateOpposingAgentAvailabilityInput[];
}

export interface UpdateListingStatusInput {
  status: TourListingStatus;
  notes?: string;
}

export interface CreateCoordinationEventInput {
  kind: CoordinationEventKind;
  senderRole: CoordinationSenderRole;
  source?: CoordinationEventSource;
  body?: string;
  summary?: string;
  parsedIntent?: CoordinationParsedIntent;
  relatedAvailabilityId?: string;
  relatedStatus?: TourListingStatus;
  occurredAt?: string;
}

export interface UpdateCoordinationEventInput {
  kind?: CoordinationEventKind;
  senderRole?: CoordinationSenderRole;
  source?: CoordinationEventSource;
  body?: string;
  summary?: string;
  parsedIntent?: CoordinationParsedIntent;
  relatedAvailabilityId?: string;
  relatedStatus?: TourListingStatus;
  occurredAt?: string;
}

export interface GenerateScheduleInput {
  viewingDurationMinutes?: number;
  defaultTravelBufferMinutes?: number;
  replaceExistingSchedule?: boolean;
}

export type ScheduleFailureReason =
  | 'NO_BUYER_AVAILABILITY'
  | 'NO_OPPOSING_AVAILABILITY'
  | 'NO_OVERLAP'
  | 'LISTING_STATUS_NOT_SCHEDULABLE'
  | 'INSUFFICIENT_WINDOW'
  | 'CONFLICT_WITH_EXISTING_SCHEDULE';

export interface UnscheduledListing {
  listingId: string;
  reason: ScheduleFailureReason;
  message: string;
}

export interface ScheduleWarning {
  code: string;
  message: string;
  listingId?: string;
}

export interface ScheduleGenerationSummary {
  candidateListingCount: number;
  scheduledCount: number;
  unscheduledCount: number;
}

export interface ScheduleGenerationResult {
  tour: Tour;
  schedule: ScheduleItem[];
  unscheduled: UnscheduledListing[];
  warnings: ScheduleWarning[];
  summary: ScheduleGenerationSummary;
}
