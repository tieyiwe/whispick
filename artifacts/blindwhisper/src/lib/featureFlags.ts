// Mirrors GHOST_BOOST_ENABLED in artifacts/api-server/src/lib/plans.ts — kept
// as a separate constant since the frontend and backend are separate
// bundles, but the two must be flipped together. See that file's comment
// for why Ghost Boost is paused rather than removed: the code, schema,
// tests, and historical campaigns all stay intact so this can be re-scoped
// and turned back on later by flipping both flags. Hides only new-send and
// new-purchase entry points (SendWhisp.tsx, CreditsPage.tsx, Dashboard.tsx)
// — viewing a PAST campaign (WhispDetail.tsx's match-stats view) is
// deliberately left ungated.
export const GHOST_BOOST_ENABLED = false;

// The curated video Suggestions library (/suggestions, the Dashboard card,
// the nav item). Hidden at launch; flip to true to bring it back once there
// are enough users for it to be worth curating. The admin tool for managing
// suggestions (/admin_pro/suggestions) is unaffected.
export const SUGGESTIONS_ENABLED = false;
