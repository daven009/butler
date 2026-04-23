import type {
  AvailabilitySlot,
  BuyerAvailabilityBlock,
  BuyerAvailabilityPreference,
  CoordinationEventKind,
  CoordinationEventSource,
  CoordinationParsedIntent,
  CoordinationSenderRole,
  CreateBuyerAvailabilityInput,
  CreateCoordinationEventInput,
  CreateListingInput,
  CreateOpposingAgentAvailabilityInput,
  CreateTourInput,
  GenerateScheduleInput,
  OpposingAgentAvailabilitySource,
  ReplaceBuyerAvailabilityInput,
  ReplaceOpposingAgentAvailabilityInput,
  TourListingStatus,
  UpdateBuyerAvailabilityInput,
  UpdateCoordinationEventInput,
  UpdateListingInput,
  UpdateListingStatusInput,
  UpdateOpposingAgentAvailabilityInput,
  UpdateTourInput
} from '../types';

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  fields?: Record<string, string>;
}

const listingStatuses: TourListingStatus[] = [
  'NOT_CONTACTED',
  'WAITING_REPLY',
  'AVAILABLE_SLOTS_RECEIVED',
  'UNAVAILABLE',
  'NEEDS_REVIEW',
  'SCHEDULED',
  'CANCELLED'
];

const buyerAvailabilityPreferences: BuyerAvailabilityPreference[] = [
  'PREFERRED',
  'AVAILABLE',
  'LAST_RESORT'
];

const opposingAvailabilitySources: OpposingAgentAvailabilitySource[] = [
  'CALL',
  'SMS',
  'WHATSAPP',
  'EMAIL',
  'MANUAL'
];

const coordinationEventKinds: CoordinationEventKind[] = [
  'MESSAGE',
  'STATUS_CHANGE',
  'AVAILABILITY_UPDATE',
  'NOTE',
  'HANDOFF',
  'SYSTEM'
];

const coordinationSenderRoles: CoordinationSenderRole[] = [
  'BUYER_AGENT',
  'OPPOSING_AGENT',
  'BUYER',
  'SYSTEM'
];

const coordinationEventSources: CoordinationEventSource[] = [
  'MANUAL',
  'WHATSAPP',
  'CALL',
  'SMS',
  'EMAIL',
  'SYSTEM'
];

const coordinationParsedIntents: CoordinationParsedIntent[] = [
  'AVAILABLE',
  'UNAVAILABLE',
  'PROPOSED_TIME',
  'WAITING',
  'QUESTION',
  'UNCLEAR',
  'NEEDS_REVIEW'
];

const fixedBlocks: Record<BuyerAvailabilityBlock, { startTime: string; endTime: string }> = {
  MORNING: { startTime: '09:00', endTime: '12:00' },
  AFTERNOON: { startTime: '12:00', endTime: '15:00' },
  EVENING: { startTime: '15:00', endTime: '18:00' },
  NIGHT: { startTime: '19:00', endTime: '21:00' }
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return stringValue(value);
}

function stringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

function numericValue(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function positiveIntegerValue(value: unknown): number | undefined | null {
  const parsed = numericValue(value);
  if (parsed === undefined || parsed === null) return parsed;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function strictlyPositiveIntegerValue(value: unknown): number | undefined | null {
  const parsed = numericValue(value);
  if (parsed === undefined || parsed === null) return parsed;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function requiredString(fields: Record<string, string>, body: Record<string, unknown>, key: string): string {
  const value = stringValue(body[key]);
  if (!value) fields[key] = `${key} is required`;
  return value || '';
}

function isDateString(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTimeString(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function resolveFixedBlock(value: unknown, fields: Record<string, string>, prefix = '') {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !(value in fixedBlocks)) {
    fields[`${prefix}block`] = `block must be one of: ${Object.keys(fixedBlocks).join(', ')}`;
    return undefined;
  }

  return fixedBlocks[value as BuyerAvailabilityBlock];
}

function validatePreference(value: unknown, fields: Record<string, string>, prefix = '') {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !buyerAvailabilityPreferences.includes(value as BuyerAvailabilityPreference)) {
    fields[`${prefix}preference`] = `preference must be one of: ${buyerAvailabilityPreferences.join(', ')}`;
    return undefined;
  }

  return value as BuyerAvailabilityPreference;
}

function validateDateField(
  value: unknown,
  fields: Record<string, string>,
  key: string,
  required: boolean
): string | undefined {
  const date = stringValue(value);
  if (!date) {
    if (required) fields[key] = `${key} is required`;
    else if (value !== undefined) fields[key] = `${key} cannot be blank`;
    return undefined;
  }

  if (!isDateString(date)) fields[key] = `${key} must use YYYY-MM-DD format`;
  return date;
}

function validateTimeField(
  value: unknown,
  fields: Record<string, string>,
  key: string,
  required: boolean
): string | undefined {
  const time = stringValue(value);
  if (!time) {
    if (required) fields[key] = `${key} is required`;
    else if (value !== undefined) fields[key] = `${key} cannot be blank`;
    return undefined;
  }

  if (!isTimeString(time)) fields[key] = `${key} must use HH:mm 24-hour format`;
  return time;
}

function validateTimeOrder(
  startTime: string | undefined,
  endTime: string | undefined,
  fields: Record<string, string>,
  endKey: string
) {
  if (!startTime || !endTime || !isTimeString(startTime) || !isTimeString(endTime)) return;
  if (minutesFromTime(endTime) <= minutesFromTime(startTime)) {
    fields[endKey] = 'endTime must be later than startTime';
  }
}

export function validateCreateTourInput(body: unknown): ValidationResult<CreateTourInput> {
  const fields: Record<string, string> = {};
  if (!isObject(body)) {
    return { ok: false, fields: { body: 'JSON object body is required' } };
  }

  const buyerName = requiredString(fields, body, 'buyerName');
  const targetDate = requiredString(fields, body, 'targetDate');
  const neighborhoods = stringList(body.neighborhoods);

  if (body.neighborhoods !== undefined && !neighborhoods) {
    fields.neighborhoods = 'neighborhoods must be an array of strings';
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };

  return {
    ok: true,
    value: {
      buyerName,
      targetDate,
      buyerPhone: optionalString(body.buyerPhone) || '',
      neighborhoods: neighborhoods || [],
      nextAction: optionalString(body.nextAction)
    }
  };
}

export function validateUpdateTourInput(body: unknown): ValidationResult<UpdateTourInput> {
  const fields: Record<string, string> = {};
  if (!isObject(body)) {
    return { ok: false, fields: { body: 'JSON object body is required' } };
  }

  const input: UpdateTourInput = {};

  if (body.buyerName !== undefined) {
    const buyerName = stringValue(body.buyerName);
    if (!buyerName) fields.buyerName = 'buyerName cannot be blank';
    else input.buyerName = buyerName;
  }

  if (body.targetDate !== undefined) {
    const targetDate = stringValue(body.targetDate);
    if (!targetDate) fields.targetDate = 'targetDate cannot be blank';
    else input.targetDate = targetDate;
  }

  if (body.buyerPhone !== undefined) input.buyerPhone = optionalString(body.buyerPhone) || '';
  if (body.nextAction !== undefined) input.nextAction = optionalString(body.nextAction) || '';

  if (body.neighborhoods !== undefined) {
    const neighborhoods = stringList(body.neighborhoods);
    if (!neighborhoods) fields.neighborhoods = 'neighborhoods must be an array of strings';
    else input.neighborhoods = neighborhoods;
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: input };
}

function validateListingStatus(value: unknown, fields: Record<string, string>, key = 'status') {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !listingStatuses.includes(value as TourListingStatus)) {
    fields[key] = `status must be one of: ${listingStatuses.join(', ')}`;
    return undefined;
  }

  return value as TourListingStatus;
}

function validateOpposingAvailabilitySource(value: unknown, fields: Record<string, string>, key = 'source') {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    !opposingAvailabilitySources.includes(value as OpposingAgentAvailabilitySource)
  ) {
    fields[key] = `source must be one of: ${opposingAvailabilitySources.join(', ')}`;
    return undefined;
  }

  return value as OpposingAgentAvailabilitySource;
}

function validateCoordinationEventKind(value: unknown, fields: Record<string, string>, required: boolean) {
  if (value === undefined) {
    if (required) fields.kind = 'kind is required';
    return undefined;
  }
  if (typeof value !== 'string' || !coordinationEventKinds.includes(value as CoordinationEventKind)) {
    fields.kind = `kind must be one of: ${coordinationEventKinds.join(', ')}`;
    return undefined;
  }

  return value as CoordinationEventKind;
}

function validateCoordinationSenderRole(value: unknown, fields: Record<string, string>, required: boolean) {
  if (value === undefined) {
    if (required) fields.senderRole = 'senderRole is required';
    return undefined;
  }
  if (typeof value !== 'string' || !coordinationSenderRoles.includes(value as CoordinationSenderRole)) {
    fields.senderRole = `senderRole must be one of: ${coordinationSenderRoles.join(', ')}`;
    return undefined;
  }

  return value as CoordinationSenderRole;
}

function validateCoordinationSource(value: unknown, fields: Record<string, string>) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !coordinationEventSources.includes(value as CoordinationEventSource)) {
    fields.source = `source must be one of: ${coordinationEventSources.join(', ')}`;
    return undefined;
  }

  return value as CoordinationEventSource;
}

function validateCoordinationParsedIntent(value: unknown, fields: Record<string, string>) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !coordinationParsedIntents.includes(value as CoordinationParsedIntent)) {
    fields.parsedIntent = `parsedIntent must be one of: ${coordinationParsedIntents.join(', ')}`;
    return undefined;
  }

  return value as CoordinationParsedIntent;
}

function validateIsoDateTime(value: unknown, fields: Record<string, string>, key = 'occurredAt') {
  if (value === undefined) return undefined;
  const dateTime = stringValue(value);
  if (!dateTime) {
    fields[key] = `${key} cannot be blank`;
    return undefined;
  }

  if (!/^\d{4}-\d{2}-\d{2}T/.test(dateTime) || Number.isNaN(Date.parse(dateTime))) {
    fields[key] = `${key} must be a valid ISO datetime string`;
    return undefined;
  }

  return dateTime;
}

function validateCoordinationBody(
  value: unknown,
  kind: CoordinationEventKind | undefined,
  fields: Record<string, string>
) {
  const bodyRequired = kind === 'MESSAGE' || kind === 'NOTE' || kind === 'HANDOFF';
  const body = stringValue(value);

  if (!body) {
    if (bodyRequired) fields.body = 'body is required for MESSAGE, NOTE, and HANDOFF events';
    else if (value !== undefined) fields.body = 'body cannot be blank';
    return undefined;
  }

  return body;
}

function applyOptionalListingNumbers(
  body: Record<string, unknown>,
  fields: Record<string, string>,
  input: Partial<CreateListingInput | UpdateListingInput>
) {
  for (const key of ['askingPrice', 'bedrooms', 'bathrooms'] as const) {
    if (body[key] === undefined) continue;
    const value = key === 'askingPrice' ? numericValue(body[key]) : positiveIntegerValue(body[key]);
    if (value === null) {
      fields[key] = `${key} must be a valid number`;
    } else if (value !== undefined) {
      input[key] = value;
    }
  }
}

export function validateCreateListingInput(body: unknown): ValidationResult<CreateListingInput> {
  const fields: Record<string, string> = {};
  if (!isObject(body)) {
    return { ok: false, fields: { body: 'JSON object body is required' } };
  }

  const title = requiredString(fields, body, 'title');
  const address = requiredString(fields, body, 'address');
  const opposingAgentName = requiredString(fields, body, 'opposingAgentName');
  const opposingAgentPhone = requiredString(fields, body, 'opposingAgentPhone');
  const status = validateListingStatus(body.status, fields);

  const input: CreateListingInput = {
    title,
    address,
    opposingAgentName,
    opposingAgentPhone,
    district: optionalString(body.district),
    notes: optionalString(body.notes),
    status
  };

  applyOptionalListingNumbers(body, fields, input);

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: input };
}

export function validateUpdateListingInput(body: unknown): ValidationResult<UpdateListingInput> {
  const fields: Record<string, string> = {};
  if (!isObject(body)) {
    return { ok: false, fields: { body: 'JSON object body is required' } };
  }

  const input: UpdateListingInput = {};

  for (const key of ['title', 'address', 'opposingAgentName', 'opposingAgentPhone'] as const) {
    if (body[key] === undefined) continue;
    const value = stringValue(body[key]);
    if (!value) fields[key] = `${key} cannot be blank`;
    else input[key] = value;
  }

  if (body.district !== undefined) input.district = optionalString(body.district) || '';
  if (body.notes !== undefined) input.notes = optionalString(body.notes) || '';

  const status = validateListingStatus(body.status, fields);
  if (status) input.status = status;

  applyOptionalListingNumbers(body, fields, input);

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: input };
}

export function validateCreateBuyerAvailabilityInput(body: unknown): ValidationResult<CreateBuyerAvailabilityInput> {
  const fields: Record<string, string> = {};
  if (!isObject(body)) {
    return { ok: false, fields: { body: 'JSON object body is required' } };
  }

  const date = validateDateField(body.date, fields, 'date', true);
  const block = resolveFixedBlock(body.block, fields);
  const startTime = block?.startTime || validateTimeField(body.startTime, fields, 'startTime', true);
  const endTime = block?.endTime || validateTimeField(body.endTime, fields, 'endTime', true);
  const preference = validatePreference(body.preference, fields);

  validateTimeOrder(startTime, endTime, fields, 'endTime');

  if (Object.keys(fields).length > 0 || !date || !startTime || !endTime) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    value: {
      date,
      startTime,
      endTime,
      preference: preference || 'AVAILABLE',
      note: optionalString(body.note)
    }
  };
}

export function validateUpdateBuyerAvailabilityInput(body: unknown): ValidationResult<UpdateBuyerAvailabilityInput> {
  const fields: Record<string, string> = {};
  if (!isObject(body)) {
    return { ok: false, fields: { body: 'JSON object body is required' } };
  }

  const block = resolveFixedBlock(body.block, fields);
  const input: UpdateBuyerAvailabilityInput = {};

  const date = validateDateField(body.date, fields, 'date', false);
  if (date) input.date = date;

  const startTime = block?.startTime || validateTimeField(body.startTime, fields, 'startTime', false);
  const endTime = block?.endTime || validateTimeField(body.endTime, fields, 'endTime', false);

  if (startTime) input.startTime = startTime;
  if (endTime) input.endTime = endTime;

  const preference = validatePreference(body.preference, fields);
  if (preference) input.preference = preference;

  if (body.note !== undefined) input.note = optionalString(body.note) || '';

  if (startTime && endTime) {
    validateTimeOrder(startTime, endTime, fields, 'endTime');
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: input };
}

export function validateReplaceBuyerAvailabilityInput(body: unknown): ValidationResult<ReplaceBuyerAvailabilityInput> {
  const fields: Record<string, string> = {};
  if (!isObject(body)) {
    return { ok: false, fields: { body: 'JSON object body is required' } };
  }

  if (!Array.isArray(body.availability)) {
    return {
      ok: false,
      fields: {
        availability: 'availability must be an array'
      }
    };
  }

  const availability: CreateBuyerAvailabilityInput[] = [];

  body.availability.forEach((item, index) => {
    const validation = validateCreateBuyerAvailabilityInput(item);
    if (!validation.ok || !validation.value) {
      for (const [key, message] of Object.entries(validation.fields || {})) {
        fields[`availability.${index}.${key}`] = message;
      }
      return;
    }

    availability.push(validation.value);
  });

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { availability } };
}

function validateAvailabilitySlot(
  value: unknown,
  fields: Record<string, string>,
  prefix: string
): AvailabilitySlot | undefined {
  if (!isObject(value)) {
    fields[prefix || 'slot'] = 'slot must be a JSON object';
    return undefined;
  }

  const date = validateDateField(value.date, fields, `${prefix}date`, true);
  const startTime = validateTimeField(value.startTime, fields, `${prefix}startTime`, true);
  const endTime = validateTimeField(value.endTime, fields, `${prefix}endTime`, true);

  validateTimeOrder(startTime, endTime, fields, `${prefix}endTime`);

  if (!date || !startTime || !endTime) return undefined;
  return { date, startTime, endTime };
}

function validateAvailabilitySlots(
  value: unknown,
  fields: Record<string, string>,
  required: boolean,
  key = 'slots'
): AvailabilitySlot[] | undefined {
  if (value === undefined) {
    if (required) fields[key] = `${key} is required`;
    return undefined;
  }

  if (!Array.isArray(value) || value.length === 0) {
    fields[key] = `${key} must be a non-empty array`;
    return undefined;
  }

  const slots: AvailabilitySlot[] = [];
  value.forEach((slot, index) => {
    const validated = validateAvailabilitySlot(slot, fields, `${key}.${index}.`);
    if (validated) slots.push(validated);
  });

  return slots;
}

export function validateCreateOpposingAgentAvailabilityInput(
  body: unknown
): ValidationResult<CreateOpposingAgentAvailabilityInput> {
  const fields: Record<string, string> = {};
  if (!isObject(body)) {
    return { ok: false, fields: { body: 'JSON object body is required' } };
  }

  const input: CreateOpposingAgentAvailabilityInput = {
    slots: []
  };

  if (body.agentName !== undefined) {
    const agentName = stringValue(body.agentName);
    if (!agentName) fields.agentName = 'agentName cannot be blank';
    else input.agentName = agentName;
  }

  const slots = validateAvailabilitySlots(body.slots, fields, true);
  if (slots) input.slots = slots;

  const source = validateOpposingAvailabilitySource(body.source, fields);
  if (source) input.source = source;

  if (Object.keys(fields).length > 0 || input.slots.length === 0) return { ok: false, fields };
  return { ok: true, value: input };
}

export function validateUpdateOpposingAgentAvailabilityInput(
  body: unknown
): ValidationResult<UpdateOpposingAgentAvailabilityInput> {
  const fields: Record<string, string> = {};
  if (!isObject(body)) {
    return { ok: false, fields: { body: 'JSON object body is required' } };
  }

  const input: UpdateOpposingAgentAvailabilityInput = {};

  if (body.agentName !== undefined) {
    const agentName = stringValue(body.agentName);
    if (!agentName) fields.agentName = 'agentName cannot be blank';
    else input.agentName = agentName;
  }

  const slots = validateAvailabilitySlots(body.slots, fields, false);
  if (slots) input.slots = slots;

  const source = validateOpposingAvailabilitySource(body.source, fields);
  if (source) input.source = source;

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: input };
}

export function validateReplaceOpposingAgentAvailabilityInput(
  body: unknown
): ValidationResult<ReplaceOpposingAgentAvailabilityInput> {
  const fields: Record<string, string> = {};
  if (!isObject(body)) {
    return { ok: false, fields: { body: 'JSON object body is required' } };
  }

  if (!Array.isArray(body.availability)) {
    return {
      ok: false,
      fields: {
        availability: 'availability must be an array'
      }
    };
  }

  const availability: CreateOpposingAgentAvailabilityInput[] = [];

  body.availability.forEach((item, index) => {
    const validation = validateCreateOpposingAgentAvailabilityInput(item);
    if (!validation.ok || !validation.value) {
      for (const [key, message] of Object.entries(validation.fields || {})) {
        fields[`availability.${index}.${key}`] = message;
      }
      return;
    }

    availability.push(validation.value);
  });

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: { availability } };
}

export function validateUpdateListingStatusInput(body: unknown): ValidationResult<UpdateListingStatusInput> {
  const fields: Record<string, string> = {};
  if (!isObject(body)) {
    return { ok: false, fields: { body: 'JSON object body is required' } };
  }

  const status = validateListingStatus(body.status, fields, 'status');
  if (!status) {
    if (body.status === undefined) fields.status = 'status is required';
    return { ok: false, fields };
  }

  const input: UpdateListingStatusInput = { status };
  if (body.notes !== undefined) input.notes = optionalString(body.notes) || '';

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: input };
}

export function validateCreateCoordinationEventInput(body: unknown): ValidationResult<CreateCoordinationEventInput> {
  const fields: Record<string, string> = {};
  if (!isObject(body)) {
    return { ok: false, fields: { body: 'JSON object body is required' } };
  }

  const kind = validateCoordinationEventKind(body.kind, fields, true);
  const senderRole = validateCoordinationSenderRole(body.senderRole, fields, true);
  const source = validateCoordinationSource(body.source, fields);
  const parsedIntent = validateCoordinationParsedIntent(body.parsedIntent, fields);
  const relatedStatus = validateListingStatus(body.relatedStatus, fields, 'relatedStatus');
  const occurredAt = validateIsoDateTime(body.occurredAt, fields);
  const eventBody = validateCoordinationBody(body.body, kind, fields);

  const relatedAvailabilityId = optionalString(body.relatedAvailabilityId);
  if (body.relatedAvailabilityId !== undefined && !relatedAvailabilityId) {
    fields.relatedAvailabilityId = 'relatedAvailabilityId cannot be blank';
  }

  if (Object.keys(fields).length > 0 || !kind || !senderRole) return { ok: false, fields };

  return {
    ok: true,
    value: {
      kind,
      senderRole,
      source: source || 'MANUAL',
      body: eventBody,
      summary: optionalString(body.summary),
      parsedIntent,
      relatedAvailabilityId,
      relatedStatus,
      occurredAt
    }
  };
}

export function validateUpdateCoordinationEventInput(body: unknown): ValidationResult<UpdateCoordinationEventInput> {
  const fields: Record<string, string> = {};
  if (!isObject(body)) {
    return { ok: false, fields: { body: 'JSON object body is required' } };
  }

  const input: UpdateCoordinationEventInput = {};

  const kind = validateCoordinationEventKind(body.kind, fields, false);
  if (kind) input.kind = kind;

  const senderRole = validateCoordinationSenderRole(body.senderRole, fields, false);
  if (senderRole) input.senderRole = senderRole;

  const source = validateCoordinationSource(body.source, fields);
  if (source) input.source = source;

  const parsedIntent = validateCoordinationParsedIntent(body.parsedIntent, fields);
  if (parsedIntent) input.parsedIntent = parsedIntent;

  const relatedStatus = validateListingStatus(body.relatedStatus, fields, 'relatedStatus');
  if (relatedStatus) input.relatedStatus = relatedStatus;

  const occurredAt = validateIsoDateTime(body.occurredAt, fields);
  if (occurredAt) input.occurredAt = occurredAt;

  if (body.body !== undefined || kind) {
    const eventBody = validateCoordinationBody(body.body, kind, fields);
    if (eventBody) input.body = eventBody;
  }

  if (body.summary !== undefined) input.summary = optionalString(body.summary) || '';

  if (body.relatedAvailabilityId !== undefined) {
    const relatedAvailabilityId = optionalString(body.relatedAvailabilityId);
    if (!relatedAvailabilityId) fields.relatedAvailabilityId = 'relatedAvailabilityId cannot be blank';
    else input.relatedAvailabilityId = relatedAvailabilityId;
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: input };
}

export function validateGenerateScheduleInput(body: unknown): ValidationResult<GenerateScheduleInput> {
  const fields: Record<string, string> = {};

  if (body === undefined || body === null || body === '') {
    return { ok: true, value: {} };
  }

  if (!isObject(body)) {
    return { ok: false, fields: { body: 'JSON object body is required' } };
  }

  const input: GenerateScheduleInput = {};

  if (body.viewingDurationMinutes !== undefined) {
    const viewingDurationMinutes = strictlyPositiveIntegerValue(body.viewingDurationMinutes);
    if (viewingDurationMinutes === null || viewingDurationMinutes === undefined) {
      fields.viewingDurationMinutes = 'viewingDurationMinutes must be a positive integer';
    } else {
      input.viewingDurationMinutes = viewingDurationMinutes;
    }
  }

  if (body.defaultTravelBufferMinutes !== undefined) {
    const defaultTravelBufferMinutes = positiveIntegerValue(body.defaultTravelBufferMinutes);
    if (defaultTravelBufferMinutes === null || defaultTravelBufferMinutes === undefined) {
      fields.defaultTravelBufferMinutes = 'defaultTravelBufferMinutes must be a nonnegative integer';
    } else {
      input.defaultTravelBufferMinutes = defaultTravelBufferMinutes;
    }
  }

  if (body.replaceExistingSchedule !== undefined) {
    if (typeof body.replaceExistingSchedule !== 'boolean') {
      fields.replaceExistingSchedule = 'replaceExistingSchedule must be a boolean';
    } else if (!body.replaceExistingSchedule) {
      fields.replaceExistingSchedule = 'Scheduler v1 only supports replaceExistingSchedule: true';
    } else {
      input.replaceExistingSchedule = body.replaceExistingSchedule;
    }
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value: input };
}

export const buyerAvailabilityFixedBlocks = fixedBlocks;
