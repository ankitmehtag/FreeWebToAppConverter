import type { Db } from 'mongodb';
import type { Auth } from '../auth';

export type AdminOptions = { db: Db; auth: Auth; adminEmails: string[]; /** Where a disabled user is told to write. */ contactEmail?: string };

/** Creates the audit log and the 2FA store, and returns what the admin routes need. */
export const prepareAdmin = async ({ db, auth, adminEmails, contactEmail }: AdminOptions) => {
  // Append only: the API inserts and reads it, and has no route that changes or removes an entry.
  const audit = db.collection('adminAudit');
  const state = db.collection('adminState');
  const coupons = db.collection('coupons');
  await audit.createIndex({ createdAt: -1 });
  return { audit, state, coupons, auth, contactEmail: contactEmail ?? adminEmails[0]?.trim() ?? '', adminEmails: adminEmails.map((email) => email.trim().toLowerCase()).filter(Boolean) };
};

export type Admin = Awaited<ReturnType<typeof prepareAdmin>>;
