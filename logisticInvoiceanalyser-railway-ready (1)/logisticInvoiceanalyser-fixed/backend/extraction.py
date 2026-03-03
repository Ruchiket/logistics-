import json
import logging
import os
import io
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
import pdfplumber

load_dotenv(Path(__file__).parent / '.env')

logger = logging.getLogger(__name__)

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract text from PDF bytes using pdfplumber."""
    text_parts = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
            tables = page.extract_tables()
            for table in tables:
                for row in table:
                    if row:
                        text_parts.append(" | ".join([str(cell) if cell else "" for cell in row]))
    return "\n".join(text_parts)


async def detect_provider(text: str) -> dict:
    """Auto-detect logistics provider from invoice PDF text.
    Returns {"provider": "BLUEDART"|...|"NOT_VERIFIED", "confidence": "HIGH"|"LOW"}
    """
    text_upper = text.upper()

    # Fast keyword matching first
    keyword_map = {
        "BLUEDART": ["BLUE DART", "BLUEDART", "BLUE-DART", "BDE", "BDEL"],
        "DELHIVERY": ["DELHIVERY", "DELHIVRY"],
        "ECOM_EXPRESS": ["ECOM EXPRESS", "ECOMEXPRESS", "ECOM_EXPRESS", "ECE"],
        "SHADOWFAX": ["SHADOWFAX", "SHADOW FAX"],
    }
    matches = {}
    for provider, keywords in keyword_map.items():
        count = sum(text_upper.count(kw) for kw in keywords)
        if count > 0:
            matches[provider] = count

    if len(matches) == 1:
        detected = list(matches.keys())[0]
        return {"provider": detected, "confidence": "HIGH"}
    if len(matches) > 1:
        # Multiple providers found — pick the one with most hits
        top = max(matches, key=matches.get)
        second = sorted(matches.values(), reverse=True)[1]
        if matches[top] >= second * 3:
            return {"provider": top, "confidence": "HIGH"}
        # Ambiguous — fall through to OpenAI

    # OpenAI fallback for ambiguous/no-match cases
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": (
                    "You identify the logistics provider from an invoice. "
                    "Return JSON: {\"provider\": \"BLUEDART\"|\"DELHIVERY\"|\"ECOM_EXPRESS\"|\"SHADOWFAX\"|\"NOT_VERIFIED\", \"confidence\": \"HIGH\"|\"LOW\"}. "
                    "Use NOT_VERIFIED only if you genuinely cannot determine the provider."
                )},
                {"role": "user", "content": text[:4000]}
            ],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=60,
        )
        result = json.loads(response.choices[0].message.content)
        provider = result.get("provider", "NOT_VERIFIED").upper()
        valid = ["BLUEDART", "DELHIVERY", "ECOM_EXPRESS", "SHADOWFAX", "NOT_VERIFIED"]
        if provider not in valid:
            provider = "NOT_VERIFIED"
        return {"provider": provider, "confidence": result.get("confidence", "LOW")}
    except Exception as e:
        logger.error(f"Provider detection AI error: {e}")
        return {"provider": "NOT_VERIFIED", "confidence": "LOW"}


async def extract_invoice_data(text: str, provider: str) -> dict:
    """Use OpenAI to extract structured AWB line items from invoice text."""
    system_prompt = """You are a logistics invoice data extraction expert. Extract ALL AWB (Air Waybill) line items from the invoice text.

For each AWB, extract these fields:
- awb_number: string (primary key, strip whitespace, uppercase)
- shipment_date: string (YYYY-MM-DD format)
- origin_pincode: string (6 digits)
- destination_pincode: string (6 digits)
- billed_zone: string (normalize to standard zone names like A, B, C, D, E or WITHIN_CITY, WITHIN_STATE, METRO, ROI, SPECIAL)
- billed_dead_weight_kg: float (physical weight)
- billed_vol_weight_kg: float (volumetric weight, 0 if not present)
- billed_chargeable_weight_kg: float (MAX of dead and vol weight)
- base_freight: float
- surcharges: list of objects with {name: string, amount: float, pct_applied: float or null}
- total_billed_amount: float
- payment_mode: "COD" or "PREPAID"
- cod_value: float (0 if prepaid)
- shipment_type: "FORWARD" or "RTO" or "SURFACE"

Return a JSON object with:
{
  "provider": "detected provider name",
  "invoice_number": "invoice number if found",
  "invoice_date": "YYYY-MM-DD",
  "billing_period_from": "YYYY-MM-DD or null",
  "billing_period_to": "YYYY-MM-DD or null",
  "total_amount": float,
  "awb_items": [array of AWB objects]
}

If you cannot extract a field, use null. Extract ALL line items, not just a sample. Be thorough."""

    user_prompt = f"Provider: {provider}\n\nInvoice Text:\n{text[:30000]}"

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
            max_tokens=16000
        )
        result = json.loads(response.choices[0].message.content)
        return result
    except Exception as e:
        logger.error(f"Invoice extraction error: {e}")
        return {"error": str(e), "awb_items": []}


async def extract_rate_card_data(text: str, provider: str) -> dict:
    """Use OpenAI to extract rate card data from contract text."""
    system_prompt = """You are a logistics contract data extraction expert. Extract the rate card information from the contract/rate card text.

Extract these fields:
- provider: string (DELHIVERY, BLUEDART, ECOM_EXPRESS, SHADOWFAX)
- effective_from: string (YYYY-MM-DD)
- effective_to: string (YYYY-MM-DD)
- zone_matrix: object mapping origin-destination pincode prefixes or regions to zone names. Format: {"pincode_prefix_pair": "zone_name"} or if the contract defines zones differently, capture the full mapping.
- weight_slabs: list of {zone: string, min_kg: float, max_kg: float, base_rate: float, per_kg_rate: float}
- vol_divisor: integer (typically 5000 or 4000)
- weight_tolerance_kg: float (default 0.5 if not stated)
- cod_fee_pct: float (percentage as decimal, e.g., 0.02 for 2%)
- cod_fee_min: float (minimum COD fee amount)
- rto_rate_type: "FLAT" or "PERCENT_OF_FORWARD" or "FULL_FORWARD"
- rto_value: float (flat amount or multiplier)
- allowed_surcharges: list of surcharge names that are contracted
- fuel_surcharge_pct: object mapping month/period to percentage, e.g., {"default": 0.15} or {"2024-01": 0.15, "2024-02": 0.16}

Return a JSON object with all these fields. If a field cannot be found in the text, use null.
Be thorough and extract ALL rate information including all weight slabs for all zones."""

    user_prompt = f"Provider: {provider}\n\nContract/Rate Card Text:\n{text[:30000]}"

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
            max_tokens=16000
        )
        result = json.loads(response.choices[0].message.content)
        return result
    except Exception as e:
        logger.error(f"Rate card extraction error: {e}")
        return {"error": str(e)}
