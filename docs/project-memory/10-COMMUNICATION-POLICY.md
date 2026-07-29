# 10 — Communication Policy

## The rule

Provider direct phone number, WhatsApp, and email must **never** be exposed to tourists. All customer-provider communication must pass through BARQ. BARQ-owned contact numbers and the "ساعدني" support channel handle customer assistance. Messaging, support tickets, booking inquiries, and quote requests must all stay inside the platform — never redirect a customer to a provider's own contact channel.

## Current state: the baseline is already correct, but only because the feature doesn't exist yet

- `ProviderProfileCard` (`src/components/services/provider-profile-card.tsx`) renders a "Contact Provider" button as **honestly disabled** — its own code comment states: *"'Contact Provider' has no backing messaging system, so it renders as an honestly disabled action."* No phone/email/WhatsApp field is fetched or displayed anywhere on a service or provider page.
- No messaging model exists (`Message`/`Conversation` — confirmed absent from schema).
- No "ساعدني" concept exists anywhere in the codebase today (zero matches).
- The static Contact/Support page (`messages/en/pages.json`) states plainly: *"A dedicated support inbox or contact form isn't wired up on BARQ yet."*

**This means the no-exposure rule is currently satisfied by omission, not by design enforcement.** The moment any future feature adds a way to contact a provider, this policy must be actively enforced by the design, not left as an accident of what hasn't been built yet.

## Target state

- A real internal messaging system (planned engine #13) that routes customer↔provider communication through BARQ — never a direct channel.
- A real "ساعدني" support channel, backed by the currently-schema-only `SupportTicket` model becoming a real feature (planned engine #12).
- Booking inquiries and quote requests handled as in-platform flows, not external contact.

## Binding constraint for any future implementation

Whatever UI/UX eventually replaces the disabled "Contact Provider" button, the underlying data flow must never surface a provider's raw phone/WhatsApp/email to a customer's browser or app — all contact must be mediated by a BARQ-owned channel or in-platform messaging thread. This is a permanent product and security rule, not a temporary placeholder to remove once messaging exists.

## Related registry entries

BR-002, BR-003 in `16-BUSINESS-RULES.md`; `SupportTicket`, `Conversation`, `Message` entities in `15-DATA-DICTIONARY.md`.
