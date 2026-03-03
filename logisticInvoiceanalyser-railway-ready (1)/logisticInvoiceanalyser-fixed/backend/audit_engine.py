import logging
from typing import Optional
from difflib import SequenceMatcher

logger = logging.getLogger(__name__)


def fuzzy_match(a: str, b: str, threshold: float = 0.8) -> bool:
    """Check if two strings are similar enough."""
    if not a or not b:
        return False
    return SequenceMatcher(None, a.upper().strip(), b.upper().strip()).ratio() >= threshold


def check_weight_overcharge(awb: dict, rate_card: dict, order_data: Optional[dict] = None) -> dict:
    """Check 1: Weight Overcharge - Is billed weight higher than actual?"""
    result = {
        "check_type": "WEIGHT_OVERCHARGE",
        "status": "PASS",
        "bucket": None,
        "expected_value": None,
        "actual_value": None,
        "discrepancy_amount": 0,
        "details": ""
    }

    billed_chargeable = awb.get("billed_chargeable_weight_kg", 0)
    billed_dead = awb.get("billed_dead_weight_kg", 0)
    billed_vol = awb.get("billed_vol_weight_kg", 0)
    tolerance = rate_card.get("weight_tolerance_kg", 0.5) if rate_card else 0.5

    if order_data and order_data.get("sku_dimensions"):
        dims = order_data["sku_dimensions"]
        vol_divisor = rate_card.get("vol_divisor", 5000) if rate_card else 5000
        l, w, h = dims.get("l", 0), dims.get("w", 0), dims.get("h", 0)
        calculated_vol_weight = (l * w * h) / vol_divisor if vol_divisor else 0
        expected_chargeable = max(billed_dead, calculated_vol_weight)

        if billed_chargeable > expected_chargeable + tolerance:
            result["status"] = "FAIL"
            result["bucket"] = "A"
            result["expected_value"] = round(expected_chargeable, 2)
            result["actual_value"] = round(billed_chargeable, 2)
            result["discrepancy_amount"] = round(billed_chargeable - expected_chargeable, 2)
            result["details"] = f"Billed chargeable weight {billed_chargeable}kg exceeds expected {round(expected_chargeable, 2)}kg (tolerance: {tolerance}kg). Verified against SKU dimensions."
        return result

    # Without order data - check internal consistency
    expected_chargeable = max(billed_dead, billed_vol) if billed_vol > 0 else billed_dead
    if billed_chargeable > expected_chargeable + tolerance:
        result["status"] = "FAIL"
        result["bucket"] = "B"
        result["expected_value"] = round(expected_chargeable, 2)
        result["actual_value"] = round(billed_chargeable, 2)
        result["discrepancy_amount"] = round(billed_chargeable - expected_chargeable, 2)
        result["details"] = f"Billed chargeable {billed_chargeable}kg exceeds max(dead={billed_dead}, vol={billed_vol})={round(expected_chargeable, 2)}kg. Needs ERP verification for actual dimensions."
    elif billed_vol == 0 and billed_chargeable > billed_dead + tolerance:
        result["status"] = "FAIL"
        result["bucket"] = "B"
        result["expected_value"] = round(billed_dead, 2)
        result["actual_value"] = round(billed_chargeable, 2)
        result["details"] = "Volumetric weight missing. Cannot verify chargeable weight. Needs verification."

    return result


def check_zone_mismatch(awb: dict, rate_card: dict) -> dict:
    """Check 2: Zone Mismatch - Does billed zone match contract zone matrix?"""
    result = {
        "check_type": "ZONE_MISMATCH",
        "status": "PASS",
        "bucket": None,
        "expected_value": None,
        "actual_value": None,
        "discrepancy_amount": 0,
        "details": ""
    }

    billed_zone = awb.get("billed_zone", "")
    origin = awb.get("origin_pincode", "")
    destination = awb.get("destination_pincode", "")
    zone_matrix = rate_card.get("zone_matrix") if rate_card else None

    if not zone_matrix:
        result["status"] = "SKIP"
        result["details"] = "No zone matrix available in rate card. Cannot verify zone."
        return result

    # Look up expected zone from matrix
    expected_zone = None
    # Try exact pincode pair
    key = f"{origin}-{destination}"
    if key in zone_matrix:
        expected_zone = zone_matrix[key]
    else:
        # Try prefix matching (first 3 digits)
        origin_prefix = origin[:3] if origin else ""
        dest_prefix = destination[:3] if destination else ""
        prefix_key = f"{origin_prefix}-{dest_prefix}"
        if prefix_key in zone_matrix:
            expected_zone = zone_matrix[prefix_key]

    if expected_zone and billed_zone:
        if not fuzzy_match(billed_zone, expected_zone):
            result["status"] = "FAIL"
            result["bucket"] = "A"
            result["expected_value"] = expected_zone
            result["actual_value"] = billed_zone
            result["details"] = f"Billed zone '{billed_zone}' does not match expected zone '{expected_zone}' for route {origin} -> {destination}."
    elif not expected_zone:
        result["status"] = "FAIL"
        result["bucket"] = "B"
        result["actual_value"] = billed_zone
        result["details"] = f"Route {origin} -> {destination} not found in zone matrix. Cannot verify zone '{billed_zone}'."

    return result


def check_rate_deviation(awb: dict, rate_card: dict) -> dict:
    """Check 3: Rate Deviation - Does base freight match contracted rate?"""
    result = {
        "check_type": "RATE_DEVIATION",
        "status": "PASS",
        "bucket": None,
        "expected_value": None,
        "actual_value": None,
        "discrepancy_amount": 0,
        "details": ""
    }

    billed_freight = awb.get("base_freight", 0)
    chargeable_weight = awb.get("billed_chargeable_weight_kg", 0)
    zone = awb.get("billed_zone", "")
    weight_slabs = rate_card.get("weight_slabs") if rate_card else None

    if not weight_slabs:
        result["status"] = "SKIP"
        result["details"] = "No weight slabs in rate card. Cannot verify rate."
        return result

    # Find matching slab
    expected_rate = None
    for slab in weight_slabs:
        slab_zone = slab.get("zone", "")
        min_kg = slab.get("min_kg", 0)
        max_kg = slab.get("max_kg", float("inf"))

        if fuzzy_match(zone, slab_zone) and min_kg <= chargeable_weight <= max_kg:
            base_rate = slab.get("base_rate", 0)
            per_kg_rate = slab.get("per_kg_rate", 0)
            if per_kg_rate > 0 and chargeable_weight > min_kg:
                expected_rate = base_rate + (chargeable_weight - min_kg) * per_kg_rate
            else:
                expected_rate = base_rate
            break

    if expected_rate is not None:
        tolerance = max(1.0, expected_rate * 0.02)  # 2% or Rs 1 tolerance
        if abs(billed_freight - expected_rate) > tolerance:
            result["status"] = "FAIL"
            result["bucket"] = "A"
            result["expected_value"] = round(expected_rate, 2)
            result["actual_value"] = round(billed_freight, 2)
            result["discrepancy_amount"] = round(billed_freight - expected_rate, 2)
            result["details"] = f"Base freight Rs.{billed_freight} deviates from expected Rs.{round(expected_rate, 2)} for zone '{zone}', weight {chargeable_weight}kg."
    else:
        result["status"] = "FAIL"
        result["bucket"] = "B"
        result["actual_value"] = round(billed_freight, 2)
        result["details"] = f"No matching rate slab found for zone '{zone}' and weight {chargeable_weight}kg. Cannot verify base freight."

    return result


def check_duplicate_awb(awb: dict, awb_history: list, current_invoice_awbs: list) -> dict:
    """Check 4: Duplicate AWB - Is this AWB billed multiple times?"""
    result = {
        "check_type": "DUPLICATE_AWB",
        "status": "PASS",
        "bucket": None,
        "expected_value": None,
        "actual_value": None,
        "discrepancy_amount": 0,
        "details": ""
    }

    awb_number = awb.get("awb_number", "")

    # Check within current invoice
    same_awb_in_invoice = [a for a in current_invoice_awbs if a.get("awb_number") == awb_number]
    if len(same_awb_in_invoice) > 1:
        result["status"] = "FAIL"
        result["bucket"] = "A"
        result["discrepancy_amount"] = awb.get("total_billed_amount", 0)
        result["details"] = f"AWB {awb_number} appears {len(same_awb_in_invoice)} times in current invoice. Duplicate billing detected."
        return result

    # Check across historical invoices
    historical_matches = [h for h in awb_history if h.get("awb_number") == awb_number]
    if historical_matches:
        result["status"] = "FAIL"
        result["bucket"] = "A"
        result["discrepancy_amount"] = awb.get("total_billed_amount", 0)
        prev_invoices = [h.get("invoice_id", "unknown") for h in historical_matches]
        result["details"] = f"AWB {awb_number} was previously billed in invoice(s): {', '.join(prev_invoices)}. Cross-invoice duplicate detected."

    return result


def check_cod_fee(awb: dict, rate_card: dict, order_data: Optional[dict] = None) -> dict:
    """Check 5: Incorrect COD Fee."""
    result = {
        "check_type": "INCORRECT_COD_FEE",
        "status": "PASS",
        "bucket": None,
        "expected_value": None,
        "actual_value": None,
        "discrepancy_amount": 0,
        "details": ""
    }

    payment_mode = awb.get("payment_mode", "PREPAID")
    surcharges = awb.get("surcharges", [])
    cod_surcharge = next((s for s in surcharges if "cod" in s.get("name", "").lower()), None)
    cod_amount = cod_surcharge["amount"] if cod_surcharge else 0

    # Check: COD fee on prepaid shipment
    if payment_mode == "PREPAID" and cod_amount > 0:
        result["status"] = "FAIL"
        result["bucket"] = "A"
        result["expected_value"] = 0
        result["actual_value"] = cod_amount
        result["discrepancy_amount"] = cod_amount
        result["details"] = f"COD fee of Rs.{cod_amount} charged on PREPAID shipment. Should be zero."
        return result

    if payment_mode == "COD" and cod_amount > 0 and rate_card:
        cod_value = awb.get("cod_value", 0)
        if order_data and order_data.get("cod_value"):
            cod_value = order_data["cod_value"]

        cod_fee_pct = rate_card.get("cod_fee_pct", 0)
        cod_fee_min = rate_card.get("cod_fee_min", 0)

        if cod_value > 0 and cod_fee_pct:
            expected_cod_fee = max(cod_fee_min, cod_value * cod_fee_pct)
            tolerance = max(1.0, expected_cod_fee * 0.05)
            if abs(cod_amount - expected_cod_fee) > tolerance:
                result["status"] = "FAIL"
                result["bucket"] = "A" if order_data else "B"
                result["expected_value"] = round(expected_cod_fee, 2)
                result["actual_value"] = round(cod_amount, 2)
                result["discrepancy_amount"] = round(cod_amount - expected_cod_fee, 2)
                result["details"] = f"COD fee Rs.{cod_amount} differs from expected Rs.{round(expected_cod_fee, 2)} (COD value: Rs.{cod_value}, rate: {cod_fee_pct*100}%)."

    return result


def check_rto_overcharge(awb: dict, rate_card: dict, order_data: Optional[dict] = None) -> dict:
    """Check 6: RTO Overcharge."""
    result = {
        "check_type": "RTO_OVERCHARGE",
        "status": "PASS",
        "bucket": None,
        "expected_value": None,
        "actual_value": None,
        "discrepancy_amount": 0,
        "details": ""
    }

    shipment_type = awb.get("shipment_type", "FORWARD")
    if shipment_type != "RTO":
        return result

    # Check if actually delivered (shouldn't be billed as RTO)
    if order_data and order_data.get("actual_delivery_status") == "DELIVERED":
        result["status"] = "FAIL"
        result["bucket"] = "A"
        result["discrepancy_amount"] = awb.get("total_billed_amount", 0)
        result["details"] = "Shipment billed as RTO but actual delivery status is DELIVERED."
        return result

    if not rate_card:
        return result

    rto_rate_type = rate_card.get("rto_rate_type")
    rto_value = rate_card.get("rto_value", 0)
    base_freight = awb.get("base_freight", 0)

    if rto_rate_type == "FLAT" and rto_value > 0:
        if abs(base_freight - rto_value) > 1.0:
            result["status"] = "FAIL"
            result["bucket"] = "A"
            result["expected_value"] = rto_value
            result["actual_value"] = base_freight
            result["discrepancy_amount"] = round(base_freight - rto_value, 2)
            result["details"] = f"RTO base freight Rs.{base_freight} doesn't match flat RTO rate Rs.{rto_value}."

    elif rto_rate_type == "PERCENT_OF_FORWARD" and rto_value > 0:
        # Need the forward shipment rate — approximate from billed
        expected_rto = base_freight * rto_value
        if abs(base_freight - expected_rto) > max(1.0, expected_rto * 0.05):
            result["status"] = "FAIL"
            result["bucket"] = "B"
            result["details"] = f"RTO charge may deviate from {rto_value*100}% of forward rate. Needs verification."

    return result


def check_non_contracted_surcharges(awb: dict, rate_card: dict) -> dict:
    """Check 7: Non-Contracted Surcharges."""
    result = {
        "check_type": "NON_CONTRACTED_SURCHARGES",
        "status": "PASS",
        "bucket": None,
        "expected_value": None,
        "actual_value": None,
        "discrepancy_amount": 0,
        "details": ""
    }

    surcharges = awb.get("surcharges", [])
    if not surcharges:
        return result

    allowed = rate_card.get("allowed_surcharges", []) if rate_card else []
    if not allowed:
        result["status"] = "SKIP"
        result["details"] = "No allowed surcharges list in rate card. Cannot verify."
        return result

    non_contracted = []
    for surcharge in surcharges:
        name = surcharge.get("name", "")
        amount = surcharge.get("amount", 0)
        if amount <= 0:
            continue
        matched = any(fuzzy_match(name, a, 0.7) for a in allowed)
        if not matched:
            non_contracted.append({"name": name, "amount": amount})

    if non_contracted:
        total_non_contracted = sum(s["amount"] for s in non_contracted)
        names = ", ".join(s["name"] for s in non_contracted)
        result["status"] = "FAIL"
        result["bucket"] = "A"
        result["discrepancy_amount"] = round(total_non_contracted, 2)
        result["actual_value"] = names
        result["details"] = f"Non-contracted surcharges found: {names}. Total: Rs.{round(total_non_contracted, 2)}."

    # Check fuel surcharge percentage
    fuel_surcharge = next((s for s in surcharges if "fuel" in s.get("name", "").lower()), None)
    if fuel_surcharge and rate_card.get("fuel_surcharge_pct"):
        pct_applied = fuel_surcharge.get("pct_applied")
        expected_pct = rate_card["fuel_surcharge_pct"].get("default", 0)
        if pct_applied and expected_pct and abs(pct_applied - expected_pct) > 0.01:
            if result["status"] == "PASS":
                result["status"] = "FAIL"
                result["bucket"] = "A"
            result["details"] += f" Fuel surcharge applied at {pct_applied*100}% vs contracted {expected_pct*100}%."

    return result


async def run_full_audit(awb_items: list, rate_card: dict, awb_history: list, order_data_map: dict) -> list:
    """Run all 7 audit checks on each AWB item. Returns list of audit results."""
    all_results = []

    for awb in awb_items:
        awb_number = awb.get("awb_number", "UNKNOWN")
        od = order_data_map.get(awb_number)

        # Check 4: Duplicate (independent)
        dup_result = check_duplicate_awb(awb, awb_history, awb_items)
        dup_result["awb_number"] = awb_number
        all_results.append(dup_result)

        # Check 2: Zone Mismatch
        zone_result = check_zone_mismatch(awb, rate_card)
        zone_result["awb_number"] = awb_number
        all_results.append(zone_result)

        # Check 1: Weight Overcharge
        weight_result = check_weight_overcharge(awb, rate_card, od)
        weight_result["awb_number"] = awb_number
        all_results.append(weight_result)

        # Check 3: Rate Deviation (depends on weight + zone)
        rate_result = check_rate_deviation(awb, rate_card)
        rate_result["awb_number"] = awb_number
        all_results.append(rate_result)

        # Check 5: COD Fee
        cod_result = check_cod_fee(awb, rate_card, od)
        cod_result["awb_number"] = awb_number
        all_results.append(cod_result)

        # Check 6: RTO Overcharge
        rto_result = check_rto_overcharge(awb, rate_card, od)
        rto_result["awb_number"] = awb_number
        all_results.append(rto_result)

        # Check 7: Non-Contracted Surcharges
        surcharge_result = check_non_contracted_surcharges(awb, rate_card)
        surcharge_result["awb_number"] = awb_number
        all_results.append(surcharge_result)

    return all_results
