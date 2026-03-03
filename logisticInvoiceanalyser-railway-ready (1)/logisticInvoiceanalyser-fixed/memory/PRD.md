# Bill Audit System - PRD

## Original Problem Statement
Automate logistics invoice reconciliation against contracts/rate cards. Extract data from Invoice PDFs and Contract PDFs using OpenAI, store in MongoDB, run 7 deterministic audit checks, categorize discrepancies into 3 buckets (A: Genuine Errors, B: Data-Dependent, C: Operationally Agreed), and display results on a dashboard.

## Architecture
- **Frontend**: React + Shadcn UI + Recharts + Tailwind (dark "Midnight Tactical" theme)
- **Backend**: FastAPI + MongoDB + OpenAI GPT-4o-mini
- **Database**: MongoDB (8 collections: invoices, awb_items, contracts, rate_cards, audit_runs, audit_results, order_data, awb_history)

## User Personas
- Supply chain analysts reconciling 5000+ line invoices
- Finance teams needing qualified audit output
- Ops teams reviewing data-dependent and operationally agreed items

## Core Requirements
- Upload Invoice PDFs → AI extraction → AWB line items stored
- Upload Contract PDFs → AI extraction → Rate cards stored
- 7 automated audit checks engine
- 3 bucket discrepancy categorization
- Dashboard with analytics and provider breakdown
- CSV export of audit results
- Manual order data upload (ERP alternative)
- Support 4 providers: BlueDart, Delhivery, Ecom Express, Shadowfax

## What's Been Implemented (Feb 2026)
- Full backend with 12+ API endpoints
- OpenAI GPT-4o-mini integration for PDF data extraction
- 7 audit check engine (Weight, Zone, Rate, Duplicate, COD, RTO, Surcharges)
- Dashboard with stat cards, pie charts, bar charts, recent runs
- Upload page for Invoice + Contract PDFs
- Invoices page with expandable AWB detail table
- Contracts page with expandable rate card detail
- Audit Engine page with run audit form + history table
- Audit Detail page with bucket summary, check type breakdown, filters, flagged AWBs
- Manual Upload page for order data CSV
- CSV export endpoint
- Sidebar navigation with collapse toggle
- Dark tactical theme throughout

## Prioritized Backlog
### P0 (Critical)
- None remaining for MVP

### P1 (High)
- Batch processing for very large invoices (5000+ AWBs) with chunked extraction
- Fuel surcharge monthly update admin interface
- Rate card version management (multiple active rate cards per provider)

### P2 (Medium)
- Email report generation
- Communication log ingestion (Bucket C support)
- ERP API connector (pluggable)
- Carrier alias management for surcharge name normalization
- AWB history cleanup/deduplication tools

## Next Tasks
1. Test with real invoice and contract PDFs to validate extraction quality
2. Add pagination for large AWB datasets
3. Implement fuel surcharge monthly log management
4. Add email report generation
5. Build ERP connector interface
