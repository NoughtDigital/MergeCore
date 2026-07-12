"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";

type MarqueeItem = {
  title: string;
  sub: string;
  accent: string;
  icon: string;
};

const svgBase = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  "aria-hidden": true as const,
};

function Icon({ kind }: { kind: string }) {
  switch (kind) {
    case "laravel":
      return (
        <svg {...svgBase} fill="currentColor">
          <path d="M1.4 8.1 6.8 5l5.4 3.1v6.2L6.8 17.4 1.4 14.3V8.1zm10.8-.1 4.7-2.7 4.7 2.7v1l-4.7 2.7-4.7-2.7V8zm0 7.2 4.7 2.7V22l-4.7-2.7v-4.1zM7 18.6l4.7 2.7V22L7 19.3v-.7z" />
        </svg>
      );
    case "filament":
      return (
        <svg {...svgBase} fill="currentColor">
          <path d="M5.5 3h5.1c4.2 0 6.9 2.3 6.9 6 0 2.5-1.3 4.4-3.5 5.3L17.5 21h-4.5l-3.4-6.5H9.2V21H5.5V3zm3.7 8.1h1.4c1.9 0 3.1-1 3.1-2.6S12.5 6 10.6 6H9.2v5.1z" />
        </svg>
      );
    case "pest":
      return (
        <svg {...svgBase} fill="currentColor">
          <path d="M12 3c1.8 0 3.2.8 4 2.1h.8c2 0 3.2 1.2 3.2 3 0 1.2-.6 2.2-1.6 2.7 1.1.7 1.8 1.8 1.8 3.2 0 2.4-2 4.1-4.9 4.1-.9 0-1.7-.2-2.4-.5-.6 1.2-1.9 2.1-3.7 2.1-2.5 0-4.2-1.6-4.2-4 0-1.2.5-2.2 1.3-2.9-.8-.7-1.3-1.7-1.3-2.9 0-1.9 1.3-3.2 3.3-3.2h.6C8.7 3.9 10.1 3 12 3zm-.9 4.5c-.8.8-1.2 1.9-1.2 3.3v2.4c0 1.4.4 2.5 1.2 3.3.8-.8 1.2-1.9 1.2-3.3v-2.4c0-1.4-.4-2.5-1.2-3.3z" />
        </svg>
      );
    case "livewire":
      return (
        <svg {...svgBase} fill="currentColor">
          <path d="M4.2 5.2c2.8-2.1 6.6-1.7 8.9.9l.4.5.4-.5c2.3-2.6 6.1-3 8.9-.9 2.5 1.9 3.1 5.3 1.5 8.1L13.5 21.2 2.7 13.3C1.1 10.5 1.7 7.1 4.2 5.2zm8.1 4.1-1.7 6.3 5.3-3.5-3.6-2.8z" />
        </svg>
      );
    case "alpine":
      return (
        <svg {...svgBase} fill="currentColor">
          <path d="M12 3.2 2.5 20.8h3.9L12 9.4l5.6 11.4h3.9L12 3.2zm0 8.4-2.8 5.8h5.6L12 11.6z" />
        </svg>
      );
    case "react":
      return (
        <svg {...svgBase} fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
          <ellipse cx="12" cy="12" rx="10" ry="4.2" />
          <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)" />
          <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)" />
        </svg>
      );
    case "typescript":
      return (
        <svg {...svgBase} fill="currentColor">
          <path d="M1.5 1.5h21v21h-21v-21zm11.2 9.4H9.3v1.7h2.1c-.1 2.3-.9 3.9-3.3 3.9-2.1 0-3.5-1.5-3.5-3.8s1.4-3.9 3.6-3.9c1.2 0 2.2.4 2.9 1.1l1.4-1.5C11.4 7.1 10 6.4 8.2 6.4c-3.4 0-5.8 2.5-5.8 5.8s2.4 5.8 5.7 5.8c3.5 0 5.4-2.3 5.6-5.5v-.2h-.01zm8.1-.2h-2.3V8.4h-2.1v2.3H14v2.1h2.4v4.9h2.1v-4.9h2.3v-2.1z" />
        </svg>
      );
    case "vue":
      return (
        <svg {...svgBase} fill="currentColor">
          <path d="M1.5 3.5h4.3L12 14.2 18.2 3.5h4.3L12 21.2 1.5 3.5zm6.2 0h3.1L12 7.4l1.2-3.9h3.1L12 12.1 7.7 3.5z" />
        </svg>
      );
    case "python":
      return (
        <svg {...svgBase} fill="currentColor">
          <path d="M12 2.2c-2.9 0-2.7 1.3-2.7 1.3v1.9h2.8v.3H7.3S4.5 5.5 4.5 9.3c0 3.8 2.1 3.6 2.1 3.6h1.3v-1.7s-.1-2 2.2-2h3.8s2.1.1 2.1-2V4.8S16.4 2.2 12 2.2zm-1.5 1.2a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6z" />
          <path d="M12 21.8c2.9 0 2.7-1.3 2.7-1.3v-1.9h-2.8v-.3h4.8s2.8.2 2.8-3.6c0-3.8-2.1-3.6-2.1-3.6h-1.3v1.7s.1 2-2.2 2H9.9s-2.1-.1-2.1 2v3.4s-.4 2.6 4.2 2.6zm1.5-1.2a.8.8 0 1 1 0-1.6.8.8 0 0 1 0 1.6z" />
        </svg>
      );
    case "pytorch":
      return (
        <svg {...svgBase} fill="currentColor">
          <path d="M12.1 2.3c.4 0 .8.2 1 .5l2.2 3.1c.5-.3 1.1-.4 1.7-.4 2.4 0 4.3 1.9 4.3 4.3 0 .4 0 .7-.1 1.1 1.3.8 2.1 2.2 2.1 3.8 0 2.5-2 4.5-4.5 4.5-.5 0-1-.1-1.4-.2-.7 1.7-2.4 2.9-4.4 2.9-1.9 0-3.5-1.1-4.3-2.7-.5.2-1 .3-1.6.3-2.5 0-4.5-2-4.5-4.5 0-1.5.7-2.8 1.9-3.6-.1-.4-.2-.8-.2-1.2 0-2.4 1.9-4.3 4.3-4.3.5 0 1 .1 1.5.3L11 2.8c.3-.3.7-.5 1.1-.5zm0 4.5-2.2 3.1c.5.5.8 1.2.8 1.9 0 1.5-1.2 2.7-2.7 2.7S5.3 13.3 5.3 11.8c0-.4.1-.8.3-1.1C4.8 11 4.5 11.6 4.5 12.4c0 1.4 1.1 2.5 2.5 2.5.4 0 .8-.1 1.1-.3.5 1.4 1.8 2.4 3.4 2.4 1.5 0 2.8-.9 3.3-2.2.4.2.8.3 1.3.3 1.4 0 2.5-1.1 2.5-2.5 0-.8-.4-1.5-.9-2 .2-.3.3-.7.3-1.1 0-1.5-1.2-2.7-2.7-2.7-.6 0-1.1.2-1.6.5L12.1 6.8z" />
        </svg>
      );
    case "go":
      return (
        <svg {...svgBase} fill="currentColor">
          <path d="M3.2 9.2h2.4c.2-1.3 1-2.1 2.3-2.1.9 0 1.5.4 1.5 1.1 0 .6-.4 1-1.3 1.2l-1.3.3c-1.7.4-2.6 1.3-2.6 2.8 0 1.7 1.2 2.8 3.1 2.8 1.4 0 2.5-.6 3.1-1.7l-1.4-.8c-.3.6-.9.9-1.6.9-.8 0-1.3-.4-1.3-1 0-.5.3-.8 1.1-1l1.4-.3c2-.5 2.9-1.5 2.9-3.1 0-1.9-1.5-3.1-3.6-3.1-2.3 0-3.9 1.3-4.3 3.4zm9.5 6.5h1.7l.3-1.5h.1c.5.9 1.4 1.6 2.7 1.6 2.3 0 3.7-1.8 3.7-4.5S19.8 7 17.6 7c-1.2 0-2.1.5-2.7 1.4h-.1l.3-3.1h-1.7l-1 10.4zm4.1-1.5c-1.2 0-2-.9-2-2.4s.8-2.4 2-2.4 2 .9 2 2.4-.8 2.4-2 2.4z" />
        </svg>
      );
    case "tauri":
      return (
        <svg {...svgBase} fill="currentColor">
          <path d="M12 2.4c1.4 0 2.6.5 3.5 1.4L12 12l-3.5-8.2C9.4 2.9 10.6 2.4 12 2.4zm0 19.2c-1.4 0-2.6-.5-3.5-1.4L12 12l3.5 8.2c-.9.9-2.1 1.4-3.5 1.4zM3.8 8.5c.9-1.1 2.2-1.8 3.7-1.8L12 12 4.8 14.8c-.9-1.1-1.3-2.5-1-3.9.1-.8.4-1.6 1-2.4zm16.4 0c.6.8.9 1.6 1 2.4.3 1.4-.1 2.8-1 3.9L12 12l4.5-5.3c1.5 0 2.8.7 3.7 1.8z" />
        </svg>
      );
    case "swift":
      return (
        <svg {...svgBase} fill="currentColor">
          <path d="M17.8 2.6c.3.4.7 1.2.7 2.2 0 3.5-2.9 8.1-7.4 11.6-1.3 1-2.7 1.8-4.1 2.3 2.4.5 5 .2 7.3-1.2 3.6-2.1 6-5.5 6.5-9.1.6 1.3.9 2.7.9 4.1 0 5.7-4.6 10.3-10.3 10.3-2.2 0-4.2-.7-5.9-1.9C2.5 18.6 1.5 14.8 3 11.4c1.1 1.9 2.7 3.5 4.6 4.7C5.6 12.8 5 9.2 6.2 6.3c.4 1.1 1.1 2.2 2 3.1C8.5 5.5 10.6 2.8 14 2.2c1.1-.2 2.6-.1 3.8.4z" />
        </svg>
      );
    case "swiftui":
      return (
        <svg {...svgBase} fill="currentColor">
          <path d="M6.2 3.5h11.6c1.5 0 2.7 1.2 2.7 2.7v11.6c0 1.5-1.2 2.7-2.7 2.7H6.2c-1.5 0-2.7-1.2-2.7-2.7V6.2c0-1.5 1.2-2.7 2.7-2.7zm5.6 3.4c.2.3.5.8.5 1.5 0 2.3-1.9 5.3-4.8 7.6 1.6.3 3.3.1 4.8-.8 2.4-1.4 3.9-3.6 4.2-6-.1.9-.3 1.7-.7 2.5-.8 1.9-2.5 3.3-4.6 3.8 1.5.7 3.3.8 4.9.2 1.1-.4 2-1.1 2.7-2-1.2 2.3-3.6 3.9-6.4 3.9-2.9 0-5.4-1.7-6.5-4.1.8 1.2 1.9 2.2 3.2 2.8C7.5 12.4 7.2 9.8 8.2 7.9c.3.8.8 1.5 1.4 2.1.2-2.3 1.5-4.1 3.5-4.7.6-.1 1.4-.1 2 .2-.4.3-.8.7-1.1 1.2-.1.2-.2.3-.2.4z" />
        </svg>
      );
    case "node":
      return (
        <svg {...svgBase} fill="currentColor">
          <path d="M12 1.8 3.6 6.6v10.8L12 22.2l8.4-4.8V6.6L12 1.8zm0 2.3 6.1 3.5v7l-2.1 1.2V10L12 12.3 7.9 10v5.8L5.9 14.6v-7L12 4.1zm0 8.3 2.7-1.5v3.1L12 15.8l-2.7-1.5v-3.1L12 12.4z" />
        </svg>
      );
    case "frameworks":
      return (
        <svg {...svgBase} fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M8 9h8M8 13h5" />
        </svg>
      );
    case "tests":
      return (
        <svg {...svgBase} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M9 3h6M10 9h4M8 3v6l-4 8a2 2 0 0 0 1.8 3h12.4a2 2 0 0 0 1.8-3l-4-8V3" />
        </svg>
      );
    case "domain":
      return (
        <svg {...svgBase} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M13 2 3 14h7l-1 8 10-12h-7z" />
        </svg>
      );
    default:
      return (
        <svg {...svgBase} fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}

function Card({ item, prominent }: { item: MarqueeItem; prominent: boolean }) {
  return (
    <article className={`flex-card${prominent ? " prominent" : ""}`}>
      <div className={`flex-icon ${item.accent}`}>
        <Icon kind={item.icon} />
      </div>
      <div className="flex-info">
        <div className="flex-title">{item.title}</div>
        <div className="flex-sub">{item.sub}</div>
      </div>
    </article>
  );
}

/** Repeat short lists so one set always fills wide viewports. */
function expandItems(items: MarqueeItem[], minCards = 12): MarqueeItem[] {
  if (items.length >= minCards) {
    return items;
  }

  const expanded: MarqueeItem[] = [];
  while (expanded.length < minCards) {
    expanded.push(...items);
  }
  return expanded;
}

export function RulePackMarqueeRow({
  items,
  direction,
  duration,
  delayMs = 0,
}: {
  items: MarqueeItem[];
  direction: "left" | "right";
  duration: number;
  delayMs?: number;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [distance, setDistance] = useState(0);
  const [ready, setReady] = useState(false);
  const loopItems = expandItems(items);
  const itemsKey = items.map((item) => item.title).join("|");

  useEffect(() => {
    const measure = () => {
      if (!contentRef.current) {
        return;
      }

      const nextDistance = contentRef.current.offsetWidth;
      if (nextDistance > 0) {
        setDistance(nextDistance);
        requestAnimationFrame(() => setReady(true));
      }
    };

    measure();

    const observer =
      typeof ResizeObserver !== "undefined" && contentRef.current
        ? new ResizeObserver(() => {
            setReady(false);
            measure();
          })
        : null;

    if (observer && contentRef.current) {
      observer.observe(contentRef.current);
    }

    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [itemsKey]);

  const style = {
    "--marquee-distance": `${distance}px`,
    "--marquee-duration": `${duration}s`,
    animationDelay: `${delayMs}ms`,
  } as CSSProperties;

  // Always animate 0 → -distance (flush left). Flip the row for rightward motion.
  return (
    <div className={`marquee-row-clip row-enter${ready ? " is-ready" : ""}`} style={style}>
      <div className={direction === "right" ? "marquee-dir-right" : undefined}>
        <div className={`marquee-track marquee-left${ready ? " is-ready" : ""}`}>
          <div className="marquee-content" ref={contentRef}>
            {loopItems.map((item, index) => (
              <Card
                key={`${item.title}-${index}`}
                item={item}
                prominent={index % items.length === 2}
              />
            ))}
          </div>
          <div className="marquee-content" aria-hidden="true">
            {loopItems.map((item, index) => (
              <Card
                key={`${item.title}-clone-${index}`}
                item={item}
                prominent={index % items.length === 2}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
