// Background Service Worker
console.log('QA Recorder background script loaded');

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('QA Recorder extension installed');
});

// Message handling between components
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);
  
  // Do not forward messages to avoid duplication; panel listens directly.
  // Keep here for future background logic if needed.
  
  sendResponse({ received: true });
  return true;
});
