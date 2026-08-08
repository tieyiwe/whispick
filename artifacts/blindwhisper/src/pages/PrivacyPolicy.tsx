import { LegalLayout, LegalSection } from "@/components/shared/LegalLayout";

const PRIVACY_EMAIL = "privacy@blindwhisper.com";

export function PrivacyPolicy() {
  return (
    <LegalLayout title="Privacy Policy" updatedDate="August 8, 2026">
      <p className="text-sm text-muted-foreground">A product of TIBLOGICS, a sub-entity of TILO GROUP, LLC.</p>
      <p>
        Welcome to Blind Whisper ("Blind Whisper," "we," "us," or "our"), a product of TIBLOGICS, which is a
        sub-entity of TILO GROUP, LLC, a limited liability company organized under the laws of the State of
        Maryland, United States of America. Blind Whisper is an anonymous video-recommendation platform that lets
        users ("Senders") share video content with recipients ("Recipients") through anonymous delivery methods,
        including Whisper Links, Whisper Groups, Ghost Boosts, and Circle. This Privacy Policy governs how we collect, use, store, share, and
        protect information in connection with our website, mobile experience, and all related services
        (collectively, the "Platform"). It applies to everyone who interacts with Blind Whisper — including people
        who never create an account, because our service is built around sending things to people who haven't
        signed up.
      </p>
      <p>
        BY ACCESSING OR USING THE PLATFORM, YOU ACKNOWLEDGE THAT YOU HAVE READ, UNDERSTOOD, AND AGREE TO BE BOUND BY
        THIS PRIVACY POLICY. IF YOU DO NOT AGREE, YOU MUST DISCONTINUE USE OF THE PLATFORM.
      </p>

      <LegalSection heading="1. Information We Collect">
        <p><strong>1.1 Information you provide directly.</strong></p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Account registration information:</strong> name and email address, plus authentication data handled by our identity provider, Clerk. We do not directly collect or store your password — Clerk manages credentials on our behalf under its own security and privacy practices.</li>
          <li><strong>Profile information:</strong> display name, optional avatar image, and optional demographic details (gender, age range) used to help tailor recommendations and reporting.</li>
          <li><strong>Phone number:</strong> if you choose to add and verify a phone number, we send a one-time verification code to that number via Twilio Verify, a purpose-built phone-verification service, and confirm the code you enter matches. We only store the number as "verified" once this succeeds — this proves you actually control that phone number, the same way any SMS one-time-passcode flow does. See Section 1.7 for what we use a verified number for.</li>
          <li><strong>Payment information:</strong> billing details submitted through our payment processor, Stripe, Inc. Blind Whisper does not directly collect, store, or process credit card numbers or other sensitive financial information — all payment data is handled by Stripe under its own privacy policy and PCI-DSS compliance standards. We retain a Stripe customer/subscription identifier and a record of the transaction.</li>
          <li><strong>Content you submit:</strong> video URLs or uploaded video files, anonymous notes, sender alias selections, mood tags, trim points, and scheduled delivery preferences.</li>
          <li><strong>Recipient contact information:</strong> the email address or phone number of a person you choose to send a Whisper Link to. That person hasn't created an account and hasn't directly given us their information — you have, by choosing to send them something. We use this solely to deliver your message, track delivery/read status, and — where the recipient opts in — let them reply anonymously or manage reminders. It is not sold, rented, or shared with third parties for marketing purposes.</li>
        </ul>
        <p><strong>1.2 Ghost Boost delivery.</strong> Ghost Boost is not a targeted-advertising product and does not involve any third-party ad platform. When a Sender uses Ghost Boost, we do not collect a specific Recipient's contact information at all — instead, the Sender's Whisp is matched against Blind Whisper's own pool of subscribers who have separately, affirmatively opted in (via double opt-in email confirmation) to receive anonymous video recommendations matching their stated mood or topic preferences. Delivery happens entirely through Blind Whisper's own email and notification systems. Subscribers can unsubscribe at any time via a one-click link in every match email, no account required.</p>
        <p><strong>1.3 Circle.</strong> Circle is a different kind of delivery: instead of sending to one chosen Recipient, a Sender can post a Whisp to a public, community discovery feed that anyone can browse without an account, or to a private Circle that only its invited members can see. Content posted to Circle — the video, note, and mood tag — is visible to whoever can see that feed; it is not delivered privately the way a Whisper Link is. The Sender's identity is still not attached to the post, but the content itself is not private in the way a one-to-one Whisper Link is.</p>
        <p><strong>1.4 Whisper Groups.</strong> A Sender can also send a single Whisp to multiple saved recipients at once ("Whisper Groups"). Each recipient receives it the same way as an individual Whisper Link, and the same delivery/tracking practices in this Policy apply to each of them.</p>
        <p><strong>1.5 Information collected automatically.</strong></p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Device and usage data:</strong> device/browser type, IP address, pages visited, and links clicked, collected as part of operating the Service.</li>
          <li><strong>Location data:</strong> at signup, we perform a one-time, best-effort lookup of your IP address to estimate your country/region/city for aggregate analytics. We do not track precise real-time location, and this has no effect on the anonymity we provide to the people you send things to.</li>
          <li><strong>Delivery and read-tracking events:</strong> when a Whisper Link is opened or its video is clicked, our servers record that event so we can show the Sender whether their message was delivered and viewed, and so the Recipient can be offered a reminder before the link expires. This tracking call does not capture or store the Recipient's IP address or device identifier — only that the link was opened. Recipients are informed of this on the landing page. Whisper Links expire 48 hours after delivery; we may send the Recipient up to two reminders before then.</li>
          <li><strong>Push notification data:</strong> if you opt in, we store a device/browser push subscription endpoint so we can notify you when something you sent is opened, watched, or replied to.</li>
        </ul>
        <p><strong>1.6 Information from third parties.</strong> If you sign in using a supported social login provider through Clerk, we receive your name, email address, and profile photo from that provider in accordance with your account permissions there. We also receive transaction confirmations and subscription status from Stripe.</p>
        <p><strong>1.7 Phone number verification and in-app delivery matching.</strong> A verified phone number lets us do one additional thing: when a Sender addresses a Whisper Link to a phone number by SMS or WhatsApp, we check — privately, on our servers only — whether that number matches a verified Blind Whisper account. If it does, we deliver the Whisp inside the app as an in-app notification instead of sending it as a text message through Twilio. This is purely a delivery-routing decision: the content, anonymity protections, and Reveal Flow all work identically either way, and it can meaningfully reduce our SMS/WhatsApp costs and get the Whisp to the Recipient faster. Two things we want to be explicit about:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>The Sender is never told which path was used.</strong> Nothing in the Sender's experience — timing, confirmation text, or any other signal — reveals whether their Whisp was delivered by text message or in-app. This is a deliberate design choice: telling a Sender "this number already has an account" would let them use Blind Whisper to check whether a specific phone number belongs to someone they know, which we consider a privacy risk to Recipients and refuse to expose.</li>
          <li><strong>Verified numbers are used only for this matching check and, if you choose, for your own sign-in.</strong> We do not use your verified phone number for marketing, sell it, or share it with Twilio or anyone else beyond what's needed to send you the one-time verification code itself.</li>
        </ul>
        <p><strong>1.8 Delayed reply notifications.</strong> When a Recipient replies to a Whisper Link, we intentionally delay the Sender's notification by a random interval (a few minutes) before sending it. This is a deliberate anonymity protection: if a Sender and Recipient happen to be physically near each other, an instant notification could let the Sender connect a Recipient's phone buzzing to their own action, undermining anonymity. The Recipient's own confirmation that their reply was sent is never delayed — only the Sender-facing notification is.</p>
      </LegalSection>

      <LegalSection heading="2. How We Use Your Information">
        <ul className="list-disc pl-5 space-y-1">
          <li>To provide, operate, and maintain the Platform and all its features</li>
          <li>To process transactions, manage subscriptions, and fulfill Ghost Boost credit purchases through Stripe</li>
          <li>To deliver Whisper Links via SMS/WhatsApp (Twilio), in-app notification, or email (Resend) on behalf of Senders</li>
          <li>To verify phone number ownership via one-time SMS codes (Twilio Verify), and to determine whether a Whisper Link's Recipient is an existing verified Blind Whisper user so we can route delivery in-app instead of by text message, as described in Section 1.7</li>
          <li>To match Ghost Boost Whisps against our opted-in subscriber pool and deliver them</li>
          <li>To send Senders tracking notifications when Recipients open, click, or engage with their Whisper Links</li>
          <li>To facilitate anonymous reply exchanges between Senders and Recipients within the Platform</li>
          <li>To power the optional Reveal Flow feature, enabling consensual identity disclosure between a Sender and Recipient</li>
          <li>To generate optional AI features you use, as described in Section 3</li>
          <li>To enforce our Terms and Conditions, detect fraud, and prevent abuse</li>
          <li>To communicate with you about account updates, subscription renewals, credit balances, and product changes</li>
          <li>To comply with applicable laws, regulations, and legal obligations</li>
          <li>To improve, personalize, and develop the Platform through aggregated, anonymized analytics</li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. AI Processing">
        <p>
          Certain optional features — a video "takeaway," note-writing suggestions, and Suggestions Library
          summaries/discovery — send limited content, such as a video's title, publicly available transcript, or
          your chosen mood, to Anthropic's Claude API for processing. We do not send your account's email, phone
          number, or payment information to this service. Anthropic processes this data under its own privacy and
          data-use terms.
        </p>
      </LegalSection>

      <LegalSection heading="4. Anonymous Delivery and Sender Identity Protection">
        <p>Blind Whisper's core functionality is built on Sender anonymity. We implement the following protections:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Sender identities are never disclosed to Recipients through automated delivery mechanisms.</li>
          <li>The optional Reveal Flow feature requires affirmative, two-step consent from both the Sender and Recipient before any identity is disclosed.</li>
          <li>Whisper Link landing pages do not contain metadata linking back to the Sender's account.</li>
          <li>Ghost Boost matches are delivered as ordinary emails to opted-in subscribers; nothing in the delivery identifies the Sender to the Recipient.</li>
          <li>When a Whisp is routed to in-app delivery because the Recipient's number matches a verified account (Section 1.7), the Sender is never informed that this happened — the routing is invisible to them.</li>
          <li>Sender-facing notifications that a Recipient has replied are deliberately delayed by a random short interval, so a Recipient's phone notifying them cannot be used to identify the Sender through physical proximity (Section 1.8).</li>
        </ul>
        <p>
          <strong>Circle is different.</strong> The Sender's identity is never attached to a Circle post, but Circle
          content itself is posted to a public or shared feed rather than delivered privately to one Recipient —
          anyone who can see that feed can see the content. Don't use Circle for anything you'd only want one
          specific person to see.
        </p>
        <p>
          <strong>Important limitation:</strong> we cannot guarantee absolute anonymity in all circumstances. We may
          be required to disclose Sender information in response to valid legal process, including court orders,
          subpoenas, or law enforcement requests. If a Sender violates our Terms and Conditions, we reserve the
          right to disclose information as necessary to protect the safety of Recipients and third parties. We also
          cannot control what a Recipient does with content after receiving it — including sharing it,
          screenshotting it, or identifying context clues within it.
        </p>
      </LegalSection>

      <LegalSection heading="5. Sharing of Information">
        <p>We do not sell your personal information. We share information only in the following circumstances:</p>
        <p><strong>5.1 Service providers</strong> — trusted third parties who help us operate the Platform, bound by confidentiality obligations:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Clerk — account authentication</li>
          <li>Stripe, Inc. — payment processing and subscription management</li>
          <li>Twilio Inc. — SMS/WhatsApp delivery for Whisper Links, and phone number verification via Twilio Verify</li>
          <li>Resend — transactional and match-delivery email</li>
          <li>Anthropic — optional AI-generated content, as described in Section 3</li>
          <li>Our hosting and database infrastructure providers — running the Platform and storing uploaded video files</li>
        </ul>
        <p><strong>5.2 Legal requirements.</strong> We may disclose information when required by law, regulation, legal process, or governmental request, or to protect the rights, property, or safety of Blind Whisper, TIBLOGICS, TILO GROUP, LLC, our users, or the public.</p>
        <p><strong>5.3 Business transfers.</strong> If TILO GROUP, LLC or TIBLOGICS is involved in a merger, acquisition, reorganization, or sale of assets, your information may be transferred as part of that transaction. We will provide notice before your personal information becomes subject to a different privacy policy.</p>
        <p><strong>5.4 With your consent.</strong> We may share information with third parties when you've given explicit, informed consent.</p>
      </LegalSection>

      <LegalSection heading="6. Data Retention">
        <p>
          We retain account and message data for as long as your account is active, or as needed to provide the
          Service. Uploaded video files are automatically deleted approximately 7 days after upload. Payment
          records are kept for as long as reasonably necessary to meet our tax and financial recordkeeping
          obligations. You can request deletion of your account and associated data at any time by contacting us at{" "}
          <a href={`mailto:${PRIVACY_EMAIL}`} className="text-primary hover:underline">{PRIVACY_EMAIL}</a>; we'll
          process your request within 30 days, subject to limited records we may need to retain for legal, security,
          or fraud-prevention purposes. Aggregate, anonymized analytics data may be retained indefinitely.
        </p>
      </LegalSection>

      <LegalSection heading="7. Data Security">
        <p>We use reasonable technical and organizational measures to protect your information, including:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>TLS/SSL encryption for data in transit</li>
          <li>Encryption of sensitive data at rest</li>
          <li>Access controls limiting employee and contractor access to personal data on a need-to-know basis</li>
        </ul>
        <p>
          No method of transmission over the internet or electronic storage is 100% secure. While we strive to use
          commercially acceptable means to protect your information, we cannot guarantee absolute security. You
          provide information at your own risk.
        </p>
      </LegalSection>

      <LegalSection heading="8. Your Rights and Choices">
        <ul className="list-disc pl-5 space-y-1">
          <li>You can access, correct, or update your account information at any time through your account settings, including adding, changing, or removing your verified phone number.</li>
          <li>You can request deletion of your account by contacting us at <a href={`mailto:${PRIVACY_EMAIL}`} className="text-primary hover:underline">{PRIVACY_EMAIL}</a>.</li>
          <li>You can reply STOP to any text message to opt out of future SMS from us, or HELP for assistance.</li>
          <li>You can unsubscribe from Ghost Boost match emails with a one-click link in every such email, no account required.</li>
          <li>You can opt out of non-essential communications at any time via your notification preferences. Transactional communications related to your account and paid services can't be opted out of while your account is active.</li>
        </ul>
        <p><strong>California residents (CCPA)</strong> have the right to know what personal information we collect, disclose, and sell (we do not sell personal information); the right to delete personal information; the right to opt out of the sale of personal information; and the right to non-discrimination for exercising these rights.</p>
        <p><strong>Canadian residents (PIPEDA)</strong> have the right to access personal information we hold about you and to challenge its accuracy and completeness.</p>
        <p>To exercise any of these rights, contact us at <a href={`mailto:${PRIVACY_EMAIL}`} className="text-primary hover:underline">{PRIVACY_EMAIL}</a>.</p>
      </LegalSection>

      <LegalSection heading="9. Children's Privacy">
        <p>
          THE PLATFORM IS NOT INTENDED FOR USE BY INDIVIDUALS UNDER THE AGE OF 18. We do not knowingly collect
          personal information from anyone under 18. If we become aware that we've inadvertently collected personal
          information from a child under 18 without verifiable parental consent, we'll take immediate steps to
          delete it. If you believe we may have collected information from a child under 18, contact us immediately
          at <a href={`mailto:${PRIVACY_EMAIL}`} className="text-primary hover:underline">{PRIVACY_EMAIL}</a>.
        </p>
      </LegalSection>

      <LegalSection heading="10. Third-Party Links and Services">
        <p>
          The Platform may contain links to third-party video platforms (YouTube, TikTok, Instagram, Facebook, and
          others) and services. This Privacy Policy doesn't apply to those third-party services, and we aren't
          responsible for their privacy practices. We encourage you to review their privacy policies directly.
        </p>
      </LegalSection>

      <LegalSection heading="11. International Data Transfers">
        <p>
          Blind Whisper is operated from the United States. If you access the Platform from outside the United
          States, your information may be transferred to and processed in the United States and other countries
          where our service providers operate, which may have data protection laws that differ from those in your
          country. By using the Platform, you consent to this transfer.
        </p>
      </LegalSection>

      <LegalSection heading="12. Cookies and Similar Technologies">
        <p>
          We keep this deliberately minimal. We don't use any third-party analytics or advertising cookies, and we
          don't run an analytics tracker of any kind. The only cookies the Platform sets are:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Authentication:</strong> a session cookie set by our identity provider, Clerk, so you stay signed in.</li>
          <li><strong>Interface preference:</strong> a cookie that remembers whether your sidebar is expanded or collapsed. It stores no personal information.</li>
        </ul>
        <p>
          Whisper Link open/click tracking (described in Section 1.5) is done with a direct call from the Recipient's
          browser when they open the link — not a cookie or an embedded tracking pixel — and it doesn't set any
          cookie on the Recipient's device. You can control cookie preferences through your browser settings;
          disabling the authentication cookie will prevent you from staying signed in.
        </p>
      </LegalSection>

      <LegalSection heading="13. Changes to This Privacy Policy">
        <p>
          We may update this Privacy Policy at any time. When we make material changes, we'll notify you via email
          and/or a prominent notice on the Platform at least 14 days before the changes take effect. Your continued
          use of the Platform after the effective date of any change constitutes acceptance of the revised policy.
        </p>
      </LegalSection>

      <LegalSection heading="14. Contact Us">
        <p>
          If you have questions, concerns, or requests regarding this Privacy Policy or our data practices, contact
          us:
        </p>
        <p>
          TIBLOGICS / TILO GROUP, LLC<br />
          Attn: Privacy Officer — Blind Whisper<br />
          Email: <a href={`mailto:${PRIVACY_EMAIL}`} className="text-primary hover:underline">{PRIVACY_EMAIL}</a><br />
          Wheaton, Maryland, United States
        </p>
        <p className="text-sm text-muted-foreground">
          © 2026 TIBLOGICS / TILO GROUP, LLC. All rights reserved. Blind Whisper is a product of TIBLOGICS, a
          sub-entity of TILO GROUP, LLC. This document does not constitute legal advice.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
