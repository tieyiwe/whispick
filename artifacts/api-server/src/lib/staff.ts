import { db, adminGrantsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type StaffMember = { id: string; email: string; roleTitle: string };

// Everyone assignable/reachable as "staff": the owner plus every linked
// staff grant. Email is the display identity here — this is an internal
// tool among people who already know each other. Shared by the HQ Projects
// workspace (task assignment) and the admin Text Whisp tools (staff-to-staff
// messaging).
export async function listStaff(): Promise<StaffMember[]> {
  const grants = await db.select().from(adminGrantsTable);
  const linked = grants.filter((g) => g.userId);
  const admins = await db.select({ id: usersTable.id, email: usersTable.email, role: usersTable.role }).from(usersTable).where(eq(usersTable.role, "admin"));
  const roleByUserId = new Map(linked.map((g) => [g.userId!, g.roleTitle]));
  return admins.map((a) => ({ id: a.id, email: a.email, roleTitle: roleByUserId.get(a.id) ?? "Super Admin" }));
}
