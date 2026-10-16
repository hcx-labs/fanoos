import type { ReactNode } from "react";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

/**
 * A titled row that scrolls sideways. The arrows sit in the header, next to the title's own
 * actions, instead of floating over the artwork; they hide when there's nowhere to go.
 */
export function Shelf<T>({
  id,
  title,
  meta,
  actions,
  items,
  itemKey,
  render,
  itemClassName = "basis-[78%] sm:basis-1/2 lg:basis-1/3 xl:basis-1/4",
  className,
}: {
  id: string;
  title: ReactNode;
  /** Small text after the title (a count, a service). */
  meta?: ReactNode;
  actions?: ReactNode;
  items: T[];
  itemKey: (item: T) => string;
  render: (item: T) => ReactNode;
  itemClassName?: string;
  className?: string;
}) {
  const arrow = "static size-8 translate-y-0 border-0 bg-secondary text-foreground shadow-none hover:bg-accent disabled:opacity-35";
  return (
    <section className={cn("mt-12", className)} aria-labelledby={id}>
      <Carousel opts={{ align: "start", dragFree: true }}>
        <div className="mb-4 flex items-center gap-3">
          <h2 id={id} className="font-display text-xl font-semibold">
            {title}
          </h2>
          {meta}
          <div className="ml-auto flex items-center gap-1">
            {actions}
            <div className={cn("hidden items-center gap-1 sm:flex", actions ? "ml-2" : "")}>
              <CarouselPrevious className={arrow} />
              <CarouselNext className={arrow} />
            </div>
          </div>
        </div>
        <CarouselContent className="-ml-4">
          {items.map((item) => (
            <CarouselItem key={itemKey(item)} className={cn("pl-4", itemClassName)}>
              {render(item)}
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </section>
  );
}
