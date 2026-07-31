// Minimal OAuth 2.1 authorization-server helpers for the masar MCP connector.
// Single-owner design: the "user login" at the authorize step is the owner entering
// a shared secret (MCP_OWNER_SECRET). Claude performs the full DCR + PKCE code flow.
import crypto from 'crypto';
import { adminDb } from '@/lib/firebase/admin';

export const OWNER = {
  secret: process.env.MCP_OWNER_SECRET || '',
  userId: process.env.MCP_OWNER_USER_ID || 'mcp-owner',
  userName: process.env.MCP_OWNER_USER_NAME || 'Owner',
  // Real admin user doc id's civilId — some server actions need it (e.g. createStudent).
  civilId: process.env.MCP_OWNER_USER_CIVILID || '',
  // Role the MCP acts as; admin so all role-gated actions pass.
  role: process.env.MCP_OWNER_USER_ROLE || 'admin',
};

export const ACCESS_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 180; // 180 days
const AUTH_CODE_TTL_MS = 1000 * 60 * 10; // 10 minutes

export function randToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// PKCE S256: base64url(sha256(verifier)) must equal the stored challenge.
export function verifyPkceS256(verifier: string, challenge: string) {
  const hash = crypto.createHash('sha256').update(verifier).digest('base64url');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(challenge));
}

export function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

// --- Clients (dynamic client registration) ---
export async function registerClient(redirectUris: string[], clientName?: string) {
  const clientId = 'mcp_' + randToken(16);
  await db().collection('mcp_clients').doc(clientId).set({
    clientId, redirectUris, clientName: clientName || null, createdAt: new Date().toISOString(),
  });
  return clientId;
}

export async function getClient(clientId: string) {
  const snap = await db().collection('mcp_clients').doc(clientId).get();
  return snap.exists ? (snap.data() as { clientId: string; redirectUris: string[] }) : null;
}

// --- Authorization codes ---
export async function issueAuthCode(input: { clientId: string; redirectUri: string; codeChallenge: string; scope: string }) {
  const code = randToken(24);
  await db().collection('mcp_auth_codes').doc(code).set({
    ...input, userId: OWNER.userId, userName: OWNER.userName, civilId: OWNER.civilId, role: OWNER.role,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString(),
  });
  return code;
}

export async function consumeAuthCode(code: string) {
  const ref = db().collection('mcp_auth_codes').doc(code);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const d = snap.data() as { clientId: string; redirectUri: string; codeChallenge: string; scope: string; userId: string; userName: string; civilId?: string; role?: string; expiresAt: string };
  await ref.delete(); // one-time use
  if (Date.parse(d.expiresAt) < Date.now()) return null;
  return d;
}

// --- Access + refresh tokens ---
export async function issueAccessToken(input: { userId: string; userName: string; civilId?: string; role?: string; clientId: string; scope: string }) {
  const accessToken = randToken(32);
  const refreshToken = randToken(32);
  const now = Date.now();
  await db().collection('mcp_tokens').doc(accessToken).set({
    userId: input.userId, userName: input.userName, civilId: input.civilId || '', role: input.role || 'admin',
    clientId: input.clientId,
    scopes: input.scope ? input.scope.split(' ') : ['tasks'],
    expiresAt: new Date(now + ACCESS_TOKEN_TTL_MS).toISOString(),
  });
  await db().collection('mcp_refresh_tokens').doc(refreshToken).set({
    userId: input.userId, userName: input.userName, civilId: input.civilId || '', role: input.role || 'admin',
    clientId: input.clientId, scope: input.scope || 'tasks',
    createdAt: new Date(now).toISOString(),
  });
  return { accessToken, refreshToken, expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000) };
}

export async function consumeRefreshToken(refreshToken: string, clientId: string) {
  const snap = await db().collection('mcp_refresh_tokens').doc(refreshToken).get();
  if (!snap.exists) return null;
  const d = snap.data() as { userId: string; userName: string; civilId?: string; role?: string; clientId: string; scope: string };
  if (d.clientId !== clientId) return null;
  return d;
}
