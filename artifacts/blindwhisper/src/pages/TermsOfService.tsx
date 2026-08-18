import { LegalLayout, LegalSection } from "@/components/shared/LegalLayout";

const SUPPORT_EMAIL = "support@blindwhisper.com";
const LEGAL_EMAIL = "legal@blindwhisper.com";
const BILLING_EMAIL = "billing@blindwhisper.com";

export function TermsOfService() {
  return (
    <LegalLayout title="Terms and Conditions of Use" updatedDate="August 8, 2026">
      <p className="text-sm text-muted-foreground">A product of TIBLOGICS, a sub-entity of TILO GROUP, LLC.</p>
      <p>
        PLEASE READ THESE TERMS AND CONDITIONS CAREFULLY BEFORE USING BLIND WHISPER. BY CREATING AN ACCOUNT,
        ACCESSING, OR USING THE PLATFORM IN ANY WAY, YOU AGREE TO BE LEGALLY BOUND BY THESE TERMS. IF YOU DO NOT
        AGREE, DO NOT USE THE PLATFORM.
      </p>

      <LegalSection heading="1. Parties and Agreement">
        <p>
          These Terms and Conditions ("Terms," "Agreement") are a legally binding contract between you ("User,"
          "you," or "your") and TILO GROUP, LLC, a Maryland limited liability company, operating through its
          sub-entity TIBLOGICS ("Company," "we," "us," or "our"), governing your access to and use of the Blind
          Whisper platform, including its website, mobile experience, and all related services, features, and
          content (collectively, the "Platform").
        </p>
        <p>In these Terms: "Sender" means any User who initiates delivery of a video recommendation, Text Whisp, or Invite through the Platform; "Recipient" means any individual who receives a Whisper Link, Whisper Group, Text Whisp, Ghost Boost delivery, or Invite; "Whisp" means a single anonymous video recommendation delivery; "Whisper Link" means an anonymous SMS, WhatsApp, or email delivery of a Whisp to a specific Recipient chosen by the Sender, which expires 48 hours after delivery; "Whisper Group" means a Whisp sent by a Sender to multiple saved Recipients at once, each delivered and governed the same way as a Whisper Link; "Text Whisp" means a short, text-only anonymous message (up to 260 characters) sent through the Platform to a Recipient's phone number, delivered instantly within the Platform if that number belongs to a verified Blind Whisper account, or otherwise by SMS to a Platform web page where the Recipient can read it and, if they choose, create an account to reply the same way; "Ghost Boost" means the delivery of a Whisp to a member of Blind Whisper's own opted-in subscriber pool, matched by mood or topic preference — Ghost Boost does not involve targeting any specific individual chosen by the Sender, and does not run through any third-party advertising platform; "Ghost Boost Credit" means a prepaid unit entitling the Sender to one Ghost Boost delivery; "Blind Circle" means a public or invite-only feed to which a Sender may post a Whisp for anyone with access to that feed to view, rather than delivering it privately to one chosen Recipient; "Invite" means an anonymous message, delivered by SMS, WhatsApp, or email, inviting a Recipient to create a Blind Whisper account.</p>
      </LegalSection>

      <LegalSection heading="2. Eligibility">
        <p>You must meet all of the following to use the Platform:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>You are at least 18 years of age.</li>
          <li>You have the legal capacity to enter into a binding contract under applicable law.</li>
          <li>You are not located in a country subject to a United States government embargo or designated as a terrorist-supporting country.</li>
          <li>You are not listed on any United States government list of prohibited or restricted parties.</li>
          <li>You have not been previously suspended or removed from the Platform by us.</li>
        </ul>
        <p>By using the Platform, you represent and warrant that you meet all eligibility requirements. If you're using the Platform on behalf of a business entity, you represent that you have authority to bind that entity to these Terms.</p>
      </LegalSection>

      <LegalSection heading="3. Account Registration and Security">
        <p><strong>3.1 Account creation.</strong> To access most features, you must create an account by providing accurate, current, and complete information, and keep it up to date.</p>
        <p><strong>3.2 Account security.</strong> You're solely responsible for maintaining the confidentiality of your account credentials and for all activity under your account. You agree to select a strong, unique password; notify us immediately at {" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a> of any unauthorized use or security breach; and log out at the end of each session on shared or public devices. We won't be liable for loss or damage arising from your failure to maintain account security, and you may be held liable for losses we or others incur due to unauthorized use of your account.
        </p>
        <p><strong>3.3 One account per user.</strong> You may only maintain one active account. Creating multiple accounts to circumvent restrictions, suspensions, or bans is prohibited and will result in termination of all associated accounts.</p>
        <p><strong>3.4 Phone number verification.</strong> You may optionally add and verify a phone number via a one-time SMS code. You represent that any phone number you verify is your own. A verified number is used to route Whisps and Text Whisps addressed to it directly within the Platform instead of by SMS, and, if you choose, to sign in — see our Privacy Policy for details. Attempting to verify a phone number that isn't yours is a violation of these Terms.</p>
      </LegalSection>

      <LegalSection heading="4. Acceptable Use Policy">
        <p><strong>4.1 Permitted uses.</strong> The Platform is designed for anonymously recommending video content and sending short anonymous messages — whether privately to a specific person via a Whisper Link, Whisper Group, or Text Whisp, to Blind Whisper's opted-in subscriber pool via Ghost Boost, to a public or shared feed via Blind Circle, or inviting someone to join via an Invite — for lawful purposes, including facilitating difficult conversations, sharing educational content, expressing care or concern, relationship communication, and general video discovery/discussion through Blind Circle.</p>
        <p><strong>4.2 Strictly prohibited conduct.</strong> The following will result in account termination, forfeiture of credits and subscription fees, and may result in civil and criminal liability:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Sending a Whisp to a Recipient who hasn't consented to receiving communications from unknown parties, or who has explicitly requested no contact from you</li>
          <li>Using the Platform to harass, stalk, threaten, intimidate, or harm anyone</li>
          <li>Sending or posting content that's defamatory, obscene, pornographic, sexually explicit, or violent</li>
          <li>Sending or posting content that sexualizes, exploits, or endangers minors in any way — this is a zero-tolerance policy, and we will report all such instances to the National Center for Missing and Exploited Children (NCMEC) and relevant law enforcement</li>
          <li>Using the Platform to send unsolicited commercial messages (spam) or conduct unauthorized marketing campaigns</li>
          <li>Sending or posting content that promotes, incites, or facilitates illegal activity, including fraud, money laundering, drug trafficking, or terrorism</li>
          <li>Providing false, inaccurate, or fraudulent information about your relationship with a Recipient</li>
          <li>Attempting to reverse-engineer, decompile, disassemble, or derive the source code or underlying structure of the Platform</li>
          <li>Using automated scripts, bots, scrapers, or other automated means to access or interact with the Platform</li>
          <li>Circumventing, disabling, or interfering with security-related features of the Platform</li>
          <li>Impersonating any person or entity, or misrepresenting your affiliation with any person or entity</li>
          <li>Uploading or transmitting viruses, malware, or other malicious code</li>
          <li>Interfering with or disrupting the integrity or performance of the Platform or its infrastructure</li>
          <li>Using the Platform in any manner that could expose TILO GROUP, LLC, TIBLOGICS, or Blind Whisper to legal liability</li>
        </ul>
        <p><strong>4.3 Content standards.</strong> All video URLs or files submitted through the Platform must be lawful and, if linked, publicly accessible. You represent and warrant that: (a) you have the right to share and recommend the content; (b) it doesn't infringe any third-party intellectual property rights; (c) it complies with applicable law; and (d) it doesn't violate the terms of service of the originating platform (YouTube, TikTok, Instagram, Facebook, etc.). The same standards, and the prohibited conduct in Section 4.2, apply in full to the free-text content of a Text Whisp — it isn't held to a lower standard just because it's text instead of a video.</p>
      </LegalSection>

      <LegalSection heading="5. Sender Responsibilities and Representations">
        <p>As a Sender, you represent, warrant, and covenant that:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>For Whisper Links, Whisper Groups, Text Whisps, and Invites, you'll only send to individuals with whom you have a genuine pre-existing personal, familial, or professional relationship, and you have a good-faith basis for believing they'd benefit from or want to receive it.</li>
          <li>For Blind Circle, you understand your post is visible to anyone with access to that feed, not just one chosen person, and you'll only post content appropriate for that audience.</li>
          <li>You accept sole and full responsibility for the content of everything you send or post, including any consequences arising from a Recipient's or viewer's exposure to it.</li>
          <li>You won't use the anonymous nature of the Platform to engage in conduct that would otherwise be prohibited by applicable law or these Terms.</li>
          <li>You understand that Blind Whisper's anonymity protections don't extend to unlawful conduct, and that we may disclose your identity in response to valid legal process.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="6. Subscriptions, Payments, and Refunds">
        <p><strong>6.1 Subscription plans.</strong> Blind Whisper offers the following tiers, billed monthly: a Free tier with limited features at no charge; the Spark plan at $9.99 USD/month; and the Ember plan at $19.99 USD/month, each including the features described on the Platform at the time of purchase. We may modify subscription pricing with 30 days' notice to current subscribers; continued use after a price change means you accept the new pricing.</p>
        <p><strong>6.2 Ghost Boost Credits.</strong> Ghost Boost Credits may be purchased in packs, or granted as part of a paid subscription, as described on the Platform. Credits are non-refundable, non-transferable, and have no cash value. Credits from any source are added to a single balance and, as of the date of these Terms, do not expire. We reserve the right to introduce an expiration policy for credits in the future; if we do, we'll give you at least 30 days' notice before it applies to credits you already hold.</p>
        <p><strong>6.3 Payment processing.</strong> All payments are processed by Stripe, Inc. By providing payment information, you agree to Stripe's Terms of Service and authorize us to charge your payment method for applicable fees. You represent that you're authorized to use the payment method provided.</p>
        <p><strong>6.4 Automatic renewal.</strong> Paid subscriptions renew automatically at the end of each billing cycle unless canceled before the renewal date. You may cancel anytime through your account settings; cancellation takes effect at the end of the current billing period, and no prorated refunds are issued for unused portions.</p>
        <p><strong>6.5 Refund policy.</strong> ALL PURCHASES, INCLUDING SUBSCRIPTION FEES AND GHOST BOOST CREDIT PACKS, ARE FINAL AND NON-REFUNDABLE, EXCEPT AS REQUIRED BY APPLICABLE LAW. If you believe you've been charged in error, contact {" "}
          <a href={`mailto:${BILLING_EMAIL}`} className="text-primary hover:underline">{BILLING_EMAIL}</a> within 14 days of the charge. We'll review billing disputes in good faith but reserve the right to make final determinations on refund requests.
        </p>
      </LegalSection>

      <LegalSection heading="7. Message Delivery and SMS/WhatsApp Consent">
        <p>
          See our <a href="/sms-terms" className="text-primary hover:underline">SMS Messaging Program</a> page for
          the full program description, sample messages, and message frequency.
        </p>
        <p>
          We use third-party providers, including telecom carriers, to deliver Whisper Links, Whisper Groups,
          Invites, and — when the Recipient's number isn't already a verified Blind Whisper account — Text Whisps,
          by SMS, WhatsApp, or email. Delivery is best-effort — we do not guarantee that any message will be
          delivered, delivered on time, or delivered at all, since carriers may filter, delay, or block messages for
          reasons outside our control.
        </p>
        <p>
          If you provide a phone number for delivery, message and data rates may apply from the recipient's carrier.
          Message frequency depends on how often you or others use the Platform to send something to that number.
          Reply <strong>STOP</strong> to any text message from us to opt out of future SMS/WhatsApp messages to that
          number, or <strong>HELP</strong> for assistance. Consent to receive a message is not a condition of any
          purchase.
        </p>
      </LegalSection>

      <LegalSection heading="8. Anonymity, Reveal Flow, and Consent">
        <p><strong>8.1 Anonymity protections.</strong> The Platform is designed to protect Sender anonymity in standard use, and we implement technical measures to prevent automated delivery mechanisms from revealing a Sender's identity to a Recipient. As stated in our Privacy Policy, anonymity may be compromised in response to valid legal process or to protect safety.</p>
        <p><strong>8.2 Blind Circle is not private delivery.</strong> Content posted via Blind Circle is visible to anyone with access to that feed — the public, for a public Blind Circle post, or all members of a private Blind Circle. The Sender's identity is still not attached to the post, but the content itself is not delivered privately the way a Whisper Link is. Don't use Blind Circle for anything you only want one specific person to see.</p>
        <p><strong>8.3 Reveal Flow.</strong> The optional Reveal Flow feature — available for Whisps, Text Whisps, and Invites — lets a Sender initiate a consensual identity disclosure process once the Recipient has an account. By initiating a Reveal Flow: (a) you acknowledge your identity may be disclosed to the Recipient if they consent; (b) you agree the Recipient's decision to accept or decline is final and binding through the Platform; (c) you won't attempt to coerce or pressure a Recipient into accepting a reveal; and (d) a Recipient's decision to decline doesn't entitle you to a refund.</p>
        <p><strong>8.4 Anonymous replies.</strong> The anonymous reply feature lets Recipients respond to Whisps without disclosing their identity. You agree not to use it for harassment, threats, or any conduct prohibited by Section 4.</p>
      </LegalSection>

      <LegalSection heading="9. Intellectual Property">
        <p><strong>9.1 Platform ownership.</strong> The Platform — including all software, algorithms, design elements, trademarks, text, graphics, and other content created by or for Blind Whisper — is the exclusive property of TILO GROUP, LLC and/or TIBLOGICS and is protected by U.S. and international intellectual property laws. "Blind Whisper," the Blind Whisper logo, and related marks are trademarks of TILO GROUP, LLC.</p>
        <p><strong>9.2 License to use.</strong> Subject to your compliance with these Terms, we grant you a limited, non-exclusive, non-transferable, non-sublicensable, revocable license to access and use the Platform for its intended personal, non-commercial purposes. This license doesn't include any right to resell or commercially exploit the Platform, collect or harvest user data, use data mining or similar gathering methods, or download or copy account information for the benefit of any third party.</p>
        <p><strong>9.3 Third-party content.</strong> The Platform lets Senders share URLs to third-party video content. We don't claim ownership of such content. By submitting a video URL, you represent that you have the right to recommend it and that sharing it complies with applicable law and the originating platform's terms.</p>
      </LegalSection>

      <LegalSection heading="10. Disclaimer of Warranties">
        <p>
          THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED,
          INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND
          NON-INFRINGEMENT. WE DO NOT WARRANT THAT: (A) THE PLATFORM WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE;
          (B) ANY DEFECTS WILL BE CORRECTED; (C) THE PLATFORM IS FREE OF VIRUSES OR OTHER HARMFUL COMPONENTS; (D)
          ANY GHOST BOOST WILL ACHIEVE DELIVERY TO A MATCHED SUBSCRIBER; (E) SENDER ANONYMITY WILL BE PRESERVED IN
          ALL CIRCUMSTANCES; OR (F) THE PLATFORM WILL MEET YOUR EXPECTATIONS OR REQUIREMENTS. YOUR USE OF THE
          PLATFORM IS ENTIRELY AT YOUR OWN RISK.
        </p>
      </LegalSection>

      <LegalSection heading="11. Limitation of Liability">
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL TILO GROUP, LLC, TIBLOGICS, BLIND
          WHISPER, OR THEIR RESPECTIVE OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, PARTNERS, SUPPLIERS, OR LICENSORS BE
          LIABLE FOR: (A) ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES; (B) ANY
          LOSS OF PROFITS, REVENUE, DATA, GOODWILL, OR OTHER INTANGIBLE LOSSES; (C) ANY UNAUTHORIZED ACCESS TO OR
          ALTERATION OF YOUR TRANSMISSIONS OR DATA; (D) ANY CONDUCT OR CONTENT OF ANY THIRD PARTY ON THE PLATFORM;
          (E) ANY CONTENT OBTAINED FROM THE PLATFORM; OR (F) UNAUTHORIZED ACCESS, USE, OR ALTERATION OF YOUR
          CONTENT — WHETHER BASED ON WARRANTY, CONTRACT, TORT (INCLUDING NEGLIGENCE), OR ANY OTHER LEGAL THEORY,
          EVEN IF WE'VE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR AGGREGATE LIABILITY WILL NOT EXCEED THE
          GREATER OF (I) THE TOTAL AMOUNT YOU PAID TO BLIND WHISPER IN THE 12 MONTHS PRECEDING THE CLAIM, OR (II)
          ONE HUNDRED DOLLARS ($100.00 USD).
        </p>
      </LegalSection>

      <LegalSection heading="12. Indemnification">
        <p>You agree to defend, indemnify, and hold harmless TILO GROUP, LLC, TIBLOGICS, Blind Whisper, and their respective officers, directors, employees, agents, affiliates, and licensors (the "Indemnified Parties") from and against any claims, damages, obligations, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising from or related to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Your use of or access to the Platform</li>
          <li>Your violation of any provision of these Terms</li>
          <li>Your violation of any third-party rights, including privacy, publicity, or intellectual property rights</li>
          <li>Any Whisp you send or post, including any harm suffered by a Recipient or viewer as a result</li>
          <li>Your violation of any applicable law, rule, or regulation</li>
          <li>Any claim that your use of the Platform caused damage to a third party</li>
        </ul>
        <p>We reserve the right to assume exclusive defense and control of any matter subject to indemnification by you, in which case you agree to cooperate fully with our defense.</p>
      </LegalSection>

      <LegalSection heading="13. Termination">
        <p><strong>13.1 By you.</strong> You may terminate your account at any time by deleting it through Platform settings or by contacting {" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a>. Termination doesn't entitle you to a refund of subscription fees or unused Ghost Boost Credits.
        </p>
        <p><strong>13.2 By us.</strong> We may suspend, restrict, or terminate your account, with or without notice, at our discretion, for reasons including violation of these Terms, conduct we determine is harmful to other users or the Platform, requests from law enforcement or government agencies, extended inactivity, or non-payment of fees. Upon termination, your right to use the Platform ceases immediately. Provisions that by their nature should survive termination — including ownership, warranty disclaimers, indemnification, and limitations of liability — will survive.</p>
      </LegalSection>

      <LegalSection heading="14. Governing Law and Dispute Resolution">
        <p><strong>14.1 Governing law.</strong> These Terms are governed by the laws of the State of Maryland, United States of America, without regard to conflict-of-law provisions. For Canadian users, mandatory consumer protection laws of your province or territory may also apply.</p>
        <p><strong>14.2 Informal resolution.</strong> Before initiating formal dispute resolution, you agree to contact us at {" "}
          <a href={`mailto:${LEGAL_EMAIL}`} className="text-primary hover:underline">{LEGAL_EMAIL}</a> and attempt to resolve the dispute informally for 30 days.
        </p>
        <p><strong>14.3 Binding arbitration.</strong> EXCEPT AS PROVIDED BELOW, ANY DISPUTE, CLAIM, OR CONTROVERSY ARISING OUT OF OR RELATING TO THESE TERMS OR THE PLATFORM SHALL BE RESOLVED BY FINAL AND BINDING ARBITRATION ADMINISTERED BY THE AMERICAN ARBITRATION ASSOCIATION (AAA) UNDER ITS CONSUMER ARBITRATION RULES, CONDUCTED IN MARYLAND OR VIA VIDEOCONFERENCE. THE ARBITRATOR'S AWARD SHALL BE FINAL AND BINDING AND MAY BE ENTERED AS A JUDGMENT IN ANY COURT OF COMPETENT JURISDICTION.</p>
        <p><strong>14.4 Class action waiver.</strong> YOU AND BLIND WHISPER AGREE THAT EACH MAY BRING CLAIMS AGAINST THE OTHER ONLY IN AN INDIVIDUAL CAPACITY, NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY PURPORTED CLASS, CONSOLIDATED, OR REPRESENTATIVE ACTION. THE ARBITRATOR MAY NOT CONSOLIDATE MORE THAN ONE PERSON'S CLAIMS.</p>
        <p><strong>14.5 Exceptions.</strong> Either party may seek injunctive or other equitable relief in any court of competent jurisdiction to prevent actual or threatened infringement, misappropriation, or violation of intellectual property rights, or in cases involving the safety of minors.</p>
      </LegalSection>

      <LegalSection heading="15. Modifications to These Terms">
        <p>
          We may modify these Terms at any time. When we make material changes, we'll notify you via email and/or a
          prominent notice on the Platform at least 14 days before the changes take effect. Your continued use of
          the Platform after the effective date of any change constitutes acceptance of the revised Terms. If you
          don't agree, you must stop using the Platform before the effective date.
        </p>
      </LegalSection>

      <LegalSection heading="16. Miscellaneous">
        <p><strong>16.1 Entire agreement.</strong> These Terms, together with our Privacy Policy and any other agreements or policies expressly incorporated herein, constitute the entire agreement between you and TILO GROUP, LLC regarding the Platform and supersede all prior agreements and understandings.</p>
        <p><strong>16.2 Severability.</strong> If any provision of these Terms is found invalid, illegal, or unenforceable, the remaining provisions continue in full force and effect, and the invalid provision will be modified to the minimum extent necessary to make it enforceable.</p>
        <p><strong>16.3 Waiver.</strong> Our failure to enforce any right or provision of these Terms isn't a waiver of that right or provision. Any waiver must be in writing and signed by an authorized representative of TILO GROUP, LLC.</p>
        <p><strong>16.4 Assignment.</strong> You may not assign or transfer your rights or obligations under these Terms without our prior written consent. We may freely assign these Terms, including in connection with a merger, acquisition, or sale of assets, without notice to you.</p>
        <p><strong>16.5 Force majeure.</strong> We won't be liable for any failure or delay in performance resulting from causes beyond our reasonable control, including acts of God, natural disasters, pandemics, war, civil unrest, government actions, internet outages, or failures of third-party service providers.</p>
        <p><strong>16.6 No third-party beneficiaries.</strong> These Terms don't create third-party beneficiary rights. Recipients of Whisps are not parties to this Agreement and have no rights under these Terms against TILO GROUP, LLC, TIBLOGICS, or Blind Whisper.</p>
      </LegalSection>

      <LegalSection heading="17. Contact Us">
        <p>For questions about these Terms, contact us:</p>
        <p>
          TIBLOGICS / TILO GROUP, LLC<br />
          Attn: Legal — Blind Whisper<br />
          General: <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a><br />
          Legal: <a href={`mailto:${LEGAL_EMAIL}`} className="text-primary hover:underline">{LEGAL_EMAIL}</a><br />
          Billing: <a href={`mailto:${BILLING_EMAIL}`} className="text-primary hover:underline">{BILLING_EMAIL}</a><br />
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
