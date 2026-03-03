import { useState } from "react";
import axios from "axios";
import { Database, Upload, Loader2, CheckCircle, FileSpreadsheet } from "lucide-react";
import { Button } from "../components/ui/button";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function ManualUpload() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleUpload = async () => {
    if (!file) { toast.error("Select a CSV file"); return; }
    setLoading(true);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await axios.post(`${API}/upload/order-data`, fd);
      setResult(res.data);
      toast.success(res.data.message || "Upload complete");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Upload failed");
    }
    setLoading(false);
  };

  return (
    <div className="p-6 md:p-8 lg:p-10 space-y-8" data-testid="manual-upload-page">
      <div>
        <h1 className="font-heading text-3xl sm:text-4xl font-bold text-zinc-100">Order Data Upload</h1>
        <p className="text-zinc-500 text-sm mt-1">Upload order data CSV as an alternative to ERP integration for enriched audit checks</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6" data-testid="order-upload-card">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
              <Database className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h2 className="font-heading font-semibold text-zinc-100">Order Data CSV</h2>
              <p className="text-xs text-zinc-500">Used for weight verification, delivery status, COD values</p>
            </div>
          </div>

          <div className="space-y-4">
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-700 rounded-lg p-8 cursor-pointer hover:border-zinc-600 transition-colors duration-150" data-testid="order-file-drop">
              <FileSpreadsheet className="w-10 h-10 text-zinc-600 mb-3" />
              <span className="text-sm text-zinc-400">{file ? file.name : "Click to select CSV file"}</span>
              <span className="text-xs text-zinc-600 mt-1">Supports .csv files</span>
              <input type="file" accept=".csv" className="hidden" onChange={e => setFile(e.target.files[0])} data-testid="order-file-input" />
            </label>

            <Button onClick={handleUpload} disabled={loading || !file} className="w-full bg-violet-600 hover:bg-violet-700 text-white" data-testid="order-upload-btn">
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...</> : <><Upload className="w-4 h-4 mr-2" /> Upload Order Data</>}
            </Button>

            {result && (
              <div className="flex items-center gap-3 p-3 rounded-md bg-emerald-500/5 border border-emerald-500/20 text-emerald-400" data-testid="order-upload-result">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm">{result.message}</span>
              </div>
            )}
          </div>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
          <h3 className="font-heading font-semibold text-zinc-200 mb-4">CSV Format Guide</h3>
          <p className="text-xs text-zinc-500 mb-3">Your CSV should include these columns:</p>
          <div className="space-y-2 text-xs">
            <FormatRow field="awb_number" desc="Air Waybill number (must match invoice AWBs)" required />
            <FormatRow field="length_cm" desc="Package length in centimeters" />
            <FormatRow field="width_cm" desc="Package width in centimeters" />
            <FormatRow field="height_cm" desc="Package height in centimeters" />
            <FormatRow field="actual_delivery_status" desc="DELIVERED, RTO, IN_TRANSIT, or LOST" />
            <FormatRow field="cod_value" desc="COD collection amount" />
          </div>
          <div className="mt-5 p-3 bg-zinc-950 border border-zinc-800 rounded-md font-mono text-[10px] text-zinc-500 overflow-x-auto">
            awb_number,length_cm,width_cm,height_cm,actual_delivery_status,cod_value<br />
            AWB001,30,20,15,DELIVERED,0<br />
            AWB002,25,18,12,RTO,500
          </div>
        </div>
      </div>
    </div>
  );
}

function FormatRow({ field, desc, required }) {
  return (
    <div className="flex items-start gap-2">
      <code className="font-mono text-blue-400 bg-zinc-950 px-1.5 py-0.5 rounded text-[10px] flex-shrink-0">{field}</code>
      <span className="text-zinc-400">{desc}</span>
      {required && <span className="text-red-400 text-[10px] flex-shrink-0">required</span>}
    </div>
  );
}
