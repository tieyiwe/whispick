import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { LogoLockup } from "@/components/ui/logo";
import { MoodTag } from "@/components/shared/MoodTag";
import { FAQ_ITEMS } from "@/lib/faqContent";
import { InstallAppPrompt } from "@/components/shared/InstallAppPrompt";
import { Send, Heart, Shield, Sparkles, PlayCircle, Users2, Users, Briefcase, UserRound, X, Check, ChevronDown } from "lucide-react";

const USE_CASES = [
  {
    relationship: "A parent, to their daughter",
    icon: Users2,
    mood: "for-your-growth",
    quote:
      "I wanted to talk to her about something sensitive, but I didn't want her focused on my reaction instead of the message. She watched it on her own time — and I've already seen her trying a new approach. No awkwardness.",
  },
  {
    relationship: "A friend, checking in",
    icon: Users,
    mood: "heal-together",
    quote:
      "He was going through a breakup and I didn't know what to say without it sounding like a lecture. I sent a video instead. He told me later it was exactly what he needed — and it just felt like it arrived, not like I'd said it.",
  },
  {
    relationship: "A partner, opening a hard conversation",
    icon: Heart,
    mood: "i-see-you",
    quote:
      "There's a difference between \"we need to talk\" and just... showing them something. I sent this instead of starting a fight. It opened the door gently instead of slamming it.",
  },
  {
    relationship: "A colleague, offering a nudge",
    icon: Briefcase,
    mood: "think-about-this",
    quote:
      "I wanted a teammate to see something about giving feedback well, without it feeling like a performance review. Anonymous meant it landed as a nudge, not a callout.",
  },
  {
    relationship: "A sibling, saying the unsaid",
    icon: UserRound,
    mood: "i-love-you",
    quote:
      "We don't really \"talk\" talk. But I could send him something that said what I couldn't figure out how to say out loud.",
  },
];

function MiniWhispPreview({ mood, className = "" }: { mood: string; className?: string }) {
  return (
    <div className={`rounded-2xl bg-background/60 border border-border/50 p-3 flex items-center gap-3 ${className}`}>
      <div className="w-14 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <PlayCircle className="w-5 h-5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <MoodTag mood={mood} className="scale-90 origin-left" />
        <p className="text-[11px] text-muted-foreground mt-1">Sent anonymously · Blind Whisper</p>
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="bg-background relative">
      <header
        className="absolute top-0 w-full px-4 sm:px-6 pb-4 sm:pb-6 flex justify-between items-center z-10 gap-2"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}
      >
        <LogoLockup />
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <Link href="/sign-in">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground rounded-full px-3 sm:px-4">
              Sign In
            </Button>
          </Link>
          <Link href="/sign-up">
            <Button size="sm" className="rounded-full shadow-[0_0_20px_rgba(124,92,252,0.3)] hover:shadow-[0_0_30px_rgba(124,92,252,0.5)] transition-all px-3 sm:px-4">
              Get Started
            </Button>
          </Link>
        </div>
      </header>

      <main className="relative overflow-hidden">
        {/* Hero */}
        <section className="relative flex flex-col items-center justify-center min-h-[100dvh] px-4 text-center pt-24 sm:pt-20">
          {/* Background elements — scoped to the hero section only (not the
              whole, much taller page) so the browser only ever has to paint
              these expensive blur layers for one screen's worth of scroll,
              instead of stretching/repainting them across the entire page. */}
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px] pointer-events-none" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-secondary/10 rounded-full blur-[100px] pointer-events-none" />

          <div className="max-w-3xl space-y-8 relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm font-medium mb-4 glow-card">
              <Sparkles className="w-4 h-4" />
              <span>A new way to share</span>
            </div>

            <h1 className="text-5xl md:text-7xl font-serif font-bold text-foreground leading-[1.1] tracking-tight">
              Send what they <span className="text-primary italic">need</span> to hear.<br/>
              Without making it weird.
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              An emotionally charged, anonymous video recommendation platform. Like slipping a handwritten note under someone's door in the digital age.
            </p>

            <div className="pt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/sign-up">
                <Button size="lg" className="rounded-full h-14 px-8 text-lg font-medium shadow-[0_0_24px_rgba(124,92,252,0.4)] hover:shadow-[0_0_40px_rgba(124,92,252,0.6)] transition-all">
                  <Send className="w-5 h-5 mr-2" /> Start Sending Whisps
                </Button>
              </Link>
            </div>
          </div>

          <div className="mt-32 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto px-4 relative z-10">
            {[
              {
                icon: Shield,
                title: "Completely Anonymous",
                desc: "They won't know it's you unless you want them to. A safe space for genuine recommendations."
              },
              {
                icon: Heart,
                title: "Emotionally Resonant",
                desc: "Attach the perfect mood tag and a brief note to set the context before they even press play."
              },
              {
                icon: Send,
                title: "Your Choice of Delivery",
                desc: "Send a private anonymous link straight to them, or drop it into Blind Circle for organic community discovery."
              }
            ].map((feature, i) => (
              <div key={i} className="p-8 rounded-3xl bg-card/40 border border-border backdrop-blur hover:bg-card/60 transition-colors">
                <feature.icon className="w-10 h-10 text-primary mb-6" />
                {/* h2, not h3: these three cards sit directly under the
                    page's single h1 with no section h2 of their own, so h3
                    here would skip a heading level. */}
                <h2 className="text-xl font-serif font-semibold mb-3">{feature.title}</h2>
                <p className="text-muted-foreground">{feature.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* See it in action */}
        <section className="relative z-10 px-4 py-20 sm:py-28">
          <div className="max-w-2xl mx-auto text-center space-y-4 mb-14">
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-foreground">
              From link to sent, in under a minute
            </h2>
            <p className="text-muted-foreground text-lg">
              Paste a video, say what you mean, and it's on its way — anonymously.
            </p>
          </div>

          <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-6">
            {[
              { src: "/screenshots/send-step1-link.png", step: "1", title: "Paste any video link", desc: "YouTube, TikTok, Instagram, Facebook — or upload your own." },
              { src: "/screenshots/send-step2-note.png", step: "2", title: "Add a note, stay anonymous", desc: "Say what you mean. They'll never know it came from you." },
              { src: "/screenshots/send-step3-sent.png", step: "3", title: "Sent — that's it", desc: "We'll let you know the moment it's seen." },
            ].map((shot) => (
              <div key={shot.step} className="flex flex-col items-center text-center">
                <div className="rounded-[2rem] border border-border/60 bg-card/40 shadow-[0_0_30px_rgba(124,92,252,0.12)] overflow-hidden w-full max-w-[220px]">
                  <img src={shot.src} alt={shot.title} className="w-full h-auto block" loading="lazy" width={390} height={844} />
                </div>
                <div className="mt-5 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-xs font-semibold flex items-center justify-center shrink-0">{shot.step}</span>
                  <h3 className="text-sm font-semibold text-foreground">{shot.title}</h3>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5 max-w-[220px]">{shot.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* No more awkwardness */}
        <section className="relative z-10 px-4 py-24 sm:py-32">
          <div className="max-w-4xl mx-auto text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm font-medium">
              <Sparkles className="w-4 h-4" />
              <span>No awkward eye contact required</span>
            </div>
            <h2 className="text-3xl md:text-5xl font-serif font-bold text-foreground leading-tight">
              The message lands. <span className="text-primary italic">Not the moment.</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              When you say something sensitive out loud, you're also managing how they react to <em>you</em> saying it.
              Blind Whisper takes you out of the room — so they can actually sit with what you meant, instead of
              studying your face while you say it.
            </p>
          </div>

          <div className="max-w-3xl mx-auto mt-16 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-6 rounded-2xl bg-card/30 border border-border/50">
              <div className="flex items-center gap-2 mb-3 text-muted-foreground">
                <X className="w-4 h-4" />
                <span className="text-sm font-medium">Saying it out loud</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                They brace for how you'll say it. You brace for how they'll take it. The message gets lost somewhere in that tension.
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-primary/10 border border-primary/30">
              <div className="flex items-center gap-2 mb-3 text-primary">
                <Check className="w-4 h-4" />
                <span className="text-sm font-medium">Whisping it instead</span>
              </div>
              <p className="text-sm text-foreground/90 leading-relaxed">
                They watch it alone, on their own time, at their own pace. Just the message — no performance, no bracing, no awkward pause after.
              </p>
            </div>
          </div>
        </section>

        {/* Use cases / illustrative scenarios */}
        <section className="relative z-10 px-4 py-24 sm:py-32 bg-card/20">
          <div className="max-w-2xl mx-auto text-center space-y-4 mb-16">
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-foreground">
              The conversations Blind Whisper makes easier
            </h2>
            <p className="text-muted-foreground text-lg">
              Every relationship has something that's easier to send than to say. Here are the kinds of moments people use Blind Whisper for.
            </p>
          </div>

          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
            {USE_CASES.map((useCase, i) => (
              <div
                key={i}
                className={`p-6 sm:p-7 rounded-3xl bg-card/50 border border-border backdrop-blur space-y-4 ${
                  i === USE_CASES.length - 1 && USE_CASES.length % 2 !== 0 ? "md:col-span-2 md:max-w-xl md:mx-auto" : ""
                }`}
              >
                <div className="flex items-center gap-2 text-primary">
                  <useCase.icon className="w-4 h-4" />
                  <span className="text-sm font-medium">{useCase.relationship}</span>
                </div>
                <p className="text-foreground/90 leading-relaxed italic">"{useCase.quote}"</p>
                <MiniWhispPreview mood={useCase.mood} />
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-muted-foreground mt-10 max-w-lg mx-auto">
            Illustrative examples of how people use Blind Whisper, not verified customer reviews.
          </p>
        </section>

        {/* FAQ */}
        <section className="relative z-10 px-4 py-24 sm:py-32">
          <div className="max-w-2xl mx-auto text-center space-y-4 mb-14">
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-foreground">
              Frequently asked questions
            </h2>
            <p className="text-muted-foreground text-lg">
              Everything people usually want to know before sending their first Whisp.
            </p>
          </div>

          {/* Plain <details>/<summary> instead of the Radix accordion
              primitive: browsers keep a closed <details>'s content in the
              DOM at all times (just CSS-hidden), so the full answer text is
              always present for crawlers and in the prerendered HTML — no
              JS, no lazy-render-on-click, and no risk of a Presence/forceMount
              edge case silently dropping collapsed answers from the markup. */}
          <div className="max-w-2xl mx-auto divide-y divide-border">
            {FAQ_ITEMS.map((item, i) => (
              <details key={i} className="group py-4">
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none text-left text-base font-serif font-semibold text-foreground hover:text-primary transition-colors [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-muted-foreground leading-relaxed">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Closing CTA */}
        <section className="relative z-10 px-4 py-24 sm:py-32 text-center">
          <div className="max-w-2xl mx-auto space-y-6">
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-foreground">
              Something you've been meaning to say?
            </h2>
            <p className="text-muted-foreground text-lg">
              You don't have to find the perfect words. Just find the video, and let it say what you meant.
            </p>
            <div className="pt-4">
              <Link href="/sign-up">
                <Button size="lg" className="rounded-full h-14 px-8 text-lg font-medium shadow-[0_0_24px_rgba(124,92,252,0.4)] hover:shadow-[0_0_40px_rgba(124,92,252,0.6)] transition-all">
                  <Send className="w-5 h-5 mr-2" /> Start Sending Whisps
                </Button>
              </Link>
            </div>
            <p className="text-sm text-muted-foreground pt-2">
              Not ready to send one?{" "}
              <Link href="/subscribe" className="text-primary hover:underline font-medium">
                Get matched with anonymous whisps on topics you pick
              </Link>
            </p>
          </div>
        </section>
      </main>

      <footer className="relative z-10 pb-8 flex justify-center gap-4 text-xs text-muted-foreground">
        <Link href="/privacy" className="hover:text-primary transition-colors">Privacy Policy</Link>
        <span className="text-border">•</span>
        <Link href="/terms" className="hover:text-primary transition-colors">Terms of Service</Link>
      </footer>

      {/* This is a signed-out visitor's only chance to see an install nudge
          outside of AppLayout (see InstallAppPrompt's own docs) — someone who
          already has the app, or a returning user browsing signed out, lands
          here rather than mid-task inside the product. */}
      <InstallAppPrompt />
    </div>
  );
}
