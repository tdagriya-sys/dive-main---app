import { AssetClass } from "../models/Instrument";

export interface SeedInstrument {
  assetClass: AssetClass;
  symbol: string;
  name: string;
  issuer?: string;
  exchange?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Bundled fallback instrument list, used when live public sources (NSE/AMFI/CoinGecko)
 * are unreachable, and as the baseline seed on first run. Not exhaustive — meant to
 * cover enough real, recognizable names per asset class for search/autocomplete to work.
 */
export const STATIC_INSTRUMENTS: SeedInstrument[] = [
  // Equity — a sample of large NSE-listed names
  { assetClass: "EQUITY", symbol: "RELIANCE", name: "Reliance Industries", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "HDFCBANK", name: "HDFC Bank", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "ICICIBANK", name: "ICICI Bank", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "INFY", name: "Infosys", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "TCS", name: "Tata Consultancy Services", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "SBIN", name: "State Bank of India", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "ITC", name: "ITC Limited", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "LT", name: "Larsen & Toubro", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "KOTAKBANK", name: "Kotak Mahindra Bank", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "BHARTIARTL", name: "Bharti Airtel", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "HINDUNILVR", name: "Hindustan Unilever", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "AXISBANK", name: "Axis Bank", exchange: "NSE" },
  // Additional NIFTY50 constituents — still a small fraction of NSE's ~2700+
  // listed equities, but meaningfully broader coverage for verification/search.
  { assetClass: "EQUITY", symbol: "BAJFINANCE", name: "Bajaj Finance", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "BAJAJFINSV", name: "Bajaj Finserv", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "MARUTI", name: "Maruti Suzuki India", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "TATAMOTORS", name: "Tata Motors", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "TATASTEEL", name: "Tata Steel", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "SUNPHARMA", name: "Sun Pharmaceutical Industries", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "TITAN", name: "Titan Company", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "ULTRACEMCO", name: "UltraTech Cement", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "NESTLEIND", name: "Nestle India", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "POWERGRID", name: "Power Grid Corporation of India", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "NTPC", name: "NTPC Limited", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "ONGC", name: "Oil and Natural Gas Corporation", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "COALINDIA", name: "Coal India", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "HINDALCO", name: "Hindalco Industries", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "JSWSTEEL", name: "JSW Steel", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "ADANIPORTS", name: "Adani Ports and Special Economic Zone", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "ADANIENT", name: "Adani Enterprises", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "DIVISLAB", name: "Divi's Laboratories", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "DRREDDY", name: "Dr. Reddy's Laboratories", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "EICHERMOT", name: "Eicher Motors", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "GRASIM", name: "Grasim Industries", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "HCLTECH", name: "HCL Technologies", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "HEROMOTOCO", name: "Hero MotoCorp", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "INDUSINDBK", name: "IndusInd Bank", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "M&M", name: "Mahindra & Mahindra", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "TECHM", name: "Tech Mahindra", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "WIPRO", name: "Wipro", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "ASIANPAINT", name: "Asian Paints", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "SBILIFE", name: "SBI Life Insurance Company", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "CIPLA", name: "Cipla", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "BPCL", name: "Bharat Petroleum Corporation", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "SHREECEM", name: "Shree Cement", exchange: "NSE" },
  { assetClass: "EQUITY", symbol: "APOLLOHOSP", name: "Apollo Hospitals Enterprise", exchange: "NSE" },

  // Mutual Funds — a sample of well-known schemes
  { assetClass: "MUTUAL_FUND", symbol: "PPFCF", name: "Parag Parikh Flexi Cap Fund", issuer: "PPFAS Mutual Fund" },
  { assetClass: "MUTUAL_FUND", symbol: "NIPLC", name: "Nippon India Large Cap Fund", issuer: "Nippon India Mutual Fund" },
  { assetClass: "MUTUAL_FUND", symbol: "MOSMALL250", name: "Motilal Oswal Midcap Fund", issuer: "Motilal Oswal Mutual Fund" },
  { assetClass: "MUTUAL_FUND", symbol: "SBIBLUECHIP", name: "SBI Blue Chip Fund", issuer: "SBI Mutual Fund" },
  { assetClass: "MUTUAL_FUND", symbol: "HDFCMIDCAP", name: "HDFC Mid-Cap Opportunities Fund", issuer: "HDFC Mutual Fund" },
  { assetClass: "MUTUAL_FUND", symbol: "AXISGROWTHOPP", name: "Axis Growth Opportunities Fund", issuer: "Axis Mutual Fund" },
  { assetClass: "MUTUAL_FUND", symbol: "ICICIPRUVAL", name: "ICICI Prudential Value Discovery Fund", issuer: "ICICI Prudential Mutual Fund" },

  // ETFs — the full live list (incl. gold/silver ETFs, reclassified into
  // GOLD/SILVER) comes from fetchNseEtfs(); these are just the fallback
  // if that live fetch fails. Deliberately excludes gold/silver ETF symbols
  // (e.g. GOLDBEES) to avoid seeding them here under the wrong asset class.
  { assetClass: "ETF", symbol: "NIFTYBEES", name: "Nippon India ETF Nifty 50 BeES", exchange: "NSE" },
  { assetClass: "ETF", symbol: "JUNIORBEES", name: "Nippon India ETF Junior BeES (Nifty Next 50)", exchange: "NSE" },
  { assetClass: "ETF", symbol: "BANKBEES", name: "Nippon India ETF Bank BeES", exchange: "NSE" },
  { assetClass: "ETF", symbol: "ICICINIFTY", name: "ICICI Prudential Nifty 50 ETF", exchange: "NSE" },

  // Bonds — no clean public master-list source found for corporate bonds/G-Secs
  // (unlike equities/MFs/ETFs), so these are hand-curated, real issuers shown
  // generically (a specific tranche has its own ISIN/maturity we don't track here).
  { assetClass: "BOND", symbol: "GSEC10Y", name: "Government of India 10-Year G-Sec" },
  { assetClass: "BOND", symbol: "HDFC_BOND", name: "HDFC Bank Bonds", issuer: "HDFC Bank" },
  { assetClass: "BOND", symbol: "REL_BOND", name: "Reliance Industries Corporate Bonds", issuer: "Reliance Industries" },
  { assetClass: "BOND", symbol: "NHAI_TAXFREE", name: "NHAI Tax-Free Bonds", issuer: "National Highways Authority of India" },
  { assetClass: "BOND", symbol: "REC_BOND", name: "REC Limited Bonds", issuer: "REC Limited" },
  { assetClass: "BOND", symbol: "PFC_BOND", name: "Power Finance Corporation Bonds", issuer: "Power Finance Corporation" },
  { assetClass: "BOND", symbol: "NABARD_BOND", name: "NABARD Bonds", issuer: "NABARD" },
  { assetClass: "BOND", symbol: "LICHFL_BOND", name: "LIC Housing Finance Bonds", issuer: "LIC Housing Finance" },

  // REITs — India's full, small, real universe of NSE-listed REITs (not fetched
  // live; NSE's public archives don't include REIT/InvIT listings at all).
  { assetClass: "REIT", symbol: "EMBASSY", name: "Embassy Office Parks REIT", exchange: "NSE" },
  { assetClass: "REIT", symbol: "MINDSPACE", name: "Mindspace Business Parks REIT", exchange: "NSE" },
  { assetClass: "REIT", symbol: "BROOKFIELD", name: "Brookfield India Real Estate Trust", exchange: "NSE" },
  { assetClass: "REIT", symbol: "NXST", name: "Nexus Select Trust", exchange: "NSE" },

  // InvITs — same as REITs above: a small real universe, hand-curated.
  { assetClass: "INVIT", symbol: "INDIGRID", name: "IndiGrid InvIT", exchange: "NSE" },
  { assetClass: "INVIT", symbol: "POWERGRIDINVIT", name: "PowerGrid Infrastructure Investment Trust", exchange: "NSE" },
  { assetClass: "INVIT", symbol: "IRBINVIT", name: "IRB InvIT Fund", exchange: "NSE" },
  { assetClass: "INVIT", symbol: "NHAI_INVIT", name: "National Highways Infra Trust", exchange: "NSE" },
  { assetClass: "INVIT", symbol: "INDIA_INFRA_TRUST", name: "India Infrastructure Trust", exchange: "NSE" },
  { assetClass: "INVIT", symbol: "BHARAT_HIGHWAYS", name: "Bharat Highways InvIT", exchange: "NSE" },
  { assetClass: "INVIT", symbol: "SHREM_INVIT", name: "Shrem InvIT", exchange: "NSE" },

  // Gold / Silver — non-ETF paper/physical routes. The much larger, live-fetched
  // list of gold/silver ETFs comes from fetchNseEtfs() (reclassified from NSE's
  // ETF list by "Underlying"); these cover the routes that aren't exchange-traded.
  { assetClass: "GOLD", symbol: "SGB", name: "Sovereign Gold Bond" },
  { assetClass: "GOLD", symbol: "DIGITAL_GOLD", name: "Digital Gold" },
  { assetClass: "GOLD", symbol: "PHYSICAL_GOLD", name: "Physical Gold" },
  { assetClass: "SILVER", symbol: "DIGITAL_SILVER", name: "Digital Silver" },
  { assetClass: "SILVER", symbol: "PHYSICAL_SILVER", name: "Physical Silver" },

  // ULIP / Insurance — proprietary insurer products with no public master
  // list; hand-curated real, well-known plans.
  { assetClass: "ULIP_INSURANCE", symbol: "HDFCLIFE_SMARTWEALTH", name: "HDFC Life SmartWealth Plan", issuer: "HDFC Life" },
  { assetClass: "ULIP_INSURANCE", symbol: "ICICIPRULIFE_WEALTH", name: "ICICI Pru Signature ULIP", issuer: "ICICI Prudential Life" },
  { assetClass: "ULIP_INSURANCE", symbol: "SBILIFE_WEALTH", name: "SBI Life Smart Wealth Builder", issuer: "SBI Life" },
  { assetClass: "ULIP_INSURANCE", symbol: "LIC_GUARANTEED", name: "LIC Guaranteed Plan", issuer: "LIC" },
  { assetClass: "ULIP_INSURANCE", symbol: "MAXLIFE_WEALTH", name: "Max Life Smart Wealth Plan", issuer: "Max Life Insurance" },
  { assetClass: "ULIP_INSURANCE", symbol: "TATAAIA_WEALTH", name: "Tata AIA Fortune Pro", issuer: "Tata AIA Life Insurance" },
  { assetClass: "ULIP_INSURANCE", symbol: "BAJAJALLIANZ_WEALTH", name: "Bajaj Allianz Goal Assure", issuer: "Bajaj Allianz Life Insurance" },

  // FD issuers — RBI-licensed banks. India has ~150 scheduled banks; this is
  // the major PSU/private/small-finance names, not the full RBI register.
  { assetClass: "FD", symbol: "HDFC_FD", name: "HDFC Bank Fixed Deposit", issuer: "HDFC Bank" },
  { assetClass: "FD", symbol: "SBI_FD", name: "State Bank of India Fixed Deposit", issuer: "State Bank of India" },
  { assetClass: "FD", symbol: "ICICI_FD", name: "ICICI Bank Fixed Deposit", issuer: "ICICI Bank" },
  { assetClass: "FD", symbol: "AXIS_FD", name: "Axis Bank Fixed Deposit", issuer: "Axis Bank" },
  { assetClass: "FD", symbol: "KOTAK_FD", name: "Kotak Mahindra Bank Fixed Deposit", issuer: "Kotak Mahindra Bank" },
  { assetClass: "FD", symbol: "PNB_FD", name: "Punjab National Bank Fixed Deposit", issuer: "Punjab National Bank" },
  { assetClass: "FD", symbol: "BOB_FD", name: "Bank of Baroda Fixed Deposit", issuer: "Bank of Baroda" },
  { assetClass: "FD", symbol: "POST_OFFICE_FD", name: "Post Office Time Deposit", issuer: "India Post" },
  { assetClass: "FD", symbol: "CANARA_FD", name: "Canara Bank Fixed Deposit", issuer: "Canara Bank" },
  { assetClass: "FD", symbol: "UNIONBANK_FD", name: "Union Bank of India Fixed Deposit", issuer: "Union Bank of India" },
  { assetClass: "FD", symbol: "BOI_FD", name: "Bank of India Fixed Deposit", issuer: "Bank of India" },
  { assetClass: "FD", symbol: "INDIANBANK_FD", name: "Indian Bank Fixed Deposit", issuer: "Indian Bank" },
  { assetClass: "FD", symbol: "IDBI_FD", name: "IDBI Bank Fixed Deposit", issuer: "IDBI Bank" },
  { assetClass: "FD", symbol: "YESBANK_FD", name: "Yes Bank Fixed Deposit", issuer: "Yes Bank" },
  { assetClass: "FD", symbol: "INDUSIND_FD", name: "IndusInd Bank Fixed Deposit", issuer: "IndusInd Bank" },
  { assetClass: "FD", symbol: "FEDERAL_FD", name: "Federal Bank Fixed Deposit", issuer: "Federal Bank" },
  { assetClass: "FD", symbol: "IDFCFIRST_FD", name: "IDFC FIRST Bank Fixed Deposit", issuer: "IDFC FIRST Bank" },
  { assetClass: "FD", symbol: "RBL_FD", name: "RBL Bank Fixed Deposit", issuer: "RBL Bank" },
  { assetClass: "FD", symbol: "BANDHAN_FD", name: "Bandhan Bank Fixed Deposit", issuer: "Bandhan Bank" },
  { assetClass: "FD", symbol: "AUSFB_FD", name: "AU Small Finance Bank Fixed Deposit", issuer: "AU Small Finance Bank" },
  { assetClass: "FD", symbol: "EQUITASSFB_FD", name: "Equitas Small Finance Bank Fixed Deposit", issuer: "Equitas Small Finance Bank" },
  { assetClass: "FD", symbol: "UJJIVANSFB_FD", name: "Ujjivan Small Finance Bank Fixed Deposit", issuer: "Ujjivan Small Finance Bank" },

  // Crypto — top coins
  { assetClass: "CRYPTO", symbol: "BTC", name: "Bitcoin" },
  { assetClass: "CRYPTO", symbol: "ETH", name: "Ethereum" },
  { assetClass: "CRYPTO", symbol: "USDT", name: "Tether" },
  { assetClass: "CRYPTO", symbol: "BNB", name: "BNB" },
  { assetClass: "CRYPTO", symbol: "SOL", name: "Solana" },
  { assetClass: "CRYPTO", symbol: "XRP", name: "XRP" },
  { assetClass: "CRYPTO", symbol: "ADA", name: "Cardano" },
  { assetClass: "CRYPTO", symbol: "DOGE", name: "Dogecoin" },
  { assetClass: "CRYPTO", symbol: "MATIC", name: "Polygon" },
  { assetClass: "CRYPTO", symbol: "DOT", name: "Polkadot" },
];
