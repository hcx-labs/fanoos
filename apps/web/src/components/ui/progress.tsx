import type { ComponentProps } from "react";
import { Progress as ProgressPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Progress({ className, value = 0, segments, ...props }: ComponentProps<typeof ProgressPrimitive.Root> & { segments?: { value: number; className: string }[] }) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn("bg-secondary relative h-2 w-full overflow-hidden rounded-full", className)}
      value={value}
      {...props}
    >
      {segments ? <div className="flex h-full w-full" aria-hidden>{segments.map((segment, index) => <span key={index} className={cn("h-full", segment.className)} style={{ width: `${Math.min(100, Math.max(0, segment.value))}%` }} />)}</div> : <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="bg-brand h-full w-full transition-transform"
        style={{ transform: `translateX(-${100 - Math.min(100, Math.max(0, value ?? 0))}%)` }}
      />}
    </ProgressPrimitive.Root>
  );
}

export { Progress };
