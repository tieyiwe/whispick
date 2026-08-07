import { LegalLayout, LegalSection } from "@/components/shared/LegalLayout";

const SUPPORT_EMAIL = "support@blindwhisper.com";
const LEGAL_EMAIL = "legal@blindwhisper.com";

export function TermsOfService() {
  return (
    <LegalLayout title="Terms of Service" updatedDate="August 7, 2026">
      <p>
        These Terms of Service ("Terms") govern your access to and use of Blind Whisper (the "Service"), operated by
        Blind Whisper ("we," "us," or "our"). By creating an account, sending a message, or otherwise using the
        Service, you agree to be bound by these Terms. If you don't agree, don't use the Service.
      </p>

      <LegalSection heading="1. Eligibility">
        <p>
          You must be at least 18 years old to create an account or use Blind Whisper. By using the Service, you
          represent that you meet this requirement. Blind Whisper is not directed at, and we do not knowingly permit
          use by, anyone under 18.
        </p>
      </LegalSection>

      <LegalSection heading="2. The Service">
        <p>
          Blind Whisper lets a registered user ("Sender") privately share a video with a specific person of their
          choosing ("Recipient") via a link delivered by email, text message, or a public community feed, without
          revealing the Sender's identity to the Recipient in the ordinary course of using the Service. Optional
          features include AI-generated summaries, note-writing suggestions, a curated library of admin-selected
          videos, and anonymous matching to opted-in subscribers. We may add, change, or remove features at any
          time.
        </p>
      </LegalSection>

      <LegalSection heading="3. Your Account">
        <p>
          You're responsible for maintaining the confidentiality of your account credentials and for all activity
          under your account. Notify us immediately of any unauthorized use. You agree to provide accurate
          information and to keep it up to date.
        </p>
      </LegalSection>

      <LegalSection heading="4. Acceptable Use">
        <p>You agree not to use Blind Whisper to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Harass, threaten, bully, stalk, or intimidate anyone</li>
          <li>Send content to someone without a good-faith, reasonable belief that they'd want to receive it from you</li>
          <li>Send unlawful, defamatory, obscene, hateful, or discriminatory content, or content that infringes someone else's rights</li>
          <li>Impersonate any person or entity, or misrepresent your affiliation with anyone</li>
          <li>Send spam, chain messages, or unsolicited bulk messages, or use the Service for any advertising or commercial solicitation</li>
          <li>Attempt to identify, deanonymize, or reveal the identity of another user against their wishes</li>
          <li>Upload or share content you don't have the rights to share, or that violates a third party's intellectual property, privacy, or publicity rights</li>
          <li>Attempt to interfere with, disrupt, reverse-engineer, or gain unauthorized access to the Service or its infrastructure</li>
          <li>Use the Service in any way that violates applicable law, including anti-harassment, telecommunications, and messaging consent laws</li>
        </ul>
        <p>
          We reserve the right to investigate, remove content, suspend, or terminate accounts that violate this
          section, and to report unlawful activity — including threats of harm — to law enforcement.
        </p>
      </LegalSection>

      <LegalSection heading="5. Content You Submit">
        <p>
          You retain ownership of content you submit through Blind Whisper. By submitting it, you grant us a
          worldwide, non-exclusive, royalty-free license to host, store, transmit, and display that content solely
          as necessary to operate the Service (for example, delivering it to your chosen Recipient and displaying it
          on the page they open). You're solely responsible for content you submit and for having the rights
          necessary to share it.
        </p>
        <p>
          If you believe content on Blind Whisper infringes your copyright, contact us at{" "}
          <a href={`mailto:${LEGAL_EMAIL}`} className="text-primary hover:underline">{LEGAL_EMAIL}</a> with a
          description of the content and your rights in it, and we'll investigate and, where appropriate, remove it.
        </p>
      </LegalSection>

      <LegalSection heading="6. Anonymity Is Not a Guarantee">
        <p>
          Blind Whisper is designed to prevent Senders and Recipients from learning each other's identity through
          the ordinary use of the Service. It is <strong>not</strong> designed or intended to shield anyone from
          legal accountability. We retain technical records that could identify a user and will disclose them in
          response to valid legal process, or where we believe in good faith it's necessary to prevent harm, fraud,
          or violation of these Terms. See our Privacy Policy for details.
        </p>
      </LegalSection>

      <LegalSection heading="7. Message Delivery Disclaimers">
        <p>
          We use third-party providers (including email and SMS/text carriers) to deliver messages. Delivery is
          best-effort — we do not guarantee that any message will be delivered, delivered on time, or delivered at
          all, since carriers may filter, delay, or block messages for reasons outside our control. If you provide a
          phone number for delivery, message and data rates may apply from your carrier. Reply STOP to opt out of
          future texts, or HELP for help. Message frequency varies based on your own use of the Service.
        </p>
      </LegalSection>

      <LegalSection heading="8. AI-Generated and Curated Content">
        <p>
          Some content on Blind Whisper — including video "takeaway" summaries, note suggestions, and entries in our
          Suggestions Library — is generated or discovered with the help of AI. We don't guarantee the accuracy,
          appropriateness, or completeness of AI-generated content, and it does not represent our endorsement of any
          third-party video's content. Admin-added or AI-discovered videos in the Suggestions Library link to
          content hosted by third parties (e.g., YouTube, Vimeo, TikTok) that we don't control and aren't
          responsible for.
        </p>
      </LegalSection>

      <LegalSection heading="9. Fees, Credits, and Billing">
        <p>
          Some features require a paid subscription or the purchase of credits, processed by Stripe. Prices are as
          displayed at the time of purchase and may change going forward. Subscriptions renew automatically until
          canceled; you can cancel anytime from your account settings, effective at the end of the current billing
          period. Purchased credits are non-refundable except as required by law or as we otherwise decide at our
          discretion.
        </p>
      </LegalSection>

      <LegalSection heading="10. Third-Party Services">
        <p>
          The Service relies on and links to third-party services (including Stripe, Twilio, Resend, Clerk,
          Anthropic, and video platforms like YouTube, Vimeo, TikTok, Instagram, Facebook, and X/Twitter). We aren't
          responsible for the availability, content, or practices of these third parties, which are governed by
          their own terms and privacy policies.
        </p>
      </LegalSection>

      <LegalSection heading="11. Termination">
        <p>
          You may stop using the Service or delete your account at any time. We may suspend or terminate your
          access, with or without notice, if we believe you've violated these Terms, created risk or legal exposure
          for us, or for any other reason at our discretion. Sections that by their nature should survive
          termination (including Sections 5, 6, 13, 14, and 15) will survive.
        </p>
      </LegalSection>

      <LegalSection heading="12. Changes to the Service or These Terms">
        <p>
          We may modify or discontinue any part of the Service at any time. We may update these Terms from time to
          time; if we make material changes, we'll update the "Last updated" date above and, where appropriate,
          notify you. Continuing to use the Service after changes take effect means you accept the updated Terms.
        </p>
      </LegalSection>

      <LegalSection heading="13. Disclaimer of Warranties">
        <p>
          THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR
          IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, OR
          THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE. WE DO NOT WARRANT THAT MESSAGES WILL BE
          DELIVERED OR THAT ANONYMITY WILL BE PRESERVED IN ALL CIRCUMSTANCES.
        </p>
      </LegalSection>

      <LegalSection heading="14. Limitation of Liability">
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, BLIND WHISPER AND ITS OPERATORS WILL NOT BE LIABLE FOR ANY
          INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, GOODWILL, OR
          PROFITS, ARISING FROM YOUR USE OF THE SERVICE — INCLUDING CONTENT SENT OR RECEIVED THROUGH IT, OR ANY
          FAILURE OR DELAY OF MESSAGE DELIVERY — EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL
          LIABILITY FOR ANY CLAIM RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US
          IN THE 12 MONTHS BEFORE THE CLAIM AROSE, OR (B) $100.
        </p>
      </LegalSection>

      <LegalSection heading="15. Indemnification">
        <p>
          You agree to indemnify and hold Blind Whisper and its operators harmless from any claim, liability,
          damage, or expense (including reasonable attorneys' fees) arising from your use of the Service, content
          you submit, or your violation of these Terms or any law or third-party right.
        </p>
      </LegalSection>

      <LegalSection heading="16. Governing Law">
        <p>
          These Terms are governed by the laws of [Insert Your State/Country], without regard to conflict-of-law
          principles, and any dispute will be resolved in the courts located there, unless applicable law requires
          otherwise.
        </p>
      </LegalSection>

      <LegalSection heading="17. Contact Us">
        <p>
          Questions about these Terms? Email us at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
