import { useState } from "react";
import axios from "axios";
import { Upload as UploadIcon, FileText, FileCheck, Loader2, CheckCircle, XCircle, X, ShieldAlert, ShieldCheck as ShieldOk, AlertTriangle } from "lucide-react";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const PROVIDERS = ["BLUEDART", "DELHIVERY", "ECOM_EXPRESS", "SHADOWFAX"];

export default function UploadPage() {
  const [invoiceFiles, setInvoiceFiles] = useState([]);
  const [contractFile, setContractFile] = useState(null);
  const [contractProvider, setContractProvider] = useState("");
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [contractLoading, setContractLoading] = useState(false);
  const [invoiceResults, setInvoiceResults] = useState([]);
  const [contractResult, setContractResult] = useState(null);
  const [confirmReplace, setConfirmReplace] = useState(null); // {existingContract, resolve}

  const handleInvoiceFilesChange = (e) => {
    const files = Array.from(e.target.files || []);
    setInvoiceFiles((prev) => [...prev, ...files]);
  };

  const removeInvoiceFile = (index) => {
    setInvoiceFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleInvoiceUpload = async () => {
    if (invoiceFiles.length === 0) {
      toast.error("Select at least one invoice PDF");
      return;
    }
    setInvoiceLoading(true);
    setInvoiceResults([]);
    const fd = new FormData();
    invoiceFiles.forEach((f) => fd.append("files", f));
    try {
      const res = await axios.post(`${API}/upload/invoices`, fd);
      setInvoiceResults(res.data.results || []);
      const extracted = (res.data.results || []).filter((r) => r.status === "EXTRACTED").length;
      toast.success(`${extracted}/${res.data.count} invoice(s) extracted successfully`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Upload failed");
    } finally {
      setInvoiceLoading(false);
    }
  };

  const handleContractUpload = async () => {
    if (!contractFile || !contractProvider) {
      toast.error("Select a provider and file");
      return;
    }
    setContractLoading(true);
    setContractResult(null);

    try {
      // Check if a contract already exists for this provider
      const check = await axios.get(`${API}/contracts/check-provider/${contractProvider}`);
      let shouldReplace = false;

      if (check.data.exists) {
        // Ask for confirmation via dialog
        shouldReplace = await new Promise((resolve) => {
          setConfirmReplace({ existingContract: check.data.contract, resolve });
        });
        setConfirmReplace(null);

        if (!shouldReplace) {
          toast.info("Upload cancelled — existing contract retained");
          setContractLoading(false);
          return;
        }
      }

      const fd = new FormData();
      fd.append("file", contractFile);
      fd.append("provider", contractProvider);
      if (shouldReplace) fd.append("replace", "true");

      const res = await axios.post(`${API}/upload/contract`, fd);
      setContractResult(res.data);
      toast.success(
        shouldReplace
          ? "Contract replaced & extracted successfully"
          : res.data.message || "Contract uploaded"
      );
    } catch (e) {
      toast.error(e.response?.data?.detail || "Upload failed");
      setContractResult({ status: "ERROR", message: e.response?.data?.detail || e.message });
    } finally {
      setContractLoading(false);
    }
  };

  return (
    <div className="p-6 md:p-8 lg:p-10 space-y-8" data-testid="upload-page">
      <div>
        <h1 className="font-heading text-3xl sm:text-4xl font-bold text-zinc-100">
          Upload Documents
        </h1>
        <p className="text-zinc-500 text-sm mt-1">
          Upload invoice PDFs and contract/rate card PDFs for extraction
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Invoice Upload - Multi-file with auto-detect */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6" data-testid="invoice-upload-card">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="font-heading font-semibold text-zinc-100">Invoice PDFs</h2>
              <p className="text-xs text-zinc-500">Upload one or more invoices — provider is auto-detected</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block font-medium">Files</label>
              <label
                className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-700 rounded-lg p-6 cursor-pointer hover:border-zinc-600 transition-colors duration-150"
                data-testid="invoice-file-drop"
              >
                <UploadIcon className="w-8 h-8 text-zinc-600 mb-2" />
                <span className="text-sm text-zinc-400">
                  {invoiceFiles.length > 0
                    ? `${invoiceFiles.length} file(s) selected`
                    : "Click to select one or more PDFs"}
                </span>
                <span className="text-[10px] text-zinc-600 mt-1">Provider will be auto-detected from content</span>
                <input
                  type="file"
                  accept=".pdf"
                  multiple
                  className="hidden"
                  onChange={handleInvoiceFilesChange}
                  data-testid="invoice-file-input"
                />
              </label>
            </div>

            {invoiceFiles.length > 0 && (
              <div className="space-y-1.5 max-h-40 overflow-y-auto" data-testid="invoice-file-list">
                {invoiceFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2">
                    <FileText className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                    <span className="text-zinc-300 truncate flex-1">{f.name}</span>
                    <span className="text-zinc-600 tabular-nums flex-shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                    <button
                      onClick={() => removeInvoiceFile(i)}
                      className="text-zinc-600 hover:text-red-400 transition-colors duration-150 flex-shrink-0"
                      data-testid={`remove-invoice-file-${i}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Button
              onClick={handleInvoiceUpload}
              disabled={invoiceLoading || invoiceFiles.length === 0}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="invoice-upload-btn"
            >
              {invoiceLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Detecting & Extracting...
                </>
              ) : (
                <>
                  <UploadIcon className="w-4 h-4 mr-2" /> Upload & Auto-Extract ({invoiceFiles.length})
                </>
              )}
            </Button>

            {invoiceResults.length > 0 && (
              <div className="space-y-2" data-testid="invoice-results-list">
                {invoiceResults.map((r, i) => (
                  <InvoiceResultRow key={i} result={r} index={i} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Contract Upload */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6" data-testid="contract-upload-card">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <FileCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="font-heading font-semibold text-zinc-100">Contract / Rate Card PDF</h2>
              <p className="text-xs text-zinc-500">Upload contract for rate card extraction</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block font-medium">Provider</label>
              <Select value={contractProvider} onValueChange={setContractProvider}>
                <SelectTrigger className="bg-zinc-950 border-zinc-800 text-zinc-200" data-testid="contract-provider-select">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p} className="text-zinc-200 focus:bg-zinc-800">
                      {p.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block font-medium">File</label>
              <label
                className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-700 rounded-lg p-6 cursor-pointer hover:border-zinc-600 transition-colors duration-150"
                data-testid="contract-file-drop"
              >
                <UploadIcon className="w-8 h-8 text-zinc-600 mb-2" />
                <span className="text-sm text-zinc-400">
                  {contractFile ? contractFile.name : "Click to select PDF"}
                </span>
                <input
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => setContractFile(e.target.files[0])}
                  data-testid="contract-file-input"
                />
              </label>
            </div>

            <Button
              onClick={handleContractUpload}
              disabled={contractLoading || !contractFile || !contractProvider}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              data-testid="contract-upload-btn"
            >
              {contractLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Extracting...
                </>
              ) : (
                <>
                  <UploadIcon className="w-4 h-4 mr-2" /> Upload & Extract
                </>
              )}
            </Button>

            {contractResult && (
              <ResultBanner result={contractResult} testId="contract-result" />
            )}
          </div>
        </div>
      </div>

      {/* Replace Contract Confirmation Dialog */}
      <AlertDialog open={!!confirmReplace} onOpenChange={(open) => { if (!open && confirmReplace) { confirmReplace.resolve(false); setConfirmReplace(null); } }}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800" data-testid="replace-contract-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              Contract Already Exists
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              A contract for <span className="text-zinc-200 font-medium">{contractProvider?.replace("_", " ")}</span> already exists.
              {confirmReplace?.existingContract && (
                <span className="block mt-2 text-xs text-zinc-500">
                  Current: <span className="text-zinc-400">{confirmReplace.existingContract.filename}</span>
                  {confirmReplace.existingContract.upload_date && (
                    <> — uploaded {new Date(confirmReplace.existingContract.upload_date).toLocaleDateString()}</>
                  )}
                </span>
              )}
              <span className="block mt-2">
                Uploading a new contract will <span className="text-red-400 font-medium">permanently replace</span> the existing one and its rate card. Continue?
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700"
              onClick={() => { if (confirmReplace) confirmReplace.resolve(false); setConfirmReplace(null); }}
              data-testid="replace-cancel-btn"
            >
              Keep Existing
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => { if (confirmReplace) confirmReplace.resolve(true); }}
              data-testid="replace-confirm-btn"
            >
              Replace Contract
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ResultBanner({ result, testId }) {
  const isSuccess = result.status === "EXTRACTED";
  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-md border ${
        isSuccess
          ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-400"
          : "bg-red-500/5 border-red-500/20 text-red-400"
      }`}
      data-testid={testId}
    >
      {isSuccess ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
      <div className="text-sm">
        <div className="font-medium">{isSuccess ? "Extraction Complete" : "Extraction Failed"}</div>
        <div className="text-xs opacity-80 mt-0.5">{result.message}</div>
        {result.total_awbs !== undefined && (
          <div className="text-xs opacity-80">
            {result.total_awbs} AWBs | Rs. {(result.total_amount || 0).toLocaleString("en-IN")}
          </div>
        )}
      </div>
    </div>
  );
}

function InvoiceResultRow({ result, index }) {
  const isSuccess = result.status === "EXTRACTED";
  const isDuplicate = result.status === "DUPLICATE";
  const isNotVerified = result.provider === "NOT_VERIFIED";
  const isLowConf = result.provider_confidence === "LOW";

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-md border ${
        isSuccess
          ? "bg-zinc-900/50 border-zinc-800"
          : isDuplicate
          ? "bg-yellow-500/5 border-yellow-500/20"
          : "bg-red-500/5 border-red-500/20"
      }`}
      data-testid={`invoice-result-${index}`}
    >
      {isSuccess ? (
        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-400" />
      ) : isDuplicate ? (
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-yellow-400" />
      ) : (
        <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-400" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-zinc-200 truncate">{result.filename}</span>
          {isDuplicate ? (
            <Badge variant="outline" className="text-[10px] bg-yellow-500/10 text-yellow-400 border-yellow-500/20" data-testid={`provider-badge-${index}`}>
              DUPLICATE
            </Badge>
          ) : isNotVerified ? (
            <Badge variant="outline" className="text-[10px] bg-orange-500/10 text-orange-400 border-orange-500/20" data-testid={`provider-badge-${index}`}>
              <ShieldAlert className="w-3 h-3 mr-1" /> NOT VERIFIED
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className={`text-[10px] ${
                isLowConf
                  ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                  : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              }`}
              data-testid={`provider-badge-${index}`}
            >
              {isLowConf ? <ShieldAlert className="w-3 h-3 mr-1" /> : <ShieldOk className="w-3 h-3 mr-1" />}
              {result.provider?.replace("_", " ")}
              {isLowConf && " (low confidence)"}
            </Badge>
          )}
        </div>
        <div className="text-xs text-zinc-500 mt-0.5">{result.message}</div>
        {result.total_awbs !== undefined && (
          <div className="text-xs text-zinc-400 mt-0.5 tabular-nums">
            {result.total_awbs} AWBs | Rs. {(result.total_amount || 0).toLocaleString("en-IN")}
          </div>
        )}
      </div>
    </div>
  );
}
