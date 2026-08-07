import { LegalLayout, LegalSection } from "@/components/shared/LegalLayout";

const SUPPORT_EMAIL = "privacy@blindwhisper.com";

export function PrivacyPolicy() {
  return (
    <LegalLayout title="Privacy Policy" updatedDate="August 7, 2026">
      <p>
        Blind Whisper ("Blind Whisper," "we," "us," or "our") operates an anonymous video-sharing platform. This
        Privacy Policy explains what information we collect, how we use it, who we share it with, and the choices
        available to you. It applies to everyone who interacts with Blind Whisper — including people who never
        create an account, because our service is built around sending things to people who haven't signed up.
      </p>
      <p>
        By using Blind Whisper, you agree to the collection and use of information as described here. If you don't
        agree, please don't use the Service.
      </p>

      <LegalSection heading="1. Information We Collect">
        <p><strong>Account information.</strong> If you create an account, we collect your email address, name, and authentication data through our identity provider (Clerk). We do not store your password ourselves.</p>
        <p><strong>Content you submit.</strong> Video links or uploaded video files, anonymous notes, mood tags, timestamps/trim points, and any replies you send or receive through the Service.</p>
        <p><strong>Recipient information.</strong> When you send something through Blind Whisper, you may provide us with a recipient's email address or phone number so we can deliver it. That person has not created an account and has not directly given us their information — <em>you</em> have, by choosing to send them something. We treat this information as sensitive and use it solely to deliver your message, track its delivery/read status, and — where the recipient opts in — allow them to reply anonymously or manage reminders/unsubscribe from future matches.</p>
        <p><strong>Payment information.</strong> If you purchase credits or a subscription, payment is processed by Stripe. We receive and store a Stripe customer/subscription identifier and a record of the transaction — we never receive or store your full card number.</p>
        <p><strong>Usage and device data.</strong> Standard technical data such as IP address, browser/device type, pages visited, links clicked, and delivery/read/watch events tied to messages sent or received, collected automatically as part of operating the Service and measuring whether a message was actually delivered and viewed.</p>
        <p><strong>Location data.</strong> At signup, we perform a one-time, best-effort lookup of your IP address to estimate your country/region/city for aggregate analytics. We do not track your precise real-time location, and this has no effect on the anonymity we provide to the people you send things to.</p>
        <p><strong>Push notification data.</strong> If you opt in to push notifications, we store a device/browser push subscription endpoint so we can notify you when something you sent is opened, watched, or replied to.</p>
      </LegalSection>

      <LegalSection heading="2. How We Use Information">
        <ul className="list-disc pl-5 space-y-1">
          <li>To operate the Service — deliver messages, track delivery/read status, process replies, send reminders, and process payments</li>
          <li>To generate optional AI features you use (a short "takeaway" of a video, note-writing suggestions, or a summary in our curated Suggestions Library)</li>
          <li>To maintain the security of the Service, detect abuse, enforce our Terms of Service, and prevent fraud</li>
          <li>To communicate with you about your account, transactional messages, and — only if you separately opt in — anonymous message matches</li>
          <li>To analyze aggregate usage trends so we can improve the Service</li>
          <li>To comply with legal obligations</li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. AI Processing">
        <p>
          Certain optional features (a video "takeaway," note-writing suggestions, and Suggestions Library
          summaries/discovery) send limited content — such as a video's title, publicly available transcript, or
          your chosen mood — to Anthropic's Claude API for processing. We do not send your account's email, phone
          number, or payment information to this service. Anthropic processes this data under its own privacy and
          data-use terms.
        </p>
      </LegalSection>

      <LegalSection heading="4. Who We Share Information With">
        <p>We don't sell your information. We share it only with the service providers necessary to run Blind Whisper, and only for that purpose:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Clerk</strong> — account authentication</li>
          <li><strong>Stripe</strong> — payment processing</li>
          <li><strong>Twilio</strong> — SMS and WhatsApp message delivery</li>
          <li><strong>Resend</strong> — email delivery</li>
          <li><strong>Anthropic</strong> — optional AI-generated content, as described above</li>
          <li><strong>Our hosting and cloud storage providers</strong> — running the Service and storing uploaded video files</li>
          <li>Law enforcement or other parties, if required by law, subpoena, or valid legal process, or to protect the rights, safety, or property of Blind Whisper, our users, or the public — see Section 6 on the limits of anonymity</li>
        </ul>
      </LegalSection>

      <LegalSection heading="5. Data Retention">
        <p>
          We retain account and message data for as long as your account is active, or as needed to provide the
          Service. Uploaded video files are automatically deleted approximately 7 days after upload. You can request
          deletion of your account and associated data at any time by contacting us at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a>; we may
          retain limited records where required for legal, security, or fraud-prevention purposes.
        </p>
      </LegalSection>

      <LegalSection heading="6. Anonymity and Its Limits">
        <p>
          Blind Whisper is built so that senders and recipients don't see each other's identity in the ordinary
          course of using the Service. We take deliberate technical steps to prevent one side from learning who the
          other is through the app itself. However, anonymity on Blind Whisper is <strong>not absolute</strong>:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>We do retain technical records (such as account identifiers, IP addresses, and delivery logs) that could, in principle, be used to identify a sender or recipient</li>
          <li>We will disclose this information if compelled by a valid subpoena, court order, or other legal process, or where we believe in good faith it's necessary to prevent harm, fraud, or illegal activity</li>
          <li>We cannot control what a recipient does with content after they receive it — including sharing it, screenshotting it, or otherwise identifying context clues within it</li>
        </ul>
        <p>We do not claim, and you should not rely on, absolute or untraceable anonymity.</p>
      </LegalSection>

      <LegalSection heading="7. Your Rights and Choices">
        <ul className="list-disc pl-5 space-y-1">
          <li>You can access, correct, or request deletion of your account information by contacting us</li>
          <li>You can reply STOP to any text message to opt out of future SMS from us, or HELP for assistance</li>
          <li>You can unsubscribe from anonymous-matching emails with a one-click link in every such email, no account required</li>
          <li>Depending on where you live, you may have additional rights (such as under the CCPA or GDPR) to access, correct, delete, or restrict use of your personal information — contact us to exercise these</li>
        </ul>
      </LegalSection>

      <LegalSection heading="8. Children's Privacy">
        <p>
          Blind Whisper is intended for users 18 and older. We do not knowingly collect personal information from
          anyone under 18. If we learn that we've collected information from someone under 18, we will delete it.
        </p>
      </LegalSection>

      <LegalSection heading="9. Security">
        <p>
          We use reasonable technical and organizational measures to protect your information. No method of
          transmission or storage is completely secure, and we cannot guarantee absolute security.
        </p>
      </LegalSection>

      <LegalSection heading="10. Changes to This Policy">
        <p>
          We may update this Privacy Policy from time to time. If we make material changes, we'll update the "Last
          updated" date above and, where appropriate, notify you directly.
        </p>
      </LegalSection>

      <LegalSection heading="11. Contact Us">
        <p>
          Questions about this Privacy Policy? Email us at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
