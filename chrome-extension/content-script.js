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

  console.log('Recording started');
}

function stopRecording() {
  isRecording = false;

  // Remove event listeners
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('change', handleChange, true);
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('keydown', handleKeyDown, true);
  document.removeEventListener('keyup', handleKeyUp, true);

  console.log('Recording stopped', recordedEvents);
}

function handleClick(event) {
  if (!isRecording || isPickingElement) return;

  const target = event.target;
  const selectors = generateSelectors(target);
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

  const target = event.target;
  const selectors = generateSelectors(target);

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

  const target = event.target;
  
  // Clear existing timer for this element
  const existingTimer = inputDebounceTimers.get(target);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  
  // Set new debounce timer (500ms)
  const timer = setTimeout(() => {
    const selectors = generateSelectors(target);
    
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

function generateSelectors(element) {
  const selectors = [];

  selectedSelectors.forEach(selectorType => {
    switch (selectorType) {
      case 'css':
        const cssSelector = generateCSSSelector(element);
        if (cssSelector) selectors.push([cssSelector]);
        break;

      case 'xpath':
        const xpathSelector = generateXPathSelector(element);
        if (xpathSelector) selectors.push([xpathSelector]);
        break;

      case 'aria':
        const ariaSelector = generateARIASelector(element);
        if (ariaSelector) selectors.push([ariaSelector]);
        break;

      case 'text':
        const textSelector = generateTextSelector(element);
        if (textSelector) selectors.push([textSelector]);
        break;

      case 'pierce':
        const pierceSelector = generatePierceSelector(element);
        if (pierceSelector) selectors.push([pierceSelector]);
        break;
    }
  });

  return selectors;
}

function generateCSSSelector(element) {
  if (element.id) {
    return `#${element.id}`;
  }

  if (element.hasAttribute('data-testid')) {
    return `[data-testid='${element.getAttribute('data-testid')}']`;
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

function generateXPathSelector(element) {
  // Prefer stable attributes first
  if (element.id) {
    return `xpath//*[@id='${element.id}']`;
  }

  // Handle input/textarea associated with a label and data-testid
  if (
    element.hasAttribute('data-testid') &&
    (element.tagName.toLowerCase() === 'input' || element.tagName.toLowerCase() === 'textarea')
  ) {
    const dataTestId = element.getAttribute('data-testid');

    // 1) label[for] association
    if (element.id) {
      const byFor = document.querySelector(`label[for='${element.id}']`);
      const labelText = byFor?.innerText?.trim();
      if (labelText) {
        // Use * instead of span for robustness
        return `xpath//label[*[text()='${labelText}']]/following-sibling::*[@data-testid='${dataTestId}']`;
      }
    }

    // 2) Previous label siblings up the chain
    let sibling = element.previousElementSibling;
    while (sibling) {
      if (sibling.tagName.toLowerCase() === 'label') {
        const labelText = sibling.innerText?.trim();
        if (labelText) {
          return `xpath//label[*[text()='${labelText}']]/following-sibling::*[@data-testid='${dataTestId}']`;
        }
      }
      sibling = sibling.previousElementSibling;
    }
  }

  // Check for li/div structure: li > div with data-testid and nested text element
  if (element.hasAttribute('data-testid')) {
    const dataTestId = element.getAttribute('data-testid');
    const tagName = element.tagName.toLowerCase();

    if (tagName === 'div' && element.parentElement && element.parentElement.tagName.toLowerCase() === 'li') {
      // Try to find any descendant with own text
      const anyWithText = Array.from(element.querySelectorAll('*')).find(n => n.textContent && n.textContent.trim());
      if (anyWithText) {
        const text = anyWithText.textContent.trim();
        return `xpath//li/div[@data-testid='${dataTestId}' and .//*[text()='${text}']]`;
      }
    }
  }

  // Find nearest ancestor (including self) with data-testid
  let node = element;
  let ancestorWithTestId = null;
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    if (node.hasAttribute('data-testid')) {
      ancestorWithTestId = node;
      break;
    }
    node = node.parentElement;
  }

  if (ancestorWithTestId) {
    const dataTestId = ancestorWithTestId.getAttribute('data-testid');
    const tagName = ancestorWithTestId.tagName.toLowerCase();

    // Try to find readable text inside within this ancestor
    let text = '';
    const anyWithText = Array.from(ancestorWithTestId.querySelectorAll('*')).find(n => n.textContent && n.textContent.trim());
    if (anyWithText) {
      text = anyWithText.textContent.trim();
    }

    if (text) {
      // Use * instead of span for robustness
      return `xpath//${tagName}[@data-testid='${dataTestId}' and .//*[text()='${text}']]`;
    }

    // Fallback to just data-testid
    return `xpath//${tagName}[@data-testid='${dataTestId}']`;
  }

  // Standard XPath fallback (short path up to 5 levels)
  const path = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling = current.previousSibling;
    while (sibling) {
      if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === current.tagName) {
        index++;
      }
      sibling = sibling.previousSibling;
    }
    const tagName = current.tagName.toLowerCase();
    const pathIndex = index > 1 ? `[${index}]` : '';
    path.unshift(`${tagName}${pathIndex}`);
    current = current.parentElement;
    if (path.length > 5) break;
  }

  return 'xpath//' + path.join('/');
}

function generateARIASelector(element) {
  const role = element.getAttribute('role');
  const label = element.getAttribute('aria-label');
  const value = element.getAttribute('aria-valuetext') || element.value;

  if (role) {
    return `aria/[role="${role}"]`;
  }

  if (label) {
    return `aria/${label}`;
  }

  if (value) {
    return `aria/${value}`;
  }

  return null;
}

function generateTextSelector(element) {
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
    currentElement = document.elementFromPoint(e.clientX, e.clientY);
    
    if (currentElement && currentElement !== overlay) {
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
      const selectors = generateSelectors(currentElement);
      console.log('Selected element selectors:', selectors);
      
      // Derive value, text and a human-readable name (label text if available)
      let value = null;
      let text = null;
      let name = null;

      const tagName = currentElement.tagName.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea') {
        value = currentElement.value;
        // Try label[for]
        if (currentElement.id) {
          const byFor = document.querySelector(`label[for='${currentElement.id}']`);
          const labelText = byFor?.innerText?.trim();
          if (labelText) name = labelText;
        }
        // Try preceding label siblings
        if (!name) {
          let sib = currentElement.previousElementSibling;
          while (sib) {
            if (sib.tagName.toLowerCase() === 'label') {
              const t = sib.innerText?.trim();
              if (t) { name = t; break; }
            }
            sib = sib.previousElementSibling;
          }
        }
      } else {
        text = currentElement.textContent?.trim();
      }

      if (!name) {
        name = currentElement.getAttribute('aria-label') || currentElement.getAttribute('title') || null;
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

async function replayRecording(recording, speed, settings) {
  console.log('Replaying recording:', recording.title);
  
  isReplaying = true;
  const delay = speed === 'slow' ? 1000 : 100;

  for (let i = 0; i < recording.steps.length; i++) {
    // Check if replay was stopped
    if (!isReplaying) {
      console.log('Replay interrupted at step', i);
      return;
    }
    
    const step = recording.steps[i];
    
    // Notify panel that this step is executing
    chrome.runtime.sendMessage({
      action: 'replayStepStatus',
      stepIndex: i,
      status: 'executing'
    });
    
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      if (step.type === 'navigate') {
        // Persist remaining steps to sessionStorage to resume after navigation
        const remaining = recording.steps.slice(i + 1);
        sessionStorage.setItem('qa_recorder_pending_replay', JSON.stringify({
          steps: remaining,
          speed,
          settings,
          currentIndex: i
        }));
        window.location.href = step.url;
        return; // Will resume after page load
      } else {
        await executeStep(step, settings);
      }
      
      // Notify panel that this step succeeded
      chrome.runtime.sendMessage({
        action: 'replayStepStatus',
        stepIndex: i,
        status: 'success'
      });
    } catch (error) {
      console.error('Error executing step:', step, error);
      
      // Notify panel that this step failed
      chrome.runtime.sendMessage({
        action: 'replayStepStatus',
        stepIndex: i,
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

    case 'click':
      const clickElement = findElement(step.selectors);
      if (clickElement) {
        clickElement.click();
      }
      break;

    case 'change':
      const changeElement = findElement(step.selectors);
      if (changeElement) {
        // Handle different element types
        if (changeElement.value !== undefined) {
          changeElement.value = step.value;
        } else {
          changeElement.textContent = step.value;
        }
        changeElement.dispatchEvent(new Event('change', { bubbles: true }));
        changeElement.dispatchEvent(new Event('input', { bubbles: true }));
      }
      break;

    case 'keyDown':
      document.dispatchEvent(new KeyboardEvent('keydown', { key: step.key }));
      break;

    case 'keyUp':
      document.dispatchEvent(new KeyboardEvent('keyup', { key: step.key }));
      break;

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
  
  for (const selectorArray of selectors) {
    if (!Array.isArray(selectorArray) || selectorArray.length === 0) continue;
    
    const selector = selectorArray[0];
    
    if (selector.startsWith('xpath//')) {
      const xpath = selector.replace('xpath//', '//');
      try {
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (result.singleNodeValue) return result.singleNodeValue;
      } catch (e) {
        console.warn('Invalid XPath:', xpath, e);
      }
    } else if (selector.startsWith('text/')) {
      const text = selector.replace('text/', '');
      const elements = Array.from(document.querySelectorAll('*'));
      const element = elements.find(el => el.textContent?.trim() === text);
      if (element) return element;
    } else if (selector.startsWith('pierce/')) {
      const cssSelector = selector.replace('pierce/', '');
      try {
        const element = document.querySelector(cssSelector);
        if (element) return element;
      } catch (e) {
        console.warn('Invalid pierce selector:', cssSelector);
      }
    } else if (selector.startsWith('aria/')) {
      // Skip ARIA selectors for now as they're complex
      continue;
    } else {
      try {
        const element = document.querySelector(selector);
        if (element) return element;
      } catch (e) {
        console.warn('Invalid selector:', selector);
      }
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
      const { steps, speed, settings } = JSON.parse(pending);
      sessionStorage.removeItem('qa_recorder_pending_replay');
      replayRecording({ title: 'Resumed', steps }, speed, settings);
    }
  } catch (e) {
    console.warn('Failed to resume pending replay', e);
  }
})();
