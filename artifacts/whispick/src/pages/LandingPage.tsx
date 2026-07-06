import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { Send, Heart, Shield, Sparkles } from "lucide-react";

export function LandingPage() {
  return (
    <div className="min-h-[100dvh] bg-background overflow-hidden relative">
      {/* Background elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-secondary/10 rounded-full blur-[100px] pointer-events-none" />
      
      <header
        className="absolute top-0 w-full px-4 sm:px-6 pb-4 sm:pb-6 flex justify-between items-center z-10 gap-2"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Logo className="w-7 h-7 sm:w-8 sm:h-8 text-primary shrink-0" />
          <span className="font-serif text-lg sm:text-2xl font-bold tracking-tight truncate">Whispick</span>
        </div>
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

      <main className="flex flex-col items-center justify-center min-h-[100dvh] px-4 text-center pt-24 sm:pt-20">
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

        <div className="mt-32 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto px-4 relative z-10 pb-24">
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
              title: "Magic Delivery",
              desc: "Send via direct link, or use Ghost Boost to deliver it organically into their social feed."
            }
          ].map((feature, i) => (
            <div key={i} className="p-8 rounded-3xl bg-card/40 border border-border backdrop-blur hover:bg-card/60 transition-colors">
              <feature.icon className="w-10 h-10 text-primary mb-6" />
              <h3 className="text-xl font-serif font-semibold mb-3">{feature.title}</h3>
              <p className="text-muted-foreground">{feature.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
