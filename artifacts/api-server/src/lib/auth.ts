import { getAuth } from "@clerk/express";

// Deliberately untyped (matches every route's inferred param/response shape) —
// an explicit Request/Response annotation here forces Express to widen every
// route's params to the generic ParamsDictionary for the whole handler chain,
// which breaks each route's own `:id`-style param inference.
export function requireAuth(req: any, res: any, next: any) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
