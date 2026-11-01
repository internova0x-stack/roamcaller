import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

// Renders a legal document from apps/web/content/<file>.md at build time.
// To change the wording, edit the Markdown file; the page picks it up on the next deploy.

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/&#?[a-z0-9]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function decode(text: string): string {
  return text.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function render(file: string) {
  const md = readFileSync(join(process.cwd(), "content", `${file}.md`), "utf8");
  const sections: { id: string; title: string }[] = [];
  let html = marked.parse(md, { async: false, gfm: true }) as string;
  // Give each section heading an id so it can be linked (e.g. /terms#cancellations-and-refunds).
  html = html.replace(/<h2>(.*?)<\/h2>/g, (_, inner: string) => {
    const id = slug(inner);
    sections.push({ id, title: decode(inner.replace(/<[^>]+>/g, "")) });
    return `<h2 id="${id}">${inner}</h2>`;
  });
  // Wide tables scroll inside their own box on small screens.
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");
  return { html, sections };
}

export default function LegalPage(props: { file: string; title: string; effective: string; other: { href: string; label: string } }) {
  const { html, sections } = render(props.file);
  return (
    <>
      <header className="legal-nav">
        <div className="wrap">
          <a className="logo" href="/" aria-label="Roam Caller home">
            <span className="logo-mark" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                <path d="M5 12a7 7 0 0 1 14 0" />
                <path d="M8.5 12a3.5 3.5 0 0 1 7 0" />
                <circle cx="12" cy="16" r="1.6" fill="currentColor" />
              </svg>
            </span>
            <span className="logo-text">
              Roam Caller<small>Data for every trip</small>
            </span>
          </a>
          <a className="back" href="/">Back to home</a>
        </div>
      </header>

      <section className="legal-hero">
        <div className="wrap">
          <h1>{props.title}</h1>
          <p>Effective {props.effective}</p>
        </div>
      </section>

      <main className="wrap legal-body">
        <nav className="toc" aria-label="Contents">
          <h2>Contents</h2>
          <ol>
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title.replace(/^\d+\.\s*/, "")}</a>
              </li>
            ))}
          </ol>
        </nav>
        <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />
      </main>

      <footer className="legal-foot">
        <div className="wrap">
          <span>© 2026 Internova Technologies Inc. Roam Caller is a brand of Internova Technologies Inc.</span>
          <span className="links">
            <a href="/">Home</a>
            <a href={props.other.href}>{props.other.label}</a>
          </span>
        </div>
      </footer>
    </>
  );
}
