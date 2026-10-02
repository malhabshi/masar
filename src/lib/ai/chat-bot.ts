// Identity and settings for the internal-chat AI responder.
//
// The bot needs a real document in `users` because chat messages resolve their author
// name and avatar through useUserCacheById — without it the AI's messages would render
// blank. The document is created on first use and is deliberately minimal: no phone (so
// it is never sent a WhatsApp notification) and no civilId (so it never appears in
// employee-portfolio queries, which all filter on civilId).

import { adminDb } from '@/lib/firebase/admin';

export const CHAT_BOT_USER_ID = 'masar-ai-assistant';
export const CHAT_BOT_NAME = 'Masar AI';

const SETTINGS = { collection: 'app_settings', doc: 'ai_chat_responder' };

export type ChatResponderSettings = {
  /** Master switch. OFF by default — the AI never posts until someone turns this on. */
  enabled: boolean;
  /** When true, it drafts a reply into the log but does not post to chat. */
  observeOnly: boolean;
  /** It may create tasks from employee requests. */
  allowTaskCreation: boolean;
  /** Student ids to ignore entirely. */
  mutedStudentIds: string[];
};

export const DEFAULT_RESPONDER_SETTINGS: ChatResponderSettings = {
  enabled: false,
  observeOnly: true,
  allowTaskCreation: true,
  mutedStudentIds: [],
};

export async function getResponderSettings(): Promise<ChatResponderSettings> {
  if (!adminDb) return DEFAULT_RESPONDER_SETTINGS;
  try {
    const snap = await adminDb.collection(SETTINGS.collection).doc(SETTINGS.doc).get();
    if (!snap.exists) return DEFAULT_RESPONDER_SETTINGS;
    const d = snap.data() ?? {};
    return {
      enabled: d.enabled === true,
      observeOnly: d.observeOnly !== false,
      allowTaskCreation: d.allowTaskCreation !== false,
      mutedStudentIds: Array.isArray(d.mutedStudentIds) ? d.mutedStudentIds : [],
    };
  } catch {
    return DEFAULT_RESPONDER_SETTINGS;
  }
}

export async function saveResponderSettings(
  patch: Partial<ChatResponderSettings>,
): Promise<ChatResponderSettings> {
  if (!adminDb) throw new Error('Database not available');
  const current = await getResponderSettings();
  const next: ChatResponderSettings = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    observeOnly: typeof patch.observeOnly === 'boolean' ? patch.observeOnly : current.observeOnly,
    allowTaskCreation:
      typeof patch.allowTaskCreation === 'boolean' ? patch.allowTaskCreation : current.allowTaskCreation,
    mutedStudentIds: Array.isArray(patch.mutedStudentIds) ? patch.mutedStudentIds : current.mutedStudentIds,
  };
  await adminDb
    .collection(SETTINGS.collection)
    .doc(SETTINGS.doc)
    .set({ ...next, updatedAt: new Date().toISOString() }, { merge: true });
  // Mirror the switch onto the bot's user document. Every chat already loads the user
  // list, so this is how the chat knows to offer "Masar AI" as a recipient without a
  // settings read of its own — and stops offering it the moment the responder is off.
  await ensureChatBotUser();
  await adminDb.collection('users').doc(CHAT_BOT_USER_ID).set({ aiChatActive: next.enabled }, { merge: true });
  return next;
}

let botEnsured = false;

/** Create the bot's user document if it does not exist yet. Safe to call repeatedly. */
export async function ensureChatBotUser(): Promise<void> {
  if (botEnsured || !adminDb) return;
  const ref = adminDb.collection('users').doc(CHAT_BOT_USER_ID);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      name: CHAT_BOT_NAME,
      email: 'ai@masar.local',
      role: 'employee',
      isBot: true,
      createdAt: new Date().toISOString(),
    });
  }
  botEnsured = true;
}
