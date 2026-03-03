import { useEffect, useState } from "react";
import axios from "axios";
import { FileText, Eye, ChevronDown, ChevronUp, Search, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    axios.get(`${API}/invoices`).then(r => setInvoices(r.data)).catch(console.error).finally(() => setLoading(false));
  }, []);

  const loadDetail = async (id) => {
    if (selected === id) { setSelected(null); setDetail(null); return; }
    setSelected(id);
    setDetailLoading(true);
    try {
      const r = await axios.get(`${API}/invoices/${id}`);
      setDetail(r.data);
    } catch (e) { console.error(e); }
    setDetailLoading(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await axios.delete(`${API}/invoices/${deleteTarget.id}`);
      setInvoices(prev => prev.filter(i => i.id !== deleteTarget.id));
      if (selected === deleteTarget.id) { setSelected(null); setDetail(null); }
      toast.success(`Invoice "${deleteTarget.filename}" deleted`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Delete failed");
    }
    setDeleteTarget(null);
  };

  const filtered = invoices.filter(i =>
    i.filename?.toLowerCase().includes(search.toLowerCase()) ||
    i.provider?.toLowerCase().includes(search.toLowerCase()) ||
    i.invoice_number?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 md:p-8 lg:p-10 space-y-6" data-testid="invoices-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl sm:text-4xl font-bold text-zinc-100">Invoices</h1>
          <p className="text-zinc-500 text-sm mt-1">Uploaded & extracted invoice data</p>
        </div>
        <Button onClick={() => navigate("/upload")} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="go-upload-btn">
          <FileText className="w-4 h-4 mr-2" /> Upload New
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <Input
          placeholder="Search by filename, provider, or invoice number..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 bg-zinc-950 border-zinc-800 text-zinc-200 placeholder:text-zinc-600"
          data-testid="invoice-search"
        />
      </div>

      {loading ? (
        <div className="text-zinc-500 text-center py-12 animate-pulse">Loading invoices...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-zinc-600">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No invoices found. Upload one to get started.</p>
        </div>
      ) : (
        <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-900/20">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-900/80 text-zinc-400 text-xs uppercase tracking-wider border-b border-zinc-800">
                <th className="text-left py-3 px-4 font-medium">Filename</th>
                <th className="text-left py-3 px-4 font-medium">Provider</th>
                <th className="text-left py-3 px-4 font-medium">Invoice #</th>
                <th className="text-right py-3 px-4 font-medium">AWBs</th>
                <th className="text-right py-3 px-4 font-medium">Amount</th>
                <th className="text-center py-3 px-4 font-medium">Status</th>
                <th className="text-center py-3 px-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => (
                <InvoiceRow
                  key={inv.id}
                  inv={inv}
                  isOpen={selected === inv.id}
                  detail={selected === inv.id ? detail : null}
                  detailLoading={selected === inv.id && detailLoading}
                  onToggle={() => loadDetail(inv.id)}
                  onDelete={() => setDeleteTarget(inv)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800" data-testid="delete-invoice-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100">Delete Invoice</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              This will permanently delete <span className="text-zinc-200 font-medium">"{deleteTarget?.filename}"</span> and all its AWB data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700" data-testid="delete-invoice-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDelete} data-testid="delete-invoice-confirm">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InvoiceRow({ inv, isOpen, detail, detailLoading, onToggle, onDelete }) {
  return (
    <>
      <tr className="hover:bg-zinc-800/30 border-b border-zinc-800/50 transition-colors duration-150" data-testid={`invoice-row-${inv.id}`}>
        <td className="py-3 px-4 text-zinc-200 font-medium truncate max-w-[200px]">{inv.filename}</td>
        <td className="py-3 px-4">
          <Badge variant="outline" className="text-xs border-zinc-700 text-zinc-300">{inv.provider}</Badge>
        </td>
        <td className="py-3 px-4 font-mono text-xs text-zinc-400">{inv.invoice_number || "—"}</td>
        <td className="py-3 px-4 text-right tabular-nums text-zinc-300">{inv.total_awbs}</td>
        <td className="py-3 px-4 text-right tabular-nums text-zinc-200">Rs. {(inv.total_amount || 0).toLocaleString("en-IN")}</td>
        <td className="py-3 px-4 text-center">
          <StatusBadge status={inv.status} />
        </td>
        <td className="py-3 px-4 text-center">
          <div className="flex gap-1 justify-center">
            <button onClick={onToggle} className="text-zinc-500 hover:text-zinc-200 transition-colors duration-150 p-1" data-testid={`invoice-expand-${inv.id}`}>
              {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            <button onClick={onDelete} className="text-zinc-500 hover:text-red-400 transition-colors duration-150 p-1" data-testid={`invoice-delete-${inv.id}`}>
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={7} className="bg-zinc-950/50 border-b border-zinc-800">
            {detailLoading ? (
              <div className="p-6 text-center text-zinc-500 animate-pulse">Loading AWB items...</div>
            ) : detail?.awb_items?.length > 0 ? (
              <div className="p-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-zinc-500 uppercase tracking-wider">
                      <th className="text-left py-2 px-3 font-medium">AWB</th>
                      <th className="text-left py-2 px-3 font-medium">Date</th>
                      <th className="text-left py-2 px-3 font-medium">Origin</th>
                      <th className="text-left py-2 px-3 font-medium">Dest</th>
                      <th className="text-left py-2 px-3 font-medium">Zone</th>
                      <th className="text-right py-2 px-3 font-medium">Weight (kg)</th>
                      <th className="text-right py-2 px-3 font-medium">Freight</th>
                      <th className="text-right py-2 px-3 font-medium">Total</th>
                      <th className="text-center py-2 px-3 font-medium">Type</th>
                      <th className="text-center py-2 px-3 font-medium">Mode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.awb_items.slice(0, 50).map((awb, i) => (
                      <tr key={i} className="border-t border-zinc-800/30 hover:bg-zinc-900/30">
                        <td className="py-2 px-3 font-mono text-zinc-300">{awb.awb_number}</td>
                        <td className="py-2 px-3 text-zinc-400">{awb.shipment_date || "—"}</td>
                        <td className="py-2 px-3 text-zinc-400 tabular-nums">{awb.origin_pincode || "—"}</td>
                        <td className="py-2 px-3 text-zinc-400 tabular-nums">{awb.destination_pincode || "—"}</td>
                        <td className="py-2 px-3 text-zinc-400">{awb.billed_zone || "—"}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-zinc-300">{awb.billed_chargeable_weight_kg || "—"}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-zinc-300">{awb.base_freight || "—"}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-zinc-200 font-medium">{awb.total_billed_amount || "—"}</td>
                        <td className="py-2 px-3 text-center">
                          <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">{awb.shipment_type || "—"}</Badge>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <Badge variant="outline" className={`text-[10px] ${awb.payment_mode === "COD" ? "border-yellow-500/30 text-yellow-500" : "border-zinc-700 text-zinc-400"}`}>
                            {awb.payment_mode || "—"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {detail.awb_items.length > 50 && (
                  <p className="text-xs text-zinc-600 mt-2 px-3">Showing first 50 of {detail.awb_items.length} AWBs</p>
                )}
              </div>
            ) : (
              <div className="p-6 text-center text-zinc-600 text-sm">No AWB items extracted</div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function StatusBadge({ status }) {
  const styles = {
    EXTRACTED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    EXTRACTING: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    EXTRACTION_FAILED: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  return (
    <Badge variant="outline" className={`text-[10px] ${styles[status] || "border-zinc-700 text-zinc-400"}`}>
      {status}
    </Badge>
  );
}
