// Content Script for Recording User Actions
let isRecording = false;
let selectedSelectors = [];
let recordedEvents = [];
let isPickingElement = false;
let isReplaying = false;
let inputDebounceTimers = new Map();

// Listen for messages from panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startRecording') {
    startRecording(message.selectors);
    sendResponse({ success: true });
  } else if (message.action === 'stopRecording') {
    stopRecording();
    sendResponse({ success: true });
  } else if (message.action === 'activateElementPicker') {
    activateElementPicker();
    sendResponse({ success: true });
  } else if (message.action === 'replayRecording') {
    replayRecording(message.recording, message.speed, message.settings);
    sendResponse({ success: true });
  } else if (message.action === 'stopReplay') {
    stopReplay();
    sendResponse({ success: true });
  }
});

// Hover detection state
let hoverDebounceTimer = null;
let lastHoveredElement = null;

function startRecording(selectors) {
  isRecording = true;
  selectedSelectors = selectors;
  recordedEvents = [];

  // Record initial viewport
  recordViewport();

  // Record initial navigation
  recordNavigation();

  // Add event listeners
  document.addEventListener('click', handleClick, true);
  document.addEventListener('change', handleChange, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('keydown', handleKeyDown, true);
  document.addEventListener('keyup', handleKeyUp, true);
  // NOTE: hover recording disabled - user requested removal of hover actions

  console.log('Recording started');
}

function stopRecording() {
  // Flush any pending debounced input before stopping
  flushPendingInputEvents();

  isRecording = false;

  // Remove event listeners
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('change', handleChange, true);
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('keydown', handleKeyDown, true);
  document.removeEventListener('keyup', handleKeyUp, true);
  // NOTE: hover recording disabled

  console.log('Recording stopped', recordedEvents);
}

function isElementVisible(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function pickBestInteractiveFromEvent(event) {
  if (!event) return null;

  const leafTags = new Set([
    'svg', 'path', 'span', 'img', 'i', 'use', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'g',
    'p', 'strong', 'em', 'b', 'small'
  ]);

  const containerDataTest = /virtuoso-item-list|List_ListWithScroll|ModalWindowItem_ModalWindowItemRoot/i;

  const scoreDataTest = (dt) => {
    if (!dt) return -1;
    if (containerDataTest.test(dt)) return -10000;

    let score = 0;

    // Highly specific interactive components
    if (/MenuItem(?:_|$)|MenuItemRoot|MenuItem_MenuItemRoot/i.test(dt)) score += 200;
    if (/(?:^|_)ListItem(?:_|$)|ListItemRoot|Material_Root|modal-list-element-\d+/i.test(dt)) score += 160;
    if (/Button|Tab|Option|Select|Dropdown|Popover|Dialog|CheckBox|Radio|Input|TextArea|Textbox/i.test(dt)) score += 120;

    // Generic anonymous nodes like ::abc123::4 are often layout wrappers/containers
    if (/^::[a-z0-9]+::\d+$/i.test(dt)) score += 5;

    // Heuristic: underscore-heavy and longer IDs tend to be more specific
    if (dt.includes('_')) score += 25;
    score += Math.min(dt.length, 80) / 8;

    return score;
  };

  const getPathFromPoint = () => {
    if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return [];
    const res = [];
    let el = document.elementFromPoint(event.clientX, event.clientY);
    while (el && el !== document.body) {
      res.push(el);
      el = el.parentElement;
    }
    return res;
  };

  const candidates = [];
  const seen = new Set();

  const pushEl = (el) => {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    if (seen.has(el)) return;
    seen.add(el);
    candidates.push(el);
  };

  // 1) composedPath (when available)
  if (typeof event.composedPath === 'function') {
    const p = event.composedPath();
    for (const n of p) pushEl(n);
  }

  // 2) elementFromPoint fallback (helps with retargeting / weird overlays)
  for (const n of getPathFromPoint()) pushEl(n);

  let best = null;
  let bestScore = -1;

  for (const el of candidates) {
    const tag = el.tagName?.toLowerCase();
    if (leafTags.has(tag)) continue;

    const dt = el.getAttribute?.('data-test');
    const s = scoreDataTest(dt);
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }

    // Early exit: if we found a MenuItem_* very close to the click, that's almost always correct
    if (bestScore >= 200) {
      return best;
    }
  }

  // If the only thing we found is a generic ::id::n wrapper, prefer to keep searching (return null)
  if (best) {
    const dt = best.getAttribute?.('data-test');
    if (dt && /^::[a-z0-9]+::\d+$/i.test(dt) && bestScore <= 20) {
      return null;
    }
  }

  return best;
}

function findInteractiveElement(element, event = null) {
  const fromEvent = pickBestInteractiveFromEvent(event);
  if (fromEvent) return fromEvent;

  // Elements that are non-interactive leaves - always go up to find parent
  const leafTags = ['svg', 'path', 'span', 'img', 'i', 'use', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'g', 'p', 'strong', 'em', 'b', 'small'];

  const containerDataTest = /virtuoso-item-list|List_ListWithScroll|ModalWindowItem_ModalWindowItemRoot/i;

  const scoreDataTest = (dt) => {
    if (!dt) return -1;
    if (containerDataTest.test(dt)) return -10000;

    let score = 0;
    if (/MenuItem(?:_|$)|MenuItemRoot|MenuItem_MenuItemRoot/i.test(dt)) score += 200;
    if (/(?:^|_)ListItem(?:_|$)|ListItemRoot|Material_Root|modal-list-element-\d+/i.test(dt)) score += 160;
    if (/Button|Tab|Option|Select|Dropdown|Popover|Dialog|CheckBox|Radio|Input|TextArea|Textbox/i.test(dt)) score += 120;
    if (/^::[a-z0-9]+::\d+$/i.test(dt)) score += 5;
    if (dt.includes('_')) score += 25;
    score += Math.min(dt.length, 80) / 8;
    return score;
  };

  let current = element;

  // Step 1: If we're on a leaf element, go up until we find a non-leaf
  while (current && current !== document.body) {
    const tagName = current.tagName?.toLowerCase();

    if (leafTags.includes(tagName)) {
      current = current.parentElement;
      continue;
    }

    break;
  }

  // Step 2: Walk up and pick the best data-test scored element (prevents picking ::id::n containers over MenuItem_*)
  let best = null;
  let bestScore = -1;
  let candidate = current;
  let hops = 0;

  while (candidate && candidate !== document.body && hops < 20) {
    const dt = candidate.getAttribute?.('data-test');
    const s = scoreDataTest(dt);

    if (s > bestScore) {
      bestScore = s;
      best = candidate;
    }

    // Early exit for MenuItem_*
    if (bestScore >= 200) {
      return best;
    }

    candidate = candidate.parentElement;
    hops++;
  }

  if (best && bestScore > 0) {
    return best;
  }

  // Fallback
  return current || element;
}

function flushPendingInputEvents() {
  if (!isRecording) return;

  for (const [target, timer] of Array.from(inputDebounceTimers.entries())) {
    try {
      clearTimeout(timer);
      inputDebounceTimers.delete(target);

      if (!target || !target.isConnected) continue;

      const selectors = generateSelectors(target, 'change');
      const value = target.value !== undefined ? target.value : target.textContent;

      recordEvent({
        type: 'change',
        value: value,
        selectors: selectors,
        target: 'main',
        url: window.location.href
      });
    } catch (e) {
      // ignore
    }
  }
}

function handleClick(event) {
  if (!isRecording || isPickingElement) return;

  // Ensure pending input debounces are recorded BEFORE the click (fixes textarea "not saved" cases)
  flushPendingInputEvents();

  // Find the actual interactive element instead of using event.target directly
  const target = findInteractiveElement(event.target, event);
  const selectors = generateSelectors(target, 'click');
  const rect = target.getBoundingClientRect();

  const clickEvent = {
    type: 'click',
    target: 'main',
    selectors: selectors,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    url: window.location.href
  };

  recordEvent(clickEvent);
}

function handleChange(event) {
  if (!isRecording) return;

  // For change events, use the target directly as it's already the input element
  const target = event.target;
  const selectors = generateSelectors(target, 'change');

  const changeEvent = {
    type: 'change',
    value: target.value || target.textContent,
    selectors: selectors,
    target: 'main',
    url: window.location.href
  };

  recordEvent(changeEvent);
}

function handleInput(event) {
  if (!isRecording) return;

  // For input events, use the target directly as it's already the input element
  const target = event.target;
  
  // Clear existing timer for this element
  const existingTimer = inputDebounceTimers.get(target);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  
  // Set new debounce timer (500ms)
  const timer = setTimeout(() => {
    const selectors = generateSelectors(target, 'change');
    
    // Handle contenteditable and other elements
    const value = target.value !== undefined ? target.value : target.textContent;
    
    const inputEvent = {
      type: 'change',
      value: value,
      selectors: selectors,
      target: 'main',
      url: window.location.href
    };

    recordEvent(inputEvent);
    inputDebounceTimers.delete(target);
  }, 500);
  
  inputDebounceTimers.set(target, timer);
}

function handleKeyDown(event) {
  if (!isRecording) return;

  const keyEvent = {
    type: 'keyDown',
    key: event.key,
    target: 'main',
    url: window.location.href
  };

  recordEvent(keyEvent);
}

function handleKeyUp(event) {
  if (!isRecording) return;

  const keyEvent = {
    type: 'keyUp',
    key: event.key,
    target: 'main',
    url: window.location.href
  };

  recordEvent(keyEvent);
}

// Patterns for hover-triggered elements (dropdowns, menus, tooltips)
const hoverTriggerPatterns = /dropdown|menu|tooltip|popover|hover|trigger|nav-item|submenu/i;

function handleHover(event) {
  if (!isRecording || isPickingElement) return;
  
  const target = event.target;
  
  // Clear existing debounce timer
  if (hoverDebounceTimer) {
    clearTimeout(hoverDebounceTimer);
  }
  
  // Debounce hover events (300ms)
  hoverDebounceTimer = setTimeout(() => {
    // Find interactive element
    const interactiveElement = findInteractiveElement(target);
    
    // Skip if same element as last hover
    if (interactiveElement === lastHoveredElement) {
      return;
    }
    
    // Check if this element or its parent could trigger hover behavior
    const dataTest = interactiveElement.getAttribute('data-test') || '';
    const className = interactiveElement.className || '';
    const role = interactiveElement.getAttribute('role') || '';
    const ariaHasPopup = interactiveElement.getAttribute('aria-haspopup');
    const ariaExpanded = interactiveElement.getAttribute('aria-expanded');
    
    // Check for hover-triggered elements
    const isHoverTrigger = 
      hoverTriggerPatterns.test(dataTest) ||
      hoverTriggerPatterns.test(className) ||
      ariaHasPopup === 'true' ||
      ariaExpanded !== null ||
      role === 'menuitem' ||
      role === 'button' && ariaHasPopup;
    
    if (isHoverTrigger) {
      lastHoveredElement = interactiveElement;
      
      const selectors = generateSelectors(interactiveElement, 'hover');
      const rect = interactiveElement.getBoundingClientRect();
      
      const hoverEvent = {
        type: 'hover',
        target: 'main',
        selectors: selectors,
        offsetX: rect.width / 2,
        offsetY: rect.height / 2,
        url: window.location.href
      };
      
      recordEvent(hoverEvent);
    }
  }, 300);
}

function recordViewport() {
  const viewportEvent = {
    type: 'setViewport',
    width: window.innerWidth,
    height: window.innerHeight,
    deviceScaleFactor: window.devicePixelRatio,
    isMobile: /Mobile|Android|iPhone/i.test(navigator.userAgent),
    hasTouch: 'ontouchstart' in window,
    isLandscape: window.innerWidth > window.innerHeight
  };

  recordEvent(viewportEvent);
}

function recordNavigation() {
  const navEvent = {
    type: 'navigate',
    url: window.location.href,
    assertedEvents: [
      {
        type: 'navigation',
        url: window.location.href,
        title: document.title
      }
    ]
  };

  recordEvent(navEvent);
}

function generateSelectors(element, eventType = null) {
  const selectors = [];

  // PRIORITY: data-test based XPath is always first and primary
  if (element.hasAttribute('data-test')) {
    const dataTest = element.getAttribute('data-test');
    selectors.push([`xpath//*[@data-test='${dataTest}']`]);
  }

  // Fallback selectors (only if xpath not available or user explicitly wants them)
  selectedSelectors.forEach((selectorType) => {
    try {
      switch (selectorType) {
        case 'css': {
          const cssSelector = generateCSSSelector(element);
          if (cssSelector) selectors.push([cssSelector]);
          break;
        }

        case 'xpath': {
          // Already added data-test xpath above as priority
          break;
        }

        case 'aria': {
          const ariaSelector = generateARIASelector(element);
          if (ariaSelector) selectors.push([ariaSelector]);
          break;
        }

        case 'text': {
          const textSelector = generateTextSelector(element);
          if (textSelector) selectors.push([textSelector]);
          break;
        }

        case 'pierce': {
          const pierceSelector = generatePierceSelector(element);
          if (pierceSelector) selectors.push([pierceSelector]);
          break;
        }
      }
    } catch (error) {
      console.warn('Error generating selector of type', selectorType, error);
    }
  });

  return selectors;
}

function generateCSSSelector(element) {
  if (element.id) {
    return `#${element.id}`;
  }

  if (element.hasAttribute('data-test')) {
    return `[data-test='${element.getAttribute('data-test')}']`;
  }

  const path = [];
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.tagName.toLowerCase();
    
    if (current.className) {
      const classes = current.className.split(' ').filter(c => c);
      if (classes.length > 0) {
        selector += '.' + classes.join('.');
      }
    }

    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(e => e.tagName === current.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    path.unshift(selector);
    current = parent;

    if (path.length > 5) break;
  }

  return path.join(' > ');
}

function generateXPathSelector(element, eventType = null) {
  // Simple data-test based XPath generation
  if (element.hasAttribute('data-test')) {
    const dataTest = element.getAttribute('data-test');
    return `xpath//*[@data-test='${dataTest}']`;
  }
  
  // Fallback if data-test is not present
  return null;
}

function generateARIASelector(element) {
  // Only generate ARIA selectors when they are likely to be specific.
  // IMPORTANT: role-only selectors like [role="button"] are too generic and can click the wrong element.
  const label = element.getAttribute('aria-label');
  const labelledBy = element.getAttribute('aria-labelledby');
  const valueText = element.getAttribute('aria-valuetext');
  const value = element.value;

  if (label) {
    return `aria/${label}`;
  }

  if (labelledBy) {
    return `aria/${labelledBy}`;
  }

  if (valueText) {
    return `aria/${valueText}`;
  }

  if (value) {
    return `aria/${value}`;
  }

  return null;
}

function generateTextSelector(element) {
  const tagName = element.tagName?.toLowerCase();
  
  // For input elements, check placeholder and associated label
  if (tagName === 'input' || tagName === 'textarea') {
    // Check placeholder first
    const placeholder = element.getAttribute('placeholder');
    if (placeholder && placeholder.trim().length > 0 && placeholder.trim().length < 50) {
      return `text/${placeholder.trim()}`;
    }
    
    // Check for associated label by 'for' attribute
    if (element.id) {
      const labelByFor = document.querySelector(`label[for='${element.id}']`);
      if (labelByFor) {
        const labelText = labelByFor.textContent?.trim();
        if (labelText && labelText.length < 50) {
          return `text/${labelText}`;
        }
      }
    }
    
    // Check for parent label element
    const parentLabel = element.closest('label');
    if (parentLabel) {
      // Get text from label, excluding the input's own text
      const labelText = Array.from(parentLabel.childNodes)
        .filter(node => node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE && node !== element))
        .map(node => node.textContent?.trim())
        .filter(t => t)
        .join(' ')
        .trim();
      if (labelText && labelText.length < 50) {
        return `text/${labelText}`;
      }
    }
    
    // Check for preceding sibling label or span with text
    let sibling = element.previousElementSibling;
    while (sibling) {
      const sibTagName = sibling.tagName?.toLowerCase();
      if (sibTagName === 'label' || sibTagName === 'span') {
        const sibText = sibling.textContent?.trim();
        if (sibText && sibText.length < 50) {
          return `text/${sibText}`;
        }
      }
      sibling = sibling.previousElementSibling;
    }
    
    // Check parent's children for label before input
    const parent = element.parentElement;
    if (parent) {
      const labelChild = parent.querySelector('label, span');
      if (labelChild && labelChild !== element) {
        const labelChildText = labelChild.textContent?.trim();
        if (labelChildText && labelChildText.length < 50) {
          return `text/${labelChildText}`;
        }
      }
    }
    
    return null;
  }
  
  // For list items and other container elements, find text within child spans/divs
  const dataTest = element.getAttribute('data-test');
  if (dataTest && /ListItem|_Item_|ItemRoot|Material_Root|modal-list-element/i.test(dataTest)) {
    // Look for text in child elements
    const textElements = element.querySelectorAll('span, p, div');
    for (const textEl of textElements) {
      // Skip elements with many children (containers)
      if (textEl.children.length > 0) continue;
      const childText = textEl.textContent?.trim();
      if (childText && childText.length > 0 && childText.length < 50) {
        return `text/${childText}`;
      }
    }
  }
  
  // For other elements, use textContent
  const text = element.textContent?.trim();
  if (text && text.length < 50) {
    return `text/${text}`;
  }
  return null;
}

function generatePierceSelector(element) {
  // Pierce selectors penetrate shadow DOM
  const cssSelector = generateCSSSelector(element);
  return cssSelector ? `pierce/${cssSelector}` : null;
}

function recordEvent(event) {
  const last = recordedEvents[recordedEvents.length - 1];

  // User requested: do NOT record hover actions.
  if (event.type === 'hover') {
    return;
  }

  // Filter out keyDown/keyUp events - we only need change events for text input
  if (event.type === 'keyDown' || event.type === 'keyUp') {
    return;
  }
  
  // Avoid duplicate events
  if (last && JSON.stringify(last) === JSON.stringify(event)) {
    return;
  }

  recordedEvents.push(event);
  
  // Send event to panel
  chrome.runtime.sendMessage({
    action: 'recordedEvent',
    event: event
  });
}

function activateElementPicker() {
  isPickingElement = true;
  
  // Create overlay
  const overlay = document.createElement('div');
  overlay.id = 'element-picker-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 123, 255, 0.1);
    z-index: 999999;
    cursor: crosshair;
  `;

  // Create highlight box
  const highlight = document.createElement('div');
  highlight.id = 'element-picker-highlight';
  highlight.style.cssText = `
    position: fixed;
    border: 2px solid #007bff;
    background: rgba(0, 123, 255, 0.1);
    pointer-events: none;
    z-index: 1000000;
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(highlight);

  let currentElement = null;

  const handleMouseMove = (e) => {
    // Temporarily hide overlay to get element underneath
    overlay.style.display = 'none';
    currentElement = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.display = '';
    
    if (currentElement && currentElement !== overlay && currentElement !== highlight) {
      const rect = currentElement.getBoundingClientRect();
      highlight.style.left = rect.left + 'px';
      highlight.style.top = rect.top + 'px';
      highlight.style.width = rect.width + 'px';
      highlight.style.height = rect.height + 'px';
    }
  };

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (currentElement) {
      // Use findInteractiveElement for element picker as well
      const interactiveElement = findInteractiveElement(currentElement);
      const selectors = generateSelectors(interactiveElement);
      console.log('Selected element selectors:', selectors);
      
      // Derive value, text and a human-readable name (label text if available)
      let value = null;
      let text = null;
      let name = null;

      const tagName = interactiveElement.tagName.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea') {
        value = interactiveElement.value;
        // Try label[for]
        if (interactiveElement.id) {
          const byFor = document.querySelector(`label[for='${interactiveElement.id}']`);
          const labelText = byFor?.innerText?.trim();
          if (labelText) name = labelText;
        }
        // Try preceding label siblings
        if (!name) {
          let sib = interactiveElement.previousElementSibling;
          while (sib) {
            if (sib.tagName.toLowerCase() === 'label') {
              const t = sib.innerText?.trim();
              if (t) { name = t; break; }
            }
            sib = sib.previousElementSibling;
          }
        }
      } else {
        text = interactiveElement.textContent?.trim();
      }

      if (!name) {
        name = interactiveElement.getAttribute('aria-label') || interactiveElement.getAttribute('title') || null;
      }
      
      // Send to panel with value, text and name
      chrome.runtime.sendMessage({
        action: 'elementPicked',
        selectors,
        value,
        text,
        name
      });
    }

    // Clean up
    overlay.removeEventListener('mousemove', handleMouseMove);
    overlay.removeEventListener('click', handleClick);
    document.body.removeChild(overlay);
    document.body.removeChild(highlight);
    isPickingElement = false;
  };

  overlay.addEventListener('mousemove', handleMouseMove);
  overlay.addEventListener('click', handleClick);
}

function stopReplay() {
  isReplaying = false;
  console.log('Replay stopped');
  
  // Clear any pending replay from sessionStorage
  sessionStorage.removeItem('qa_recorder_pending_replay');
  
  // Notify panel that replay was stopped
  chrome.runtime.sendMessage({
    action: 'replayStopped'
  });
}

async function replayRecording(recording, speed, settings, startIndex = 0) {
  console.log('Replaying recording:', recording.title);
  
  isReplaying = true;
  
  // Use configurable stepDelay from settings, fallback to speed-based delay
  const baseDelay = speed === 'slow' ? 1000 : 100;
  const delay = settings.stepDelay !== undefined ? settings.stepDelay : baseDelay;

  for (let i = 0; i < recording.steps.length; i++) {
    const actualIndex = startIndex + i;
    // Check if replay was stopped
    if (!isReplaying) {
      console.log('Replay interrupted at step', i);
      return;
    }
    
    const step = recording.steps[i];
    
    // Notify panel that this step is executing
    chrome.runtime.sendMessage({
      action: 'replayStepStatus',
      stepIndex: actualIndex,
      status: 'executing'
    });
    
    // Apply step delay
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      if (step.type === 'navigate') {
        // Persist remaining steps to sessionStorage to resume after navigation
        const remaining = recording.steps.slice(i + 1);
        sessionStorage.setItem('qa_recorder_pending_replay', JSON.stringify({
          steps: remaining,
          speed,
          settings,
          startIndex: actualIndex + 1
        }));
        
        // Mark navigate step as success before leaving
        chrome.runtime.sendMessage({
          action: 'replayStepStatus',
          stepIndex: actualIndex,
          status: 'success'
        });
        
        window.location.href = step.url;
        return; // Will resume after page load
      } else {
        await executeStep(step, settings);
      }
      
      // Notify panel that this step succeeded
      chrome.runtime.sendMessage({
        action: 'replayStepStatus',
        stepIndex: actualIndex,
        status: 'success'
      });
      
      // Small delay to ensure message is sent
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (error) {
      console.error('Error executing step:', step, error);
      
      // Notify panel that this step failed
      chrome.runtime.sendMessage({
        action: 'replayStepStatus',
        stepIndex: actualIndex,
        status: 'error',
        error: error.message
      });
    }
  }

  isReplaying = false;
  console.log('Replay completed');
  
  // Notify panel that replay completed
  chrome.runtime.sendMessage({
    action: 'replayCompleted'
  });
}

async function executeStep(step, settings) {
  switch (step.type) {
    case 'navigate':
      window.location.href = step.url;
      await waitForNavigation();
      break;

    case 'click': {
      // Patterns for detecting if target is a MenuItem (likely inside a dropdown)
      const menuItemPatterns = /MenuItem(?:_|$)|MenuItemRoot|MenuItem_MenuItemRoot/i;
      const dropdownTriggerPatterns = /trigger|select|dropdown|combobox|popover/i;

      // Extract recorded data-test from selectors
      const recordedDataTest = (() => {
        if (!Array.isArray(step.selectors)) return null;
        for (const arr of step.selectors) {
          const s = arr?.[0];
          if (typeof s !== 'string') continue;
          const m = s.match(/^xpath\/\/\*\[@data-test='([^']+)'\]$/);
          if (m) return m[1];
        }
        return null;
      })();

      // --- Auto-open dropdown if target is a MenuItem but not yet in DOM ---
      const isMenuItem = recordedDataTest && menuItemPatterns.test(recordedDataTest);
      let clickElement = findElement(step.selectors);

      if (!clickElement && isMenuItem) {
        // Try to find and click a dropdown trigger to open the menu
        const triggers = Array.from(document.querySelectorAll(
          '[aria-haspopup="true"], [aria-haspopup="listbox"], [aria-haspopup="menu"], ' +
          '[role="combobox"], [role="listbox"], [data-test*="Trigger"], [data-test*="Select"], ' +
          '[data-test*="Dropdown"], button[aria-expanded]'
        ));

        for (const trigger of triggers) {
          const expanded = trigger.getAttribute('aria-expanded');
          // If already expanded, skip
          if (expanded === 'true') continue;

          // Click trigger to open dropdown
          try {
            trigger.scrollIntoView?.({ behavior: 'auto', block: 'center' });
            await new Promise(r => setTimeout(r, 50));
            trigger.click();
            await new Promise(r => setTimeout(r, 200));

            // Check if our target appeared
            clickElement = findElement(step.selectors);
            if (clickElement) break;
          } catch (e) {
            console.warn('Failed to click dropdown trigger:', e);
          }
        }
      }

      // Standard wait for element (in case auto-open worked or element was loading)
      if (!clickElement) {
        clickElement = await waitForElement(step.selectors, settings.timeout || 5000);
      }

      if (clickElement) {
        const listItemPatterns = /ListItem|_Item_|ItemRoot|Material_Root|modal-list-element/i;
        const checkboxRadioPatterns = /CheckBox|Radio|Circle_Svg|CheckBoxRoot|CheckBoxField/i;

        let baseElement = clickElement;

        // For checkbox/radio clicks - find the parent ListItem to click
        if (recordedDataTest && checkboxRadioPatterns.test(recordedDataTest)) {
          let candidate = clickElement;
          while (candidate && candidate !== document.body) {
            const dt = candidate.getAttribute?.('data-test');
            if (dt && listItemPatterns.test(dt)) {
              baseElement = candidate;
              break;
            }
            candidate = candidate.parentElement;
          }
        } else if (recordedDataTest && listItemPatterns.test(recordedDataTest)) {
          let candidate = clickElement;
          while (candidate && candidate !== document.body) {
            const dt = candidate.getAttribute?.('data-test');
            if (dt && listItemPatterns.test(dt)) {
              baseElement = candidate;
              break;
            }
            candidate = candidate.parentElement;
          }
        }

        // Scroll into view
        baseElement.scrollIntoView?.({ behavior: 'auto', block: 'center' });
        await new Promise(r => setTimeout(r, 80));

        const rect = baseElement.getBoundingClientRect();
        const hasOffsets = typeof step.offsetX === 'number' && typeof step.offsetY === 'number';
        const isCheckboxRadio = recordedDataTest && checkboxRadioPatterns.test(recordedDataTest);

        const ox = isCheckboxRadio
          ? rect.width / 2
          : (hasOffsets ? Math.min(Math.max(step.offsetX, 1), Math.max(1, rect.width - 1)) : rect.width / 2);
        const oy = isCheckboxRadio
          ? rect.height / 2
          : (hasOffsets ? Math.min(Math.max(step.offsetY, 1), Math.max(1, rect.height - 1)) : rect.height / 2);

        const xRaw = rect.left + ox;
        const yRaw = rect.top + oy;
        const x = Math.min(Math.max(xRaw, 1), window.innerWidth - 2);
        const y = Math.min(Math.max(yRaw, 1), window.innerHeight - 2);

        let dispatchTarget = document.elementFromPoint(x, y);
        if (!dispatchTarget || !baseElement.contains(dispatchTarget) || dispatchTarget === document.documentElement || dispatchTarget === document.body) {
          dispatchTarget = baseElement;
        }

        // Focus element (silently)
        try {
          if (typeof dispatchTarget.focus === 'function') {
            dispatchTarget.focus({ preventScroll: true });
          } else if (typeof baseElement.focus === 'function') {
            baseElement.focus({ preventScroll: true });
          }
        } catch (e) { /* ignore */ }

        // --- Realistic click sequence (avoids crashes from long synthetic sequences) ---
        // Using a minimal but more realistic approach: pointerdown -> mousedown -> pointerup -> mouseup -> click
        const eventInit = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
          screenX: x,
          screenY: y,
          button: 0,
          buttons: 1,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          detail: 1
        };

        try {
          // pointerdown + mousedown
          dispatchTarget.dispatchEvent(new PointerEvent('pointerdown', eventInit));
          dispatchTarget.dispatchEvent(new MouseEvent('mousedown', eventInit));
          await new Promise(r => setTimeout(r, 30));

          // pointerup + mouseup
          const upInit = { ...eventInit, buttons: 0 };
          dispatchTarget.dispatchEvent(new PointerEvent('pointerup', upInit));
          dispatchTarget.dispatchEvent(new MouseEvent('mouseup', upInit));
          await new Promise(r => setTimeout(r, 10));

          // click
          dispatchTarget.dispatchEvent(new MouseEvent('click', upInit));
        } catch (e) {
          // Fallback: native click
          console.warn('Synthetic click failed, using native click:', e);
          try { dispatchTarget.click(); } catch (e2) { baseElement.click(); }
        }

        await new Promise(r => setTimeout(r, 120));
      }
      break;
    }

    case 'change': {
      const changeElementRaw = await waitForElement(step.selectors, settings.timeout || 5000);
      if (changeElementRaw) {
        // Some apps put data-test on a wrapper; try to find the real editable element.
        let editable = changeElementRaw;
        const rawTag = editable.tagName?.toLowerCase();

        if (rawTag !== 'input' && rawTag !== 'textarea' && !editable.isContentEditable && editable.getAttribute?.('contenteditable') !== 'true') {
          const descendant = editable.querySelector?.('textarea, input, [contenteditable="true"], [role="textbox"]');
          if (descendant) editable = descendant;
        }

        // Ensure visible & focused
        editable.scrollIntoView?.({ behavior: 'auto', block: 'center' });
        await new Promise((resolve) => setTimeout(resolve, 60));

        // Some editors require a real click to place caret
        if (typeof editable.click === 'function') {
          try { editable.click(); } catch (e) {}
          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        if (typeof editable.focus === 'function') {
          try { editable.focus({ preventScroll: true }); } catch (e) { try { editable.focus(); } catch (e2) {} }
          await new Promise((resolve) => setTimeout(resolve, 30));
        }

        const tagName = editable.tagName?.toLowerCase();
        const role = editable.getAttribute?.('role');
        const isInputLike = tagName === 'input' || tagName === 'textarea';
        const isContentEditable = editable.isContentEditable || editable.getAttribute?.('contenteditable') === 'true';
        const isRoleTextbox = role === 'textbox';

        const normalize = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

        if (isInputLike) {
          const proto = tagName === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

          const prevValue = editable.value;

          // beforeinput -> input (React listens here) -> change
          try {
            editable.dispatchEvent(
              new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertReplacementText',
                data: step.value
              })
            );
          } catch (e) {
            // ignore
          }

          if (nativeSetter) nativeSetter.call(editable, step.value);
          else editable.value = step.value;

          // React internal value tracker (prevents false-green where DOM value changes but React state doesn't)
          try {
            const tracker = editable._valueTracker;
            if (tracker) tracker.setValue(prevValue);
          } catch (e) {
            // ignore
          }

          // Fire both InputEvent and plain Event for broad compatibility
          try {
            editable.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: step.value,
                composed: true
              })
            );
          } catch (e) {
            editable.dispatchEvent(new Event('input', { bubbles: true }));
          }

          editable.dispatchEvent(new Event('input', { bubbles: true }));
          editable.dispatchEvent(new Event('change', { bubbles: true }));

          await new Promise((resolve) => setTimeout(resolve, 30));
          editable.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
          editable.dispatchEvent(new FocusEvent('blur', { bubbles: false }));

          // Validate that the value actually set (prevents false-green)
          if (normalize(editable.value) !== normalize(step.value)) {
            throw new Error(`Failed to set input value. Expected: "${step.value}", Actual: "${editable.value}"`);
          }
        } else if (isContentEditable || isRoleTextbox) {
          // Contenteditable / role=textbox editors often require real selection + insertText.
          const selectAll = () => {
            try {
              const sel = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(editable);
              sel.removeAllRanges();
              sel.addRange(range);
            } catch (e) {
              // ignore
            }
          };

          try {
            editable.dispatchEvent(
              new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertReplacementText',
                data: step.value
              })
            );
          } catch (e) {
            // ignore
          }

          selectAll();
          let inserted = false;
          try {
            inserted = document.execCommand && document.execCommand('insertText', false, step.value);
          } catch (e) {
            inserted = false;
          }
          if (!inserted) {
            editable.textContent = step.value;
          }

          try {
            editable.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: step.value,
                composed: true
              })
            );
          } catch (e) {
            editable.dispatchEvent(new Event('input', { bubbles: true }));
          }

          editable.dispatchEvent(new Event('input', { bubbles: true }));
          editable.dispatchEvent(new Event('change', { bubbles: true }));

          // Validate (normalized) to avoid false-green
          const actualText = normalize(editable.textContent);
          if (actualText !== normalize(step.value)) {
            throw new Error(`Failed to set textbox text. Expected: "${step.value}", Actual: "${editable.textContent?.trim()}"`);
          }
        } else {
          // Fallback (rare): just set textContent
          editable.textContent = step.value;
          editable.dispatchEvent(new Event('input', { bubbles: true }));
          editable.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      break;
    }

    case 'keyDown':
      document.dispatchEvent(new KeyboardEvent('keydown', { key: step.key }));
      break;

    case 'keyUp':
      document.dispatchEvent(new KeyboardEvent('keyup', { key: step.key }));
      break;

    case 'hover': {
      // Hover steps are intentionally ignored (recording hover is disabled).
      break;
    }

    case 'waitForElement':
      const element = await waitForElement(step.selectors, settings.timeout || 5000);
      // If value assertion is present, verify it
      if (element && step.value !== undefined) {
        const actualValue = element.value || element.textContent;
        if (actualValue !== step.value) {
          throw new Error(`Value assertion failed. Expected: "${step.value}", Actual: "${actualValue}"`);
        }
      }
      // If text assertion is present, verify it
      if (element && step.text !== undefined) {
        const actualText = element.textContent?.trim();
        if (actualText !== step.text) {
          throw new Error(`Text assertion failed. Expected: "${step.text}", Actual: "${actualText}"`);
        }
      }
      break;
  }
}

function findElement(selectors) {
  if (!Array.isArray(selectors)) return null;

  // Priority 1: XPath (most reliable for data-test attributes)
  for (const selectorArray of selectors) {
    if (!Array.isArray(selectorArray) || selectorArray.length === 0) continue;
    const selector = selectorArray[0];
    if (typeof selector !== 'string') continue;

    if (selector.startsWith('xpath//')) {
      const xpath = selector.replace('xpath//', '//');
      try {
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (result.singleNodeValue) {
          console.log('Found element using XPath:', xpath);
          return result.singleNodeValue;
        }
      } catch (e) {
        console.warn('Invalid XPath:', xpath, e);
      }
    }
  }

  // Priority 2: CSS selectors (fast + specific in modern apps)
  for (const selectorArray of selectors) {
    if (!Array.isArray(selectorArray) || selectorArray.length === 0) continue;
    const selector = selectorArray[0];
    if (typeof selector !== 'string') continue;

    if (selector.startsWith('xpath//') || selector.startsWith('text/') || selector.startsWith('pierce/') || selector.startsWith('aria/')) {
      continue;
    }

    try {
      const element = document.querySelector(selector);
      if (element) {
        console.log('Found element using CSS:', selector);
        return element;
      }
    } catch (e) {
      console.warn('Invalid CSS selector:', selector, e);
    }
  }

  // Priority 3: ARIA selectors (label-based only; role-only removed)
  for (const selectorArray of selectors) {
    if (!Array.isArray(selectorArray) || selectorArray.length === 0) continue;
    const selector = selectorArray[0];
    if (typeof selector !== 'string' || !selector.startsWith('aria/')) continue;

    const ariaLabel = selector.replace('aria/', '');
    try {
      if (ariaLabel.trim().startsWith('[')) {
        const el = document.querySelector(ariaLabel.trim());
        if (el) {
          console.log('Found element using ARIA query:', ariaLabel);
          return el;
        }
      }

      const element =
        document.querySelector(`[aria-label="${ariaLabel}"]`) ||
        document.querySelector(`[aria-labelledby*="${ariaLabel}"]`);
      if (element) {
        console.log('Found element using ARIA:', ariaLabel);
        return element;
      }
    } catch (e) {
      console.warn('Invalid ARIA selector:', selector, e);
    }
  }

  // Priority 4: Pierce selectors (shadow DOM)
  for (const selectorArray of selectors) {
    if (!Array.isArray(selectorArray) || selectorArray.length === 0) continue;
    const selector = selectorArray[0];
    if (typeof selector !== 'string' || !selector.startsWith('pierce/')) continue;

    const cssSelector = selector.replace('pierce/', '');
    try {
      const element = document.querySelector(cssSelector);
      if (element) {
        console.log('Found element using Pierce:', cssSelector);
        return element;
      }
    } catch (e) {
      console.warn('Invalid pierce selector:', cssSelector, e);
    }
  }

  // Priority 5: Text selectors (last resort)
  for (const selectorArray of selectors) {
    if (!Array.isArray(selectorArray) || selectorArray.length === 0) continue;
    const selector = selectorArray[0];
    if (typeof selector !== 'string' || !selector.startsWith('text/')) continue;

    const text = selector.replace('text/', '');
    console.warn('Using text selector as fallback:', text);

    const clickableSelectors = 'button, a, input, [role="button"], [onclick]';
    const elements = Array.from(document.querySelectorAll(clickableSelectors));
    const element = elements.find(el => el.textContent?.trim() === text);

    if (element) {
      console.log('Found element using text (fallback):', text);
      return element;
    }
  }

  return null;
}

async function waitForElement(selectors, timeout) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const element = findElement(selectors);
    if (element) return element;
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  throw new Error('Element not found within timeout');
}

async function waitForNavigation() {
  return new Promise(resolve => {
    if (document.readyState === 'complete') {
      resolve();
    } else {
      window.addEventListener('load', resolve, { once: true });
    }
  });
}

// Auto-resume replay after navigation if pending
(function resumePendingReplay() {
  try {
    const pending = sessionStorage.getItem('qa_recorder_pending_replay');
    if (pending) {
      const { steps, speed, settings, startIndex } = JSON.parse(pending);
      sessionStorage.removeItem('qa_recorder_pending_replay');
      replayRecording({ title: 'Resumed', steps }, speed, settings, startIndex || 0);
    }
  } catch (e) {
    console.warn('Failed to resume pending replay', e);
  }
})();
