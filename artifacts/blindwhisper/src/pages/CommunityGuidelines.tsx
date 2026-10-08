import { LegalLayout, LegalSection } from "@/components/shared/LegalLayout";

const SUPPORT_EMAIL = "support@blindwhisper.com";

// The community rulebook for Blind Whisper's public spaces — Debate Now
// first and foremost, plus Blind Circle's comment threads. Linked from the
// Debate Now feed, the topic composer, and the report dialog, and it's the
// page every moderation notification (warning to an author, resolution
// reply to a reporter — see routes/admin.ts's resolve endpoint) points at.
// English-only by the same convention as the other legal pages (scoped out
// of the i18n pass); prerendered for crawlers like they are (see
// scripts/prerender.mjs).
export function CommunityGuidelines() {
  return (
    <LegalLayout title="Community Guidelines" updatedDate="August 22, 2026">
      <p className="text-sm text-muted-foreground">A product of TIBLOGICS, a sub-entity of TILO GROUP, LLC.</p>

      <LegalSection heading="Why these guidelines exist">
        <p>
          Blind Whisper's public spaces — Debate Now and Blind Circle — are built on an unusual promise:
          you can speak honestly without attaching your name to it. Anonymity here exists so people can say
          the true thing, ask the awkward question, and take an unpopular position without fear of personal
          fallout. It is not a license to hurt people.
        </p>
        <p>
          These guidelines describe what that freedom is for, where its hard limits are, and what happens
          when someone crosses them. By posting a debate topic, commenting, or otherwise participating in a
          public space on Blind Whisper, you agree to follow them. They apply alongside our Terms of
          Service, and where the two overlap, the stricter rule applies.
        </p>
      </LegalSection>

      <LegalSection heading="What we encourage">
        <p>
          Strong opinions, honestly held. Debate Now exists for real disagreement — take a side, defend it,
          change your mind in public. The best threads here are the ones where people who disagree keep
          talking anyway.
        </p>
        <p>
          Attack the idea, never the person. "That argument ignores X" moves a debate forward. "You're an
          idiot" ends it. Anonymity cuts both ways: you don't know who is behind a handle, what they're
          carrying, or how old they are — write like the person reading you is a real human being, because
          they are.
        </p>
        <p>
          Good faith. Ask questions you actually want answered. Represent opposing views fairly before
          arguing against them. If you're wrong, say so — nobody here knows your name, so the only ego at
          stake is the one you bring.
        </p>
      </LegalSection>

      <LegalSection heading="What is never allowed">
        <p>
          The following have no place on Blind Whisper, in any public space, regardless of how a post is
          framed or whether it claims to be a joke, a hypothetical, or "just a debate topic":
        </p>
        <p>
          <strong>Child sexual abuse and child endangerment — zero tolerance.</strong> Any content that
          sexualizes, exploits, or endangers minors is removed immediately, the account is banned, and
          where the law requires or permits it we report to the appropriate authorities, including the
          National Center for Missing &amp; Exploited Children (NCMEC). This is not a moderation category;
          it is a legal and moral bright line.
        </p>
        <p>
          <strong>Threats and incitement of violence.</strong> Threatening any person or group with harm,
          celebrating or wishing for violence against them, or organizing, encouraging, or providing
          instructions for violent acts. "It's hypothetical" does not make a threat not a threat.
        </p>
        <p>
          <strong>Sexual or pornographic content.</strong> Sexually explicit text, imagery, or links, and
          content that solicits sexual material or contact. This is the same "no sexually explicit content"
          rule our Terms of Service applies to everything sent through Blind Whisper.
        </p>
        <p>
          <strong>Harassment and bullying.</strong> Targeting a person — on or off the platform — with
          abuse, degradation, or unwanted sexualization; pile-ons; using anonymity to torment someone who
          can't tell who is doing it. Repeatedly reporting content you merely disagree with is also a form
          of abuse (of the reporting system) and is treated as such.
        </p>
        <p>
          <strong>Hate speech.</strong> Attacking, dehumanizing, or promoting discrimination against people
          on the basis of race, ethnicity, national origin, religion, caste, sexual orientation, gender,
          gender identity, disability, or serious disease. Debating ideas and policies is welcome;
          attacking people for who they are is not.
        </p>
        <p>
          <strong>Doxxing and privacy violations.</strong> Posting anyone's private information — real
          name, address, phone number, workplace, photos, or anything else that could identify or locate
          them — or attempting to unmask an anonymous participant. On a platform built on anonymity,
          de-anonymizing someone is one of the most serious violations possible.
        </p>
        <p>
          <strong>Encouraging self-harm.</strong> Content that encourages, glorifies, or provides
          instructions for suicide, self-injury, or eating disorders. If you or someone you know is
          struggling, please reach out to a crisis line in your country — in the U.S., call or text 988.
        </p>
        <p>
          <strong>Extremism.</strong> Content that promotes, glorifies, or recruits for terrorist
          organizations, violent extremist movements, or organized hate groups.
        </p>
        <p>
          <strong>Illegal activity.</strong> Using Blind Whisper's public spaces to facilitate, promote, or
          coordinate illegal acts, including the sale of drugs, weapons, or stolen data.
        </p>
        <p>
          <strong>Spam, scams, and deception.</strong> Repetitive or off-topic posting, fraudulent schemes,
          phishing, malicious links, impersonating Blind Whisper or its staff, and coordinated manipulation
          of threads or reactions.
        </p>
        <p>
          <strong>Graphic violence and gore.</strong> Content shared to shock — depictions of severe
          violence, death, or injury without any legitimate discussion purpose.
        </p>
      </LegalSection>

      <LegalSection heading="Reporting content">
        <p>
          Every debate topic and comment has a report option (the flag). If something looks like it crosses
          a line above, report it: pick the reason that fits best, add detail if you have it (up to 300
          words), and submit. Reports go straight into our moderation queue, ordered by severity — reports
          involving child safety or threats of violence are reviewed first.
        </p>
        <p>
          You'll hear back. When our team resolves your report, you receive a notification telling you what
          happened — whether the content was removed, or reviewed and found not to violate these
          guidelines. Reporting is confidential: the author of the content is never told who reported it.
        </p>
        <p>
          Please report in good faith. The report system exists to protect the community, not to punish
          opinions you dislike — a position you find wrong, offensive, or badly argued is what the comment
          section is for.
        </p>
      </LegalSection>

      <LegalSection heading="How enforcement works">
        <p>
          Blind Whisper uses a combination of automated screening and human review. Automated systems flag
          potentially violating content for our team; community reports are triaged by severity and
          reviewed by a person before action is taken on them.
        </p>
        <p>
          Depending on severity and history, enforcement can mean: removal of the content; a formal warning
          delivered to your account; temporary restriction; or permanent suspension of your account. For
          the bright-line categories above — child safety, credible threats — removal and account action
          are immediate, and we cooperate with law enforcement where required.
        </p>
        <p>
          Anonymity is preserved through enforcement: being warned or having content removed never reveals
          your identity to other users. But anonymity on the surface is not anonymity to the law — where we
          are legally compelled, we comply with valid legal process as described in our Privacy Policy.
        </p>
      </LegalSection>

      <LegalSection heading="Appeals and questions">
        <p>
          If your content was removed or your account was actioned and you believe we got it wrong, contact
          us at <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a> with
          the notification you received. A human will take a second look.
        </p>
        <p>
          These guidelines will evolve as the community does. Material changes will be reflected in the
          "last updated" date at the top of this page.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
