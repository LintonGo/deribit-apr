// Options APR Calculator - Content Script
// Supports: Deribit, Tibired
// Calculates and displays APR for options

(function() {
  'use strict';

  // ========== Configuration ==========
  const CONFIG = {
    daysPerYear: 365,
    debug: true, // Enable debug logs
  };

  // State
  let aprEnabled = true; // APR display enabled by default
  let currentStrategy = 'put';
  let btcPrice = null;
  let ethPrice = null;
  let underlyingPrice = null; // Current page's underlying price
  let currentSite = null;

  // ========== Initialize ==========
  function init() {
    // Detect which site we're on
    currentSite = detectSite();
    log('[APR] Extension loaded on:', currentSite);

    // Load saved state
    chrome.storage.sync.get(['aprEnabled', 'strategy'], (result) => {
      if (result.aprEnabled !== undefined) {
        aprEnabled = result.aprEnabled;
        log('[APR] APR enabled:', aprEnabled);
      }
      if (result.strategy) {
        currentStrategy = result.strategy;
        log('[APR] Strategy:', currentStrategy);
      }
      // Apply initial state
      if (!aprEnabled) {
        hideAllAPR();
      }
    });

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'APR_TOGGLE') {
        aprEnabled = message.enabled;
        log('[APR] APR toggle:', aprEnabled);
        if (aprEnabled) {
          processPage();
        } else {
          hideAllAPR();
        }
      }
      if (message.type === 'STRATEGY_CHANGED') {
        currentStrategy = message.strategy;
        log('[APR] Strategy changed to:', currentStrategy);
        updateAllAPRColumns();
      }
      if (message.type === 'GET_STATUS') {
        sendResponse({
          enabled: aprEnabled,
          strategy: currentStrategy,
          btcPrice: btcPrice,
          ethPrice: ethPrice,
          underlyingPrice: underlyingPrice,
          site: currentSite
        });
      }
    });

    // Start observing
    observePage();

    // Initial processing with delay
    setTimeout(processPage, 1500);
  }

  // ========== Site Detection ==========
  function detectSite() {
    const url = window.location.href;
    if (url.includes('tibired.com')) return 'tibired';
    if (url.includes('deribit.com')) return 'deribit';
    return 'unknown';
  }

  // ========== Debug Logging ==========
  function log(...args) {
    if (CONFIG.debug) {
      console.log.apply(console, args);
    }
  }

  // ========== DOM Observation ==========
  function observePage() {
    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          shouldProcess = true;
          break;
        }
      }
      if (shouldProcess) {
        clearTimeout(window._aprTimeout);
        window._aprTimeout = setTimeout(processPage, 300);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // ========== Main Processing ==========
  function processPage() {
    if (!aprEnabled) {
      log('[APR] APR disabled, skipping processing');
      return;
    }

    log('[APR] Processing page...');

    // Find underlying price first
    findUnderlyingPrice();

    // Debug: show found price
    log('[APR] Underlying price:', underlyingPrice);

    // Find and process options tables based on site
    if (currentSite === 'tibired') {
      processTibired();
    } else if (currentSite === 'deribit') {
      processDeribit();
    } else {
      processGeneric();
    }
  }

  // ========== Hide All APR Displays ==========
  function hideAllAPR() {
    log('[APR] Hiding all APR displays');

    // Remove all APR badges
    document.querySelectorAll('.apr-badge, .apr-badge-bid, .apr-badge-ask, .apr-tibired').forEach(el => {
      el.remove();
    });

    // Remove APR headers and cells
    document.querySelectorAll('.apr-header, .apr-cell').forEach(el => {
      el.remove();
    });

    // Clear processed flags so they can be re-processed when enabled
    document.querySelectorAll('[data-apr-processed]').forEach(el => {
      delete el.dataset.aprProcessed;
    });
  }

  // ========== Tibired Processing ==========
  function processTibired() {
    log('[APR] Processing Tibired page...');

    // Find all option rows using data-id attribute
    const optionRows = document.querySelectorAll('[data-id^="BTC_USDC-"], [data-id^="ETH_USDC-"]');

    log('[APR] Found option rows:', optionRows.length);

    if (optionRows.length === 0) {
      log('[APR] No option rows found yet, will retry...');
      return;
    }

    // Get expiry from page
    const expiry = getTibiredExpiryFromPage();

    optionRows.forEach((row, index) => {
      processTibiredOptionRow(row, expiry, index);
    });

    // Start observing price changes for real-time updates
    observePriceChanges();
  }

  // ========== Observe Price Changes ==========
  let priceUpdateTimer = null;

  function observePriceChanges() {
    const priceObserver = new MutationObserver((mutations) => {
      // Debounce: wait for changes to settle
      clearTimeout(priceUpdateTimer);
      priceUpdateTimer = setTimeout(() => {
        if (!aprEnabled) return;
        updateChangedPrices(mutations);
      }, 200); // 200ms debounce
    });

    // Observe the option chain container instead of individual elements
    const container = document.querySelector('[data-id^="BTC_USDC-"], [data-id^="ETH_USDC-"]')?.parentElement;
    if (container) {
      priceObserver.observe(container, {
        childList: true,
        subtree: true,
        characterData: true
      });
      log('[APR] Observing price changes on container');
    }
  }

  function updateChangedPrices(mutations) {
    const processedRows = new Set();

    for (const mutation of mutations) {
      const target = mutation.target;
      // Check if target is an Element (not a text node)
      if (!(target instanceof Element)) continue;

      // Check if this is a price element
      const priceContainer = target.closest('[data-colid="best_bid_price"], [data-colid="best_ask_price"]');
      if (priceContainer) {
        const optionRow = priceContainer.closest('[data-id^="BTC_USDC-"], [data-id^="ETH_USDC-"]');
        if (optionRow && !processedRows.has(optionRow)) {
          processedRows.add(optionRow);
          const expiry = getTibiredExpiryFromPage();
          processTibiredOptionRow(optionRow, expiry, -1);
        }
      }
    }

    if (processedRows.size > 0) {
      log('[APR] Updated APR for', processedRows.size, 'rows');
    }
  }

  // ========== Process Tibired Option Row ==========
  function processTibiredOptionRow(row, expiry, index) {
    // Always process to allow updates (don't skip if already processed)
    // We'll update existing badges instead of skipping

    const dataId = row.getAttribute('data-id');
    if (!dataId) return;

    // Parse option info from data-id: BTC_USDC-24APR26-40000-C or ETH_USDC-6APR26-2000-C
    const match = dataId.match(/(BTC|ETH)_USDC-(\d{1,2}[A-Z]{3}\d{2})-(\d+)-([CP])$/);
    if (!match) {
      return;
    }

    const assetType = match[1]; // BTC or ETH
    const strike = parseFloat(match[3]);
    const optionType = match[4] === 'P' ? 'put' : 'call';

    // Find bid price element
    const bidEl = row.querySelector('[data-colid="best_bid_price"] .MuiBox-root');
    const askEl = row.querySelector('[data-colid="best_ask_price"] .MuiBox-root');

    // Parse prices
    const bid = bidEl ? parseTibiredPrice(bidEl.textContent) : null;
    const ask = askEl ? parseTibiredPrice(askEl.textContent) : null;

    // Mark as processed
    row.dataset.aprProcessed = 'true';

    // Update APR displays next to bid and ask prices
    if (bidEl && bid !== null) {
      const bidApr = calculateAPR({
        strike,
        bid,
        ask,
        mark: bid,
        expiry,
        optionType,
        isUSDPrice: true,
        assetType
      });
      updateTibiredAPRBadge(bidEl.parentElement, bidApr, 'bid', strike, optionType, assetType);
    } else {
      // Remove badge if no bid price
      removeTibiredAPRBadge(bidEl?.parentElement, 'bid');
    }

    if (askEl && ask !== null) {
      const askApr = calculateAPR({
        strike,
        bid,
        ask,
        mark: ask,
        expiry,
        optionType,
        isUSDPrice: true,
        assetType
      });
      updateTibiredAPRBadge(askEl.parentElement, askApr, 'ask', strike, optionType, assetType);
    } else {
      // Remove badge if no ask price
      removeTibiredAPRBadge(askEl?.parentElement, 'ask');
    }
  }

  // ========== Parse Tibired Price ==========
  function parseTibiredPrice(text) {
    if (!text) return null;
    const cleaned = text.trim();
    if (cleaned === '-' || cleaned === '') return null;
    const price = parseFloat(cleaned.replace(/[^0-9.]/g, ''));
    return isNaN(price) ? null : price;
  }

  // ========== Get Tibired Expiry From Page ==========
  function getTibiredExpiryFromPage() {
    // Find expiry date in the header
    const expiryHeader = document.querySelector('[class*="css-1khst8"] h6, h6[class*="css-12630jt"]');
    if (expiryHeader) {
      const text = expiryHeader.textContent?.trim();
      log('[APR] Found expiry header:', text);
      // Parse: "24 Apr 2026"
      const match = text.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i);
      if (match) {
        const day = parseInt(match[1]);
        const monthStr = match[2].toUpperCase();
        const year = parseInt(match[3]);
        const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        const month = months.indexOf(monthStr);
        if (month >= 0) {
          return new Date(year, month, day, 8, 0, 0);
        }
      }
    }

    // Alternative: parse from到期时间 text
    const expiryTimeEl = document.querySelector('[class*="css-1srujop"]');
    if (expiryTimeEl) {
      const text = expiryTimeEl.textContent;
      // Parse: "到期时间: 18d 20h 30m"
      const match = text.match(/(\d+)d\s*(\d+)h/);
      if (match) {
        const days = parseInt(match[1]);
        const hours = parseInt(match[2]);
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + days);
        expiry.setHours(expiry.getHours() + hours);
        return expiry;
      }
    }

    // Default 30 days
    const defaultExpiry = new Date();
    defaultExpiry.setDate(defaultExpiry.getDate() + 30);
    return defaultExpiry;
  }

  // ========== Check if Option is OTM (Out of The Money) ==========
  function isOTM(strike, optionType, underlyingPrice) {
    if (!underlyingPrice) return false; // Can't determine if no underlying price

    if (optionType === 'call') {
      // Call is OTM when strike > underlying price
      return strike > underlyingPrice;
    } else if (optionType === 'put') {
      // Put is OTM when strike < underlying price
      return strike < underlyingPrice;
    }
    return false;
  }

  // ========== Update Tibired APR Badge ==========
  function updateTibiredAPRBadge(parentEl, aprData, priceType, strike, optionType, assetType) {
    if (!parentEl || !aprData) return;

    // Only show APR for OTM (Out of The Money) options - seller perspective
    // Call OTM: strike > underlyingPrice (left bottom quadrant)
    // Put OTM: strike < underlyingPrice (right upper quadrant)
    if (!isOTM(strike, optionType, underlyingPrice)) {
      // Remove badge if exists (for ITM options)
      removeTibiredAPRBadge(parentEl, priceType);
      return;
    }

    // Find existing badge or create new one
    let aprBadge = parentEl.querySelector(`.apr-badge-${priceType}`);

    if (!aprBadge) {
      aprBadge = document.createElement('span');
      aprBadge.className = `apr-badge apr-badge-${priceType}`;
      aprBadge.dataset.strike = strike;
      aprBadge.dataset.optionType = optionType;
      aprBadge.dataset.priceType = priceType;
      aprBadge.dataset.assetType = assetType || 'BTC';

      // Style based on option type
      let bgColor, textColor;
      if (optionType === 'put') {
        bgColor = assetType === 'ETH' ? '#f3e5f5' : '#e3f2fd'; // Purple for ETH Put, Blue for BTC Put
        textColor = assetType === 'ETH' ? '#7b1fa2' : '#1976d2';
      } else {
        bgColor = assetType === 'ETH' ? '#fff8e1' : '#fff3e0'; // Yellow for ETH Call, Orange for BTC Call
        textColor = assetType === 'ETH' ? '#f57f17' : '#f57c00';
      }

      aprBadge.style.cssText = `
        display: inline-block;
        margin-left: 4px;
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 10px;
        font-weight: 500;
        white-space: nowrap;
        background: ${bgColor};
        color: ${textColor};
        cursor: default;
      `;

      parentEl.appendChild(aprBadge);
    }

    // Update content
    aprBadge.textContent = `APR: ${aprData.apr.toFixed(1)}%`;
    aprBadge.title = `${assetType || 'BTC'} ${optionType.toUpperCase()} ${strike} (OTM) | ${priceType.toUpperCase()} | Days: ${aprData.daysToExpiry.toFixed(1)} | Price: $${aprData.optionPriceUSD.toFixed(2)}`;
  }

  // ========== Remove Tibired APR Badge ==========
  function removeTibiredAPRBadge(parentEl, priceType) {
    if (!parentEl) return;
    const badge = parentEl.querySelector(`.apr-badge-${priceType}`);
    if (badge) badge.remove();
  }

  // ========== Debug Page Structure ==========
  function debugPageStructure() {
    log('[APR] === Page Structure Debug ===');

    // Find all elements that might contain option data
    const allElements = document.querySelectorAll('*');
    const potentialDataElements = [];

    allElements.forEach(el => {
      const text = el.textContent?.trim() || '';
      // Look for strike-like numbers (e.g., 60000, 70000)
      if (/^\d{4,6}$/.test(text) || /^\d{4,6}\.\d+$/.test(text)) {
        const strikeNum = parseFloat(text);
        if (strikeNum > 10000 && strikeNum < 200000) {
          potentialDataElements.push({
            element: el,
            text: text,
            tagName: el.tagName,
            className: el.className,
            parent: el.parentElement?.className || ''
          });
        }
      }
    });

    log('[APR] Found potential strike elements:', potentialDataElements.length);

    // Show first 5 samples
    potentialDataElements.slice(0, 5).forEach(item => {
      log('[APR] Sample:', item.tagName, 'class:', item.className, 'text:', item.text);
    });

    // Find price-related elements
    const priceElements = document.querySelectorAll('[class*="price"], [class*="Price"], [class*="mark"], [class*="bid"], [class*="ask"]');
    log('[APR] Price-related elements:', priceElements.length);

    // Find table headers - expanded selectors for React/Ag-Grid/MUI
    const headerSelectors = [
      'th',
      '[role="columnheader"]',
      '[class*="header"]',
      '[class*="Header"]',
      '.ag-header-cell',
      '[class*="ag-header"]',
      '[class*="grid-header"]',
      '[class*="table-head"]',
      '[class*="column-header"]',
      '[data-testid*="header"]'
    ];

    let headers = [];
    for (const selector of headerSelectors) {
      try {
        const els = document.querySelectorAll(selector);
        if (els.length > headers.length) {
          headers = Array.from(els);
        }
      } catch (e) {}
    }

    log('[APR] Header elements:', headers.length);
    headers.slice(0, 20).forEach(h => {
      const text = h.textContent?.trim();
      if (text && text.length < 100) log('[APR] Header:', text);
    });

    // Debug: find grid/table containers
    const gridContainers = document.querySelectorAll('[class*="grid"], [class*="table"], [class*="list"], [data-testid*="grid"]');
    log('[APR] Grid/Table containers:', gridContainers.length);
    gridContainers.forEach(g => {
      log('[APR] Container class:', g.className?.substring(0, 50));
      // Check if it has child rows
      const children = g.children;
      log('[APR] Container children:', children.length);
      if (children.length > 0) {
        log('[APR] First child:', children[0].tagName, children[0].className?.substring(0, 30));
      }
    });
  }

  // ========== Deribit Processing ==========
  function processDeribit() {
    log('[APR] Processing Deribit page...');
    // Similar logic as before, with known Deribit selectors
    processGeneric();
  }

  // ========== Generic Processing ==========
  function processGeneric() {
    const tables = document.querySelectorAll('table, [role="table"], [class*="table"], [class*="Table"]');
    tables.forEach(table => {
      if (isOptionsContainer(table)) {
        processOptionsTable(table);
      }
    });
  }

  // ========== Find Underlying Prices ==========
  function findUnderlyingPrice() {
    // Tibired shows price like:
    // <span class="css-o60dzv">标的期货: <span class="deribit-icon-usdc"></span>67,069.90</span>

    // First try: find the specific price display element
    const priceLabels = document.querySelectorAll('[class*="css-o60dzv"]');

    for (const el of priceLabels) {
      const text = el.textContent?.trim();

      // Check for "标的期货:" pattern
      if (text.includes('标的期货')) {
        // Extract the price number after the label
        const match = text.match(/标的期货.*?([\d,]+\.?\d+)/);
        if (match) {
          const price = parsePrice(match[1]);
          log('[APR] Found price from 标的期货:', match[1], '-> parsed:', price);
          // Determine if BTC or ETH based on magnitude
          if (price && price > 10000 && price < 200000) {
            btcPrice = price;
            log('[APR] Set as BTC price:', btcPrice);
          } else if (price && price > 500 && price < 10000) {
            ethPrice = price;
            log('[APR] Set as ETH price:', ethPrice);
          }
        }
      }
    }

    // Set underlyingPrice based on which options are on the page
    const hasBTCOptions = document.querySelector('[data-id^="BTC_USDC-"]');
    const hasETHOptions = document.querySelector('[data-id^="ETH_USDC-"]');

    if (hasBTCOptions && btcPrice) {
      underlyingPrice = btcPrice;
    } else if (hasETHOptions && ethPrice) {
      underlyingPrice = ethPrice;
    }

    log('[APR] Final - BTC:', btcPrice, 'ETH:', ethPrice, 'Underlying:', underlyingPrice);
  }

  // ========== Parse Price ==========
  function parsePrice(text) {
    if (!text) return null;
    const cleaned = text.replace(/[^0-9.]/g, '');
    const price = parseFloat(cleaned);
    return isNaN(price) ? null : price;
  }

  // ========== Check if Options Container ==========
  function isOptionsContainer(element) {
    const text = element.textContent || '';
    const hasStrike = /\d{4,6}/.test(text);
    // Support both English and Chinese keywords
    const hasOptionTerms = /call|put|bid|ask|mark|strike|expiry|看涨|看跌|买入|卖出|行权|期权|标记|delta|gamma|vega|theta/i.test(text);
    return hasStrike && hasOptionTerms;
  }

  // ========== Process Options Table ==========
  function processOptionsTable(table) {
    log('[APR] Processing options table');

    // Detect column indices from header
    const columnMap = detectColumnIndices(table);
    log('[APR] Column map:', columnMap);

    // Add APR header
    addAPRHeader(table);

    // Find rows
    const rows = findOptionRows(table);
    log('[APR] Found', rows.length, 'rows');

    rows.forEach((row, index) => {
      processOptionRow(row, index, columnMap);
    });
  }

  // ========== Detect Column Indices ==========
  function detectColumnIndices(table) {
    // Try multiple header selectors for different table types
    const headerSelectors = [
      'thead tr',
      'thead tr:first-child',
      '[role="rowheader"]',
      '[class*="header-row"]',
      '[class*="header"]',
      '.ag-header-row',
      '[class*="ag-header-row"]',
      // First row fallback
      'tr:first-child',
      '> div:first-child',
      '> div[class*="header"]'
    ];

    let headerRow = null;
    for (const selector of headerSelectors) {
      try {
        const el = table.querySelector(selector);
        if (el) {
          headerRow = el;
          log('[APR] Found header with selector:', selector);
          break;
        }
      } catch (e) {}
    }

    if (!headerRow) return null;

    // Get all cells in header - try multiple selectors
    let headerCells = headerRow.querySelectorAll('th, td, [role="columnheader"], span, div');
    if (headerCells.length === 0) {
      headerCells = Array.from(headerRow.children);
    }

    const columnMap = {
      product: -1,
      markPrice: -1,
      avgPrice: -1,
      strike: -1,
      expiry: -1
    };

    headerCells.forEach((cell, index) => {
      const text = cell.textContent?.trim().toLowerCase() || '';
      log('[APR] Header cell', index, ':', text.substring(0, 30));

      if (text.includes('产品') || text.includes('product') || text.includes('instrument')) {
        columnMap.product = index;
      } else if (text.includes('标记价格') || text.includes('mark price') || text.includes('标记')) {
        columnMap.markPrice = index;
      } else if (text.includes('平均价格') || text.includes('avg price') || text.includes('平均')) {
        columnMap.avgPrice = index;
      } else if (text.includes('行权') || text.includes('strike')) {
        columnMap.strike = index;
      } else if (text.includes('到期') || text.includes('expir') || text.includes('日期')) {
        columnMap.expiry = index;
      }
    });

    return columnMap;
  }

  // ========== Find Option Rows ==========
  function findOptionRows(table) {
    const rowSelectors = [
      'tr',
      '[role="row"]',
      '[class*="row"]:not([class*="header"])',
      '[class*="Row"]:not([class*="Header"])',
      // Ag-Grid style
      '.ag-row',
      '[class*="ag-row"]',
      // Virtual list style
      '[class*="virtual"] > div',
      // Generic grid row
      '[class*="grid-row"]',
      '[class*="item"]',
      // Direct children approach
      '> div:not([class*="header"])'
    ];

    let bestRows = [];

    for (const selector of rowSelectors) {
      try {
        const rows = table.querySelectorAll(selector);
        if (rows.length > bestRows.length) {
          bestRows = Array.from(rows).filter(r => !isHeaderRow(r));
          if (bestRows.length > 0) {
            log('[APR] Found rows with selector:', selector, 'count:', bestRows.length);
          }
        }
      } catch (e) {}
    }

    // Fallback: try direct children if no rows found
    if (bestRows.length === 0) {
      const directChildren = Array.from(table.children).filter(c => !isHeaderRow(c));
      if (directChildren.length > 0) {
        // Check if children contain option-like data
        const dataChildren = directChildren.filter(c => {
          const text = c.textContent || '';
          return /\d{4,6}/.test(text); // Has strike-like number
        });
        if (dataChildren.length > 0) {
          bestRows = dataChildren;
          log('[APR] Using direct children as rows, count:', bestRows.length);
        }
      }
    }

    return bestRows;
  }

  // ========== Check if Header Row ==========
  function isHeaderRow(row) {
    const isHeaderTag = row.tagName === 'TH' || row.closest('thead');
    const isHeaderRole = row.getAttribute('role') === 'rowheader';
    const isHeaderClass = /header|Header|ag-header/i.test(row.className || '');
    // Also check if row contains header-like text only
    const text = row.textContent?.trim() || '';
    const isOnlyHeaders = !/\d{4,6}/.test(text) && !/BTC_|ETH_/.test(text);
    return isHeaderTag || isHeaderRole || isHeaderClass;
  }

  // ========== Process Option Row ==========
  function processOptionRow(row, index, columnMap = null) {
    if (row.dataset.aprProcessed === 'true') return;

    const data = extractOptionData(row, columnMap);

    if (data) {
      row.dataset.aprProcessed = 'true';

      const apr = calculateAPR(data);
      addAPRCell(row, apr, data);

      log('[APR] Row', index, 'Strike:', data.strike, 'Mark:', data.mark, 'APR:', apr?.apr);
    }
  }

  // ========== Extract Option Data from Row ==========
  function extractOptionData(row, columnMap = null) {
    // Get all cells in the row - try multiple element types
    let cells = row.querySelectorAll('td, [role="cell"], th, [role="gridcell"]');

    // If no cells found, try spans/divs inside the row
    if (cells.length <= 1) {
      const spans = row.querySelectorAll('span:not(:empty), div:not(:empty)');
      if (spans.length > cells.length) {
        cells = spans;
        log('[APR] Using spans instead of td cells');
      }
    }

    const cellData = Array.from(cells).map(cell => ({
      text: cell.textContent?.trim() || '',
      className: cell.className || '',
      element: cell
    }));

    log('[APR] Row cells:', cellData.map(c => c.text).join(' | '));
    log('[APR] Row cell count:', cellData.length);
    if (cellData.length > 1) {
      cellData.forEach((c, i) => log('[APR] Cell', i, ':', c.text.substring(0, 50), '| class:', c.className.substring(0, 30)));
    }

    // Extract values
    let strike = null;
    let bid = null;
    let ask = null;
    let mark = null;
    let expiry = null;
    let optionType = currentStrategy; // Default to current strategy
    let productName = null;

    // Strategy 1: Find by class names (support both English and Chinese)
    for (const cell of cellData) {
      const value = parsePrice(cell.text);
      const cls = cell.className.toLowerCase();
      const txt = cell.text.toLowerCase();

      // Product name detection (产品)
      if (cls.includes('product') || cls.includes('instrument') ||
          /BTC_|ETH_/.test(cell.text)) {
        productName = cell.text.trim();
        // Parse option name: BTC_USDC-24APR26-50000-P or BTC-5APR24-65000-C
        // Match strike and type at end: -50000-P or -65000-C
        const optionMatch = cell.text.match(/-(\d{4,6})-([PCpc])(?:\s|$|[^0-9])/);
        if (optionMatch) {
          strike = parseFloat(optionMatch[1]);
          optionType = optionMatch[2].toUpperCase() === 'P' ? 'put' : 'call';
          log('[APR] Parsed from product name - Strike:', strike, 'Type:', optionType);
        }
        // Parse expiry from product name: -24APR26- or -5APR24-
        const expiryMatch = cell.text.match(/-(\d{1,2})([A-Z]{3})(\d{2})-/);
        if (expiryMatch) {
          const day = parseInt(expiryMatch[1]);
          const monthStr = expiryMatch[2];
          const year = 2000 + parseInt(expiryMatch[3]);
          const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
          const month = months.indexOf(monthStr.toUpperCase());
          if (month >= 0) {
            expiry = new Date(year, month, day, 8, 0, 0); // 8:00 UTC typical expiry
            log('[APR] Parsed expiry:', expiry);
          }
        }
        continue; // Skip price parsing for product name cell
      }
      // Strike detection (行权价)
      if (cls.includes('strike') || txt.includes('行权') || txt.includes('strike')) {
        if (value && value > 10000) strike = value;
      }
      // Bid detection (买入价)
      else if (cls.includes('bid') || txt.includes('买入') || txt.includes('bid')) {
        bid = value;
      }
      // Ask detection (卖出价)
      else if (cls.includes('ask') || txt.includes('卖出') || txt.includes('ask')) {
        ask = value;
      }
      // Mark price detection (标记价格)
      else if (cls.includes('mark') || cls.includes('price') ||
               txt.includes('标记') || txt.includes('价格')) {
        mark = value;
      }
      // Expiry detection (到期日)
      else if (cls.includes('expir') || cls.includes('date') ||
               txt.includes('到期') || txt.includes('日期')) {
        expiry = parseExpiry(cell.text);
      }

      // Detect option type (看涨/看跌) - only if not already parsed from product name
      if (!strike) {
        if (/call|看涨/i.test(cell.text) || cls.includes('call')) {
          optionType = 'call';
        } else if (/put|看跌/i.test(cell.text) || cls.includes('put')) {
          optionType = 'put';
        }
      }
    }

    // Strategy 2: Position-based using column map
    if (columnMap && cellData.length > 1) {
      log('[APR] Using column map for extraction');

      // Get mark price from column position
      if (columnMap.markPrice >= 0 && cellData[columnMap.markPrice]) {
        const priceVal = parsePrice(cellData[columnMap.markPrice].text);
        if (priceVal !== null && priceVal > 0) {
          mark = priceVal;
          log('[APR] Found mark price at column', columnMap.markPrice, ':', mark);
        }
      }

      // Get avg price as fallback
      if (!mark && columnMap.avgPrice >= 0 && cellData[columnMap.avgPrice]) {
        const priceVal = parsePrice(cellData[columnMap.avgPrice].text);
        if (priceVal !== null && priceVal > 0) {
          mark = priceVal;
          log('[APR] Found avg price at column', columnMap.avgPrice, ':', mark);
        }
      }
    }

    // Strategy 3: Position-based (common layout without column map)
    // Typical order: Strike | Call Bid | Call Ask | Put Bid | Put Ask | Expiry
    // or: Expiry | Strike | ...
    if (!strike) {
      for (const cell of cellData) {
        const value = parsePrice(cell.text);
        // Strike prices for BTC are typically 4-6 digits
        if (value && value >= 10000 && value <= 200000) {
          strike = value;
          break;
        }
      }
    }

    // Strategy 4: Find option premium (small values in BTC)
    // Option prices in BTC are typically 0.0001 to 0.5 for most options
    const allValues = cellData.map(c => parsePrice(c.text)).filter(v => v !== null);

    log('[APR] All numeric values in row:', allValues);

    // Look for BTC-denominated option prices (typically < 1)
    const btcPrices = allValues.filter(v => v > 0 && v < 1);
    if (btcPrices.length > 0 && !mark) {
      // Sort by magnitude to find likely option prices
      // Skip very small values that might be delta/gamma
      const candidatePrices = btcPrices.filter(v => v > 0.001);
      if (candidatePrices.length > 0) {
        mark = candidatePrices[0];
        log('[APR] Found potential BTC price:', mark);
      }
    }

    // Strategy 5: Look for USD option prices (could be > 1 for deep ITM)
    // Values between 1 and 10000 could be USD option prices
    if (!mark) {
      const usdPrices = allValues.filter(v => v >= 1 && v < 10000);
      if (usdPrices.length > 0) {
        // Use the smallest USD value as likely option price
        mark = Math.min(...usdPrices);
        // Flag this as USD so we don't multiply by underlying price
        log('[APR] Found potential USD price:', mark);
      }
    }

    // Try to find bid/ask if only one price found
    if (mark && !bid && !ask) {
      // Look for adjacent cells with similar small values
      for (let i = 0; i < cellData.length; i++) {
        const v = parsePrice(cellData[i].text);
        if (v !== null && v > 0 && v < 1 && v !== mark) {
          if (!bid) bid = v;
          else if (!ask) ask = v;
        }
      }
    }

    // Fallback: use mid price
    if (!mark && bid && ask) {
      mark = (bid + ask) / 2;
    }
    if (!mark && (bid || ask)) {
      mark = bid || ask;
    }

    // Find expiry
    if (!expiry) {
      for (const cell of cellData) {
        if (/expir|date|d\d+|\d+d|\d+\s*day/i.test(cell.text)) {
          expiry = parseExpiry(cell.text);
          break;
        }
      }
    }

    // Get expiry from page context if still not found
    if (!expiry) {
      expiry = getExpiryFromContext();
    }

    if (!strike) {
      log('[APR] Could not find strike for row');
      return null;
    }

    return {
      strike,
      bid,
      ask,
      mark,
      expiry,
      optionType
    };
  }

  // ========== Parse Expiry ==========
  function parseExpiry(text) {
    if (!text) return null;

    // Relative time patterns: "2d", "5h", "30m", "2 days"
    const relativeMatch = text.match(/(\d+)\s*(d|h|m|day|hour|minute|min)/i);
    if (relativeMatch) {
      const amount = parseInt(relativeMatch[1]);
      const unit = relativeMatch[2].toLowerCase();
      const now = new Date();

      if (unit.startsWith('d') || unit === 'day') {
        now.setDate(now.getDate() + amount);
      } else if (unit.startsWith('h') || unit === 'hour') {
        now.setHours(now.getHours() + amount);
      } else if (unit.startsWith('m') || unit === 'min' || unit === 'minute') {
        now.setMinutes(now.getMinutes() + amount);
      }

      return now;
    }

    // Date patterns
    const datePatterns = [
      /(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i,
      /(\d{4})-(\d{2})-(\d{2})/,
      /(\d{2})\/(\d{2})\/(\d{4})/,
      /(\d{1,2})-(\d{1,2})-(\d{4})/
    ];

    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        const date = new Date(text);
        if (!isNaN(date.getTime())) return date;
      }
    }

    return null;
  }

  // ========== Get Expiry from Context ==========
  function getExpiryFromContext() {
    // Look for expiry in page headers or nearby elements
    const expirySelectors = [
      '[class*="expiry"]',
      '[class*="expiry"]',
      '[class*="expiration"]',
      '[class*="date"]',
      'h1', 'h2', 'h3'
    ];

    for (const selector of expirySelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const expiry = parseExpiry(el.textContent);
        if (expiry) return expiry;
      }
    }

    // Default: assume 30 days if not found
    const defaultExpiry = new Date();
    defaultExpiry.setDate(defaultExpiry.getDate() + 30);
    return defaultExpiry;
  }

  // ========== Calculate APR ==========
  function calculateAPR(data) {
    const { strike, bid, ask, mark, expiry, optionType, isUSDPrice, assetType } = data;

    const optionPrice = mark || (bid && ask ? (bid + ask) / 2 : bid || ask);

    if (!optionPrice || !strike) return null;

    // Calculate days to expiry
    let daysToExpiry = 30;
    if (expiry) {
      const diff = expiry - new Date();
      daysToExpiry = Math.max(1, diff / (1000 * 60 * 60 * 24));
    }

    // Option prices on Tibired are in USD
    let optionPriceUSD = optionPrice;

    // Calculate APR based on option type
    let apr;
    let capitalBase;

    if (optionType === 'put') {
      // Cash-Secured Put: capital = strike price (USD needed to buy asset at strike)
      capitalBase = strike;
      apr = (optionPriceUSD / capitalBase) * (365 / daysToExpiry) * 100;
    } else {
      // Covered Call: capital = underlying price (asset value at current price)
      // Use underlyingPrice if available, otherwise estimate from strike
      if (assetType === 'ETH') {
        capitalBase = underlyingPrice || strike;
      } else {
        capitalBase = underlyingPrice || strike;
      }
      apr = (optionPriceUSD / capitalBase) * (365 / daysToExpiry) * 100;
    }

    return {
      apr: apr,
      daysToExpiry: daysToExpiry,
      optionPriceUSD: optionPriceUSD,
      capitalBase: capitalBase,
      rawOptionPrice: optionPrice,
      assetType: assetType
    };
  }

  // ========== Add APR Header ==========
  function addAPRHeader(table) {
    // Check if header already exists
    if (table.querySelector('.apr-header')) return;

    // Find header row
    const headerRow = table.querySelector('thead tr, tr:first-child, [role="rowheader"], [class*="header"]');
    if (!headerRow) {
      log('[APR] No header row found');
      return;
    }

    // Create APR header cell
    const aprHeader = document.createElement(headerRow.querySelector('th') ? 'th' : 'td');
    aprHeader.className = 'apr-header';
    aprHeader.innerHTML = `
      <div class="apr-header-content">
        <span>APR</span>
        <span class="apr-strategy-badge">(${currentStrategy === 'put' ? 'Put' : 'Call'})</span>
      </div>
    `;

    headerRow.appendChild(aprHeader);
    log('[APR] Added APR header');
  }

  // ========== Add APR Cell ==========
  function addAPRCell(row, aprData, data) {
    // Remove existing if any
    const existing = row.querySelector('.apr-cell');
    if (existing) existing.remove();

    // Create cell
    const aprCell = document.createElement(row.querySelector('td') ? 'td' : 'td');
    aprCell.className = 'apr-cell';

    if (aprData) {
      aprCell.innerHTML = `
        <div class="apr-value" title="Days: ${aprData.daysToExpiry.toFixed(1)} | Price: ${aprData.rawOptionPrice}">
          ${aprData.apr.toFixed(1)}%
        </div>
      `;
      aprCell.dataset.apr = aprData.apr.toFixed(2);
      aprCell.dataset.days = aprData.daysToExpiry.toFixed(1);
    } else {
      aprCell.innerHTML = '<div class="apr-value apr-na">N/A</div>';
    }

    // Find last cell to insert after
    const cells = row.querySelectorAll('td, [role="cell"]');
    if (cells.length > 0) {
      cells[cells.length - 1].after(aprCell);
    } else {
      row.appendChild(aprCell);
    }
  }

  // ========== Update All APR Columns ==========
  function updateAllAPRColumns() {
    // Update header badges
    document.querySelectorAll('.apr-strategy-badge').forEach(el => {
      el.textContent = `(${currentStrategy === 'put' ? 'Put' : 'Call'})`;
    });

    // Re-process all rows
    document.querySelectorAll('[data-apr-processed]').forEach(row => {
      delete row.dataset.aprProcessed;
    });

    processPage();
  }

  // ========== Start ==========
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();