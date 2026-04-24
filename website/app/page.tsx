import { homepageCopy } from "@/lib/copy";
import { RulePackMarqueeRow } from "@/components/rule-pack-marquee-row";

const c = homepageCopy;

const currentRulePacks = [
  {
    title: "TypeScript",
    sub: "Type & app rules",
    accent: "blue",
    icon: "ts",
  },
  {
    title: "React",
    sub: "Component review",
    accent: "cyan",
    icon: "react",
  },
  {
    title: "Python",
    sub: "Service rules",
    accent: "yellow",
    icon: "python",
  },
  {
    title: "Go",
    sub: "API & concurrency",
    accent: "teal",
    icon: "go",
  },
  {
    title: "Swift",
    sub: "App rules",
    accent: "purple",
    icon: "hex",
  },
];

const futureRulePacks = [
  {
    title: "More Frameworks",
    sub: "Web & app packs",
    accent: "green",
    icon: "panel",
  },
  {
    title: "More Test Runners",
    sub: "Coverage & quality",
    accent: "purple",
    icon: "flask",
  },
  {
    title: "Node",
    sub: "Backend JS services",
    accent: "green",
    icon: "node",
  },
  {
    title: "Domain Packs",
    sub: "Team-specific rules",
    accent: "red",
    icon: "bolt",
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
                  Shipping today from the repo: language, framework, testing, frontend, backend,
                  mobile, and systems packs. Planned next: more community packs, domain packs, and
                  stronger pack resolution.
                </p>
              </div>
            </div>
          </div>

          <div className="marquee-container">
            <div className="marquee-row-label">Current rule packs</div>
            <RulePackMarqueeRow
              items={currentRulePacks}
              direction="left"
              duration={40}
              delayMs={120}
            />
            <div className="marquee-row-label future">Future rule packs</div>
            <RulePackMarqueeRow
              items={futureRulePacks}
              direction="right"
              duration={46}
              delayMs={260}
            />
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

        <section aria-labelledby="personas-heading">
          <div className="wrap">
            <p className="section-label">{c.personasIntro.eyebrow}</p>
            <h2 id="personas-heading">{c.personasIntro.headline}</h2>
            <p className="lead">{c.personasIntro.body}</p>
            <div className="persona-grid">
              {c.personas.map((persona) => (
                <article key={persona.id} className="card persona-card">
                  <div className="persona-header">
                    <span className="persona-badge">{persona.badge}</span>
                    <h3>{persona.title}</h3>
                  </div>
                  <p>{persona.tagline}</p>
                  <ul className="persona-focus">
                    {persona.focus.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="levels-heading">
          <div className="wrap">
            <p className="section-label">{c.reviewLevelsIntro.eyebrow}</p>
            <h2 id="levels-heading">{c.reviewLevelsIntro.headline}</h2>
            <p className="lead">{c.reviewLevelsIntro.body}</p>
            <div className="level-grid">
              {c.reviewLevels.map((level) => (
                <article key={level.id} className="card level-card">
                  <div className="level-header">
                    <span className="level-badge">{level.badge}</span>
                    <span className="level-scope">{level.scope}</span>
                  </div>
                  <h3>{level.title}</h3>
                  <p>{level.tagline}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="inline-heading">
          <div className="wrap">
            <p className="section-label">{c.inlineCommentsIntro.eyebrow}</p>
            <h2 id="inline-heading">{c.inlineCommentsIntro.headline}</h2>
            <p className="lead">{c.inlineCommentsIntro.body}</p>
            <div className="inline-examples">
              {c.inlineCommentExamples.map((example) => (
                <article key={example.label} className="card inline-card">
                  <p className="pack-kicker">{example.label}</p>
                  <div className="inline-row inline-before">
                    <span className="inline-tag weak">Weak</span>
                    <p>{example.before}</p>
                  </div>
                  <div className="inline-row inline-after">
                    <span className="inline-tag strong">Strong</span>
                    <p>{example.after}</p>
                  </div>
                  <p className="inline-note">{example.note}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="memory-heading">
          <div className="wrap">
            <p className="section-label">{c.memoryIntro.eyebrow}</p>
            <h2 id="memory-heading">{c.memoryIntro.headline}</h2>
            <p className="lead">{c.memoryIntro.body}</p>
            <div className="grid grid-2">
              {c.memorySignals.map((signal) => (
                <article key={signal.title} className="card">
                  <h3>{signal.title}</h3>
                  <p>{signal.body}</p>
                </article>
              ))}
            </div>
            <div className="plugin-panel memory-panel">
              <p>{c.memoryNote}</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="prod-risks-heading">
          <div className="wrap">
            <p className="section-label">{c.prodRisksIntro.eyebrow}</p>
            <h2 id="prod-risks-heading">{c.prodRisksIntro.headline}</h2>
            <p className="lead">{c.prodRisksIntro.body}</p>
            <div className="prod-risks-grid">
              {c.prodRiskCategories.map((risk) => (
                <article key={risk.id} className="card risk-card">
                  <div className="risk-header">
                    <span className="risk-tag">{risk.id}</span>
                  </div>
                  <h3>{risk.title}</h3>
                  <p>{risk.body}</p>
                </article>
              ))}
            </div>
            <div className="plugin-panel memory-panel">
              <p>{c.prodRisksNote}</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="teaching-heading">
          <div className="wrap">
            <p className="section-label">{c.teachingIntro.eyebrow}</p>
            <h2 id="teaching-heading">{c.teachingIntro.headline}</h2>
            <p className="lead">{c.teachingIntro.body}</p>
            <div className="inline-examples">
              {c.teachingExamples.map((example) => (
                <article key={example.label} className="card inline-card">
                  <p className="pack-kicker">{example.label}</p>
                  <div className="inline-row inline-before">
                    <span className="inline-tag weak">Weak</span>
                    <p>{example.weak}</p>
                  </div>
                  <div className="inline-row inline-after">
                    <span className="inline-tag strong">Teaches</span>
                    <p>{example.strong}</p>
                  </div>
                  {example.sideEffectTag ? (
                    <p className="inline-note">
                      <span className="side-effect-tag">{example.sideEffectTag}</span>
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
            <div className="plugin-panel memory-panel">
              <p>{c.teachingNote}</p>
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
          <p className="footer-credit">
            {c.footer.madeBy.prefix}{" "}
            <a
              href={c.footer.madeBy.href}
              rel="noopener noreferrer"
              target="_blank"
            >
              {c.footer.madeBy.linkLabel}
            </a>
            .
          </p>
        </div>
      </footer>
    </>
  );
}
