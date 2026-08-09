import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // bg-surface-2 (Surface Elevated) + transparent border by
          // default; focus swaps in an accent-primary border and a soft
          // violet glow instead of the old plain ring.
          "flex w-full min-h-11 rounded-[14px] border border-transparent bg-surface-2 px-4 py-[14px] text-base leading-tight transition-all duration-200 ease-out file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-tertiary-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_rgba(123,97,255,0.15)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
