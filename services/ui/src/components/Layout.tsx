import { Link, Outlet, useMatchRoute } from "@tanstack/react-router";

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const matchRoute = useMatchRoute();
  const isActive = !!matchRoute({ to });
  return (
    <Link
      to={to}
      className={[
        "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
        isActive
          ? "bg-indigo-50 text-indigo-700"
          : "text-gray-500 hover:text-gray-800 hover:bg-gray-100",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}

export function Layout() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-gray-900 tracking-tight">
              Talent Intelligence
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              AI-powered resume ranking engine
            </p>
          </div>
        </div>
        <div className="max-w-3xl mx-auto px-4 pb-0 flex gap-1 border-t border-gray-100">
          <NavLink to="/upload">Upload Resumes</NavLink>
          <NavLink to="/rank">Rank Candidates</NavLink>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
