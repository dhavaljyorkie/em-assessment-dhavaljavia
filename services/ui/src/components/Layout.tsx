import { Link, Outlet, useMatchRoute } from "@tanstack/react-router";

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const matchRoute = useMatchRoute();
  const isActive = !!matchRoute({ to });
  return (
    <Link
      to={to}
      style={{
        display: "inline-block",
        fontFamily: "var(--font-mono)",
        fontSize: "11px",
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        padding: "14px 0",
        color: isActive ? "var(--accent)" : "var(--text-muted)",
        borderBottom: `1px solid ${isActive ? "var(--accent)" : "transparent"}`,
        textDecoration: "none",
        transition: "color 0.2s, border-color 0.2s",
      }}
    >
      {children}
    </Link>
  );
}

export function Layout() {
  return (
    <div style={{ minHeight: "100vh" }}>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ maxWidth: "820px", margin: "0 auto", padding: "0 24px" }}>
          {/* Masthead */}
          <div
            style={{
              padding: "28px 0 20px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "14px",
              }}
            >
              <h1
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "36px",
                  fontWeight: 300,
                  fontStyle: "italic",
                  letterSpacing: "0.01em",
                  color: "var(--text)",
                  lineHeight: 1,
                  margin: 0,
                }}
              >
                Talent Intelligence
              </h1>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "9px",
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "var(--accent)",
                  border: "1px solid rgba(196, 148, 74, 0.4)",
                  padding: "3px 7px",
                  lineHeight: 1.4,
                }}
              >
                AI
              </span>
            </div>
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                letterSpacing: "0.04em",
                color: "var(--text-muted)",
                marginTop: "8px",
                marginBottom: 0,
              }}
            >
              Resume ranking engine — vector search &amp; LLM scoring
            </p>
          </div>

          {/* Nav */}
          <nav style={{ display: "flex", gap: "28px" }}>
            <NavLink to="/upload">Upload Resumes</NavLink>
            <NavLink to="/rank">Rank Candidates</NavLink>
          </nav>
        </div>
      </header>

      <main
        style={{
          maxWidth: "820px",
          margin: "0 auto",
          padding: "48px 24px 80px",
        }}
      >
        <Outlet />
      </main>
    </div>
  );
}
