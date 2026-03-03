import { useEffect, useState } from "react";
import axios from "axios";
import { ShieldCheck, Play, Loader2, Download, Eye, Trash2, Layers } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function AuditEngine() {
  const [invoices, setInvoices] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [runs, setRuns] = useState([]);
  const [selectedInvoice, setSelectedInvoice] = useState("");
  const [selectedContract, setSelectedContract] = useState("");
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [bulkProvider, setBulkProvider] = useState("");
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/invoices`),
      axios.get(`${API}/contracts`),
      axios.get(`${API}/audit/runs`),
    ]).then(([inv, con, runs]) => {
      setInvoices(inv.data.filter(i => i.status === "EXTRACTED" && !i.audited));
      setContracts(con.data.filter(c => c.status === "EXTRACTED"));
      setRuns(runs.data);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const runAudit = async () => {
    if (!selectedInvoice || !selectedContract) {
      toast.error("Select both invoice and contract");
      return;
    }
    const inv = invoices.find(i => i.id === selectedInvoice);
    const con = contracts.find(c => c.id === selectedContract);
    if (inv?.provider !== con?.provider) {
      toast.error("Invoice and contract must be from the same provider");
      return;
    }
    setRunning(true);
    try {
      const fd = new FormData();
      fd.append("invoice_id", selectedInvoice);
      fd.append("contract_id", selectedContract);
      const res = await axios.post(`${API}/audit/run`, fd);
      toast.success(`Audit completed: ${res.data.failed} issues found`);
      setRuns(prev => [res.data, ...prev]);
      setInvoices(prev => prev.filter(i => i.id !== selectedInvoice));
      setSelectedInvoice("");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Audit failed");
    }
    setRunning(false);
  };

  const handleDeleteRun = async () => {
    if (!deleteTarget) return;
    try {
      await axios.delete(`${API}/audit/runs/${deleteTarget.id}`);
      setRuns(prev => prev.filter(r => r.id !== deleteTarget.id));
      toast.success("Audit run deleted");
      // Refresh invoices list since the invoice may now be re-auditable
      const inv = await axios.get(`${API}/invoices`);
      setInvoices(inv.data.filter(i => i.status === "EXTRACTED" && !i.audited));
    } catch (e) {
      toast.error(e.response?.data?.detail || "Delete failed");
    }
    setDeleteTarget(null);
  };

  const runBulkAudit = async () => {
    if (!bulkProvider) { toast.error("Select a provider"); return; }
    setBulkRunning(true);
    setBulkResult(null);
    try {
      const fd = new FormData();
      fd.append("provider", bulkProvider);
      const res = await axios.post(`${API}/audit/run-bulk`, fd);
      setBulkResult(res.data);
      toast.success(`Bulk audit complete: ${res.data.invoices_audited} invoice(s) audited`);
      // Refresh data
      const [inv, runRes] = await Promise.all([
        axios.get(`${API}/invoices`),
        axios.get(`${API}/audit/runs`),
      ]);
      setInvoices(inv.data.filter(i => i.status === "EXTRACTED" && !i.audited));
      setRuns(runRes.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Bulk audit failed");
    }
    setBulkRunning(false);
  };

  // Derived: pending invoices per provider for bulk section
  const PROVIDERS = ["BLUEDART", "DELHIVERY", "ECOM_EXPRESS", "SHADOWFAX"];
  const pendingByProvider = PROVIDERS.reduce((acc, p) => {
    acc[p] = invoices.filter(i => i.provider === p).length;
    return acc;
  }, {});
  const contractByProvider = contracts.reduce((acc, c) => {
    acc[c.provider] = c;
    return acc;
  }, {});
  const bulkPendingCount = bulkProvider ? (pendingByProvider[bulkProvider] || 0) : 0;
  const bulkContract = bulkProvider ? contractByProvider[bulkProvider] : null;

  return (
    <div className="p-6 md:p-8 lg:p-10 space-y-8" data-testid="audit-page">
      <div>
        <h1 className="font-heading text-3xl sm:text-4xl font-bold text-zinc-100">Audit Engine</h1>
        <p className="text-zinc-500 text-sm mt-1">Run automated audit checks on invoices against contracts</p>
      </div>

      {/* Bulk Audit by Provider */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6" data-testid="bulk-audit-card">
        <h2 className="font-heading font-semibold text-zinc-200 mb-4 flex items-center gap-2">
          <Layers className="w-5 h-5 text-violet-400" /> Bulk Audit by Provider
        </h2>
        <p className="text-xs text-zinc-500 mb-4">Select a provider to audit all its pending invoices at once using that provider's contract.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block font-medium">Provider</label>
            <Select value={bulkProvider} onValueChange={(v) => { setBulkProvider(v); setBulkResult(null); }}>
              <SelectTrigger className="bg-zinc-950 border-zinc-800 text-zinc-200" data-testid="bulk-provider-select">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                {PROVIDERS.map(p => (
                  <SelectItem key={p} value={p} className="text-zinc-200 focus:bg-zinc-800">
                    {p.replace("_", " ")} ({pendingByProvider[p] || 0} pending)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-xs space-y-1">
            {bulkProvider && (
              <>
                <div className="text-zinc-400">
                  Invoices to audit: <span className="text-zinc-200 font-medium tabular-nums">{bulkPendingCount}</span>
                </div>
                <div className="text-zinc-400">
                  Contract: {bulkContract
                    ? <span className="text-emerald-400">{bulkContract.filename}</span>
                    : <span className="text-red-400">No contract found</span>}
                </div>
              </>
            )}
          </div>
          <Button
            onClick={runBulkAudit}
            disabled={bulkRunning || !bulkProvider || bulkPendingCount === 0 || !bulkContract}
            className="bg-violet-600 hover:bg-violet-700 text-white shadow-[0_0_10px_rgba(124,58,237,0.3)] hover:shadow-[0_0_20px_rgba(124,58,237,0.5)]"
            data-testid="run-bulk-audit-btn"
          >
            {bulkRunning ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Auditing {bulkPendingCount} Invoice(s)...</>
            ) : (
              <><Layers className="w-4 h-4 mr-2" /> Bulk Audit ({bulkPendingCount})</>
            )}
          </Button>
        </div>

        {bulkResult && (
          <div className="mt-4 p-4 rounded-md bg-zinc-950 border border-zinc-800" data-testid="bulk-audit-result">
            <div className="flex items-center gap-4 flex-wrap text-sm">
              <div className="text-zinc-300">
                <span className="text-zinc-500 text-xs uppercase tracking-wider mr-1">Audited:</span>
                <span className="font-medium tabular-nums">{bulkResult.invoices_audited} invoice(s)</span>
              </div>
              <div className="text-red-400">
                <span className="text-zinc-500 text-xs uppercase tracking-wider mr-1">Failed checks:</span>
                <span className="font-medium tabular-nums">{bulkResult.total_failed}</span>
              </div>
              <div className="text-red-400">
                <span className="text-zinc-500 text-xs uppercase tracking-wider mr-1">Discrepancy:</span>
                <span className="font-medium tabular-nums">Rs. {(bulkResult.total_discrepancy || 0).toLocaleString("en-IN")}</span>
              </div>
            </div>
            {bulkResult.runs?.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {bulkResult.runs.map(r => (
                  <div key={r.id} className="flex items-center gap-3 text-xs px-3 py-2 bg-zinc-900/50 rounded-md border border-zinc-800/50">
                    <span className="text-zinc-300 truncate flex-1">{r.invoice_filename}</span>
                    <span className="text-emerald-400 tabular-nums">{r.passed} pass</span>
                    <span className="text-red-400 tabular-nums">{r.failed} fail</span>
                    <span className="text-red-400 tabular-nums font-medium">Rs. {(r.total_discrepancy_amount || 0).toLocaleString("en-IN")}</span>
                    <button onClick={() => navigate(`/audit/${r.id}`)} className="text-zinc-500 hover:text-blue-400 transition-colors duration-150" data-testid={`bulk-view-${r.id}`}>
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Run New Audit (Single) */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6" data-testid="run-audit-card">
        <h2 className="font-heading font-semibold text-zinc-200 mb-4 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-blue-400" /> Run New Audit
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block font-medium">Invoice</label>
            <Select value={selectedInvoice} onValueChange={setSelectedInvoice}>
              <SelectTrigger className="bg-zinc-950 border-zinc-800 text-zinc-200" data-testid="audit-invoice-select">
                <SelectValue placeholder="Select invoice" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                {invoices.map(i => (
                  <SelectItem key={i.id} value={i.id} className="text-zinc-200 focus:bg-zinc-800">
                    {i.filename} ({i.provider})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block font-medium">Contract</label>
            <Select value={selectedContract} onValueChange={setSelectedContract}>
              <SelectTrigger className="bg-zinc-950 border-zinc-800 text-zinc-200" data-testid="audit-contract-select">
                <SelectValue placeholder="Select contract" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                {contracts.map(c => (
                  <SelectItem key={c.id} value={c.id} className="text-zinc-200 focus:bg-zinc-800">
                    {c.filename} ({c.provider})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={runAudit} disabled={running || !selectedInvoice || !selectedContract}
            className="bg-blue-600 hover:bg-blue-700 text-white shadow-[0_0_10px_rgba(37,99,235,0.3)] hover:shadow-[0_0_20px_rgba(37,99,235,0.5)]"
            data-testid="run-audit-btn">
            {running ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Running 7 Checks...</> : <><Play className="w-4 h-4 mr-2" /> Run Audit</>}
          </Button>
        </div>
      </div>

      {/* Audit Runs List */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg" data-testid="audit-runs-list">
        <div className="px-5 py-4 border-b border-zinc-800">
          <h3 className="font-heading font-semibold text-sm text-zinc-300">Audit Run History</h3>
        </div>
        {loading ? (
          <div className="p-8 text-center text-zinc-500 animate-pulse">Loading...</div>
        ) : runs.length === 0 ? (
          <div className="p-12 text-center text-zinc-600 text-sm">No audit runs yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-900/50 text-zinc-400 text-xs uppercase tracking-wider border-b border-zinc-800">
                  <th className="text-left py-3 px-4 font-medium">Date</th>
                  <th className="text-left py-3 px-4 font-medium">Provider</th>
                  <th className="text-center py-3 px-4 font-medium">Checks</th>
                  <th className="text-center py-3 px-4 font-medium">Passed</th>
                  <th className="text-center py-3 px-4 font-medium">Failed</th>
                  <th className="text-center py-3 px-4 font-medium">Bucket A</th>
                  <th className="text-center py-3 px-4 font-medium">Bucket B</th>
                  <th className="text-right py-3 px-4 font-medium">Discrepancy</th>
                  <th className="text-center py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(run => (
                  <tr key={run.id} className="hover:bg-zinc-800/30 border-b border-zinc-800/50 transition-colors duration-150" data-testid={`audit-run-${run.id}`}>
                    <td className="py-3 px-4 text-zinc-400 text-xs">{new Date(run.run_date).toLocaleString()}</td>
                    <td className="py-3 px-4"><Badge variant="outline" className="text-xs border-zinc-700 text-zinc-300">{run.provider}</Badge></td>
                    <td className="py-3 px-4 text-center tabular-nums text-zinc-300">{run.total_checks}</td>
                    <td className="py-3 px-4 text-center tabular-nums text-emerald-400">{run.passed}</td>
                    <td className="py-3 px-4 text-center tabular-nums text-red-400">{run.failed}</td>
                    <td className="py-3 px-4 text-center">
                      <Badge className="bg-red-500/10 text-red-400 border border-red-500/20 text-[10px]">{run.bucket_a_count}</Badge>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Badge className="bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 text-[10px]">{run.bucket_b_count}</Badge>
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums text-red-400 font-medium">Rs. {(run.total_discrepancy_amount || 0).toLocaleString("en-IN")}</td>
                    <td className="py-3 px-4 text-center flex gap-1 justify-center">
                      <button onClick={() => navigate(`/audit/${run.id}`)} className="text-zinc-500 hover:text-blue-400 transition-colors duration-150 p-1" data-testid={`view-audit-${run.id}`}>
                        <Eye className="w-4 h-4" />
                      </button>
                      <a href={`${API}/audit/export/${run.id}`} className="text-zinc-500 hover:text-emerald-400 transition-colors duration-150 p-1" data-testid={`export-audit-${run.id}`}>
                        <Download className="w-4 h-4" />
                      </a>
                      <button onClick={() => setDeleteTarget(run)} className="text-zinc-500 hover:text-red-400 transition-colors duration-150 p-1" data-testid={`delete-audit-${run.id}`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800" data-testid="delete-audit-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100">Delete Audit Run</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              This will permanently delete this audit run ({deleteTarget?.provider}, {deleteTarget?.run_date ? new Date(deleteTarget.run_date).toLocaleDateString() : ""}) and all its results. The associated invoice will become available for re-auditing. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700" data-testid="delete-audit-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDeleteRun} data-testid="delete-audit-confirm">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
