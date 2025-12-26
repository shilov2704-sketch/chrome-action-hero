// Background Service Worker
console.log('QA Recorder background script loaded');

// Track attached debugger tabs
const attachedTabs = new Set();

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('QA Recorder extension installed');
});

// Clean up debugger on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  if (attachedTabs.has(tabId)) {
    attachedTabs.delete(tabId);
  }
});

// Message handling between components
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);
  
  if (message.action === 'debuggerClick') {
    handleDebuggerClick(message.tabId, message.x, message.y, message.clickCount || 1)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // async response
  }
  
  if (message.action === 'attachDebugger') {
    attachDebugger(message.tabId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  if (message.action === 'detachDebugger') {
    detachDebugger(message.tabId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  if (message.action === 'debuggerInsertText') {
    handleDebuggerInsertText(message.tabId, message.text)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  sendResponse({ received: true });
  return true;
});

async function attachDebugger(tabId) {
  if (attachedTabs.has(tabId)) {
    console.log('Debugger already attached to tab', tabId);
    return;
  }
  
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        console.error('Failed to attach debugger:', chrome.runtime.lastError.message);
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        attachedTabs.add(tabId);
        console.log('Debugger attached to tab', tabId);
        resolve();
      }
    });
  });
}

async function detachDebugger(tabId) {
  if (!attachedTabs.has(tabId)) {
    console.log('Debugger not attached to tab', tabId);
    return;
  }
  
  return new Promise((resolve, reject) => {
    chrome.debugger.detach({ tabId }, () => {
      if (chrome.runtime.lastError) {
        console.warn('Failed to detach debugger:', chrome.runtime.lastError.message);
        // Don't reject, just resolve - debugger might already be detached
      }
      attachedTabs.delete(tabId);
      console.log('Debugger detached from tab', tabId);
      resolve();
    });
  });
}

async function handleDebuggerClick(tabId, x, y, clickCount) {
  // Ensure debugger is attached
  if (!attachedTabs.has(tabId)) {
    await attachDebugger(tabId);
  }
  
  const sendDebuggerCommand = (method, params) => {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
  };
  
  // Dispatch mouse events sequence for a real click
  // mousePressed -> mouseReleased
  await sendDebuggerCommand('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: Math.round(x),
    y: Math.round(y),
    button: 'left',
    clickCount: clickCount
  });
  
  await new Promise(r => setTimeout(r, 50));
  
  await sendDebuggerCommand('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: Math.round(x),
    y: Math.round(y),
    button: 'left',
    clickCount: clickCount
  });
  
  console.log('Debugger click dispatched at', x, y);
}

async function handleDebuggerInsertText(tabId, text) {
  // Ensure debugger is attached
  if (!attachedTabs.has(tabId)) {
    await attachDebugger(tabId);
  }
  
  const sendDebuggerCommand = (method, params) => {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
  };
  
  // First, select all content (Ctrl+A) to replace existing text
  await sendDebuggerCommand('Input.dispatchKeyEvent', {
    type: 'keyDown',
    modifiers: 2, // Ctrl
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65
  });
  
  await sendDebuggerCommand('Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers: 2,
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65
  });
  
  await new Promise(r => setTimeout(r, 50));
  
  // Use Input.insertText to insert the text (this works with contenteditable)
  await sendDebuggerCommand('Input.insertText', {
    text: text
  });
  
  console.log('Debugger insertText completed:', text.substring(0, 50) + '...');
}

// Handle debugger detach events
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId) {
    attachedTabs.delete(source.tabId);
    console.log('Debugger detached from tab', source.tabId, 'reason:', reason);
  }
});
