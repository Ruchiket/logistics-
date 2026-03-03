import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { ArrowLeft, Download, Filter } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const CHECK_LABELS = {
  WEIGHT_OVERCHARGE: "Weight Overcharge",
  ZONE_MISMATCH: "Zone Mismatch",
  RATE_DEVIATION: "Rate Deviation",
  DUPLICATE_AWB: "Duplicate AWB",
  INCORRECT_COD_FEE: "Incorrect COD Fee",
  RTO_OVERCHARGE: "RTO Overcharge",
  NON_CONTRACTED_SURCHARGES: "Non-Contracted Surcharges",
};

const BUCKET_LABELS = { A: "Genuine Error", B: "Data-Dependent", C: "Op. Agreed" };
const BUCKET_STYLES = {
  A: "bg-red-500/10 text-red-400 border-red-500/20",
  B: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  C: "bg-green-500/10 text-green-400 border-green-500/20",
};

export default function AuditDetail() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkFilter, setCheckFilter] = useState("ALL");
  const [bucketFilter, setBucketFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  useEffect(() => {
    axios.get(`${API}/audit/runs/${runId}`)
      .then(r => setRun(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading) return <div className="p-8 text-zinc-500 animate-pulse">Loading audit results...</div>;
  if (!run) return <div className="p-8 text-red-400">Audit run not found</div>;

  const results = run.results || [];
  const filtered = results.filter(r => {
    if (checkFilter !== "ALL" && r.check_type !== checkFilter) return false;
    if (bucketFilter !== "ALL" && r.bucket !== bucketFilter) return false;
    if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
    return true;
  });

  const failedResults = results.filter(r => r.status === "FAIL");
  const uniqueAwbs = [...new Set(failedResults.map(r => r.awb_number))];

  // Summary by check type
  const checkSummary = Object.keys(CHECK_LABELS).map(ct => {
    const items = results.filter(r => r.check_type === ct);
    return {
      check: ct,
      label: CHECK_LABELS[ct],
      total: items.length,
      passed: items.filter(r => r.status === "PASS").length,
      failed: items.filter(r => r.status === "FAIL").length,
      discrepancy: items.reduce((s, r) => s + (r.discrepancy_amount || 0), 0),
    };
  });

  return (
    <div className="p-6 md:p-8 lg:p-10 space-y-6" data-testid="audit-detail-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/audit")} className="text-zinc-500 hover:text-zinc-200 transition-colors duration-150" data-testid="back-to-audit-btn">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-zinc-100">Audit Results</h1>
            <p className="text-zinc-500 text-xs mt-0.5">
              {run.provider} | {new Date(run.run_date).toLocaleString()} | {run.invoice_filename || ""}
            </p>
          </div>
        </div>
        <a href={`${API}/audit/export/${runId}`}>
          <Button className="bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700" data-testid="export-csv-btn">
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
        </a>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Total Checks" value={run.total_checks} color="text-zinc-100" />
        <SummaryCard label="Passed" value={run.passed} color="text-emerald-400" />
        <SummaryCard label="Failed" value={run.failed} color="text-red-400" />
        <SummaryCard label="Discrepancy" value={`Rs. ${(run.total_discrepancy_amount || 0).toLocaleString("en-IN")}`} color="text-red-400" />
      </div>

      {/* Bucket Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 text-center" data-testid="bucket-a-summary">
          <div className="text-2xl font-heading font-bold text-red-400 tabular-nums">{run.bucket_a_count}</div>
          <div className="text-xs text-red-400/70 mt-1">Bucket A: Genuine Errors</div>
        </div>
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-4 text-center" data-testid="bucket-b-summary">
          <div className="text-2xl font-heading font-bold text-yellow-400 tabular-nums">{run.bucket_b_count}</div>
          <div className="text-xs text-yellow-400/70 mt-1">Bucket B: Data-Dependent</div>
        </div>
        <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-4 text-center" data-testid="bucket-c-summary">
          <div className="text-2xl font-heading font-bold text-green-400 tabular-nums">{run.bucket_c_count}</div>
          <div className="text-xs text-green-400/70 mt-1">Bucket C: Op. Agreed</div>
        </div>
      </div>

      <Tabs defaultValue="checks" className="space-y-4">
        <TabsList className="bg-zinc-900 border border-zinc-800">
          <TabsTrigger value="checks" className="data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-400" data-testid="tab-checks">
            By Check Type
          </TabsTrigger>
          <TabsTrigger value="all" className="data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-400" data-testid="tab-all">
            All Results ({filtered.length})
          </TabsTrigger>
          <TabsTrigger value="awb" className="data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-400" data-testid="tab-awb">
            Flagged AWBs ({uniqueAwbs.length})
          </TabsTrigger>
        </TabsList>

        {/* By Check Type */}
        <TabsContent value="checks" className="space-y-3">
          {checkSummary.map(cs => (
            <div key={cs.check} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 flex items-center gap-4" data-testid={`check-summary-${cs.check}`}>
              <div className="flex-1">
                <div className="text-sm font-medium text-zinc-200">{cs.label}</div>
                <div className="text-xs text-zinc-500 mt-0.5">{cs.total} checks run</div>
              </div>
              <div className="flex gap-4 text-xs tabular-nums">
                <span className="text-emerald-400">{cs.passed} pass</span>
                <span className="text-red-400">{cs.failed} fail</span>
              </div>
              {cs.discrepancy > 0 && (
                <span className="text-xs text-red-400 tabular-nums font-medium">
                  Rs. {cs.discrepancy.toLocaleString("en-IN")}
                </span>
              )}
            </div>
          ))}
        </TabsContent>

        {/* All Results */}
        <TabsContent value="all" className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center" data-testid="result-filters">
            <Filter className="w-4 h-4 text-zinc-500" />
            <Select value={checkFilter} onValueChange={setCheckFilter}>
              <SelectTrigger className="w-48 bg-zinc-950 border-zinc-800 text-zinc-200 text-xs" data-testid="filter-check-type">
                <SelectValue placeholder="Check Type" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                <SelectItem value="ALL" className="text-zinc-200 focus:bg-zinc-800">All Checks</SelectItem>
                {Object.entries(CHECK_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k} className="text-zinc-200 focus:bg-zinc-800">{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32 bg-zinc-950 border-zinc-800 text-zinc-200 text-xs" data-testid="filter-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                <SelectItem value="ALL" className="text-zinc-200 focus:bg-zinc-800">All</SelectItem>
                <SelectItem value="PASS" className="text-zinc-200 focus:bg-zinc-800">Pass</SelectItem>
                <SelectItem value="FAIL" className="text-zinc-200 focus:bg-zinc-800">Fail</SelectItem>
                <SelectItem value="SKIP" className="text-zinc-200 focus:bg-zinc-800">Skip</SelectItem>
              </SelectContent>
            </Select>
            <Select value={bucketFilter} onValueChange={setBucketFilter}>
              <SelectTrigger className="w-36 bg-zinc-950 border-zinc-800 text-zinc-200 text-xs" data-testid="filter-bucket">
                <SelectValue placeholder="Bucket" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                <SelectItem value="ALL" className="text-zinc-200 focus:bg-zinc-800">All Buckets</SelectItem>
                <SelectItem value="A" className="text-zinc-200 focus:bg-zinc-800">Bucket A</SelectItem>
                <SelectItem value="B" className="text-zinc-200 focus:bg-zinc-800">Bucket B</SelectItem>
                <SelectItem value="C" className="text-zinc-200 focus:bg-zinc-800">Bucket C</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-900/20">
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-zinc-900/95 backdrop-blur-sm text-zinc-400 text-xs uppercase tracking-wider border-b border-zinc-800">
                    <th className="text-left py-3 px-4 font-medium">AWB</th>
                    <th className="text-left py-3 px-4 font-medium">Check</th>
                    <th className="text-center py-3 px-4 font-medium">Status</th>
                    <th className="text-center py-3 px-4 font-medium">Bucket</th>
                    <th className="text-right py-3 px-4 font-medium">Expected</th>
                    <th className="text-right py-3 px-4 font-medium">Actual</th>
                    <th className="text-right py-3 px-4 font-medium">Discrepancy</th>
                    <th className="text-left py-3 px-4 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 200).map((r, i) => (
                    <tr key={i} className="hover:bg-zinc-800/30 border-b border-zinc-800/50 transition-colors duration-150">
                      <td className="py-2.5 px-4 font-mono text-xs text-zinc-300">{r.awb_number}</td>
                      <td className="py-2.5 px-4 text-xs text-zinc-400">{CHECK_LABELS[r.check_type] || r.check_type}</td>
                      <td className="py-2.5 px-4 text-center">
                        <Badge variant="outline" className={`text-[10px] ${r.status === "PASS" ? "text-emerald-400 border-emerald-500/20" : r.status === "FAIL" ? "text-red-400 border-red-500/20" : "text-zinc-400 border-zinc-700"}`}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {r.bucket ? (
                          <Badge variant="outline" className={`text-[10px] ${BUCKET_STYLES[r.bucket]}`}>
                            {r.bucket}: {BUCKET_LABELS[r.bucket]}
                          </Badge>
                        ) : "—"}
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-xs text-zinc-400">{r.expected_value ?? "—"}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-xs text-zinc-300">{r.actual_value ?? "—"}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-xs font-medium text-red-400">
                        {r.discrepancy_amount ? `Rs. ${r.discrepancy_amount.toLocaleString("en-IN")}` : "—"}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-zinc-500 max-w-[300px] truncate">{r.details || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length > 200 && (
                <div className="p-3 text-xs text-zinc-600 text-center">Showing first 200 of {filtered.length} results</div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Flagged AWBs */}
        <TabsContent value="awb" className="space-y-2">
          {uniqueAwbs.length === 0 ? (
            <div className="text-center py-12 text-zinc-600 text-sm">No flagged AWBs</div>
          ) : (
            uniqueAwbs.slice(0, 100).map(awb => {
              const awbResults = failedResults.filter(r => r.awb_number === awb);
              const totalDisc = awbResults.reduce((s, r) => s + (r.discrepancy_amount || 0), 0);
              return (
                <div key={awb} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4" data-testid={`flagged-awb-${awb}`}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-mono text-sm text-zinc-200">{awb}</span>
                    <span className="text-xs text-red-400 tabular-nums">{awbResults.length} issue(s)</span>
                    {totalDisc > 0 && <span className="text-xs text-red-400 tabular-nums ml-auto font-medium">Rs. {totalDisc.toLocaleString("en-IN")}</span>}
                  </div>
                  <div className="space-y-1.5">
                    {awbResults.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <Badge variant="outline" className={`text-[9px] flex-shrink-0 ${BUCKET_STYLES[r.bucket] || "border-zinc-700 text-zinc-400"}`}>
                          {r.bucket || "?"}
                        </Badge>
                        <span className="text-zinc-400">{CHECK_LABELS[r.check_type]}:</span>
                        <span className="text-zinc-500">{r.details}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({ label, value, color }) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 text-center">
      <div className={`text-xl font-heading font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[10px] text-zinc-500 mt-0.5 uppercase tracking-wider">{label}</div>
    </div>
  );
}
