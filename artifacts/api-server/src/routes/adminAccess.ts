import { Router, type IRouter } from "express";
import { db, adminGrantsTable, usersTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAdmin, requireOwner, ALL_ADMIN_PERMISSIONS, ROLE_PRESETS, isOwner } from "../lib/adminAuth";
import { logAdminAction } from "../lib/adminAudit";

const router: IRouter = Router();

router.use(requireAdmin);

// GET /api/admin/access/me — any admin: who am I in the HQ. Drives
// AdminLayout's nav filtering and the owner-only Access page visibility.
router.get("/me", (req: any, res): void => {
  res.json({
    isOwner: !!req.adminIsOwner,
    permissions: req.adminPermissions ?? [],
  });
});

// Everything below manages OTHER people's access — owner only.
router.use(requireOwner);

function toGrantResponse(grant: typeof adminGrantsTable.$inferSelect, linkedEmailToUser?: Map<string, { lastSeenAt: Date | null }>) {
  let permissions: string[] = [];
  try {
    const parsed = JSON.parse(grant.permissions);
    permissions = Array.isArray(parsed) ? parsed : [];
  } catch {
    permissions = [];
  }
  return {
    id: grant.id,
    email: grant.email,
    userId: grant.userId,
    roleTitle: grant.roleTitle,
    permissions,
    linkedAt: grant.linkedAt,
    createdAt: grant.createdAt,
    lastSeenAt: (grant.userId && linkedEmailToUser?.get(grant.userId)?.lastSeenAt) ?? null,
  };
}

// GET /api/admin/access/grants
router.get("/grants", async (_req, res): Promise<void> => {
  const grants = await db.select().from(adminGrantsTable);
  const linkedIds = grants.map((g) => g.userId).filter((id): id is string => !!id);
  const users = linkedIds.length
    ? await db.select({ id: usersTable.id, lastSeenAt: usersTable.lastSeenAt }).from(usersTable)
    : [];
  const byId = new Map(users.map((u) => [u.id, { lastSeenAt: u.lastSeenAt }]));
  res.json({
    items: grants.map((g) => toGrantResponse(g, byId)),
    availablePermissions: [...ALL_ADMIN_PERMISSIONS],
    rolePresets: ROLE_PRESETS,
  });
});

const grantInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  roleTitle: z.string().trim().min(1).max(60),
  permissions: z
    .array(z.enum(ALL_ADMIN_PERMISSIONS))
    .min(1)
    .max(ALL_ADMIN_PERMISSIONS.length),
});

// POST /api/admin/access/grants — invite a collaborator by email. If a
// user with that email already exists they're promoted and linked
// immediately; otherwise the grant waits and ensureUser attaches it on
// their first sign-in (or when their placeholder email heals).
router.post("/grants", async (req: any, res): Promise<void> => {
  const parsed = grantInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email, role title, and at least one permission." });
    return;
  }
  const adminUser = req.adminUser as User;
  const email = parsed.data.email;

  if (isBootstrapEmailGuard(email)) {
    res.status(400).json({ error: "That's the owner account — it already has every permission." });
    return;
  }

  const existingGrant = await db.select().from(adminGrantsTable).where(eq(adminGrantsTable.email, email)).then((r) => r[0]);
  if (existingGrant) {
    res.status(409).json({ error: "That email already has a staff grant — edit it instead." });
    return;
  }

  const id = randomUUID();
  const existingUser = await db.select().from(usersTable).where(eq(usersTable.email, email)).then((r) => r[0]);
  await db.insert(adminGrantsTable).values({
    id,
    email,
    userId: existingUser?.id ?? null,
    roleTitle: parsed.data.roleTitle,
    permissions: JSON.stringify(parsed.data.permissions),
    invitedByAdminId: adminUser.id,
    linkedAt: existingUser ? new Date() : null,
  });
  if (existingUser && existingUser.role !== "admin") {
    await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, existingUser.id));
  }

  logAdminAction(adminUser.id, "access.grant", { type: "admin_grant", id }, { email, roleTitle: parsed.data.roleTitle, permissions: parsed.data.permissions, linkedImmediately: !!existingUser });

  const created = await db.select().from(adminGrantsTable).where(eq(adminGrantsTable.id, id)).then((r) => r[0]);
  res.status(201).json(toGrantResponse(created));
});

function isBootstrapEmailGuard(email: string): boolean {
  const list = process.env.ADMIN_EMAILS;
  if (!list) return false;
  return list.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email);
}

const grantUpdateSchema = z.object({
  roleTitle: z.string().trim().min(1).max(60).optional(),
  permissions: z.array(z.enum(ALL_ADMIN_PERMISSIONS)).min(1).max(ALL_ADMIN_PERMISSIONS.length).optional(),
});

// PATCH /api/admin/access/grants/:id — retitle or rescope. Takes effect on
// the collaborator's next admin request (permissions are read live).
router.patch("/grants/:id", async (req: any, res): Promise<void> => {
  const grant = await db.select().from(adminGrantsTable).where(eq(adminGrantsTable.id, req.params.id)).then((r) => r[0]);
  if (!grant) {
    res.status(404).json({ error: "Grant not found" });
    return;
  }
  const parsed = grantUpdateSchema.safeParse(req.body);
  if (!parsed.success || (!parsed.data.roleTitle && !parsed.data.permissions)) {
    res.status(400).json({ error: "Nothing valid to update" });
    return;
  }
  await db
    .update(adminGrantsTable)
    .set({
      ...(parsed.data.roleTitle ? { roleTitle: parsed.data.roleTitle } : {}),
      ...(parsed.data.permissions ? { permissions: JSON.stringify(parsed.data.permissions) } : {}),
    })
    .where(eq(adminGrantsTable.id, grant.id));

  const adminUser = req.adminUser as User;
  logAdminAction(adminUser.id, "access.update", { type: "admin_grant", id: grant.id }, { email: grant.email, after: parsed.data });

  const updated = await db.select().from(adminGrantsTable).where(eq(adminGrantsTable.id, grant.id)).then((r) => r[0]);
  res.json(toGrantResponse(updated));
});

// DELETE /api/admin/access/grants/:id — revoke: the linked account (if
// any) loses the admin role entirely, not just its permissions. The owner
// can't be revoked this way — owners never have a grant row to begin with.
router.delete("/grants/:id", async (req: any, res): Promise<void> => {
  const grant = await db.select().from(adminGrantsTable).where(eq(adminGrantsTable.id, req.params.id)).then((r) => r[0]);
  if (!grant) {
    res.status(404).json({ error: "Grant not found" });
    return;
  }
  if (grant.userId) {
    const linked = await db.select().from(usersTable).where(eq(usersTable.id, grant.userId)).then((r) => r[0]);
    // Never demote the owner even if a grant row somehow points at them.
    if (linked && !isOwner(linked)) {
      await db.update(usersTable).set({ role: "user" }).where(eq(usersTable.id, linked.id));
    }
  }
  await db.delete(adminGrantsTable).where(eq(adminGrantsTable.id, grant.id));

  const adminUser = req.adminUser as User;
  logAdminAction(adminUser.id, "access.revoke", { type: "admin_grant", id: grant.id }, { email: grant.email, roleTitle: grant.roleTitle });

  res.status(204).send();
});

export default router;
