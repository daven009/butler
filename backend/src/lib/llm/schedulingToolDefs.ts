/**
 * Scheduling agent tool registry.
 *
 * One source of truth for the tools the LLM can call and the JSON schemas
 * it sees. The actual *implementations* live in `schedulingTools.ts` so this
 * file can stay free of repository / DB coupling — the schemas need to be
 * exported to OpenAI without dragging the whole backend in.
 *
 * Naming: `propose_*` tools NEVER mutate. They produce a
 * `schedule_change_proposals` row that the user later Apply/Discard. The
 * read tools (`get_*`) return data straight from the repository.
 *
 * Tool scope is "medium" per PRD §8.6.3 lock-in:
 *   ✔ read schedule + listing + travel time + reasoning
 *   ✔ propose reschedule / swap / drop / add constraint
 *   ✘ no direct WhatsApp send (that's "large" scope, deferred)
 */

import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export const SCHEDULING_TOOL_NAMES = [
  'get_schedule',
  'get_listing_detail',
  'get_unscheduled_reason',
  'get_travel_time',
  'propose_reschedule',
  'propose_swap',
  'propose_drop',
  'propose_add_constraint',
] as const;

export type SchedulingToolName = typeof SCHEDULING_TOOL_NAMES[number];

/**
 * Schema definitions sent to OpenAI verbatim. The `description` fields are
 * the LLM's only documentation — write them so a reasonably smart agent
 * can pick the right tool. Be specific about effects ("propose, does not
 * apply"), input formats, and edge cases.
 */
export const SCHEDULING_TOOLS: ChatCompletionTool[] = [
  // ── Read ──────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_schedule',
      description:
        'Return the current full schedule for this tour: scheduled viewings (each with time, listing title, area, agent name) plus unscheduled listings with their reason. Use this whenever you need an overview of the day.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_listing_detail',
      description:
        'Get details for one listing: address, agent name + phone, current scheduled time (or "Pending"), the agent\'s availability windows, and any attention reason. Use when the user asks about a specific property.',
      parameters: {
        type: 'object',
        properties: {
          listing_id: {
            type: 'string',
            description: 'The listing id (uuid) the user is asking about.',
          },
        },
        required: ['listing_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_unscheduled_reason',
      description:
        'Why is a particular listing NOT on the schedule? Returns the structured reason recorded by the optimizer (e.g. NO_OVERLAP, INSUFFICIENT_WINDOW, UNREACHABLE) plus a human-readable message.',
      parameters: {
        type: 'object',
        properties: {
          listing_id: {
            type: 'string',
            description: 'The listing id the user is asking about.',
          },
        },
        required: ['listing_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_travel_time',
      description:
        'Estimated travel time and distance between two points. Either point can be a listing id, OR the literal string "buyer" to mean the buyer\'s location (if known).',
      parameters: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'A listing id, or "buyer".',
          },
          to: {
            type: 'string',
            description: 'A listing id, or "buyer".',
          },
        },
        required: ['from', 'to'],
      },
    },
  },

  // ── Write (proposals — never auto-apply) ─────────────────────────────
  {
    type: 'function',
    function: {
      name: 'propose_reschedule',
      description:
        'Propose moving a listing to a new start time. Use this when the destination slot is FREE. If another scheduled listing already occupies that slot, prefer `propose_swap` instead — `propose_reschedule` will flag the move as a conflict and force manual review. THIS DOES NOT APPLY THE CHANGE — it produces a proposal the user must explicitly approve in the UI.',
      parameters: {
        type: 'object',
        properties: {
          listing_id: { type: 'string' },
          new_start: {
            type: 'string',
            description: 'New start time in HH:MM (24h) format, e.g. "11:00".',
          },
          date: {
            type: 'string',
            description:
              'Optional ISO date (YYYY-MM-DD) if moving across days. Defaults to the listing\'s current date.',
          },
        },
        required: ['listing_id', 'new_start'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_swap',
      description:
        'Propose swapping the time slots of two scheduled listings. Use this when the user wants to move listing A into a slot currently held by listing B (B will inherit A\'s old slot in return). Both must currently be in the schedule. THIS DOES NOT APPLY — it produces a proposal.',
      parameters: {
        type: 'object',
        properties: {
          listing_id_a: { type: 'string' },
          listing_id_b: { type: 'string' },
        },
        required: ['listing_id_a', 'listing_id_b'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_drop',
      description:
        'Propose removing a listing from this tour\'s schedule (the listing stays in the plan, just gets dropped from today). Useful when the user accepts that one viewing isn\'t feasible. THIS DOES NOT APPLY — it produces a proposal.',
      parameters: {
        type: 'object',
        properties: {
          listing_id: { type: 'string' },
          reason: {
            type: 'string',
            description: 'Optional short reason captured for the audit log.',
          },
        },
        required: ['listing_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_add_constraint',
      description:
        'Add a buyer-side constraint then trigger a full re-plan. Use this for vague requirements like "no viewings before 10am" or "X must be in the morning". THIS DOES NOT APPLY immediately — the cascade of resulting changes is shown to the user as a proposal.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['before_time', 'after_time', 'must_morning', 'must_afternoon', 'date'],
            description:
              'before_time: nothing earlier than `value`. after_time: nothing later than `value`. must_morning/must_afternoon: a specific listing must be in that block. date: change the tour date.',
          },
          listing_id: {
            type: 'string',
            description:
              'Required when type is must_morning / must_afternoon. The listing the constraint applies to.',
          },
          value: {
            type: 'string',
            description:
              'For before_time/after_time: HH:MM. For date: YYYY-MM-DD. Ignored for must_morning/must_afternoon.',
          },
        },
        required: ['type'],
      },
    },
  },
];

/**
 * Build the system prompt sent on every assistant turn. Schedule + tour
 * context is materialized inline so the LLM doesn't have to call get_schedule
 * before its very first reply (saves a round-trip).
 *
 * `persona` is the user-customizable voice block (Settings → AI rules).
 * The caller resolves it from user_preferences.butler_persona, falling
 * back to DEFAULT_BUTLER_PERSONA when the user hasn't customized it.
 */
export function buildSystemPrompt(args: {
  persona: string;
  buyerName: string;
  targetDate: string;
  totalListings: number;
  scheduledCount: number;
  unscheduledCount: number;
  scheduleTable: string;
  unscheduledList: string;
}): string {
  return [
    args.persona,
    "",
    "TOUR CONTEXT:",
    `- Buyer: ${args.buyerName}`,
    `- Date: ${args.targetDate}`,
    `- Total listings: ${args.totalListings} (${args.scheduledCount} scheduled, ${args.unscheduledCount} unscheduled)`,
    "",
    "CURRENT SCHEDULE:",
    args.scheduleTable || "(empty)",
    "",
    "UNSCHEDULED:",
    args.unscheduledList || "(none)",
    "",
    "HARD RULES (override anything in your persona that conflicts):",
    "- Length: 1–2 short sentences per turn. No bullet lists. No numbered steps. No markdown bold/italics.",
    "- After issuing a propose_* tool call, your FOLLOW-UP message must be at most one short sentence (e.g. \"Drafted — review the card.\" / \"已起草，请确认卡片。\"). Never re-list the changes; the proposal card shows them.",
    "- Never say \"click Apply\", \"in the UI\", \"as an AI\", \"I am an assistant\", or similar UI/role boilerplate.",
    "- All time changes go through propose_* tools. Never claim a change is applied unless the user clicked Apply.",
    "- Reply in the language the user writes in (English default; Simplified Chinese if they do).",
    "",
    "TOOL SELECTION:",
    "- User wants to move A to a slot held by B → call propose_swap(A, B) in ONE tool call.",
    "- Destination slot is empty → propose_reschedule.",
    "- Remove from tour → propose_drop.",
    "- For 'why X at Y?' questions → use get_unscheduled_reason or get_travel_time + get_schedule, don't guess.",
    "",
    "USER CONFIRMATION FLOW:",
    "- If you described a plan in plain text and the user replies 'yes' / 'go ahead' / 'confirm' / '是' / '确认', IMMEDIATELY call the matching propose_* tool. Don't just acknowledge.",
  ].join("\n");
}
