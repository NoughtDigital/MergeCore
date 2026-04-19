import { homepageCopy } from "@/lib/copy";

const c = homepageCopy;

const currentRulePacks = [
  {
    title: "Laravel Core",
    sub: "Production rules",
    accent: "green",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
      </svg>
    ),
  },
  {
    title: "Filament",
    sub: "Admin & panels",
    accent: "blue",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="16" rx="2"></rect>
        <path d="M8 9h8M8 13h5"></path>
      </svg>
    ),
  },
  {
    title: "Pest",
    sub: "Testing rules",
    accent: "purple",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 3h6"></path>
        <path d="M10 9h4"></path>
        <path d="M8 3v6l-4 8a2 2 0 0 0 1.8 3h12.4a2 2 0 0 0 1.8-3l-4-8V3"></path>
      </svg>
    ),
  },
  {
    title: "Livewire",
    sub: "Component behaviour",
    accent: "cyan",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 12h4l3 8 4-16 3 8h4"></path>
      </svg>
    ),
  },
  {
    title: "Alpine",
    sub: "Blade frontend rules",
    accent: "orange",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m4 15 4-6 4 4 4-8 4 10"></path>
      </svg>
    ),
  },
];

const futureRulePacks = [
  {
    title: "TypeScript",
    sub: "App & service rules",
    accent: "blue",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 5h16v14H4z"></path>
        <path d="M9 9h6M12 9v8M9 17h6"></path>
      </svg>
    ),
  },
  {
    title: "React",
    sub: "Frontend review packs",
    accent: "cyan",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="1.5"></circle>
        <path d="M19.4 11.1c.5 2.5-.7 4.9-3.1 6.1-2.6 1.3-6 1.5-8.3-.2-2-1.5-2.7-4.3-1.8-6.6 1-2.6 3.6-4.9 6.3-5.7 2.5-.7 5.4-.3 6.9 1.9 1 1.4 1.2 3 .9 4.5Z"></path>
      </svg>
    ),
  },
  {
    title: "Node",
    sub: "Backend JS services",
    accent: "green",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2 4 7v10l8 5 8-5V7z"></path>
        <path d="M9 10v4M15 10v4M9 14h6"></path>
      </svg>
    ),
  },
  {
    title: "Python",
    sub: "Services & data work",
    accent: "yellow",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M8 7a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2H8z"></path>
        <path d="M16 17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2h8z"></path>
        <circle cx="10" cy="8.5" r="0.5"></circle>
        <circle cx="14" cy="15.5" r="0.5"></circle>
      </svg>
    ),
  },
  {
    title: "Go",
    sub: "Modules & APIs",
    accent: "teal",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 12h8"></path>
        <path d="M4 8h10"></path>
        <path d="M4 16h7"></path>
        <circle cx="16.5" cy="12" r="3.5"></circle>
      </svg>
    ),
  },
  {
    title: "Horizon & Octane",
    sub: "Deeper Laravel ops",
    accent: "red",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M13 2 3 14h7l-1 8 10-12h-7z"></path>
      </svg>
    ),
  },
];

const packArtifacts = [
  {
    title: "pack.json",
    sub: "Manifest & wiring",
    body: "The pack manifest tells MergeCore what the pack is called, which version it is, which files it publishes, and how hosts should resolve the rest of the pack.",
    details: [
      "Defines metadata like pack ID, title, version, tags, and compatibility details.",
      "Points at the files the pack exposes, such as rubric, smells, and agent instructions.",
      "Acts as the single lookup point when a host wants to load the pack correctly.",
    ],
  },
  {
    title: "rubric.json",
    sub: "Rules & scoring",
    body: "This is the scoring source of truth. It defines the rules, severities, penalties, and detection hints that shape how MergeCore judges a change.",
    details: [
      "Holds stable rule IDs, categories, titles, descriptions, and severity levels.",
      "Controls how findings affect score so review output stays consistent and traceable.",
      "Lets packs gate or tune rules for stack-specific contexts like Filament or Pest.",
    ],
  },
  {
    title: "smells.json",
    sub: "Human-facing shorthand",
    body: "The smell index translates deeper rules into named patterns people recognise quickly, which helps with triage, wording, and fix guidance.",
    details: [
      "Maps named smells back to rubric rules through rule references.",
      "Adds quick summaries, layers, and typical-fix guidance for common problems.",
      "Keeps reviewer wording practical without losing the rule-level source underneath.",
    ],
  },
  {
    title: "agents.md",
    sub: "How reviewers should think",
    body: "Agent instructions explain tone, priorities, evidence rules, and how the reviewer should apply the pack instead of just dumping raw rule text.",
    details: [
      "Defines stance like security before style and evidence before invention.",
      "Keeps AI-assisted review aligned with the same language and standards across teams.",
      "Bridges the gap between structured rules and useful, readable feedback.",
    ],
  },
];

function MarqueeRow({
  items,
  className,
}: {
  items: typeof currentRulePacks;
  className: string;
}) {
  return (
    <div className={`marquee-track ${className}`}>
      <div className="marquee-content">
        {items.map((item, index) => (
          <article
            key={`${item.title}-${index}`}
            className={`flex-card${index === 2 ? " prominent" : ""}`}
          >
            <div className={`flex-icon ${item.accent}`}>{item.icon}</div>
            <div className="flex-info">
              <div className="flex-title">{item.title}</div>
              <div className="flex-sub">{item.sub}</div>
            </div>
          </article>
        ))}
      </div>
      <div className="marquee-content" aria-hidden="true">
        {items.map((item, index) => (
          <article
            key={`${item.title}-clone-${index}`}
            className={`flex-card${index === 2 ? " prominent" : ""}`}
          >
            <div className={`flex-icon ${item.accent}`}>{item.icon}</div>
            <div className="flex-info">
              <div className="flex-title">{item.title}</div>
              <div className="flex-sub">{item.sub}</div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <header>
        <div className="wrap header-inner">
          <div className="logo">
            MergeCore<span>.dev</span>
          </div>
          <a className="nav-cta" href="#setup-heading">
            {c.hero.primaryCta}
          </a>
        </div>
      </header>

      <main>
        <div className="wrap hero">
          <p className="hero-badge">{c.hero.badge}</p>
          <h1>{c.hero.headline}</h1>
          <p className="hero-sub">{c.hero.subheadline}</p>
          <div className="hero-actions">
            <a className="btn-primary" href="#setup-heading">
              {c.hero.primaryCta}
            </a>
            <a className="btn-ghost" href="#features-heading">
              {c.hero.secondaryCta}
            </a>
          </div>
        </div>

        <section aria-labelledby="panel-heading">
          <div className="wrap">
            <p className="section-label" id="panel-eyebrow">
              {c.panelOverview.eyebrow}
            </p>
            <h2 id="panel-heading">{c.panelOverview.headline}</h2>
            <p className="lead">{c.panelOverview.body}</p>
            <div className="plugin-panel">
              <code>{c.panelOverview.commandLine}</code>
              <p>{c.panelOverview.panelNote}</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="features-heading">
          <div className="wrap">
            <p className="section-label">{c.featuresIntro.eyebrow}</p>
            <h2 id="features-heading">{c.featuresIntro.headline}</h2>
            <p className="lead">{c.featuresIntro.body}</p>
            <div className="grid grid-2">
              {c.features.map((feature) => (
                <article key={feature.title} className="card">
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="marquee-section" aria-labelledby="capabilities-heading">
          <div className="wrap">
            <div className="marquee-header">
              <div className="marquee-label">
                <span>{"// Rule Packs"}</span>
              </div>
              <div>
                <h2 id="capabilities-heading">Current rule packs, plus the next wave on the roadmap.</h2>
                <p className="lead">
                  Shipping today from the repo: Laravel Core, Filament, Pest, Livewire, and Alpine.
                  Planned next from the roadmap: TypeScript, React, Node, Python, Go, and deeper
                  Laravel ops coverage.
                </p>
              </div>
            </div>
          </div>

          <div className="marquee-container">
            <div className="marquee-row-label">Current rule packs</div>
            <div className="marquee-row-clip row-enter row-enter-1">
              <MarqueeRow items={currentRulePacks} className="track-1" />
            </div>
            <div className="marquee-row-label future">Future rule packs</div>
            <div className="marquee-row-clip row-enter row-enter-2">
              <MarqueeRow items={futureRulePacks} className="track-2" />
            </div>
          </div>
        </section>

        <section aria-labelledby="packs-heading">
          <div className="wrap">
            <p className="section-label">How Packs Work</p>
            <h2 id="packs-heading">Rule packs are structured, not hand-wavy.</h2>
            <p className="lead">
              MergeCore packs are made of a few clear files with different jobs: one says what the
              pack is, one defines the rules and scoring, one gives human shorthand for common
              problems, and one explains how an AI reviewer should apply the pack in practice.
            </p>
            <div className="grid grid-2 pack-grid">
              {packArtifacts.map((artifact) => (
                <article key={artifact.title} className="card pack-card">
                  <p className="pack-kicker">{artifact.sub}</p>
                  <h3>{artifact.title}</h3>
                  <p>{artifact.body}</p>
                  <ul className="pack-points">
                    {artifact.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="modes-heading">
          <div className="wrap">
            <p className="section-label">{c.reviewModesIntro.eyebrow}</p>
            <h2 id="modes-heading">{c.reviewModesIntro.headline}</h2>
            <p className="lead">{c.reviewModesIntro.body}</p>
            <div className="grid grid-2">
              {c.reviewModes.map((mode) => (
                <article key={mode.command} className="card">
                  <h3>{mode.title}</h3>
                  <p>{mode.body}</p>
                  <p className="card-meta">
                    <code>{mode.command}</code>
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="setup-heading">
          <div className="wrap">
            <p className="section-label">{c.setupIntro.eyebrow}</p>
            <h2 id="setup-heading">{c.setupIntro.headline}</h2>
            <div className="pricing">
              <p className="lead">{c.setupIntro.body}</p>
              <ul className="info-list">
                {c.setupItems.map((item) => (
                  <li key={item.label}>
                    <strong>{item.label}.</strong> {item.body}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="final-cta" aria-labelledby="final-heading">
          <div className="wrap">
            <h2 id="final-heading">{c.finalCta.headline}</h2>
            <p className="lead">{c.finalCta.body}</p>
            <a className="btn-primary" href="#features-heading">
              {c.finalCta.button}
            </a>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <p>{c.footer.tagline}</p>
        </div>
      </footer>
    </>
  );
}
