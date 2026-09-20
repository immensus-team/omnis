import { GALLERY_COMPONENTS } from "./registry.js";
import { GALLERY_DEMOS } from "./demos/index.js";

export function App() {
  return (
    <div className="gallery-layout">
      <nav className="gallery-nav">
        {GALLERY_COMPONENTS.map(({ id, label }) => (
          <a href={"#" + id} key={id}>
            {label}
          </a>
        ))}
      </nav>
      <main className="gallery-main">
        {GALLERY_COMPONENTS.map(({ id, label }) => {
          const Demo = GALLERY_DEMOS[id];
          return (
            <section id={id} className="gallery-section" key={id}>
              <h2>{label}</h2>
              <div className="gallery-panes">
                <div className="gallery-pane">
                  <h3>Light</h3>
                  {Demo ? <Demo /> : "TODO"}
                </div>
                <div className="gallery-pane" data-theme="dark">
                  <h3>Dark</h3>
                  {Demo ? <Demo /> : "TODO"}
                </div>
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
