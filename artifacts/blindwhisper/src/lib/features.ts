// Product switches for features that exist but are hidden for now. Flip one
// to true to bring the feature back — every entry point reads from here, so
// there's nothing else to hunt down.

/**
 * The curated video Suggestions library (/suggestions, the Dashboard
 * "browse suggestions" card, the nav item). Hidden at launch; to be shown
 * again once there are enough users for it to be worth curating. The admin
 * tool for managing suggestions (/admin_pro/suggestions) is unaffected.
 */
export const SUGGESTIONS_ENABLED = false;
