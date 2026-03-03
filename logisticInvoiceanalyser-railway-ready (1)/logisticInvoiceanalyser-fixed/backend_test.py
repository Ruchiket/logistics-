#!/usr/bin/env python3

import requests
import json
import csv
import io
import sys
from datetime import datetime
import tempfile
import os
import hashlib

class LogisticsBillAuditTester:
    def __init__(self, base_url="https://doc-data-hub-1.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []
        self.test_invoice_id = None
        self.test_contract_id = None

    def run_test(self, name, method, endpoint, expected_status, data=None, files=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        default_headers = {'Content-Type': 'application/json'}
        if headers:
            default_headers.update(headers)
        
        # Remove Content-Type for file uploads
        if files:
            default_headers.pop('Content-Type', None)

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=default_headers)
            elif method == 'POST':
                if files:
                    response = requests.post(url, files=files, data=data)
                elif headers and headers.get('Content-Type') == 'application/x-www-form-urlencoded':
                    response = requests.post(url, data=data, headers=headers)
                elif data:
                    response = requests.post(url, json=data, headers=default_headers)
                else:
                    response = requests.post(url, headers=default_headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=default_headers)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                if response.headers.get('content-type', '').startswith('application/json'):
                    try:
                        return True, response.json()
                    except:
                        return True, {}
                else:
                    return True, {"non_json_response": True}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                print(f"   Response: {response.text[:500]}")
                self.failed_tests.append({
                    "test": name,
                    "expected": expected_status,
                    "actual": response.status_code,
                    "response": response.text[:200]
                })
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.failed_tests.append({
                "test": name,
                "error": str(e)
            })
            return False, {}

    def test_root_endpoint(self):
        """Test API root"""
        return self.run_test("API Root", "GET", "", 200)

    def test_dashboard_stats(self):
        """Test dashboard stats endpoint"""
        success, response = self.run_test("Dashboard Stats", "GET", "dashboard/stats", 200)
        if success:
            # Verify required fields are present
            required_fields = ["total_invoices", "total_contracts", "total_audit_runs"]
            for field in required_fields:
                if field not in response:
                    print(f"⚠️  Warning: Missing field '{field}' in dashboard stats")
        return success, response

    def test_empty_lists(self):
        """Test that empty lists return correctly initially"""
        tests = [
            ("Empty Invoices List", "GET", "invoices", 200),
            ("Empty Contracts List", "GET", "contracts", 200),
            ("Empty Audit Runs List", "GET", "audit/runs", 200),
        ]
        
        results = []
        for name, method, endpoint, expected in tests:
            success, response = self.run_test(name, method, endpoint, expected)
            results.append(success)
        
        return all(results)

    def test_upload_validation(self):
        """Test upload endpoint validation"""
        # Test invalid provider for invoice upload (old single endpoint)
        success1, _ = self.run_test(
            "Invoice Upload - No Form Data", 
            "POST", 
            "upload/invoice", 
            422,  # FastAPI validation error - missing file
        )
        
        # Test invalid provider for contract upload  
        success2, _ = self.run_test(
            "Contract Upload - No Form Data",
            "POST", 
            "upload/contract", 
            422,
        )
        
        # Test new bulk invoice upload without files
        success3, _ = self.run_test(
            "Bulk Invoice Upload - No Files",
            "POST",
            "upload/invoices", 
            422  # Should fail when no files provided
        )
        
        return success1 and success2 and success3

    def test_csv_upload(self):
        """Test CSV order data upload"""
        # Create a test CSV file
        csv_content = """awb_number,length_cm,width_cm,height_cm,actual_delivery_status,cod_value
AWB001,30,20,15,DELIVERED,0
AWB002,25,18,12,RTO,500
AWB003,35,22,18,DELIVERED,1000"""

        # Create temporary file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False) as f:
            f.write(csv_content)
            temp_path = f.name

        try:
            with open(temp_path, 'rb') as f:
                files = {'file': ('test_orders.csv', f, 'text/csv')}
                success, response = self.run_test(
                    "CSV Order Data Upload",
                    "POST",
                    "upload/order-data",
                    200,
                    files=files
                )
                
            if success and response:
                expected_count = 3
                actual_count = response.get('count', 0)
                if actual_count != expected_count:
                    print(f"⚠️  Warning: Expected {expected_count} records, got {actual_count}")
                    
        finally:
            # Clean up temporary file
            os.unlink(temp_path)
            
        return success

    def test_audit_endpoints_without_data(self):
        """Test audit endpoints when no data exists"""
        # Test running audit without data should fail - use form data
        import urllib.parse
        data = urllib.parse.urlencode({"invoice_id": "nonexistent", "contract_id": "nonexistent"})
        headers = {'Content-Type': 'application/x-www-form-urlencoded'}
        
        success, _ = self.run_test(
            "Audit Run - No Data",
            "POST",
            "audit/run",
            404,  # Should fail with invoice not found
            data=data,
            headers=headers
        )
        return success

    def test_detail_endpoints_not_found(self):
        """Test detail endpoints with non-existent IDs"""
        tests = [
            ("Invoice Detail - Not Found", "GET", "invoices/nonexistent", 404),
            ("Contract Detail - Not Found", "GET", "contracts/nonexistent", 404),
            ("Audit Run Detail - Not Found", "GET", "audit/runs/nonexistent", 404),
        ]
        
        results = []
        for name, method, endpoint, expected in tests:
            success, _ = self.run_test(name, method, endpoint, expected)
            results.append(success)
        
        return all(results)

    def test_bulk_invoice_endpoint_with_dummy_files(self):
        """Test bulk invoice endpoint with dummy PDF files"""
        # Create small dummy PDF files to test multipart form data handling
        import tempfile
        
        dummy_content = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n108\n%%EOF"
        
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f1, \
             tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f2:
            
            f1.write(dummy_content)
            f2.write(dummy_content)
            f1.flush()
            f2.flush()
            
            try:
                # Test with multiple files
                with open(f1.name, 'rb') as file1, open(f2.name, 'rb') as file2:
                    files = [
                        ('files', ('test_invoice1.pdf', file1, 'application/pdf')),
                        ('files', ('test_invoice2.pdf', file2, 'application/pdf'))
                    ]
                    
                    success, response = self.run_test(
                        "Bulk Invoice Upload - With Files",
                        "POST",
                        "upload/invoices",
                        200,  # Should accept files and process them
                        files=files
                    )
                    
                    if success and response:
                        if 'count' in response and 'results' in response:
                            print(f"✅ Bulk upload processed {response.get('count', 0)} files")
                            
                            # Check that results have provider detection
                            for i, result in enumerate(response.get('results', [])):
                                provider = result.get('provider', 'NOT_SET')
                                confidence = result.get('provider_confidence') 
                                status = result.get('status', 'UNKNOWN')
                                print(f"   File {i+1}: Provider={provider}, Confidence={confidence}, Status={status}")
                        else:
                            print("⚠️ Response missing expected fields")
                            
            finally:
                # Clean up
                import os
                os.unlink(f1.name)
                os.unlink(f2.name)
                
        return success

    def test_contract_check_provider_endpoints(self):
        """Test the new contract check-provider endpoints"""
        
        # Test check for BlueDart (should exist according to context)
        success1, response1 = self.run_test(
            "Check Provider - BLUEDART", 
            "GET", 
            "contracts/check-provider/BLUEDART", 
            200
        )
        
        if success1 and response1:
            exists = response1.get('exists')
            print(f"   BLUEDART exists: {exists}")
            if exists and 'contract' in response1:
                contract = response1['contract']
                print(f"   Existing contract ID: {contract.get('id', 'N/A')}")
                print(f"   Existing filename: {contract.get('filename', 'N/A')}")
        
        # Test check for Shadowfax (should not exist)
        success2, response2 = self.run_test(
            "Check Provider - SHADOWFAX", 
            "GET", 
            "contracts/check-provider/SHADOWFAX", 
            200
        )
        
        if success2 and response2:
            exists = response2.get('exists')
            print(f"   SHADOWFAX exists: {exists}")
            if not exists:
                print("   ✅ Correctly shows no existing contract for SHADOWFAX")
        
        return success1 and success2

    def test_contract_upload_enforcement(self):
        """Test contract upload single-per-provider enforcement"""
        import tempfile
        
        # Create dummy PDF content
        dummy_content = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n108\n%%EOF"
        
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
            f.write(dummy_content)
            f.flush()
            
            try:
                # Test 1: Try uploading contract for BLUEDART without replace=true (should get 409)
                with open(f.name, 'rb') as file1:
                    form_data = {
                        'provider': 'BLUEDART'
                    }
                    files = {'file': ('test_contract.pdf', file1, 'application/pdf')}
                    
                    success1, response1 = self.run_test(
                        "Contract Upload - Existing Provider (should fail)",
                        "POST",
                        "upload/contract",
                        409,  # Should return conflict
                        data=form_data,
                        files=files
                    )
                
                # Test 2: Upload contract for new provider (should work)
                with open(f.name, 'rb') as file2:
                    form_data = {
                        'provider': 'SHADOWFAX'
                    }
                    files = {'file': ('shadowfax_contract.pdf', file2, 'application/pdf')}
                    
                    success2, response2 = self.run_test(
                        "Contract Upload - New Provider (should work)",
                        "POST",
                        "upload/contract",
                        200,  # Should work
                        data=form_data,
                        files=files
                    )
                
                # Test 3: Try uploading contract with replace=true (should work)
                with open(f.name, 'rb') as file3:
                    form_data = {
                        'provider': 'SHADOWFAX',
                        'replace': 'true'
                    }
                    files = {'file': ('shadowfax_contract_v2.pdf', file3, 'application/pdf')}
                    
                    success3, response3 = self.run_test(
                        "Contract Upload - Replace Existing (should work)",
                        "POST",
                        "upload/contract",
                        200,  # Should work with replace=true
                        data=form_data,
                        files=files
                    )
                    
            finally:
                # Clean up
                import os
                os.unlink(f.name)
        
        return success1 and success2 and success3

    def create_test_pdf_content(self, content_variant="default"):
        """Create test PDF content with different variants for duplicate testing"""
        if content_variant == "default":
            pdf_content = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj
4 0 obj<</Length 44>>stream
BT /F1 12 Tf 100 700 Td (Test Invoice PDF) Tj ET
endstream endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000189 00000 n 
trailer<</Size 5/Root 1 0 R>>
startxref
282
%%EOF"""
        elif content_variant == "unique":
            pdf_content = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj
4 0 obj<</Length 50>>stream
BT /F1 12 Tf 100 700 Td (Unique Test Invoice) Tj ET
endstream endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000189 00000 n 
trailer<</Size 5/Root 1 0 R>>
startxref
288
%%EOF"""
        else:  # contract variant
            pdf_content = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj
4 0 obj<</Length 48>>stream
BT /F1 12 Tf 100 700 Td (Test Contract PDF) Tj ET
endstream endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000189 00000 n 
trailer<</Size 5/Root 1 0 R>>
startxref
286
%%EOF"""
        return pdf_content

    def test_duplicate_prevention_features(self):
        """Test duplicate prevention and audit-once features"""
        print("\n🔬 Testing Duplicate Prevention & Audit-Once Features...")
        
        # Test 1: Check invoices endpoint includes 'audited' field
        success1, response = self.run_test(
            "GET /api/invoices includes 'audited' field",
            "GET",
            "invoices",
            200
        )
        if success1 and response:
            has_audited_field = any('audited' in invoice for invoice in response)
            if has_audited_field:
                print("✅ Found 'audited' field in invoices response")
            else:
                print("⚠️  No 'audited' field found (may be expected for new DB)")
                success1 = True  # Still pass as this might be expected
        
        # Test 2: Single invoice upload (first time)
        pdf_content_1 = self.create_test_pdf_content("default")
        
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
            f.write(pdf_content_1)
            f.flush()
            
            try:
                with open(f.name, 'rb') as file_obj:
                    files = {'file': ('test_invoice.pdf', file_obj, 'application/pdf')}
                    form_data = {'provider': 'BLUEDART'}
                    
                    success2, response2 = self.run_test(
                        "Single Invoice Upload (first time)",
                        "POST",
                        "upload/invoice",
                        200,
                        data=form_data,
                        files=files
                    )
                    
                    if success2 and response2:
                        self.test_invoice_id = response2.get('id')
                        print(f"📝 Created test invoice ID: {self.test_invoice_id}")
                
            finally:
                os.unlink(f.name)
        
        # Test 3: Duplicate single invoice upload (should return 409)
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
            f.write(pdf_content_1)  # Same content
            f.flush()
            
            try:
                with open(f.name, 'rb') as file_obj:
                    files = {'file': ('test_invoice_duplicate.pdf', file_obj, 'application/pdf')}
                    form_data = {'provider': 'BLUEDART'}
                    
                    success3, _ = self.run_test(
                        "Duplicate Single Invoice Upload (should return 409)",
                        "POST",
                        "upload/invoice",
                        409,
                        data=form_data,
                        files=files
                    )
                
            finally:
                os.unlink(f.name)
        
        # Test 4: Bulk upload with duplicates
        pdf_content_2 = self.create_test_pdf_content("unique")
        
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f1, \
             tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f2:
            
            f1.write(pdf_content_2)  # Unique content
            f1.flush()
            f2.write(pdf_content_1)  # Duplicate content
            f2.flush()
            
            try:
                with open(f1.name, 'rb') as file1, open(f2.name, 'rb') as file2:
                    files = [
                        ('files', ('unique_invoice.pdf', file1, 'application/pdf')),
                        ('files', ('duplicate_invoice.pdf', file2, 'application/pdf'))
                    ]
                    
                    success4, response4 = self.run_test(
                        "Bulk Invoice Upload with Duplicates",
                        "POST",
                        "upload/invoices",
                        200,
                        files=files
                    )
                    
                    if success4 and response4:
                        results = response4.get('results', [])
                        statuses = [r.get('status') for r in results]
                        
                        if 'DUPLICATE' in statuses:
                            print("✅ Bulk upload correctly identified duplicate")
                        else:
                            print(f"⚠️  Expected DUPLICATE status in bulk upload results, got: {statuses}")
                
            finally:
                os.unlink(f1.name)
                os.unlink(f2.name)
        
        # Test 5: Contract upload for audit testing (if we haven't created one already)
        if not self.test_contract_id:
            contract_content = self.create_test_pdf_content("contract")
            
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
                f.write(contract_content)
                f.flush()
                
                try:
                    with open(f.name, 'rb') as file_obj:
                        files = {'file': ('test_contract_audit.pdf', file_obj, 'application/pdf')}
                        form_data = {'provider': 'BLUEDART', 'replace': 'true'}  # Replace existing
                        
                        success5, response5 = self.run_test(
                            "Contract Upload for Audit Testing",
                            "POST",
                            "upload/contract",
                            200,
                            data=form_data,
                            files=files
                        )
                        
                        if success5 and response5:
                            self.test_contract_id = response5.get('id')
                            print(f"📝 Created test contract ID: {self.test_contract_id}")
                    
                finally:
                    os.unlink(f.name)
        else:
            success5 = True  # Already have a contract
            
        # Test 6: First audit run (should succeed)
        success6 = False
        if self.test_invoice_id and self.test_contract_id:
            form_data = {
                'invoice_id': self.test_invoice_id,
                'contract_id': self.test_contract_id
            }
            
            success6, _ = self.run_test(
                "First Audit Run (should succeed)",
                "POST",
                "audit/run",
                200,
                data=form_data,
                headers={'Content-Type': 'application/x-www-form-urlencoded'}
            )
            
            if success6:
                print("✅ First audit run completed successfully")
                import time
                time.sleep(2)  # Wait for audit to complete
        else:
            print("❌ Cannot test audit run - missing invoice or contract ID")
        
        # Test 7: Duplicate audit run (should return 409)
        success7 = False
        if self.test_invoice_id and self.test_contract_id and success6:
            form_data = {
                'invoice_id': self.test_invoice_id,
                'contract_id': self.test_contract_id
            }
            
            success7, _ = self.run_test(
                "Duplicate Audit Run (should return 409)",
                "POST",
                "audit/run",
                409,
                data=form_data,
                headers={'Content-Type': 'application/x-www-form-urlencoded'}
            )
        else:
            print("❌ Cannot test duplicate audit - missing prerequisites")
        
        # Test 8: Check that invoice is marked as audited
        success8 = False
        if self.test_invoice_id and success6:
            success8, response8 = self.run_test(
                f"Check Invoice Audited Status",
                "GET",
                f"invoices/{self.test_invoice_id}",
                200
            )
            
            if success8 and response8:
                audited = response8.get('audited', False)
                if audited:
                    print("✅ Invoice correctly marked as audited=true")
                else:
                    print("❌ Invoice not marked as audited after audit run")
                    success8 = False
        
        return all([success1, success2, success3, success4, success5 if not hasattr(self, 'test_contract_id') or self.test_contract_id else True, success6, success7, success8])

    def test_delete_endpoints(self):
        """Test DELETE endpoints for invoices, contracts, and audit runs"""
        print("\n🗑️  Testing DELETE Endpoints...")
        
        # Test 1: DELETE non-existent invoice (should return 404)
        success1, _ = self.run_test(
            "DELETE Invoice - Not Found",
            "DELETE",
            "invoices/nonexistent-id",
            404
        )
        
        # Test 2: DELETE non-existent contract (should return 404)  
        success2, _ = self.run_test(
            "DELETE Contract - Not Found",
            "DELETE", 
            "contracts/nonexistent-id",
            404
        )
        
        # Test 3: DELETE non-existent audit run (should return 404)
        success3, _ = self.run_test(
            "DELETE Audit Run - Not Found",
            "DELETE",
            "audit/runs/nonexistent-id", 
            404
        )
        
        # Test 4: Get current data to find IDs for valid deletion tests
        success4, invoices = self.run_test(
            "GET Invoices for DELETE test",
            "GET",
            "invoices",
            200
        )
        
        success5, contracts = self.run_test(
            "GET Contracts for DELETE test", 
            "GET",
            "contracts",
            200
        )
        
        success6, audit_runs = self.run_test(
            "GET Audit Runs for DELETE test",
            "GET", 
            "audit/runs",
            200
        )
        
        delete_success = []
        
        # Test valid deletions if we have data
        if success4 and invoices and len(invoices) > 0:
            # Find an invoice to delete
            invoice_to_delete = invoices[0]
            invoice_id = invoice_to_delete.get('id')
            
            if invoice_id:
                success_del_inv, response = self.run_test(
                    f"DELETE Invoice - Valid ID ({invoice_to_delete.get('filename', 'unknown')})",
                    "DELETE",
                    f"invoices/{invoice_id}",
                    200
                )
                delete_success.append(success_del_inv)
                
                if success_del_inv and response:
                    print(f"✅ Invoice deleted: {response.get('message', 'Success')}")
                    
                    # Verify invoice is actually deleted
                    success_verify, _ = self.run_test(
                        "Verify Invoice Deleted",
                        "GET", 
                        f"invoices/{invoice_id}",
                        404
                    )
                    delete_success.append(success_verify)
        
        if success5 and contracts and len(contracts) > 0:
            # Find a contract to delete
            contract_to_delete = contracts[0]
            contract_id = contract_to_delete.get('id')
            
            if contract_id:
                success_del_con, response = self.run_test(
                    f"DELETE Contract - Valid ID ({contract_to_delete.get('filename', 'unknown')})",
                    "DELETE",
                    f"contracts/{contract_id}", 
                    200
                )
                delete_success.append(success_del_con)
                
                if success_del_con and response:
                    print(f"✅ Contract deleted: {response.get('message', 'Success')}")
                    
                    # Verify contract is actually deleted
                    success_verify, _ = self.run_test(
                        "Verify Contract Deleted",
                        "GET",
                        f"contracts/{contract_id}",
                        404
                    )
                    delete_success.append(success_verify)
        
        if success6 and audit_runs and len(audit_runs) > 0:
            # Find an audit run to delete
            audit_run_to_delete = audit_runs[0]
            run_id = audit_run_to_delete.get('id')
            
            if run_id:
                success_del_run, response = self.run_test(
                    f"DELETE Audit Run - Valid ID ({audit_run_to_delete.get('provider', 'unknown')})",
                    "DELETE",
                    f"audit/runs/{run_id}",
                    200
                )
                delete_success.append(success_del_run)
                
                if success_del_run and response:
                    print(f"✅ Audit run deleted: {response.get('message', 'Success')}")
                    
                    # Verify audit run is actually deleted
                    success_verify, _ = self.run_test(
                        "Verify Audit Run Deleted",
                        "GET",
                        f"audit/runs/{run_id}", 
                        404
                    )
                    delete_success.append(success_verify)
                    
                    # Test that associated invoice is unmarked as audited
                    invoice_id = audit_run_to_delete.get('invoice_id')
                    if invoice_id:
                        success_check, invoice_data = self.run_test(
                            "Check Invoice Unmarked After Audit Run Delete",
                            "GET",
                            f"invoices/{invoice_id}",
                            200
                        )
                        if success_check and invoice_data:
                            audited = invoice_data.get('audited', True) 
                            if not audited:
                                print("✅ Invoice correctly unmarked as audited after audit run deletion")
                                delete_success.append(True)
                            else:
                                print("⚠️ Invoice still marked as audited after audit run deletion")
                                delete_success.append(False)
        
        # Basic DELETE tests must pass
        basic_tests = [success1, success2, success3, success4, success5, success6]
        all_basic_passed = all(basic_tests)
        
        # Additional delete tests are bonus if data exists
        all_delete_passed = all(delete_success) if delete_success else True
        
        print(f"✅ Basic DELETE tests: {sum(basic_tests)}/{len(basic_tests)}")
        if delete_success:
            print(f"✅ Data deletion tests: {sum(delete_success)}/{len(delete_success)}")
        
        return all_basic_passed and all_delete_passed

    def test_bulk_audit_endpoints(self):
        """Test the new bulk audit endpoints"""
        print("\n🔄 Testing Bulk Audit Endpoints...")
        
        # Test 1: POST /api/audit/run-bulk with invalid provider returns 400
        form_data = {'provider': 'INVALID_PROVIDER'}
        success1, _ = self.run_test(
            "Bulk Audit - Invalid Provider (should return 400)",
            "POST",
            "audit/run-bulk",
            400,
            data=form_data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )
        
        # Test 2: POST /api/audit/run-bulk with provider that has no contract returns 404
        # First check if SHADOWFAX has a contract
        success_check, contract_check = self.run_test(
            "Check SHADOWFAX Contract Exists",
            "GET", 
            "contracts/check-provider/SHADOWFAX",
            200
        )
        
        # Choose a provider without contract for testing
        test_provider = "ECOM_EXPRESS"  # Assuming this doesn't have a contract
        form_data = {'provider': test_provider}
        success2, _ = self.run_test(
            f"Bulk Audit - Provider {test_provider} with No Contract (should return 404)",
            "POST",
            "audit/run-bulk", 
            404,
            data=form_data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )
        
        # Test 3: POST /api/audit/run-bulk with provider that has no pending invoices
        # First create a contract for SHADOWFAX if it doesn't exist
        contract_content = self.create_test_pdf_content("contract")
        shadowfax_contract_id = None
        
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
            f.write(contract_content)
            f.flush()
            
            try:
                with open(f.name, 'rb') as file_obj:
                    files = {'file': ('shadowfax_contract.pdf', file_obj, 'application/pdf')}
                    form_data_contract = {'provider': 'SHADOWFAX', 'replace': 'true'}
                    
                    success3a, response3a = self.run_test(
                        "Create SHADOWFAX Contract for Bulk Testing",
                        "POST",
                        "upload/contract",
                        200,
                        data=form_data_contract,
                        files=files
                    )
                    
                    if success3a and response3a:
                        shadowfax_contract_id = response3a.get('id')
                        print(f"📝 Created SHADOWFAX contract ID: {shadowfax_contract_id}")
                
            finally:
                os.unlink(f.name)
        
        # Now test bulk audit with no pending invoices for SHADOWFAX
        form_data = {'provider': 'SHADOWFAX'}
        success3, _ = self.run_test(
            "Bulk Audit - SHADOWFAX with No Pending Invoices (should return 404)",
            "POST",
            "audit/run-bulk",
            404,
            data=form_data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )
        
        # Test 4: POST /api/audit/run-bulk with valid provider+contract+pending invoices
        # First create some pending invoices for SHADOWFAX
        pdf_content1 = self.create_test_pdf_content("default")
        pdf_content2 = self.create_test_pdf_content("unique")
        
        shadowfax_invoice_ids = []
        
        # Create 2 invoices for SHADOWFAX
        for i, content in enumerate([pdf_content1, pdf_content2], 1):
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
                f.write(content)
                f.flush()
                
                try:
                    with open(f.name, 'rb') as file_obj:
                        files = {'file': (f'shadowfax_invoice_{i}.pdf', file_obj, 'application/pdf')}
                        form_data_invoice = {'provider': 'SHADOWFAX'}
                        
                        success_inv, response_inv = self.run_test(
                            f"Create SHADOWFAX Invoice {i} for Bulk Testing",
                            "POST",
                            "upload/invoice",
                            200,
                            data=form_data_invoice,
                            files=files
                        )
                        
                        if success_inv and response_inv:
                            invoice_id = response_inv.get('id')
                            shadowfax_invoice_ids.append(invoice_id)
                            print(f"📝 Created SHADOWFAX invoice {i} ID: {invoice_id}")
                    
                finally:
                    os.unlink(f.name)
        
        # Now test successful bulk audit
        form_data = {'provider': 'SHADOWFAX'}
        success4, response4 = self.run_test(
            "Bulk Audit - SHADOWFAX with Valid Data (should succeed)",
            "POST",
            "audit/run-bulk",
            200,
            data=form_data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )
        
        if success4 and response4:
            print(f"✅ Bulk audit completed: {response4.get('invoices_audited', 0)} invoices audited")
            print(f"   Total failed checks: {response4.get('total_failed', 0)}")
            print(f"   Total discrepancy: Rs. {response4.get('total_discrepancy', 0)}")
            
            # Test 5: Verify that all processed invoices are marked as audited=true
            audited_count = 0
            for invoice_id in shadowfax_invoice_ids:
                success_check, invoice_data = self.run_test(
                    f"Check Invoice {invoice_id} Audited After Bulk Audit",
                    "GET",
                    f"invoices/{invoice_id}",
                    200
                )
                
                if success_check and invoice_data:
                    audited = invoice_data.get('audited', False)
                    if audited:
                        audited_count += 1
            
            success5 = audited_count == len(shadowfax_invoice_ids)
            if success5:
                print(f"✅ All {audited_count} invoices correctly marked as audited=true")
            else:
                print(f"❌ Only {audited_count}/{len(shadowfax_invoice_ids)} invoices marked as audited")
        else:
            success5 = False
            print("❌ Bulk audit failed, cannot verify audited status")
        
        return all([success1, success2, success3, success4, success5])

    def print_summary(self):
        """Print test summary"""
        print(f"\n📊 Test Summary:")
        print(f"   Total tests: {self.tests_run}")
        print(f"   Passed: {self.tests_passed}")
        print(f"   Failed: {len(self.failed_tests)}")
        print(f"   Success rate: {(self.tests_passed/self.tests_run*100):.1f}%")
        
        if self.failed_tests:
            print(f"\n❌ Failed Tests:")
            for test in self.failed_tests:
                print(f"   • {test.get('test', 'Unknown')}")
                if 'error' in test:
                    print(f"     Error: {test['error']}")
                else:
                    print(f"     Expected: {test.get('expected')}, Got: {test.get('actual')}")

def main():
    print("🚀 Starting Logistics Bill Audit System Backend Tests")
    print("=" * 60)
    
    tester = LogisticsBillAuditTester()
    
    # Run all tests
    print("\n1. Testing API Root...")
    tester.test_root_endpoint()
    
    print("\n2. Testing Dashboard Stats...")
    tester.test_dashboard_stats()
    
    print("\n3. Testing Empty List Endpoints...")
    tester.test_empty_lists()
    
    print("\n4. Testing Upload Validation...")
    tester.test_upload_validation()
    
    print("\n5. Testing CSV Upload...")
    tester.test_csv_upload()
    
    print("\n6. Testing Audit Endpoints...")
    tester.test_audit_endpoints_without_data()
    
    print("\n7. Testing Detail Endpoints...")
    tester.test_detail_endpoints_not_found()
    
    print("\n8. Testing Bulk Invoice Upload with Files...")
    tester.test_bulk_invoice_endpoint_with_dummy_files()
    
    print("\n9. Testing Contract Check Provider Endpoints...")
    tester.test_contract_check_provider_endpoints()
    
    print("\n10. Testing Contract Upload Enforcement...")
    tester.test_contract_upload_enforcement()
    
    print("\n11. Testing Duplicate Prevention & Audit-Once Features...")
    tester.test_duplicate_prevention_features()
    
    print("\n12. Testing DELETE Endpoints...")
    tester.test_delete_endpoints()
    
    print("\n13. Testing Bulk Audit Endpoints...")
    tester.test_bulk_audit_endpoints()
    
    # Print summary
    tester.print_summary()
    
    # Return appropriate exit code
    success_rate = tester.tests_passed / tester.tests_run if tester.tests_run > 0 else 0
    return 0 if success_rate >= 0.8 else 1

if __name__ == "__main__":
    sys.exit(main())