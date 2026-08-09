import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Calm, precise motion only — no bounce/elastic easing anywhere. Every
  // variant is pill-shaped (rounded-full) per the design spec; sizes below
  // no longer override that with a sharper radius.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
" hover:scale-[1.02] active:scale-[0.98]",
  {
    variants: {
      variant: {
        default:
          // Accent gradient fill, soft violet glow, brightens on hover.
          "bg-[linear-gradient(135deg,hsl(var(--primary))_0%,hsl(var(--primary-hover))_100%)] text-primary-foreground shadow-[0_4px_20px_rgba(123,97,255,0.3)] hover:shadow-[0_6px_28px_rgba(123,97,255,0.4)] hover:brightness-110",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:brightness-110",
        outline:
          // Transparent bg, subtle violet-tinted border, brightens to
          // accent-primary on hover — no fill change, no shadow.
          "border-[1.5px] border-primary/20 bg-transparent text-muted-foreground hover:border-primary hover:text-foreground",
        secondary:
          // Transparent bg, border-subtle, secondary (muted) text — same
          // calm outline treatment as `outline`, just semantically distinct.
          "border-[1.5px] border-primary/12 bg-transparent text-muted-foreground hover:border-primary hover:text-foreground",
        ghost: "border border-transparent hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline rounded-md",
      },
      size: {
        default: "min-h-9 px-5 py-2",
        sm: "min-h-8 px-4 text-xs",
        lg: "min-h-11 px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
