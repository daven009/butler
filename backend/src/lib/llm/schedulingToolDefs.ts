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
  'submit_listing_brief',
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
      name: 'submit_listing_brief',
      description:
        'Finalize the selected listing scheduling brief after the user requirements are clear. Saves the structured brief, then asks the deterministic Tour Engine to generate a proposal while preserving confirmed listings. Call once per completed clarification. Never use it without a selected listing.',
      parameters: {
        type: 'object',
        properties: {
          priority: {
            type: 'string',
            enum: ['low', 'normal', 'high'],
            description: 'User-stated listing priority. Default normal.',
          },
          summary: {
            type: 'string',
            description: 'One concise sentence summarizing the final user requirements.',
          },
          constraints: {
            type: 'array',
            description:
              'Only explicit listing scheduling requirements extracted from the conversation. Empty is valid when the user says there are no special requirements.',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['before_time', 'after_time', 'exclude_time_window', 'must_morning', 'must_afternoon'],
                },
                scope: {
                  type: 'string',
                  enum: ['listing', 'tour'],
                  description:
                    'Use listing by default. Use tour only when the user explicitly says the rule applies to the whole Tour, such as a Tour-wide lunch break.',
                },
                value: { type: 'string' },
                end_value: { type: 'string' },
              },
              required: ['type'],
            },
          },
          flexibility: {
            type: 'object',
            description:
              'Optional structured notes about what the user is willing to relax, such as time or date flexibility.',
          },
        },
        required: ['summary', 'constraints'],
      },
    },
  },
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
        'Add a buyer-side constraint then trigger a full re-plan. Use this for requirements like "no viewings before 10am", "X must be in the morning", or "no viewings during lunch 12:30-13:30". THIS DOES NOT APPLY immediately — the cascade of resulting changes is shown to the user as a proposal.',
      parameters: {
        type: 'object',
        properties: {
          constraints: {
            type: 'array',
            minItems: 1,
            description:
              'All scheduling constraints extracted from the user message. Put related requirements in this one array so they are applied in a single re-plan.',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['include_listing', 'preserve_confirmed', 'before_time', 'after_time', 'exclude_time_window', 'must_morning', 'must_afternoon'],
                  description:
                    'include_listing: prioritize inserting a selected unscheduled listing. preserve_confirmed: no currently confirmed listing may be dropped. before_time: earliest allowed start is `value`. after_time: latest allowed end is `value`. exclude_time_window: no viewing may overlap `value` through `end_value`. must_morning/must_afternoon: a specific listing must be in that block.',
                },
                listing_id: {
                  type: 'string',
                  description:
                    'Required for include_listing / must_morning / must_afternoon.',
                },
                value: {
                  type: 'string',
                  description:
                    'For before_time/after_time: HH:MM. For exclude_time_window: blocked start.',
                },
                end_value: {
                  type: 'string',
                  description:
                    'Required for exclude_time_window: blocked end.',
                },
              },
              required: ['type'],
            },
          },
        },
        required: ['constraints'],
      },
    },
  },
];

const LISTING_SESSION_TOOL_NAMES = new Set<SchedulingToolName>([
  'get_schedule',
  'get_listing_detail',
  'get_unscheduled_reason',
  'get_travel_time',
  'submit_listing_brief',
]);

export function getSchedulingTools(listingScoped: boolean): ChatCompletionTool[] {
  return SCHEDULING_TOOLS.filter((tool) => {
    if (tool.type !== 'function') return false;
    const name = tool.function.name as SchedulingToolName;
    return listingScoped
      ? LISTING_SESSION_TOOL_NAMES.has(name)
      : name !== 'submit_listing_brief';
  });
}

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
  focusedListing?: string;
  listingScoped?: boolean;
}): string {
  const sharedRules = [
    args.listingScoped
      ? "You are Butler, an AI assistant helping a Singapore property agent clarify scheduling requirements for one selected listing. Answer questions in plain language and finalize clear requirements with submit_listing_brief."
      : "You are Butler, an AI assistant helping a Singapore property agent build or refine a viewing tour. The tour may be unscheduled, partially scheduled, or already have a draft schedule. Answer questions in plain language and use propose_* tools when the user requests a change.",
    "",
    "TOUR CONTEXT:",
    `- Buyer: ${args.buyerName}`,
    `- Buyer availability: ${args.targetDate}`,
    `- Total listings: ${args.totalListings} (${args.scheduledCount} scheduled, ${args.unscheduledCount} unscheduled)`,
    "",
    "CURRENT SCHEDULE:",
    args.scheduleTable || "(empty)",
    "",
    "UNSCHEDULED:",
    args.unscheduledList || "(none)",
    "",
    "CURRENTLY SELECTED LISTING:",
    args.focusedListing || "(none — discuss the tour as a whole)",
    "",
    "RULES:",
    "- Be concise. 1–2 short sentences per turn. No bullet lists. No numbered steps. No markdown bold/italics. Singapore property agents are busy.",
    "- After issuing a propose_* tool call, your FOLLOW-UP message must be at most one short sentence (e.g. \"Drafted — review the card.\" / \"已起草，请确认卡片。\"). Never re-list the changes; the proposal card shows them.",
    "- If any propose_* tool returns an error, do not call another propose_* tool in that turn. Explain the conflict once and state which constraint would need to change.",
    "- A tour can span multiple dates. Treat the date in each availability window and scheduled slot as part of the slot; identical clock times on different dates do not conflict.",
    "- Never say \"click Apply\", \"in the UI\", \"as an AI\", \"I am an assistant\", or similar UI/role boilerplate.",
    args.listingScoped
      ? "- This session records requirements only. Never claim that the listing or tour schedule has already changed."
      : "- All time changes go through propose_* tools. NEVER claim a change is applied unless the user has clicked Apply in the UI.",
    "- When propose_reschedule produces a `cascade` (other listings had to move so yours could fit), explicitly list every cascading change before asking for approval.",
    "- Before proposing changes the user did not request, ask first.",
    "- When a selected listing is provided, interpret 'this listing', '这套', and similar references as that listing.",
    "- A blocked interval such as lunch 12:30–13:30 means constraints=[{type:'exclude_time_window', value:'12:30', end_value:'13:30'}]. It does NOT mean no viewings before 13:30.",
    "- Reply in the language the user writes in. Default English; switch to Chinese (Simplified) if they do.",
    "- Don't second-guess the optimizer's geographic clustering unless the user asks. The cluster groupings reflect real travel times.",
    "",
  ];

  const scopeRules = args.listingScoped
    ? [
        "LISTING SESSION RULES:",
        "- This session only clarifies scheduling requirements for the currently selected listing.",
        "- Once the requirements are clear, call submit_listing_brief exactly once. It is the only tool that may finalize this listing session.",
        "- The submit_listing_brief result reports whether this is the first ready listing. Do not ask for more requirements after a successful submission.",
        "- Never call propose_reschedule, propose_swap, propose_drop, or propose_add_constraint in this session.",
        "- If the user says there are no special requirements, submit an empty constraints array with normal priority.",
        "- If information is ambiguous, ask one concise clarification question instead of submitting the brief.",
        "- Mark each constraint scope='listing' by default. Use scope='tour' only when the user explicitly applies it to the whole Tour.",
        "- For 'why is this listing unscheduled?' use get_unscheduled_reason or get_listing_detail; do not guess.",
      ]
    : [
        "TOUR SESSION RULES:",
        "- For one or more scheduling requirements, call propose_add_constraint once with every extracted requirement in its constraints array. It runs one constrained full-tour re-plan.",
        "- 'Prioritize/keep confirmed viewings' means include {type:'preserve_confirmed'}; never silently drop a confirmed listing when this is requested.",
        "",
        "TOOL SELECTION:",
        "- User wants to move A to a slot held by B → call propose_swap(A, B) in ONE tool call.",
        "- User wants to add/insert a selected unscheduled listing → include {type:'include_listing', listing_id:<selected listing id>} in the constraints array, together with any other stated scheduling preferences.",
        "- Destination slot is empty → propose_reschedule.",
        "- Remove from tour → propose_drop.",
        "- For 'why X at Y?' questions → use get_unscheduled_reason or get_travel_time + get_schedule, don't guess.",
        "",
        "USER CONFIRMATION FLOW:",
        "- If you described a plan in plain text and the user replies 'yes' / 'go ahead' / 'confirm' / '是' / '确认', IMMEDIATELY call the matching propose_* tool. Don't just acknowledge.",
      ];

  return [...sharedRules, ...scopeRules].join("\n");
}
