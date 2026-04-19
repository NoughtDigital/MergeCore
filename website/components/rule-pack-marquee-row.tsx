"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";

type MarqueeItem = {
  title: string;
  sub: string;
  accent: string;
  icon: string;
};

function Icon({ kind }: { kind: string }) {
  const common = {
    xmlns: "http://www.w3.org/2000/svg",
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
  };

  switch (kind) {
    case "hex":
      return (
        <svg {...common}>
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
        </svg>
      );
    case "panel":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2"></rect>
          <path d="M8 9h8M8 13h5"></path>
        </svg>
      );
    case "flask":
      return (
        <svg {...common}>
          <path d="M9 3h6"></path>
          <path d="M10 9h4"></path>
          <path d="M8 3v6l-4 8a2 2 0 0 0 1.8 3h12.4a2 2 0 0 0 1.8-3l-4-8V3"></path>
        </svg>
      );
    case "pulse":
      return (
        <svg {...common}>
          <path d="M3 12h4l3 8 4-16 3 8h4"></path>
        </svg>
      );
    case "mountain":
      return (
        <svg {...common}>
          <path d="m4 15 4-6 4 4 4-8 4 10"></path>
        </svg>
      );
    case "ts":
      return (
        <svg {...common}>
          <path d="M4 5h16v14H4z"></path>
          <path d="M9 9h6M12 9v8M9 17h6"></path>
        </svg>
      );
    case "react":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="1.5"></circle>
          <path d="M19.4 11.1c.5 2.5-.7 4.9-3.1 6.1-2.6 1.3-6 1.5-8.3-.2-2-1.5-2.7-4.3-1.8-6.6 1-2.6 3.6-4.9 6.3-5.7 2.5-.7 5.4-.3 6.9 1.9 1 1.4 1.2 3 .9 4.5Z"></path>
        </svg>
      );
    case "node":
      return (
        <svg {...common}>
          <path d="M12 2 4 7v10l8 5 8-5V7z"></path>
          <path d="M9 10v4M15 10v4M9 14h6"></path>
        </svg>
      );
    case "python":
      return (
        <svg {...common}>
          <path d="M8 7a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2H8z"></path>
          <path d="M16 17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2h8z"></path>
          <circle cx="10" cy="8.5" r="0.5"></circle>
          <circle cx="14" cy="15.5" r="0.5"></circle>
        </svg>
      );
    case "go":
      return (
        <svg {...common}>
          <path d="M4 12h8"></path>
          <path d="M4 8h10"></path>
          <path d="M4 16h7"></path>
          <circle cx="16.5" cy="12" r="3.5"></circle>
        </svg>
      );
    case "bolt":
      return (
        <svg {...common}>
          <path d="M13 2 3 14h7l-1 8 10-12h-7z"></path>
        </svg>
      );
    default:
      return null;
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

  useEffect(() => {
    const measure = () => {
      if (!contentRef.current) {
        return;
      }

      const nextDistance = contentRef.current.getBoundingClientRect().width;
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
  }, []);

  const style = {
    "--marquee-distance": `${distance}px`,
    "--marquee-duration": `${duration}s`,
    animationDelay: `${delayMs}ms`,
  } as CSSProperties;

  return (
    <div className={`marquee-row-clip row-enter${ready ? " is-ready" : ""}`} style={style}>
      <div className={`marquee-track marquee-${direction}${ready ? " is-ready" : ""}`}>
        <div className="marquee-content" ref={contentRef}>
          {items.map((item, index) => (
            <Card key={`${item.title}-${index}`} item={item} prominent={index === 2} />
          ))}
        </div>
        <div className="marquee-content" aria-hidden="true">
          {items.map((item, index) => (
            <Card key={`${item.title}-clone-${index}`} item={item} prominent={index === 2} />
          ))}
        </div>
      </div>
    </div>
  );
}
