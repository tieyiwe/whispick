export * from "./generated/api";
export * from "./generated/types";

// GET /admin/users/{id}/whisps is the one operation with both a path param
// and query params, so orval's "{OperationId}Params" naming template
// collides between the query-params type here and the path-params zod
// object in ./generated/api — an explicit re-export (as TS's own error
// message suggests) resolves the ambiguity in favor of the type; the zod
// object is still reachable via ./generated/api directly if ever needed.
export type { AdminListUserWhispsParams } from "./generated/types";
