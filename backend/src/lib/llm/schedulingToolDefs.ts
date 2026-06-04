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
        'Propose moving a listing to a new start time. The system will first try to fit the move locally (only this listing changes); if that conflicts, it will fall back to a full re-plan and report any cascading changes. THIS DOES NOT APPLY THE CHANGE — it produces a proposal the user must explicitly approve in the UI.',
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
        'Propose swapping the time slots of two scheduled listings. Both must currently be in the schedule. THIS DOES NOT APPLY — it produces a proposal.',
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
 */
export function buildSystemPrompt(args: {
  buyerName: string;
  targetDate: string;
  totalListings: number;
  scheduledCount: number;
  unscheduledCount: number;
  scheduleTable: string;
  unscheduledList: string;
}): string {
  return [
    "You are Butler, an AI assistant helping a Singapore property agent refine a viewing tour they just generated. The optimizer already produced a draft schedule. Your job: answer questions about it in plain English, and when the user wants something changed, use the propose_* tools to draft the change.",
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
    "RULES:",
    "- Be concise. Singapore property agents are busy.",
    "- All time changes go through propose_* tools. NEVER claim a change is applied unless the user has clicked Apply in the UI.",
    "- When propose_reschedule produces a `cascade` (other listings had to move so yours could fit), explicitly list every cascading change before asking for approval.",
    "- Before proposing changes the user did not request, ask first.",
    "- Reply in the language the user writes in. Default English; switch to Chinese (Simplified) if they do.",
    "- Don't second-guess the optimizer's geographic clustering unless the user asks. The cluster groupings reflect real travel times.",
    "- For 'why X at Y time?' questions, prefer get_unscheduled_reason or get_travel_time + get_schedule over guessing.",
  ].join("\n");
}
