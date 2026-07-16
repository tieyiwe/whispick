// The Contact Picker API (https://developer.mozilla.org/en-US/docs/Web/API/Contact_Picker_API)
// isn't in TypeScript's default DOM lib yet, and browser support is narrow —
// Android Chrome/Edge/Samsung Internet only, no iOS Safari, no desktop. It has
// no persistent "permission granted" state like camera/mic: every call opens
// the OS's own contact picker UI and the user explicitly chooses which
// contact(s) to share for that one pick, each time. There's nothing to
// request or store up front — feature-detect, and if it's there, use it.
declare global {
  interface ContactInfo {
    name?: string[];
    email?: string[];
    tel?: string[];
  }
  interface ContactsManager {
    select(properties: string[], options?: { multiple?: boolean }): Promise<ContactInfo[]>;
  }
  interface Navigator {
    contacts?: ContactsManager;
  }
}

export function isContactPickerSupported(): boolean {
  return typeof navigator !== "undefined" && "contacts" in navigator && !!navigator.contacts?.select;
}

export type PickedContact = { name: string | null; email: string | null; tel: string | null };

// Resolves to null if the user cancels the picker or the API throws (e.g. not
// a secure context) — callers should treat null as "no-op", not an error,
// since cancelling is an expected, silent outcome.
export async function pickContact(): Promise<PickedContact | null> {
  if (!isContactPickerSupported()) return null;

  try {
    const contacts = await navigator.contacts!.select(["name", "email", "tel"], { multiple: false });
    const contact = contacts?.[0];
    if (!contact) return null;

    return {
      name: contact.name?.[0] ?? null,
      email: contact.email?.[0] ?? null,
      tel: contact.tel?.[0] ?? null,
    };
  } catch {
    return null;
  }
}
