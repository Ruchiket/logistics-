import { useEffect, useState } from "react";
import axios from "axios";
import { FileCheck, ChevronDown, ChevronUp, Search, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function Contracts() {
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    axios.get(`${API}/contracts`).then(r => setContracts(r.data)).catch(console.error).finally(() => setLoading(false));
  }, []);

  const loadDetail = async (id) => {
    if (selected === id) { setSelected(null); setDetail(null); return; }
    setSelected(id);
    setDetailLoading(true);
    try {
      const r = await axios.get(`${API}/contracts/${id}`);
      setDetail(r.data);
    } catch (e) { console.error(e); }
    setDetailLoading(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await axios.delete(`${API}/contracts/${deleteTarget.id}`);
      setContracts(prev => prev.filter(c => c.id !== deleteTarget.id));
      if (selected === deleteTarget.id) { setSelected(null); setDetail(null); }
      toast.success(`Contract "${deleteTarget.filename}" deleted`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Delete failed");
    }
    setDeleteTarget(null);
  };

  const filtered = contracts.filter(c =>
    c.filename?.toLowerCase().includes(search.toLowerCase()) ||
    c.provider?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 md:p-8 lg:p-10 space-y-6" data-testid="contracts-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl sm:text-4xl font-bold text-zinc-100">Contracts & Rate Cards</h1>
          <p className="text-zinc-500 text-sm mt-1">Manage extracted rate cards per logistics provider</p>
        </div>
        <Button onClick={() => navigate("/upload")} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="go-upload-contract-btn">
          <FileCheck className="w-4 h-4 mr-2" /> Upload New
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <Input placeholder="Search by filename or provider..." value={search} onChange={e => setSearch(e.target.value)}
          className="pl-9 bg-zinc-950 border-zinc-800 text-zinc-200 placeholder:text-zinc-600" data-testid="contract-search" />
      </div>

      {loading ? (
        <div className="text-zinc-500 text-center py-12 animate-pulse">Loading contracts...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-zinc-600">
          <FileCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No contracts found. Upload one to get started.</p>
        </div>
      ) : (
        <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-900/20">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-900/80 text-zinc-400 text-xs uppercase tracking-wider border-b border-zinc-800">
                <th className="text-left py-3 px-4 font-medium">Filename</th>
                <th className="text-left py-3 px-4 font-medium">Provider</th>
                <th className="text-left py-3 px-4 font-medium">Effective From</th>
                <th className="text-left py-3 px-4 font-medium">Effective To</th>
                <th className="text-center py-3 px-4 font-medium">Status</th>
                <th className="text-center py-3 px-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <ContractRow key={c.id} contract={c} isOpen={selected === c.id}
                  detail={selected === c.id ? detail : null}
                  detailLoading={selected === c.id && detailLoading}
                  onToggle={() => loadDetail(c.id)}
                  onDelete={() => setDeleteTarget(c)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800" data-testid="delete-contract-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100">Delete Contract</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              This will permanently delete <span className="text-zinc-200 font-medium">"{deleteTarget?.filename}"</span> ({deleteTarget?.provider}) and its rate card data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700" data-testid="delete-contract-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDelete} data-testid="delete-contract-confirm">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ContractRow({ contract, isOpen, detail, detailLoading, onToggle, onDelete }) {
  const rc = detail?.rate_card;
  return (
    <>
      <tr className="hover:bg-zinc-800/30 border-b border-zinc-800/50 transition-colors duration-150" data-testid={`contract-row-${contract.id}`}>
        <td className="py-3 px-4 text-zinc-200 font-medium truncate max-w-[200px]">{contract.filename}</td>
        <td className="py-3 px-4"><Badge variant="outline" className="text-xs border-zinc-700 text-zinc-300">{contract.provider}</Badge></td>
        <td className="py-3 px-4 text-zinc-400 text-xs">{contract.effective_from || "—"}</td>
        <td className="py-3 px-4 text-zinc-400 text-xs">{contract.effective_to || "—"}</td>
        <td className="py-3 px-4 text-center">
          <Badge variant="outline" className={`text-[10px] ${contract.status === "EXTRACTED" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
            {contract.status}
          </Badge>
        </td>
        <td className="py-3 px-4 text-center">
          <div className="flex gap-1 justify-center">
            <button onClick={onToggle} className="text-zinc-500 hover:text-zinc-200 transition-colors duration-150 p-1" data-testid={`contract-expand-${contract.id}`}>
              {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            <button onClick={onDelete} className="text-zinc-500 hover:text-red-400 transition-colors duration-150 p-1" data-testid={`contract-delete-${contract.id}`}>
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={6} className="bg-zinc-950/50 border-b border-zinc-800">
            {detailLoading ? (
              <div className="p-6 text-center text-zinc-500 animate-pulse">Loading rate card...</div>
            ) : rc ? (
              <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <InfoBlock label="Volume Divisor" value={rc.vol_divisor || "—"} />
                <InfoBlock label="Weight Tolerance" value={rc.weight_tolerance_kg ? `${rc.weight_tolerance_kg} kg` : "—"} />
                <InfoBlock label="COD Fee %" value={rc.cod_fee_pct ? `${(rc.cod_fee_pct * 100).toFixed(1)}%` : "—"} />
                <InfoBlock label="COD Fee Min" value={rc.cod_fee_min ? `Rs. ${rc.cod_fee_min}` : "—"} />
                <InfoBlock label="RTO Rate Type" value={rc.rto_rate_type || "—"} />
                <InfoBlock label="RTO Value" value={rc.rto_value || "—"} />

                {rc.allowed_surcharges?.length > 0 && (
                  <div className="col-span-full">
                    <span className="text-xs text-zinc-500 block mb-1">Allowed Surcharges</span>
                    <div className="flex flex-wrap gap-1.5">
                      {rc.allowed_surcharges.map((s, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">{s}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {rc.weight_slabs?.length > 0 && (
                  <div className="col-span-full">
                    <span className="text-xs text-zinc-500 block mb-2">Weight Slabs</span>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-zinc-500 uppercase tracking-wider">
                            <th className="text-left py-1.5 px-2 font-medium">Zone</th>
                            <th className="text-right py-1.5 px-2 font-medium">Min kg</th>
                            <th className="text-right py-1.5 px-2 font-medium">Max kg</th>
                            <th className="text-right py-1.5 px-2 font-medium">Base Rate</th>
                            <th className="text-right py-1.5 px-2 font-medium">Per kg</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rc.weight_slabs.slice(0, 20).map((s, i) => (
                            <tr key={i} className="border-t border-zinc-800/30">
                              <td className="py-1.5 px-2 text-zinc-300">{s.zone}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-zinc-400">{s.min_kg}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-zinc-400">{s.max_kg}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-zinc-300">Rs. {s.base_rate}</td>
                              <td className="py-1.5 px-2 text-right tabular-nums text-zinc-300">Rs. {s.per_kg_rate}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center text-zinc-600 text-sm">No rate card data extracted</div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function InfoBlock({ label, value }) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-md p-3">
      <span className="text-xs text-zinc-500 block mb-0.5">{label}</span>
      <span className="text-sm text-zinc-200 font-medium">{value}</span>
    </div>
  );
}
