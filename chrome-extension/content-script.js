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

function findInteractiveElement(element) {
  // Elements that are non-interactive leaves - always go up to find parent
  const leafTags = ['svg', 'path', 'span', 'img', 'i', 'use', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'g', 'p', 'strong', 'em', 'b', 'small'];
  
  // Priority interactive tags - if we're inside one of these, use it
  const priorityInteractiveTags = ['a', 'button'];
  
  let current = element;
  
  // Step 0: Check if we're inside a modal-list-element (highest priority)
  // This handles modal windows with checkboxes/radio buttons
  let checkElement = element;
  while (checkElement && checkElement !== document.body) {
    const dataTest = checkElement.getAttribute('data-test');
    if (dataTest && dataTest.includes('modal-list-element')) {
      return checkElement;
    }
    checkElement = checkElement.parentElement;
  }
  
  // Step 1: Check if the clicked element itself is a checkbox/radio button
  // These should NOT be overridden by parent <a> or <button>
  let isCheckboxOrRadio = false;
  checkElement = element;
  while (checkElement && checkElement !== document.body) {
    const dataTest = checkElement.getAttribute('data-test') || '';
    const role = checkElement.getAttribute('role') || '';
    const inputType = checkElement.tagName?.toLowerCase() === 'input' ? checkElement.type : '';
    
    // Check if this is a checkbox or radio button
    if (dataTest.toLowerCase().includes('checkbox') || 
        dataTest.toLowerCase().includes('radio') ||
        role === 'checkbox' || 
        role === 'radio' ||
        inputType === 'checkbox' || 
        inputType === 'radio') {
      isCheckboxOrRadio = true;
      break;
    }
    
    // Stop checking parents if we hit an <a> or <button>
    const tagName = checkElement.tagName?.toLowerCase();
    if (tagName === 'a' || tagName === 'button') {
      break;
    }
    checkElement = checkElement.parentElement;
  }
  
  // Step 2: Check if we're inside a priority interactive element (like <a> or <button>)
  // But ONLY use it if we're NOT clicking on a checkbox/radio inside it
  let priorityElement = null;
  if (!isCheckboxOrRadio) {
    checkElement = element;
    while (checkElement && checkElement !== document.body) {
      const tagName = checkElement.tagName?.toLowerCase();
      if (priorityInteractiveTags.includes(tagName) && checkElement.getAttribute('data-test')) {
        priorityElement = checkElement;
        break;
      }
      checkElement = checkElement.parentElement;
    }
  }
  
  // If we found a priority interactive element (and not a checkbox/radio), use it
  if (priorityElement) {
    return priorityElement;
  }
  
  // Step 2: If we're on a leaf element, go up until we find a non-leaf with data-test
  while (current && current !== document.body) {
    const tagName = current.tagName?.toLowerCase();
    
    if (leafTags.includes(tagName)) {
      current = current.parentElement;
      continue;
    }
    
    // Found a non-leaf element
    break;
  }
  
  // Step 3: If current element has data-test, use it directly
  if (current && current.getAttribute('data-test')) {
    return current;
  }
  
  // Step 4: If no data-test, look up for the closest element with data-test
  while (current && current !== document.body) {
    if (current.getAttribute('data-test')) {
      return current;
    }
    current = current.parentElement;
  }
  
  // Fallback to original element
  return element;
}

function handleClick(event) {
  if (!isRecording || isPickingElement) return;

  // Find the actual interactive element instead of using event.target directly
  const target = findInteractiveElement(event.target);
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

  selectedSelectors.forEach((selectorType) => {
    try {
      switch (selectorType) {
        case 'css': {
          const cssSelector = generateCSSSelector(element);
          if (cssSelector) selectors.push([cssSelector]);
          break;
        }

        case 'xpath': {
          const xpathSelector = generateXPathSelector(element, eventType);
          if (xpathSelector) selectors.push([xpathSelector]);
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
  const delay = speed === 'slow' ? 1000 : 100;

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

function resolveEditableElement(element) {
  if (!element || element === document.body) return element;

  // Directly editable
  const tag = element.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return element;
  if (element.isContentEditable) return element;
  if (element.getAttribute?.('role') === 'textbox') return element;

  // Common wrappers: search for a real editable descendant
  const editableChild = element.querySelector?.(
    'input, textarea, [contenteditable="true"], [role="textbox"]'
  );
  return editableChild || element;
}

function setElementValue(el, value) {
  if (!el) return;

  const tag = el.tagName?.toLowerCase();
  // React/Angular/etc often rely on the native value setter
  if (tag === 'input') {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    desc?.set?.call(el, value);
    return;
  }
  if (tag === 'textarea') {
    const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    desc?.set?.call(el, value);
    return;
  }

  // Handle contenteditable / Draft.js / rich text editors
  // These need special handling - we'll use Debugger API if available
  if (el.isContentEditable || el.getAttribute?.('role') === 'textbox') {
    // Mark that we need debugger input (will be handled in executeStep)
    el._needsDebuggerInput = true;
    el._debuggerInputValue = value;
    return 'USE_DEBUGGER';
  }

  if (el.value !== undefined) {
    try {
      el.value = value;
    } catch (e) {
      // ignore
    }
    return;
  }
}

function dispatchValueEvents(el) {
  if (!el) return;

  // input first (what frameworks usually listen to)
  try {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
  } catch (e) {
    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  }

  // change after
  el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}

async function executeStep(step, settings) {
  switch (step.type) {
    case 'navigate':
      window.location.href = step.url;
      await waitForNavigation();
      break;

    case 'click': {
      const clickElement = await waitForElement(step.selectors, settings.timeout || 5000);
      if (clickElement) {
        // Scroll element into view
        clickElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise(resolve => setTimeout(resolve, 300));

        // Calculate click coordinates
        const containerRect = clickElement.getBoundingClientRect();
        const hasOffsets = Number.isFinite(step.offsetX) && Number.isFinite(step.offsetY);
        let clickX = hasOffsets ? containerRect.left + step.offsetX : containerRect.left + containerRect.width / 2;
        let clickY = hasOffsets ? containerRect.top + step.offsetY : containerRect.top + containerRect.height / 2;

        // Try to find the actual interactive element at the click point
        let pointEl = null;
        try {
          pointEl = document.elementFromPoint(clickX, clickY);
        } catch (e) {
          // ignore
        }

        // Resolve to the best click target (checkbox/radio/button inside containers)
        const resolveReplayClickTarget = (container, atPoint) => {
          const isWithin = atPoint && container.contains(atPoint);
          const start = isWithin ? atPoint : container;

          const isCheckableInput = (el) => {
            const t = el?.tagName?.toLowerCase();
            return t === 'input' && (el.type === 'checkbox' || el.type === 'radio');
          };

          const isRoleCheckable = (el) => {
            const role = el?.getAttribute?.('role');
            return role === 'checkbox' || role === 'radio';
          };

          // Custom checkboxes/radios are often <div data-test="CheckBox_*"> without role/input.
          const isDataTestCheckable = (el) => {
            const dt = (el?.getAttribute?.('data-test') || '').toLowerCase();
            return dt.includes('checkbox') || dt.includes('radio');
          };

          const isClickable = (el) => {
            const t = el?.tagName?.toLowerCase();
            return (
              isDataTestCheckable(el) ||
              isCheckableInput(el) ||
              isRoleCheckable(el) ||
              t === 'button' ||
              t === 'a' ||
              el?.getAttribute?.('role') === 'button'
            );
          };

          let cur = start;
          while (cur && cur !== document.body) {
            if (isClickable(cur)) return cur;
            if (cur === container) break;
            cur = cur.parentElement;
          }

          // Fallback: search inside container for likely controls
          const descendant = container.querySelector(
            'input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"], button, a, [role="button"]'
          );
          return descendant || container;
        };

        const actualClickTarget = resolveReplayClickTarget(clickElement, pointEl);

        // If we resolved to a different element, recalculate coordinates to its center
        if (actualClickTarget !== clickElement && actualClickTarget !== pointEl) {
          const targetRect = actualClickTarget.getBoundingClientRect();
          clickX = targetRect.left + targetRect.width / 2;
          clickY = targetRect.top + targetRect.height / 2;
        }

        try {
          actualClickTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await new Promise(resolve => setTimeout(resolve, 100));
          // Recalculate after scroll
          const newRect = actualClickTarget.getBoundingClientRect();
          clickX = newRect.left + newRect.width / 2;
          clickY = newRect.top + newRect.height / 2;
        } catch (e) {
          // ignore
        }

        // Use Chrome Debugger API for real isTrusted clicks
        const tabId = settings?.tabId;
        console.log('Dispatching debugger click at', clickX, clickY, 'on', actualClickTarget.tagName, actualClickTarget.getAttribute('data-test') || '', 'tabId:', tabId);
        
        let clickSucceeded = false;
        
        if (tabId) {
          try {
            const response = await new Promise((resolve) => {
              chrome.runtime.sendMessage({
                action: 'debuggerClick',
                tabId: tabId,
                x: clickX,
                y: clickY,
                clickCount: 1
              }, resolve);
            });
            
            if (response && response.success) {
              clickSucceeded = true;
              console.log('Debugger click succeeded');
            } else {
              console.warn('Debugger click failed:', response?.error);
            }
          } catch (e) {
            console.warn('Debugger click error:', e);
          }
        }
        
        // Fallback to synthetic click if debugger click failed or tabId not available
        if (!clickSucceeded) {
          console.log('Using synthetic click fallback');
          
          // Focus first for inputs
          const tagName = actualClickTarget.tagName?.toLowerCase();
          const role = actualClickTarget.getAttribute?.('role');
          const isInput = tagName === 'input' || tagName === 'select' || role === 'checkbox' || role === 'radio';
          
          if (isInput) {
            actualClickTarget.focus?.();
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          
          // Dispatch synthetic events
          const rect = actualClickTarget.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          
          actualClickTarget.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, cancelable: true, view: window,
            clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true
          }));
          
          await new Promise(resolve => setTimeout(resolve, 10));
          
          actualClickTarget.dispatchEvent(new PointerEvent('pointerup', {
            bubbles: true, cancelable: true, view: window,
            clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true
          }));
          
          actualClickTarget.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy
          }));
          
          actualClickTarget.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy
          }));
          
          actualClickTarget.click();
          
          actualClickTarget.dispatchEvent(new MouseEvent('click', {
            bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy
          }));
          
          // For checkboxes/radios, ensure change event fires
          if (tagName === 'input' && (actualClickTarget.type === 'checkbox' || actualClickTarget.type === 'radio')) {
            try {
              actualClickTarget.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
            } catch (e) {
              actualClickTarget.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            }
            actualClickTarget.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          }
        }

        await new Promise(resolve => setTimeout(resolve, 200));
      }
      break;
    }


    case 'change': {
      // Avoid writing into containers/wrappers: resolve to a real editable element.
      const timeout = settings?.timeout || 5000;
      const located = await waitForElement(step.selectors, timeout);
      const target = resolveEditableElement(located);
      const nextValue = step.value == null ? '' : String(step.value);

      try {
        target.focus?.();
      } catch (e) {
        // ignore
      }

      const result = setElementValue(target, nextValue);
      
      // For contenteditable elements, use Debugger API
      if (result === 'USE_DEBUGGER') {
        const tabId = settings?.tabId;
        if (tabId && (target.isContentEditable || target.getAttribute?.('role') === 'textbox')) {
          try {
            // Click on the element first to focus it properly
            const rect = target.getBoundingClientRect();
            const clickX = rect.left + rect.width / 2;
            const clickY = rect.top + rect.height / 2;
            
            await new Promise((resolve) => {
              chrome.runtime.sendMessage({
                action: 'debuggerClick',
                tabId: tabId,
                x: clickX,
                y: clickY,
                clickCount: 1
              }, resolve);
            });
            
            await new Promise(r => setTimeout(r, 100));
            
            // Now insert text via debugger
            const response = await new Promise((resolve) => {
              chrome.runtime.sendMessage({
                action: 'debuggerInsertText',
                tabId: tabId,
                text: nextValue
              }, resolve);
            });
            
            if (response && response.success) {
              console.log('Debugger insertText succeeded for contenteditable');
            } else {
              console.warn('Debugger insertText failed, using fallback:', response?.error);
              // Fallback: try execCommand
              target.focus();
              const selection = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(target);
              selection.removeAllRanges();
              selection.addRange(range);
              document.execCommand('insertText', false, nextValue);
            }
          } catch (e) {
            console.warn('Debugger input error:', e);
            // Fallback
            target.textContent = nextValue;
          }
        } else {
          // No tabId, use fallback
          target.focus?.();
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(target);
          selection.removeAllRanges();
          selection.addRange(range);
          document.execCommand('insertText', false, nextValue);
        }
      }
      
      dispatchValueEvents(target);
      break;
    }

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
  
  // Priority 1: Try XPath selectors first (most reliable)
  for (const selectorArray of selectors) {
    if (!Array.isArray(selectorArray) || selectorArray.length === 0) continue;
    const selector = selectorArray[0];
    
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
  
  // Priority 2: Try ARIA selectors
  for (const selectorArray of selectors) {
    if (!Array.isArray(selectorArray) || selectorArray.length === 0) continue;
    const selector = selectorArray[0];
    
    if (selector.startsWith('aria/')) {
      const ariaLabel = selector.replace('aria/', '');
      try {
        const element = document.querySelector(`[aria-label="${ariaLabel}"]`) || 
                       document.querySelector(`[aria-labelledby*="${ariaLabel}"]`);
        if (element) {
          console.log('Found element using ARIA:', ariaLabel);
          return element;
        }
      } catch (e) {
        console.warn('Invalid ARIA selector:', selector, e);
      }
    }
  }
  
  // Priority 3: Try CSS selectors
  for (const selectorArray of selectors) {
    if (!Array.isArray(selectorArray) || selectorArray.length === 0) continue;
    const selector = selectorArray[0];
    
    if (!selector.startsWith('xpath//') && !selector.startsWith('text/') && 
        !selector.startsWith('pierce/') && !selector.startsWith('aria/')) {
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
  }
  
  // Priority 4: Try Pierce selectors
  for (const selectorArray of selectors) {
    if (!Array.isArray(selectorArray) || selectorArray.length === 0) continue;
    const selector = selectorArray[0];
    
    if (selector.startsWith('pierce/')) {
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
  }
  
  // Priority 5: Text selectors as last resort (least reliable)
  for (const selectorArray of selectors) {
    if (!Array.isArray(selectorArray) || selectorArray.length === 0) continue;
    const selector = selectorArray[0];
    
    if (selector.startsWith('text/')) {
      const text = selector.replace('text/', '');
      console.warn('Using text selector as fallback:', text);
      
      // Find clickable elements only (buttons, links, inputs)
      const clickableSelectors = 'button, a, input, [role="button"], [onclick]';
      const elements = Array.from(document.querySelectorAll(clickableSelectors));
      const element = elements.find(el => el.textContent?.trim() === text);
      
      if (element) {
        console.log('Found element using text (fallback):', text);
        return element;
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
      const { steps, speed, settings, startIndex } = JSON.parse(pending);
      sessionStorage.removeItem('qa_recorder_pending_replay');
      replayRecording({ title: 'Resumed', steps }, speed, settings, startIndex || 0);
    }
  } catch (e) {
    console.warn('Failed to resume pending replay', e);
  }
})();
