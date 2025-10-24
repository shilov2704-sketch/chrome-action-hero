// Create a panel in DevTools
chrome.devtools.panels.create(
  'QA Recorder',
  'icons/icon16.png',
  'panel.html',
  function(panel) {
    console.log('QA Recorder panel created');
  }
);
