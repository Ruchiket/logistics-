import { useEffect, useState } from "react";
import axios from "axios";
import {
  FileText,
  FileCheck,
  ShieldCheck,
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingUp,
  ArrowRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const BUCKET_COLORS = { A: "#ef4444", B: "#eab308", C: "#22c55e" };

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    axios
      .get(`${API}/dashboard/stats`)
      .then((r) => setStats(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="animate-pulse text-zinc-500">Loading dashboard...</div>
      </div>
    );
  }

  const bucketData = [
    { name: "Genuine Errors (A)", value: stats?.bucket_a || 0, color: BUCKET_COLORS.A },
    { name: "Data-Dependent (B)", value: stats?.bucket_b || 0, color: BUCKET_COLORS.B },
    { name: "Op. Agreed (C)", value: stats?.bucket_c || 0, color: BUCKET_COLORS.C },
  ].filter((d) => d.value > 0);

  const providerData = (stats?.provider_stats || []).map((p) => ({
    name: p.provider,
    discrepancy: p.total_discrepancy,
    failed: p.total_failed,
  }));

  return (
    <div className="p-6 md:p-8 lg:p-10 space-y-8" data-testid="dashboard-page">
      {/* Header */}
      <div>
        <h1 className="font-heading text-3xl sm:text-4xl font-bold text-zinc-100">
          Dashboard
        </h1>
        <p className="text-zinc-500 text-sm mt-1">
          Logistics invoice audit overview
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={FileText}
          label="Invoices"
          value={stats?.total_invoices || 0}
          color="text-blue-400"
          testId="stat-invoices"
          onClick={() => navigate("/invoices")}
        />
        <StatCard
          icon={FileCheck}
          label="Contracts"
          value={stats?.total_contracts || 0}
          color="text-emerald-400"
          testId="stat-contracts"
          onClick={() => navigate("/contracts")}
        />
        <StatCard
          icon={ShieldCheck}
          label="Audit Runs"
          value={stats?.total_audit_runs || 0}
          color="text-violet-400"
          testId="stat-audit-runs"
          onClick={() => navigate("/audit")}
        />
        <StatCard
          icon={AlertTriangle}
          label="Total Discrepancy"
          value={`Rs. ${(stats?.total_discrepancy || 0).toLocaleString("en-IN")}`}
          color="text-red-400"
          testId="stat-discrepancy"
          subtitle={`${stats?.total_failed || 0} issues found`}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Audit Summary */}
        <div className="lg:col-span-4 bg-zinc-900/50 border border-zinc-800 rounded-lg p-5" data-testid="audit-summary-card">
          <h3 className="font-heading font-semibold text-sm text-zinc-300 mb-4">
            Audit Check Results
          </h3>
          <div className="space-y-3">
            <ResultBar
              icon={CheckCircle}
              label="Passed"
              value={stats?.total_passed || 0}
              total={stats?.total_checks || 1}
              color="bg-emerald-500"
            />
            <ResultBar
              icon={XCircle}
              label="Failed"
              value={stats?.total_failed || 0}
              total={stats?.total_checks || 1}
              color="bg-red-500"
            />
          </div>
        </div>

        {/* Bucket Pie */}
        <div className="lg:col-span-4 bg-zinc-900/50 border border-zinc-800 rounded-lg p-5" data-testid="bucket-chart">
          <h3 className="font-heading font-semibold text-sm text-zinc-300 mb-4">
            Discrepancy Buckets
          </h3>
          {bucketData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={120} height={120}>
                <PieChart>
                  <Pie
                    data={bucketData}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={30}
                    outerRadius={55}
                    strokeWidth={0}
                  >
                    {bucketData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {bucketData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <div
                      className="w-2.5 h-2.5 rounded-sm"
                      style={{ background: d.color }}
                    />
                    <span className="text-zinc-400">{d.name}</span>
                    <span className="text-zinc-200 font-medium ml-auto tabular-nums">
                      {d.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-zinc-600 text-sm">No audit data yet</p>
          )}
        </div>

        {/* Provider Bar Chart */}
        <div className="lg:col-span-4 bg-zinc-900/50 border border-zinc-800 rounded-lg p-5" data-testid="provider-chart">
          <h3 className="font-heading font-semibold text-sm text-zinc-300 mb-4">
            Provider Discrepancies
          </h3>
          {providerData.length > 0 ? (
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={providerData}>
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#a1a1aa", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip
                  contentStyle={{
                    background: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="discrepancy" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-zinc-600 text-sm">No provider data yet</p>
          )}
        </div>
      </div>

      {/* Recent Audit Runs */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg" data-testid="recent-runs">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="font-heading font-semibold text-sm text-zinc-300">
            Recent Audit Runs
          </h3>
          <button
            onClick={() => navigate("/audit")}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors duration-150"
            data-testid="view-all-audits-btn"
          >
            View all <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        {stats?.recent_runs?.length > 0 ? (
          <div className="divide-y divide-zinc-800/50">
            {stats.recent_runs.map((run) => (
              <div
                key={run.id}
                className="px-5 py-3 flex items-center gap-4 hover:bg-zinc-800/30 cursor-pointer transition-colors duration-150"
                onClick={() => navigate(`/audit/${run.id}`)}
                data-testid={`recent-run-${run.id}`}
              >
                <TrendingUp className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-zinc-200 truncate block">
                    {run.provider}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {new Date(run.run_date).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex gap-3 text-xs tabular-nums">
                  <span className="text-emerald-400">{run.passed} pass</span>
                  <span className="text-red-400">{run.failed} fail</span>
                </div>
                <span className="text-xs text-red-400 tabular-nums font-medium">
                  Rs. {(run.total_discrepancy_amount || 0).toLocaleString("en-IN")}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-zinc-600 text-sm">
            No audit runs yet. Upload an invoice and contract to get started.
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, testId, subtitle, onClick }) {
  return (
    <div
      className={`bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 hover:border-zinc-700 transition-colors duration-150 ${
        onClick ? "cursor-pointer" : ""
      }`}
      onClick={onClick}
      data-testid={testId}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-xs text-zinc-500 uppercase tracking-wider font-medium">
          {label}
        </span>
      </div>
      <div className="text-2xl font-heading font-bold text-zinc-100">{value}</div>
      {subtitle && <div className="text-xs text-zinc-500 mt-0.5">{subtitle}</div>}
    </div>
  );
}

function ResultBar({ icon: Icon, label, value, total, color }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <Icon className="w-4 h-4 text-zinc-500 flex-shrink-0" />
      <div className="flex-1">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-zinc-400">{label}</span>
          <span className="text-zinc-300 tabular-nums">{value}</span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full ${color} rounded-full transition-[width] duration-500`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
