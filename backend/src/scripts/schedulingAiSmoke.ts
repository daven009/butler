import 'dotenv/config';
import assert from 'node:assert/strict';

const DEFAULT_TOUR_ID = '2dc1ff6e-f4ff-4cd4-8212-8c5ede856f31';

type CheckStatus = 'PASS' | 'SKIP';

interface CheckResult {
  status: CheckStatus;
  name: string;
  detail?: string;
}

function isFlag(value: string): boolean {
  return value.startsWith('--');
}

function push(results: CheckResult[], name: string, detail?: string) {
  results.push({ status: 'PASS', name, detail });
}

function skip(results: CheckResult[], name: string, detail?: string) {
  results.push({ status: 'SKIP', name, detail });
}

function printResults(results: CheckResult[]) {
  for (const result of results) {
    const detail = result.detail ? ` — ${result.detail}` : '';
    console.log(`${result.status} ${result.name}${detail}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const tourId = args.find((arg) => !isFlag(arg)) ?? DEFAULT_TOUR_ID;
  const jwt = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(jwt, 'SUPABASE_SERVICE_ROLE_KEY is required for the smoke test');

  const [
    { supabaseAdmin },
    { runWithUser },
    { listListingsByTour },
    { runTool },
    { findListingByReference, listingNumberById, sortListingsForScheduleView },
  ] = await Promise.all([
    import('../lib/supabase'),
    import('../lib/userContext'),
    import('../lib/repositories/plansRepository'),
    import('../lib/llm/schedulingTools'),
    import('../lib/llm/listingIndex'),
  ]);

  const { data: tour, error: tourError } = await supabaseAdmin
    .from('tours')
    .select('id,title,user_id')
    .eq('id', tourId)
    .maybeSingle();
  if (tourError) throw tourError;
  assert(tour, `Tour not found: ${tourId}`);
  const userId = (tour as { user_id: string }).user_id;

  const { data: session, error: sessionError } = await supabaseAdmin
    .from('scheduling_sessions')
    .insert({
      tour_id: tourId,
      listing_id: null,
      user_id: userId,
      status: 'archived',
    })
    .select('id')
    .single();
  if (sessionError) throw sessionError;
  const sessionId = (session as { id: string }).id;
  const results: CheckResult[] = [];

  try {
    await runWithUser({ userId, jwt }, async () => {
      const listings = await listListingsByTour(tourId);
      assert(listings.length > 0, 'Tour must contain at least one listing');
      const sorted = sortListingsForScheduleView(listings);
      const numbered = listingNumberById(listings);
      const first = sorted[0];
      const firstRef = `#${numbered.get(first.id)}`;
      assert.equal(firstRef, '#1');

      const scheduledTimes = sorted
        .filter((listing) => listing.status === 'confirmed' && listing.suggestedTime)
        .map((listing) => listing.suggestedTime as string);
      const sortedTimes = [...scheduledTimes].sort((a, b) => a.localeCompare(b));
      assert.deepEqual(scheduledTimes, sortedTimes);
      push(
        results,
        'listing index order is schedule-first and chronological',
        `${scheduledTimes.length}/${listings.length} scheduled`,
      );

      assert.equal(findListingByReference(listings, '#1')?.id, first.id);
      assert.equal(findListingByReference(listings, '1号房源')?.id, first.id);
      assert.equal(findListingByReference(listings, 'listing 1')?.id, first.id);
      push(results, 'visible listing refs resolve in English and Chinese', `${firstRef} -> ${first.title}`);

      const toolCtx = { tourId, sessionId };
      const schedule = await runTool('get_schedule', {}, toolCtx) as {
        scheduled?: Array<{ ref?: string; listingId?: string }>;
        unscheduled?: Array<{ ref?: string; listingId?: string }>;
      };
      const scheduleRows = [...(schedule.scheduled ?? []), ...(schedule.unscheduled ?? [])];
      assert(scheduleRows.length > 0, 'get_schedule should return listing rows');
      assert(scheduleRows.every((row) => /^#\d+$/.test(row.ref ?? '')));
      push(results, 'get_schedule returns numbered refs', `${scheduleRows.length} rows`);

      const detail = await runTool(
        'get_listing_detail',
        { listing_id: '#1' },
        toolCtx,
      ) as { listingId?: string; ref?: string; title?: string; error?: string };
      assert(!detail.error, detail.error);
      assert.equal(detail.listingId, first.id);
      assert.equal(detail.ref, '#1');
      push(results, 'get_listing_detail resolves #1 to the selected listing', detail.title);

      const attentionListing = sorted.find((listing) => listing.status !== 'confirmed');
      if (attentionListing) {
        const attentionRef = `#${numbered.get(attentionListing.id)}`;
        const reason = await runTool(
          'get_unscheduled_reason',
          { listing_id: attentionRef },
          toolCtx,
        ) as { listingId?: string; onSchedule?: boolean; error?: string };
        assert(!reason.error, reason.error);
        assert.equal(reason.listingId, attentionListing.id);
        assert.equal(reason.onSchedule, false);
        push(results, 'get_unscheduled_reason resolves an unscheduled numbered listing', attentionRef);
      } else {
        skip(results, 'get_unscheduled_reason resolves an unscheduled numbered listing', 'no unscheduled listing in tour');
      }

      const proposal = await runTool(
        'propose_drop',
        { listing_id: '#1', reason: 'smoke test only' },
        toolCtx,
      ) as { changes?: Array<{ listingId?: string; action?: string }>; error?: string };
      assert(!proposal.error, proposal.error);
      assert.equal(proposal.changes?.[0]?.listingId, first.id);
      assert.equal(proposal.changes?.[0]?.action, 'drop');
      push(results, 'write tool proposal resolves #1 without mutating listings', first.title);

      const [{ openai }, { runAgentTurn }, { listMessagesForSession, listProposalsForSession }] = await Promise.all([
        import('../lib/llm/openaiClient'),
        import('../lib/llm/schedulingAgent'),
        import('../lib/repositories/schedulingSessionsRepository'),
      ]);
      const originalCreate = openai.chat.completions.create;
      let mockedLlmCalls = 0;
      (openai.chat.completions.create as unknown as (request: unknown) => Promise<unknown>) =
        async () => {
          mockedLlmCalls += 1;
          if (mockedLlmCalls === 1) {
            return {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: 'call_smoke_get_listing_detail',
                        type: 'function',
                        function: {
                          name: 'get_listing_detail',
                          arguments: JSON.stringify({ listing_id: '#1' }),
                        },
                      },
                    ],
                  },
                },
              ],
              usage: { prompt_tokens: 42, completion_tokens: 12, total_tokens: 54 },
            };
          }
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: `#1 是 ${first.title}，当前安排在 ${first.suggestedTime ?? '未安排'}。`,
                },
              },
            ],
            usage: { prompt_tokens: 50, completion_tokens: 18, total_tokens: 68 },
          };
        };
      try {
        const assistant = await runAgentTurn(
          sessionId,
          '请查看 #1 的房源详情，然后用一句话告诉我它现在安排在几点。',
        );
        assert.equal(assistant.role, 'assistant');
        assert(assistant.content?.includes(first.title));
        const messages = await listMessagesForSession(sessionId);
        assert(messages.some((message) => message.toolName === 'get_listing_detail'));
        assert.equal(mockedLlmCalls, 2);
        push(
          results,
          'mocked right-panel AI loop calls a tool and returns final answer',
          assistant.content,
        );
      } finally {
        (openai.chat.completions.create as unknown as typeof originalCreate) = originalCreate;
      }

      if (live) {
        const assistant = await runAgentTurn(
          sessionId,
          '请查看 #1 的房源详情，然后用一句话告诉我它现在安排在几点。',
        );
        assert.equal(assistant.role, 'assistant');
        assert(assistant.content && assistant.content.trim().length > 0);
        const messages = await listMessagesForSession(sessionId);
        assert(messages.some((message) => message.role === 'tool'));
        push(results, 'live right-panel AI can call tools and answer about #1', assistant.content);

        const beforeCount = (await listProposalsForSession(sessionId)).length;
        await runAgentTurn(
          sessionId,
          '请生成一个待确认方案，把 #1 从 tour 里移除，原因是 smoke test。',
        );
        const proposals = await listProposalsForSession(sessionId);
        const created = proposals.slice(beforeCount).find((item) =>
          item.changes.some((change) => change.listingId === first.id && change.action === 'drop'),
        );
        assert(created, 'live AI should create a drop proposal for #1');
        push(results, 'live right-panel AI can create a proposal for #1', created.id);
      } else {
        skip(results, 'live right-panel AI turn', 'run with --live to call OpenAI');
      }
    });
  } finally {
    await supabaseAdmin
      .from('scheduling_sessions')
      .delete()
      .eq('id', sessionId);
  }

  console.log(`Scheduling AI smoke test for tour ${tourId}`);
  printResults(results);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
