import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Upload,
  FileText,
  FileCheck,
  ShieldCheck,
  Database,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/upload", icon: Upload, label: "Upload Documents" },
  { to: "/invoices", icon: FileText, label: "Invoices" },
  { to: "/contracts", icon: FileCheck, label: "Contracts" },
  { to: "/audit", icon: ShieldCheck, label: "Audit Engine" },
  { to: "/manual-upload", icon: Database, label: "Order Data" },
];

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden" data-testid="app-layout">
      {/* Sidebar */}
      <aside
        className={`${
          collapsed ? "w-16" : "w-60"
        } flex-shrink-0 bg-zinc-950 border-r border-zinc-800 flex flex-col transition-[width] duration-200`}
        data-testid="sidebar"
      >
        <div className="h-14 flex items-center px-4 border-b border-zinc-800 gap-2">
          <ShieldCheck className="w-6 h-6 text-blue-500 flex-shrink-0" />
          {!collapsed && (
            <span className="font-heading font-bold text-base text-zinc-100 truncate">
              BillAudit
            </span>
          )}
        </div>

        <nav className="flex-1 py-3 flex flex-col gap-0.5 px-2">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors duration-150 ${
                  isActive
                    ? "bg-blue-600/10 text-blue-400 border border-blue-500/20"
                    : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50"
                }`
              }
            >
              <Icon className="w-4.5 h-4.5 flex-shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </NavLink>
          ))}
        </nav>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="h-10 flex items-center justify-center border-t border-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors duration-150"
          data-testid="sidebar-toggle"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-[#09090b]">
        <Outlet />
      </main>
    </div>
  );
}
