import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "@/components/ui/logo";
import { useUser, useClerk } from "@clerk/react";
import { 
  LayoutDashboard, 
  Send, 
  ListVideo, 
  MessageSquareHeart, 
  CreditCard, 
  Settings, 
  LogOut 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/send", label: "Send Whisp", icon: Send },
  { href: "/whisps", label: "My Whisps", icon: ListVideo },
  { href: "/replies", label: "Replies", icon: MessageSquareHeart },
  { href: "/credits", label: "Credits & Plan", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      <aside className="w-full md:w-64 border-r border-border bg-card/50 backdrop-blur-xl flex flex-col hidden md:flex h-screen sticky top-0">
        <div className="p-6">
          <Link href="/dashboard" className="flex items-center gap-3 text-primary hover:opacity-80 transition-opacity">
            <Logo className="w-8 h-8 text-primary" />
            <span className="font-serif text-2xl font-bold tracking-tight text-foreground">Whispick</span>
          </Link>
        </div>

        <nav className="flex-1 px-4 space-y-2 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href || location.startsWith(item.href + "/");
            const Icon = item.icon;
            
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  isActive 
                    ? "bg-primary/10 text-primary font-medium glow-card" 
                    : "text-muted-foreground hover:text-foreground hover:bg-card"
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 mt-auto">
          <Separator className="mb-4" />
          <div className="flex items-center gap-3 px-2 mb-4">
            <Avatar className="w-10 h-10 border border-border">
              <AvatarImage src={user?.imageUrl} />
              <AvatarFallback>{user?.firstName?.charAt(0) || "U"}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{user?.fullName}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.primaryEmailAddress?.emailAddress}</p>
            </div>
          </div>
          <Button 
            variant="ghost" 
            className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={() => signOut({ redirectUrl: "/" })}
          >
            <LogOut className="w-5 h-5 mr-3" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Mobile nav (simplified) */}
      <header className="md:hidden border-b border-border bg-card/80 backdrop-blur p-4 flex items-center justify-between sticky top-0 z-50">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Logo className="w-6 h-6 text-primary" />
          <span className="font-serif text-xl font-bold">Whispick</span>
        </Link>
        <Link href="/send">
          <Button size="sm" className="rounded-full shadow-[0_0_15px_rgba(124,92,252,0.3)]">
            <Send className="w-4 h-4 mr-2" /> Send
          </Button>
        </Link>
      </header>

      <main className="flex-1 overflow-x-hidden min-h-[calc(100vh-73px)] md:min-h-screen">
        <div className="max-w-5xl mx-auto p-4 md:p-8 lg:p-10">
          {children}
        </div>
      </main>
      
      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-background/90 backdrop-blur flex justify-around p-3 z-50">
        {[
          { href: "/dashboard", icon: LayoutDashboard },
          { href: "/whisps", icon: ListVideo },
          { href: "/replies", icon: MessageSquareHeart },
          { href: "/settings", icon: Settings },
        ].map((item) => {
          const isActive = location === item.href;
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={`p-2 rounded-full ${isActive ? 'bg-primary/20 text-primary' : 'text-muted-foreground'}`}>
              <Icon className="w-6 h-6" />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
