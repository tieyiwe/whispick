import { LegalLayout, LegalSection } from "@/components/shared/LegalLayout";

const SUPPORT_EMAIL = "support@blindwhisper.com";

// A single, easy-to-find page a carrier or Twilio reviewer can land on and
// check every A2P 10DLC campaign field against — program name, message
// flow/opt-in, verbatim sample messages, frequency, and opt-out — without
// having to piece it together from Section 1.7/1.10 of the Privacy Policy
// and Section 5/7 of the Terms. Every sample message below must stay a
// byte-for-byte copy of what lib/sms.ts actually sends (COMPLIANCE_FOOTER
// plus lib/copy.ts's SMS_WHISPER_LINK_LEAD/SMS_INVITE_LEAD/
// SMS_TEXT_WHISP_LEAD, via whisperLinkSmsBody/inviteSmsBody/
// textWhispGuestSmsBody) — that consistency is exactly what a rejected
// registration is checked against on resubmission.
export function SmsTerms() {
  return (
    <LegalLayout title="SMS Messaging Program" updatedDate="August 18, 2026">
      <p className="text-sm text-muted-foreground">A product of TIBLOGICS, a sub-entity of TILO GROUP, LLC.</p>

      <LegalSection heading="What this program is">
        <p>
          Blind Whisper is a software platform operated by TIBLOGICS, offering free and paid subscription plans.
          A registered, signed-in customer ("Sender") uses a built-in platform feature to notify a specific phone
          number they choose (a "Recipient") about content shared through our software — a video recommendation,
          a short note, or an account invitation. Our software generates and sends every message from a fixed set
          of templates; a Sender never composes free-form text that goes out over SMS.
        </p>
        <p>
          This is a one-way notification, not a text conversation: a Recipient engages with what was shared by
          opening the link and using the Blind Whisper web app, never by replying to the SMS thread itself — our
          system does not read or act on inbound message content beyond the carrier-mandated STOP/HELP keywords.
          Blind Whisper itself never selects who receives a message and never sends marketing, advertising, or
          promotional messages to a phone number.
        </p>
      </LegalSection>

      <LegalSection heading="How consent works (message flow)">
        <p>
          The Recipient does not sign up, opt in, or give Blind Whisper their phone number before receiving a first
          message — the Sender does, entirely from within the Blind Whisper web app, using a number the Sender
          already has. Consent is captured from the Sender, not collected from the Recipient in advance, because
          the Sender is our platform's registered customer and the party accountable for the send:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Every Sender creates a Blind Whisper account and, in doing so, agrees to our Terms of Service.</li>
          <li>
            Our Terms of Service (Section 5, "Sender Responsibilities and Representations") require every Sender to
            represent that they'll only send to people they have a genuine pre-existing personal, family, or
            professional relationship with, and have a good-faith basis for believing want to receive it.
          </li>
          <li>
            Our Terms of Service (Section 4.2) and Acceptable Use Policy prohibit sending to anyone who hasn't
            consented to hearing from unknown parties, or who has asked not to be contacted, on pain of account
            termination.
          </li>
          <li>
            At the exact point in the app where a Sender enters a Recipient's phone number, the Sender must also
            check a required, unchecked-by-default box reading: "I confirm I have this person's permission to
            receive a text from me via Blind Whisper." The send action stays disabled until this is checked.
          </li>
        </ul>
        <p>There are three ways a message reaches a Recipient by SMS:</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li><strong>Whisper Link / Whisper Group</strong> — a Sender addresses a video recommendation to the Recipient's phone number.</li>
          <li><strong>Invite</strong> — a Sender invites someone they know to create a Blind Whisper account.</li>
          <li><strong>Text Whisp</strong> — a Sender sends a short (up to 260-character) note to a phone number that isn't already a verified Blind Whisper account.</li>
        </ol>
        <p>
          After that first message, the Recipient is in full control of any further contact: replying{" "}
          <strong>STOP</strong> immediately and permanently opts that phone number out of every future Blind
          Whisper message, from any Sender, platform-wide — not just from the one Sender who happened to text
          them. That instruction is included on every message we send, not only the first one to a given number,
          because a Sender's follow-up, reminder, or reveal notification can be the first message a number actually
          receives from us if an earlier send to it failed.
        </p>
      </LegalSection>

      <LegalSection heading="Sample messages">
        <p>These are sent verbatim — nothing is added or removed per Recipient beyond the link itself:</p>
        <div className="rounded-lg border border-border/50 bg-muted/30 p-4 font-mono text-xs sm:text-sm whitespace-pre-wrap">
          Blind Whisper: Someone you know shared a video with you.{"\n"}
          https://blindwhisper.com/w/AbC123XyZ{"\n"}
          Reply STOP to opt out, HELP for help. Msg & data rates may apply.
        </div>
        <div className="rounded-lg border border-border/50 bg-muted/30 p-4 font-mono text-xs sm:text-sm whitespace-pre-wrap">
          Blind Whisper: Someone you know invited you to join Blind Whisper.{"\n"}
          https://blindwhisper.com/invite/AbC123XyZ{"\n"}
          Reply STOP to opt out, HELP for help. Msg & data rates may apply.
        </div>
        <div className="rounded-lg border border-border/50 bg-muted/30 p-4 font-mono text-xs sm:text-sm whitespace-pre-wrap">
          Blind Whisper: You have a new message on Blind Whisper.{"\n"}
          https://blindwhisper.com/tw/AbC123XyZ{"\n"}
          Reply STOP to opt out, HELP for help. Msg & data rates may apply.
        </div>
      </LegalSection>

      <LegalSection heading="Frequency, cost, and opt-out">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Message frequency varies</strong> — it depends entirely on how often people in a Recipient's life use Blind Whisper to send them something. A single Whisper Link can generate up to 2 automated reminder messages before it expires, 48 hours after delivery.</li>
          <li><strong>Message and data rates may apply</strong>, billed by the Recipient's own wireless carrier.</li>
          <li>
            <strong>Reply STOP</strong> to any message to stop all future SMS from Blind Whisper to that number.
            <strong> Reply HELP</strong> for assistance, or contact{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a>.
          </li>
          <li>Consent to receive a message is never a condition of any purchase.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="More detail">
        <p>
          This page summarizes our SMS messaging program specifically. It's governed by, and should be read
          alongside, our full <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a> and{" "}
          <a href="/terms" className="text-primary hover:underline">Terms of Service</a>, which describe the
          platform, anonymity protections, and Sender obligations in full.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
