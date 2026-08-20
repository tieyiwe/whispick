export * from "./generated/api";
export * from "./generated/types";

// GET /admin/users/{id}/whisps is the one operation with both a path param
// and query params, so orval's "{OperationId}Params" naming template
// collides between the query-params type here and the path-params zod
// object in ./generated/api — an explicit re-export (as TS's own error
// message suggests) resolves the ambiguity in favor of the type; the zod
// object is still reachable via ./generated/api directly if ever needed.
export type { AdminListUserWhispsParams } from "./generated/types";
// Same collision, same fix: GET /public/w/{token} gained its own query
// param (visitorId) once Blind Circle likes needed it.
export type { GetPublicWhispParams } from "./generated/types";
// And the same again for these two request bodies' generated names, which
// happen to collide with an unrelated zod object elsewhere in ./generated/api.
export type { PostCircleCommentBody, ToggleCircleLikeBody } from "./generated/types";
// GET /public/debate-topics/{id} gained its own query param (visitorId),
// same collision as GetPublicWhispParams above.
export type { GetDebateTopicParams } from "./generated/types";
// The comment-reaction/handle-rename/rewhisp request bodies added for
// Circle + Debate Topic comments — same collision pattern as
// PostCircleCommentBody above, each against an unrelated zod object
// elsewhere in ./generated/api.
export type {
  ReactToCircleCommentBody,
  ReactToDebateTopicCommentBody,
  RenameCircleHandleBody,
  RenameDebateTopicHandleBody,
  RewhispDebateTopicBody,
  ToggleFollowBody,
} from "./generated/types";
// Same collision, added with the Debate Topics avatar-picker endpoint.
export type { UpdateDebateTopicHandleAvatarBody } from "./generated/types";
