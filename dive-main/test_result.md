#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

## user_problem_statement: Convert DIVE from a mocked demo (FastAPI + hardcoded profiles, no real auth) into a real product — Node/Express/TypeScript backend, MongoDB, real JWT auth with OTP signup, and 4 real investment-ingestion methods (Account Aggregator/Finvu sandbox, Manual Entry, Bot Scanner screen-share OCR, File Upload), an Instrument Master data service, and supporting docs/security.

## backend:
##   - task: "Real auth: signup (OTP) + login (incl. user-not-found)"
##     implemented: true
##     working: true
##     file: "backend/src/controllers/authController.ts, backend/src/services/otpService.ts"
##     stuck_count: 0
##     priority: "high"
##     needs_retesting: false
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "JWT access+refresh, bcrypt, OTP hashed w/ 5min TTL. 7/7 auth integration tests pass (tests/auth.test.ts), incl. USER_NOT_FOUND and INVALID_CREDENTIALS branches. Browser-verified end-to-end."
##
##   - task: "Instrument Master data service + daily refresh"
##     implemented: true
##     working: true
##     file: "backend/src/models/Instrument.ts, backend/src/services/instrumentService.ts, backend/src/jobs/instrumentRefresh.cron.ts"
##     stuck_count: 0
##     priority: "high"
##     needs_retesting: false
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "Static seed (~70 instruments across all 11 asset classes) + live AMFI/CoinGecko refresh with fallback. node-cron at 6am IST + manual admin trigger. Search endpoint tested via tests/holdings.test.ts."
##
##   - task: "Manual entry — all 11 asset classes incl. FD special fields"
##     implemented: true
##     working: true
##     file: "backend/src/models/Holding.ts, backend/src/validators/holdings.ts, backend/src/controllers/holdingsController.ts"
##     stuck_count: 0
##     priority: "high"
##     needs_retesting: false
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "FD computes current/maturity value server-side (quarterly compounding approximation). 4/4 holdings tests pass. Browser-verified: real equity holding saved and scored."
##
##   - task: "File upload ingestion (CSV/XLSX/JSON/PDF/image)"
##     implemented: true
##     working: true
##     file: "backend/src/services/fileParsers/*, backend/src/controllers/uploadController.ts"
##     stuck_count: 0
##     priority: "medium"
##     needs_retesting: false
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "Shared categorizeInstrument + fuzzy header normalizer. Returns candidates for review (nothing auto-saved). Scanned/image-only PDFs return empty rather than fake data. 4/4 upload tests pass; browser-verified CSV round-trip (correct MUTUAL_FUND/GOLD categorization)."
##
##   - task: "Bot Scanner (screen-share OCR)"
##     implemented: true
##     working: "NA"
##     file: "backend/src/services/botScanService.ts, backend/src/services/brokerParsers/angelOne.ts, frontend/src/screens/BotScan.jsx"
##     stuck_count: 0
##     priority: "medium"
##     needs_retesting: true
##     status_history:
##         -working: "NA"
##         -agent: "main"
##         -comment: "Real getDisplayMedia capture + periodic frame POST + real Tesseract.js OCR + Angel One layout regex parser + generic fallback. Parser logic unit-tested (2/2 pass) and endpoint smoke-tested with a real (blank) image end-to-end. NOT yet verified against a real Angel One holdings screen — the getDisplayMedia permission dialog is a real OS-level picker no automation can drive, and no real broker account was available. Needs a human to run Start Scan against a real broker tab and confirm OCR accuracy."
##
##   - task: "Finvu Account Aggregator sandbox integration"
##     implemented: true
##     working: true
##     file: "backend/src/services/finvuService.ts, backend/src/controllers/aaController.ts, frontend/src/screens/AAConsent.jsx"
##     stuck_count: 0
##     priority: "medium"
##     needs_retesting: false
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "MOCK_MODE (FINVU_CLIENT_ID/SECRET are placeholders) exercises the full consent-request -> approve -> fetch -> Holding pipeline with clearly-labeled synthetic data (isMock:true on every record). 2/2 AA tests pass incl. user-scoping. Browser-verified end-to-end (4 synthetic holdings landed, real DIVE Score computed). Real Finvu sandbox behavior untested — no real credentials available (see /docs/GETTING_API_KEYS.md)."
##
## frontend:
##   - task: "Onboarding: real signup/OTP + login incl. user-not-found"
##     implemented: true
##     working: true
##     file: "frontend/src/screens/Onboarding.jsx, frontend/src/context/DiveContext.js, frontend/src/lib/api.js"
##     stuck_count: 0
##     priority: "high"
##     needs_retesting: false
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "Replaced mock signup/consent flow. Fixed a real bug found during testing: AnimatePresence mode='wait' could get stuck indefinitely if an exit animation never completes (e.g. rAF paused on a hidden/backgrounded tab) — switched to default mode so screen transitions don't depend on animation completion."
##
##   - task: "Choose Method + Manual Entry + File Upload + Bot Scan + AA Consent screens"
##     implemented: true
##     working: true
##     file: "frontend/src/screens/ChooseFetchMethod.jsx, ManualEntry.jsx, FileUpload.jsx, BotScan.jsx, AAConsent.jsx"
##     stuck_count: 0
##     priority: "high"
##     needs_retesting: false
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "All 4 fetch methods reachable and functional (Bot Scan's real-broker-accuracy step needs a human, see backend task above). diveEngine.js rewired to score real Holding data instead of the two hardcoded demo profiles — see adaptHolding()'s comment on the honest scope reduction of the look-through feature (no fund-composition data source yet, so concentration is only detected via matching instrument names, not fund decomposition)."
##
## metadata:
##   created_by: "main_agent"
##   version: "2.0"
##   test_sequence: 1
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Bot Scanner (screen-share OCR)"
##   stuck_tasks: []
##   test_all: false
##   test_priority: "stuck_first"
##
## agent_communication:
##     -agent: "main"
##     -message: "Migrated backend from FastAPI/Python (preserved at backend/legacy-python/, no longer run) to Node/Express/TypeScript + MongoDB. Phases 0-6 of the migration complete: architecture+scaffolding, real auth, instrument master service, manual entry, file upload, bot scanner, and Finvu AA sandbox (mock mode). 22/22 backend integration tests passing. Only remaining gap: Bot Scanner's real-broker-screen OCR accuracy needs a human to test (getDisplayMedia requires a real OS permission dialog + a real broker account, neither of which automation can provide)."