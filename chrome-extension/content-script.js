// Content Script for Recording User Actions
let isRecording = false;
let selectedSelectors = [];
let recordedEvents = [];
let isPickingElement = false;

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
  document.addEventListener('keydown', handleKeyDown, true);
  document.addEventListener('keyup', handleKeyUp, true);

  console.log('Recording started');
}

function stopRecording() {
  isRecording = false;

  // Remove event listeners
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('change', handleChange, true);
  document.removeEventListener('keydown', handleKeyDown, true);
  document.removeEventListener('keyup', handleKeyUp, true);

  console.log('Recording stopped', recordedEvents);
}

function handleClick(event) {
  if (!isRecording) return;

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
    value: target.value,
    selectors: selectors,
    target: 'main',
    url: window.location.href
  };

  recordEvent(changeEvent);
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
  // Special handling for elements with data-testid
  const dataTestId = element.getAttribute('data-testid');
  
  if (dataTestId) {
    // Check if element has text content in nested spans
    const span = element.querySelector('span');
    if (span && span.textContent.trim()) {
      const text = span.textContent.trim();
      const tagName = element.tagName.toLowerCase();
      return `xpath//${tagName}[@data-testid="${dataTestId}" and .//span[text()="${text}"]]`;
    }
    return `xpath//*[@data-testid="${dataTestId}"]`;
  }

  // Generate standard XPath
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
      
      // You can send this to the panel or add it to current step
      chrome.runtime.sendMessage({
        action: 'elementPicked',
        selectors: selectors
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

async function replayRecording(recording, speed, settings) {
  console.log('Replaying recording:', recording.title);
  
  const delay = speed === 'slow' ? 1000 : 100;

  for (const step of recording.steps) {
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await executeStep(step, settings);
    } catch (error) {
      console.error('Error executing step:', step, error);
    }
  }

  console.log('Replay completed');
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
        changeElement.value = step.value;
        changeElement.dispatchEvent(new Event('change', { bubbles: true }));
      }
      break;

    case 'keyDown':
      document.dispatchEvent(new KeyboardEvent('keydown', { key: step.key }));
      break;

    case 'keyUp':
      document.dispatchEvent(new KeyboardEvent('keyup', { key: step.key }));
      break;

    case 'waitForElement':
      await waitForElement(step.selectors, settings.timeout || 5000);
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
