import { vi } from "vitest";

// End-to-end harness (see e2e/README.md): the REAL app — routes, DB,
// schedulers — with only the two external identities swapped out:
//   - Clerk: the caller is whoever the `x-test-user` header names (the e2e
//     Vite proxy sets it from the browser's `e2e_user` cookie). Each test
//     identity `e2e_<name>` has the verified email <name>@e2e.test.
//   - Anthropic: a canned reply, so moderation/takeaways never call out.
// Never imported by the app or the unit-test suite.
process.env.NODE_ENV = "test";
process.env.ADMIN_MFA_TOKEN_SECRET ??= "e2e-admin-mfa-secret";
process.env.ANTHROPIC_API_KEY ??= "e2e-anthropic-key";

export const E2E_USER_HEADER = "x-test-user";

function clerkUserFor(clerkId: string) {
  const name = clerkId.replace(/^e2e_/, "");
  return {
    id: clerkId,
    firstName: name.charAt(0).toUpperCase() + name.slice(1),
    lastName: "Tester",
    primaryEmailAddressId: "em_1",
    emailAddresses: [{ id: "em_1", emailAddress: `${name}@e2e.test`, verification: { status: "verified" } }],
    primaryPhoneNumberId: null,
    phoneNumbers: [],
    twoFactorEnabled: true,
  };
}

vi.mock("@clerk/express", () => ({
  getAuth: (req: any) => ({ userId: req.headers[E2E_USER_HEADER] ?? null }),
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  clerkClient: { users: { getUser: async (clerkId: string) => clerkUserFor(clerkId) } },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => ({ content: [{ type: "text", text: '{"flagged":false,"categories":[],"severity":"none","reason":"e2e"}' }] }),
    };
  },
}));
