import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Upload from "@/pages/Upload";
import Invoices from "@/pages/Invoices";
import Contracts from "@/pages/Contracts";
import AuditEngine from "@/pages/AuditEngine";
import AuditDetail from "@/pages/AuditDetail";
import ManualUpload from "@/pages/ManualUpload";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/contracts" element={<Contracts />} />
            <Route path="/audit" element={<AuditEngine />} />
            <Route path="/audit/:runId" element={<AuditDetail />} />
            <Route path="/manual-upload" element={<ManualUpload />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" theme="dark" richColors />
    </div>
  );
}

export default App;
