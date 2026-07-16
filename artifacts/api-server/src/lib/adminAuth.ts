import { getAuth } from "@clerk/express";
import { ensureUser } from "./ensureUser";

// Deliberately untyped, same reasoning as lib/auth.ts's requireAuth.
export async function requireAdmin(req: any, res: any, next: any) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const user = await ensureUser(userId, req);
  if (user.banned) {
    res.status(403).json({ error: "Your account has been suspended" });
    return;
  }
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  req.adminUser = user;
  next();
}
