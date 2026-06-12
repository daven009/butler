/**
 * User preferences repository — currently just the Butler persona that
 * gets injected into the chat-with-Butler system prompt.
 *
 * The schema is permissive (one text field) so we can add more fields
 * (escalation policy, language preference, etc.) without migrations.
 */

import { supabaseForUser } from '../supabase';
import { getCurrentJwt, getCurrentUserId } from '../userContext';

export interface UserPreferences {
  butlerPersona: string | null;
  updatedAt?: string;
}

function db() {
  return supabaseForUser(getCurrentJwt());
}

/**
 * The default Butler voice. Used when the user hasn't customized it.
 * Designed to feel like a real personal assistant: warm but not chatty,
 * confident, makes decisions, never breaks character into "AI assistant"
 * boilerplate. Bilingual: English by default, Chinese when the user
 * writes Chinese. Keep this in sync with the Settings page placeholder.
 */
export const DEFAULT_BUTLER_PERSONA = [
  'You are Butler — the user\'s personal scheduling concierge for property viewings.',
  '',
  'Voice:',
  '- Calm, attentive, warmly professional. Think a senior hotel concierge who knows the city.',
  '- Speak in first person, sparingly. Refer to the user as "you", never "the user".',
  '- Never say "As an AI", "I am an assistant", "I cannot do that as an AI", "Please click Apply in the UI", or similar boilerplate. The UI handles all that.',
  '- Never restate a proposal\'s contents in prose — the proposal card already shows them. Just acknowledge briefly ("Done.", "Swap drafted.", "已起草。"). One sentence is enough.',
  '- When the user replies in Chinese, respond in Simplified Chinese with the same calm-concierge tone.',
  '',
  'Length:',
  '- 1–2 short sentences per turn. No bullet lists, no numbered steps, no markdown bold.',
  '- If you\'re unsure, ask one short clarifying question. Don\'t enumerate options.',
].join('\n');

export async function getMyPreferences(): Promise<UserPreferences> {
  const userId = getCurrentUserId();
  const { data, error } = await db()
    .from('user_preferences')
    .select('butler_persona, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { butlerPersona: null };
  return {
    butlerPersona: (data as { butler_persona: string | null }).butler_persona,
    updatedAt: (data as { updated_at: string }).updated_at,
  };
}

export async function upsertMyPreferences(
  patch: Partial<UserPreferences>,
): Promise<UserPreferences> {
  const userId = getCurrentUserId();
  // Trim & normalize persona — null/'' both mean "use default".
  const persona =
    patch.butlerPersona == null ? null
      : String(patch.butlerPersona).trim() || null;

  const { data, error } = await db()
    .from('user_preferences')
    .upsert(
      { user_id: userId, butler_persona: persona },
      { onConflict: 'user_id' },
    )
    .select('butler_persona, updated_at')
    .single();
  if (error) throw error;
  return {
    butlerPersona: (data as { butler_persona: string | null }).butler_persona,
    updatedAt: (data as { updated_at: string }).updated_at,
  };
}
