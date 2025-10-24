// Background Service Worker
console.log('QA Recorder background script loaded');

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('QA Recorder extension installed');
});

// Message handling between components
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);
  
  // Forward messages between panel and content script
  if (message.action === 'recordedEvent') {
    // Event was recorded in content script, forward to panel
    chrome.runtime.sendMessage(message);
  } else if (message.action === 'elementPicked') {
    // Element was picked, forward to panel
    chrome.runtime.sendMessage(message);
  }
  
  sendResponse({ received: true });
  return true;
});
