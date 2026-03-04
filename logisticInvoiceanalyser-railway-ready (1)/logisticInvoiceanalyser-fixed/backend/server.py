from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import io
import csv
import json
import hashlib
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone

from extraction import extract_text_from_pdf, extract_invoice_data, extract_rate_card_data, detect_provider
from audit_engine import run_full_audit

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url, tlsAllowInvalidCertificates=True)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

PROVIDERS = ["BLUEDART", "DELHIVERY", "ECOM_EXPRESS", "SHADOWFAX"]


# ==================== MODELS ====================

class InvoiceResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    filename: str
    provider: str
    upload_date: str
    status: str
    total_awbs: int = 0
    total_amount: float = 0
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None

class ContractResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    filename: str
    provider: str
    upload_date: str
    status: str
    effective_from: Optional[str] = None
    effective_to: Optional[str] = None

class AuditRunResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    invoice_id: str
    contract_id: str
    provider: str
    run_date: str
    status: str
    total_checks: int = 0
    passed: int = 0
    failed: int = 0
    needs_verification: int = 0
    total_discrepancy_amount: float = 0
    bucket_a_count: int = 0
    bucket_b_count: int = 0
    bucket_c_count: int = 0


# ==================== UPLOAD ENDPOINTS ====================

@api_router.post("/upload/invoice")
async def upload_invoice(file: UploadFile = File(...), provider: str = Form(...)):
    if provider.upper() not in PROVIDERS:
        raise HTTPException(400, f"Provider must be one of: {', '.join(PROVIDERS)}")

    file_bytes = await file.read()
    file_hash = hashlib.sha256(file_bytes).hexdigest()

    # Check for duplicate by content hash
    existing = await db.invoices.find_one({"file_hash": file_hash}, {"_id": 0, "id": 1, "filename": 1})
    if existing:
        raise HTTPException(409, f"This invoice has already been uploaded (matches '{existing['filename']}')")

    invoice_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    invoice_doc = {
        "id": invoice_id,
        "filename": file.filename,
        "provider": provider.upper(),
        "upload_date": now,
        "status": "EXTRACTING",
        "total_awbs": 0,
        "total_amount": 0,
        "invoice_number": None,
        "invoice_date": None,
        "file_hash": file_hash,
        "audited": False,
    }
    await db.invoices.insert_one(invoice_doc)

    try:
        text = extract_text_from_pdf(file_bytes)
        if not text.strip():
            await db.invoices.update_one({"id": invoice_id}, {"$set": {"status": "EXTRACTION_FAILED"}})
            return {"id": invoice_id, "status": "EXTRACTION_FAILED", "message": "Could not extract text from PDF"}

        extracted = await extract_invoice_data(text, provider.upper())

        if "error" in extracted:
            await db.invoices.update_one({"id": invoice_id}, {"$set": {"status": "EXTRACTION_FAILED"}})
            return {"id": invoice_id, "status": "EXTRACTION_FAILED", "message": extracted["error"]}

        awb_items = extracted.get("awb_items", [])
        total_amount = 0

        for awb in awb_items:
            awb["id"] = str(uuid.uuid4())
            awb["invoice_id"] = invoice_id
            awb["provider"] = provider.upper()
            total_amount += awb.get("total_billed_amount", 0) or 0

        if awb_items:
            await db.awb_items.insert_many(awb_items)

        await db.invoices.update_one({"id": invoice_id}, {"$set": {
            "status": "EXTRACTED",
            "total_awbs": len(awb_items),
            "total_amount": round(total_amount, 2),
            "invoice_number": extracted.get("invoice_number"),
            "invoice_date": extracted.get("invoice_date"),
        }})

        return {
            "id": invoice_id,
            "status": "EXTRACTED",
            "total_awbs": len(awb_items),
            "total_amount": round(total_amount, 2),
            "message": f"Successfully extracted {len(awb_items)} AWB line items"
        }

    except Exception as e:
        logger.error(f"Invoice upload error: {e}")
        await db.invoices.update_one({"id": invoice_id}, {"$set": {"status": "EXTRACTION_FAILED"}})
        raise HTTPException(500, str(e))


@api_router.post("/upload/invoices")
async def upload_invoices_bulk(files: List[UploadFile] = File(...)):
    """Upload multiple invoice PDFs. Provider is auto-detected from content."""
    results = []
    for file in files:
        invoice_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        try:
            file_bytes = await file.read()
            file_hash = hashlib.sha256(file_bytes).hexdigest()

            # Check for duplicate by content hash
            existing = await db.invoices.find_one({"file_hash": file_hash}, {"_id": 0, "id": 1, "filename": 1})
            if existing:
                results.append({"id": None, "filename": file.filename, "status": "DUPLICATE", "provider": None, "provider_confidence": None, "message": f"Duplicate — already uploaded as '{existing['filename']}'"})
                continue

            invoice_doc = {
                "id": invoice_id,
                "filename": file.filename,
                "provider": "DETECTING",
                "upload_date": now,
                "status": "EXTRACTING",
                "total_awbs": 0,
                "total_amount": 0,
                "invoice_number": None,
                "invoice_date": None,
                "provider_confidence": None,
                "file_hash": file_hash,
                "audited": False,
            }
            await db.invoices.insert_one(invoice_doc)
            text = extract_text_from_pdf(file_bytes)
            if not text.strip():
                await db.invoices.update_one({"id": invoice_id}, {"$set": {"status": "EXTRACTION_FAILED", "provider": "NOT_VERIFIED"}})
                results.append({"id": invoice_id, "filename": file.filename, "status": "EXTRACTION_FAILED", "provider": "NOT_VERIFIED", "provider_confidence": None, "message": "Could not extract text from PDF"})
                continue

            # Auto-detect provider
            detection = await detect_provider(text)
            detected_provider = detection["provider"]
            confidence = detection["confidence"]

            await db.invoices.update_one({"id": invoice_id}, {"$set": {"provider": detected_provider, "provider_confidence": confidence}})

            # Extract invoice data
            extracted = await extract_invoice_data(text, detected_provider)

            if "error" in extracted:
                await db.invoices.update_one({"id": invoice_id}, {"$set": {"status": "EXTRACTION_FAILED"}})
                results.append({"id": invoice_id, "filename": file.filename, "status": "EXTRACTION_FAILED", "provider": detected_provider, "provider_confidence": confidence, "message": extracted["error"]})
                continue

            awb_items = extracted.get("awb_items", [])
            total_amount = 0
            for awb in awb_items:
                awb["id"] = str(uuid.uuid4())
                awb["invoice_id"] = invoice_id
                awb["provider"] = detected_provider
                total_amount += awb.get("total_billed_amount", 0) or 0

            if awb_items:
                await db.awb_items.insert_many(awb_items)

            await db.invoices.update_one({"id": invoice_id}, {"$set": {
                "status": "EXTRACTED",
                "total_awbs": len(awb_items),
                "total_amount": round(total_amount, 2),
                "invoice_number": extracted.get("invoice_number"),
                "invoice_date": extracted.get("invoice_date"),
            }})

            results.append({
                "id": invoice_id,
                "filename": file.filename,
                "status": "EXTRACTED",
                "provider": detected_provider,
                "provider_confidence": confidence,
                "total_awbs": len(awb_items),
                "total_amount": round(total_amount, 2),
                "message": f"Extracted {len(awb_items)} AWBs"
            })

        except Exception as e:
            logger.error(f"Bulk invoice upload error for {file.filename}: {e}")
            await db.invoices.update_one({"id": invoice_id}, {"$set": {"status": "EXTRACTION_FAILED", "provider": "NOT_VERIFIED"}})
            results.append({"id": invoice_id, "filename": file.filename, "status": "EXTRACTION_FAILED", "provider": "NOT_VERIFIED", "provider_confidence": None, "message": str(e)})

    return {"count": len(results), "results": results}



@api_router.get("/contracts/check-provider/{provider}")
async def check_contract_for_provider(provider: str):
    """Check if a contract already exists for this provider."""
    existing = await db.contracts.find_one(
        {"provider": provider.upper(), "status": "EXTRACTED"},
        {"_id": 0, "id": 1, "filename": 1, "upload_date": 1, "effective_from": 1, "effective_to": 1}
    )
    if existing:
        return {"exists": True, "contract": existing}
    return {"exists": False}


@api_router.post("/upload/contract")
async def upload_contract(file: UploadFile = File(...), provider: str = Form(...), replace: str = Form("false")):
    if provider.upper() not in PROVIDERS:
        raise HTTPException(400, f"Provider must be one of: {', '.join(PROVIDERS)}")

    # Check for existing contract
    existing = await db.contracts.find_one({"provider": provider.upper(), "status": "EXTRACTED"}, {"_id": 0, "id": 1})
    if existing and replace.lower() != "true":
        raise HTTPException(409, f"A contract already exists for {provider.upper()}. Send replace=true to overwrite.")

    # If replacing, delete old contract + rate card
    if existing and replace.lower() == "true":
        old_id = existing["id"]
        await db.rate_cards.delete_many({"contract_id": old_id})
        await db.contracts.delete_one({"id": old_id})

    file_bytes = await file.read()
    contract_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    contract_doc = {
        "id": contract_id,
        "filename": file.filename,
        "provider": provider.upper(),
        "upload_date": now,
        "status": "EXTRACTING",
        "effective_from": None,
        "effective_to": None,
    }
    await db.contracts.insert_one(contract_doc)

    try:
        text = extract_text_from_pdf(file_bytes)
        if not text.strip():
            await db.contracts.update_one({"id": contract_id}, {"$set": {"status": "EXTRACTION_FAILED"}})
            return {"id": contract_id, "status": "EXTRACTION_FAILED", "message": "Could not extract text from PDF"}

        extracted = await extract_rate_card_data(text, provider.upper())

        if "error" in extracted:
            await db.contracts.update_one({"id": contract_id}, {"$set": {"status": "EXTRACTION_FAILED"}})
            return {"id": contract_id, "status": "EXTRACTION_FAILED", "message": extracted["error"]}

        rate_card_id = str(uuid.uuid4())
        rate_card_doc = {
            "id": rate_card_id,
            "contract_id": contract_id,
            "provider": provider.upper(),
            "zone_matrix": extracted.get("zone_matrix"),
            "weight_slabs": extracted.get("weight_slabs"),
            "vol_divisor": extracted.get("vol_divisor", 5000),
            "weight_tolerance_kg": extracted.get("weight_tolerance_kg", 0.5),
            "cod_fee_pct": extracted.get("cod_fee_pct"),
            "cod_fee_min": extracted.get("cod_fee_min"),
            "rto_rate_type": extracted.get("rto_rate_type"),
            "rto_value": extracted.get("rto_value"),
            "allowed_surcharges": extracted.get("allowed_surcharges"),
            "fuel_surcharge_pct": extracted.get("fuel_surcharge_pct"),
        }
        await db.rate_cards.insert_one(rate_card_doc)

        await db.contracts.update_one({"id": contract_id}, {"$set": {
            "status": "EXTRACTED",
            "effective_from": extracted.get("effective_from"),
            "effective_to": extracted.get("effective_to"),
        }})

        return {
            "id": contract_id,
            "status": "EXTRACTED",
            "message": "Rate card extracted successfully"
        }

    except Exception as e:
        logger.error(f"Contract upload error: {e}")
        await db.contracts.update_one({"id": contract_id}, {"$set": {"status": "EXTRACTION_FAILED"}})
        raise HTTPException(500, str(e))


@api_router.post("/upload/order-data")
async def upload_order_data(file: UploadFile = File(...)):
    """Upload order data CSV as ERP alternative."""
    file_bytes = await file.read()
    text = file_bytes.decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))

    records = []
    for row in reader:
        record = {
            "id": str(uuid.uuid4()),
            "awb_number": row.get("awb_number", "").strip().upper(),
            "sku_dimensions": None,
            "actual_delivery_status": row.get("actual_delivery_status", "").strip().upper(),
            "cod_value": float(row.get("cod_value", 0) or 0),
            "upload_date": datetime.now(timezone.utc).isoformat(),
        }
        l = float(row.get("length_cm", 0) or 0)
        w = float(row.get("width_cm", 0) or 0)
        h = float(row.get("height_cm", 0) or 0)
        if l > 0 and w > 0 and h > 0:
            record["sku_dimensions"] = {"l": l, "w": w, "h": h}
        records.append(record)

    if records:
        await db.order_data.insert_many(records)

    return {"count": len(records), "message": f"Uploaded {len(records)} order records"}


# ==================== LIST/GET ENDPOINTS ====================

@api_router.get("/invoices")
async def list_invoices():
    invoices = await db.invoices.find({}, {"_id": 0}).sort("upload_date", -1).to_list(100)
    return invoices


@api_router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    awb_items = await db.awb_items.find({"invoice_id": invoice_id}, {"_id": 0}).to_list(10000)
    invoice["awb_items"] = awb_items
    return invoice


@api_router.get("/contracts")
async def list_contracts():
    contracts = await db.contracts.find({}, {"_id": 0}).sort("upload_date", -1).to_list(100)
    return contracts


@api_router.get("/contracts/{contract_id}")
async def get_contract(contract_id: str):
    contract = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not contract:
        raise HTTPException(404, "Contract not found")
    rate_card = await db.rate_cards.find_one({"contract_id": contract_id}, {"_id": 0})
    contract["rate_card"] = rate_card
    return contract


# ==================== DELETE ENDPOINTS ====================

@api_router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0, "id": 1})
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    await db.awb_items.delete_many({"invoice_id": invoice_id})
    await db.awb_history.delete_many({"invoice_id": invoice_id})
    await db.invoices.delete_one({"id": invoice_id})
    return {"message": "Invoice deleted"}


@api_router.delete("/contracts/{contract_id}")
async def delete_contract(contract_id: str):
    contract = await db.contracts.find_one({"id": contract_id}, {"_id": 0, "id": 1})
    if not contract:
        raise HTTPException(404, "Contract not found")
    await db.rate_cards.delete_many({"contract_id": contract_id})
    await db.contracts.delete_one({"id": contract_id})
    return {"message": "Contract deleted"}


@api_router.delete("/audit/runs/{run_id}")
async def delete_audit_run(run_id: str):
    run = await db.audit_runs.find_one({"id": run_id}, {"_id": 0, "id": 1, "invoice_id": 1})
    if not run:
        raise HTTPException(404, "Audit run not found")
    await db.audit_results.delete_many({"audit_run_id": run_id})
    await db.audit_runs.delete_one({"id": run_id})
    # Unmark invoice as audited so it can be re-audited
    remaining = await db.audit_runs.count_documents({"invoice_id": run["invoice_id"]})
    if remaining == 0:
        await db.invoices.update_one({"id": run["invoice_id"]}, {"$set": {"audited": False}})
    return {"message": "Audit run deleted"}


# ==================== AUDIT ENDPOINTS ====================

@api_router.post("/audit/run")
async def run_audit(invoice_id: str = Form(...), contract_id: str = Form(...)):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(404, "Invoice not found")

    # Prevent re-auditing
    if invoice.get("audited"):
        raise HTTPException(409, "This invoice has already been audited")

    contract = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not contract:
        raise HTTPException(404, "Contract not found")

    if invoice["provider"] != contract["provider"]:
        raise HTTPException(400, "Invoice and contract must be from the same provider")

    awb_items = await db.awb_items.find({"invoice_id": invoice_id}, {"_id": 0}).to_list(10000)
    rate_card = await db.rate_cards.find_one({"contract_id": contract_id}, {"_id": 0})

    # Get historical AWBs for duplicate check
    awb_numbers = [a.get("awb_number") for a in awb_items if a.get("awb_number")]
    awb_history = await db.awb_history.find(
        {"awb_number": {"$in": awb_numbers}, "invoice_id": {"$ne": invoice_id}},
        {"_id": 0}
    ).to_list(50000)

    # Get order data if available
    order_data_list = await db.order_data.find(
        {"awb_number": {"$in": awb_numbers}},
        {"_id": 0}
    ).to_list(50000)
    order_data_map = {od["awb_number"]: od for od in order_data_list}

    # Run audit
    audit_results = await run_full_audit(awb_items, rate_card or {}, awb_history, order_data_map)

    # Calculate summary
    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    passed = sum(1 for r in audit_results if r["status"] == "PASS")
    failed = sum(1 for r in audit_results if r["status"] == "FAIL")
    skipped = sum(1 for r in audit_results if r["status"] == "SKIP")
    total_disc = sum(r.get("discrepancy_amount", 0) for r in audit_results if r["status"] == "FAIL")
    bucket_a = sum(1 for r in audit_results if r.get("bucket") == "A")
    bucket_b = sum(1 for r in audit_results if r.get("bucket") == "B")
    bucket_c = sum(1 for r in audit_results if r.get("bucket") == "C")

    # Save results
    for r in audit_results:
        r["id"] = str(uuid.uuid4())
        r["audit_run_id"] = run_id

    if audit_results:
        await db.audit_results.insert_many(audit_results)

    # Save AWBs to history
    history_records = []
    for awb in awb_items:
        history_records.append({
            "awb_number": awb.get("awb_number"),
            "provider": invoice["provider"],
            "invoice_id": invoice_id,
            "shipment_date": awb.get("shipment_date"),
            "shipment_type": awb.get("shipment_type"),
            "amount": awb.get("total_billed_amount", 0),
        })
    if history_records:
        await db.awb_history.insert_many(history_records)

    audit_run = {
        "id": run_id,
        "invoice_id": invoice_id,
        "contract_id": contract_id,
        "provider": invoice["provider"],
        "run_date": now,
        "status": "COMPLETED",
        "total_checks": len(audit_results),
        "passed": passed,
        "failed": failed,
        "needs_verification": skipped,
        "total_discrepancy_amount": round(total_disc, 2),
        "bucket_a_count": bucket_a,
        "bucket_b_count": bucket_b,
        "bucket_c_count": bucket_c,
        "invoice_filename": invoice.get("filename"),
        "contract_filename": contract.get("filename"),
    }
    await db.audit_runs.insert_one(audit_run)

    # Mark invoice as audited
    await db.invoices.update_one({"id": invoice_id}, {"$set": {"audited": True}})

    return {k: v for k, v in audit_run.items() if k != "_id"}


@api_router.post("/audit/run-bulk")
async def run_bulk_audit(provider: str = Form(...)):
    """Run audit on ALL non-audited invoices for a provider using that provider's single contract."""
    provider = provider.upper()
    if provider not in PROVIDERS:
        raise HTTPException(400, f"Provider must be one of: {', '.join(PROVIDERS)}")

    # Find the single contract for this provider
    contract = await db.contracts.find_one(
        {"provider": provider, "status": "EXTRACTED"}, {"_id": 0}
    )
    if not contract:
        raise HTTPException(404, f"No extracted contract found for {provider}")

    contract_id = contract["id"]
    rate_card = await db.rate_cards.find_one({"contract_id": contract_id}, {"_id": 0})

    # Find all non-audited, extracted invoices for this provider
    pending_invoices = await db.invoices.find(
        {"provider": provider, "status": "EXTRACTED", "$or": [{"audited": False}, {"audited": {"$exists": False}}]},
        {"_id": 0}
    ).to_list(500)

    if not pending_invoices:
        raise HTTPException(404, f"No pending invoices found for {provider}")

    bulk_results = []

    for invoice in pending_invoices:
        invoice_id = invoice["id"]
        awb_items = await db.awb_items.find({"invoice_id": invoice_id}, {"_id": 0}).to_list(10000)

        awb_numbers = [a.get("awb_number") for a in awb_items if a.get("awb_number")]
        awb_history = await db.awb_history.find(
            {"awb_number": {"$in": awb_numbers}, "invoice_id": {"$ne": invoice_id}},
            {"_id": 0}
        ).to_list(50000)

        order_data_list = await db.order_data.find(
            {"awb_number": {"$in": awb_numbers}}, {"_id": 0}
        ).to_list(50000)
        order_data_map = {od["awb_number"]: od for od in order_data_list}

        audit_results = await run_full_audit(awb_items, rate_card or {}, awb_history, order_data_map)

        run_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        passed = sum(1 for r in audit_results if r["status"] == "PASS")
        failed = sum(1 for r in audit_results if r["status"] == "FAIL")
        skipped = sum(1 for r in audit_results if r["status"] == "SKIP")
        total_disc = sum(r.get("discrepancy_amount", 0) for r in audit_results if r["status"] == "FAIL")
        bucket_a = sum(1 for r in audit_results if r.get("bucket") == "A")
        bucket_b = sum(1 for r in audit_results if r.get("bucket") == "B")
        bucket_c = sum(1 for r in audit_results if r.get("bucket") == "C")

        for r in audit_results:
            r["id"] = str(uuid.uuid4())
            r["audit_run_id"] = run_id

        if audit_results:
            await db.audit_results.insert_many(audit_results)

        history_records = []
        for awb in awb_items:
            history_records.append({
                "awb_number": awb.get("awb_number"),
                "provider": provider,
                "invoice_id": invoice_id,
                "shipment_date": awb.get("shipment_date"),
                "shipment_type": awb.get("shipment_type"),
                "amount": awb.get("total_billed_amount", 0),
            })
        if history_records:
            await db.awb_history.insert_many(history_records)

        audit_run = {
            "id": run_id,
            "invoice_id": invoice_id,
            "contract_id": contract_id,
            "provider": provider,
            "run_date": now,
            "status": "COMPLETED",
            "total_checks": len(audit_results),
            "passed": passed,
            "failed": failed,
            "needs_verification": skipped,
            "total_discrepancy_amount": round(total_disc, 2),
            "bucket_a_count": bucket_a,
            "bucket_b_count": bucket_b,
            "bucket_c_count": bucket_c,
            "invoice_filename": invoice.get("filename"),
            "contract_filename": contract.get("filename"),
        }
        await db.audit_runs.insert_one(audit_run)
        await db.invoices.update_one({"id": invoice_id}, {"$set": {"audited": True}})

        bulk_results.append({k: v for k, v in audit_run.items() if k != "_id"})

    return {
        "provider": provider,
        "invoices_audited": len(bulk_results),
        "total_failed": sum(r["failed"] for r in bulk_results),
        "total_discrepancy": round(sum(r["total_discrepancy_amount"] for r in bulk_results), 2),
        "runs": bulk_results,
    }


@api_router.get("/audit/runs")
async def list_audit_runs():
    runs = await db.audit_runs.find({}, {"_id": 0}).sort("run_date", -1).to_list(100)
    return runs


@api_router.get("/audit/runs/{run_id}")
async def get_audit_run(run_id: str):
    run = await db.audit_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(404, "Audit run not found")
    results = await db.audit_results.find({"audit_run_id": run_id}, {"_id": 0}).to_list(50000)
    run["results"] = results
    return run


@api_router.get("/audit/export/{run_id}")
async def export_audit_csv(run_id: str):
    run = await db.audit_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(404, "Audit run not found")

    results = await db.audit_results.find({"audit_run_id": run_id}, {"_id": 0}).to_list(50000)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["AWB Number", "Check Type", "Status", "Bucket", "Expected Value", "Actual Value", "Discrepancy Amount", "Details"])

    for r in results:
        writer.writerow([
            r.get("awb_number", ""),
            r.get("check_type", ""),
            r.get("status", ""),
            r.get("bucket", ""),
            r.get("expected_value", ""),
            r.get("actual_value", ""),
            r.get("discrepancy_amount", ""),
            r.get("details", ""),
        ])

    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=audit_{run_id}.csv"}
    )


# ==================== DASHBOARD ====================

@api_router.get("/dashboard/stats")
async def dashboard_stats():
    total_invoices = await db.invoices.count_documents({})
    total_contracts = await db.contracts.count_documents({})
    total_audit_runs = await db.audit_runs.count_documents({})

    # Get aggregated stats from audit runs
    pipeline = [
        {"$group": {
            "_id": None,
            "total_discrepancy": {"$sum": "$total_discrepancy_amount"},
            "total_checks": {"$sum": "$total_checks"},
            "total_passed": {"$sum": "$passed"},
            "total_failed": {"$sum": "$failed"},
            "bucket_a": {"$sum": "$bucket_a_count"},
            "bucket_b": {"$sum": "$bucket_b_count"},
            "bucket_c": {"$sum": "$bucket_c_count"},
        }}
    ]
    agg_result = await db.audit_runs.aggregate(pipeline).to_list(1)
    agg = agg_result[0] if agg_result else {}

    # Provider breakdown
    provider_pipeline = [
        {"$group": {
            "_id": "$provider",
            "count": {"$sum": 1},
            "total_discrepancy": {"$sum": "$total_discrepancy_amount"},
            "total_failed": {"$sum": "$failed"},
        }}
    ]
    provider_stats = await db.audit_runs.aggregate(provider_pipeline).to_list(10)

    # Recent audit runs
    recent_runs = await db.audit_runs.find({}, {"_id": 0}).sort("run_date", -1).to_list(5)

    return {
        "total_invoices": total_invoices,
        "total_contracts": total_contracts,
        "total_audit_runs": total_audit_runs,
        "total_discrepancy": round(agg.get("total_discrepancy", 0), 2),
        "total_checks": agg.get("total_checks", 0),
        "total_passed": agg.get("total_passed", 0),
        "total_failed": agg.get("total_failed", 0),
        "bucket_a": agg.get("bucket_a", 0),
        "bucket_b": agg.get("bucket_b", 0),
        "bucket_c": agg.get("bucket_c", 0),
        "provider_stats": [{"provider": p["_id"], "count": p["count"], "total_discrepancy": round(p["total_discrepancy"], 2), "total_failed": p["total_failed"]} for p in provider_stats],
        "recent_runs": recent_runs,
    }


@api_router.get("/")
async def root():
    return {"message": "Bill Audit System API"}


# Include router
app.include_router(api_router, prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
