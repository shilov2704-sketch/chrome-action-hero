// State Management
const state = {
  currentView: 'main',
  recordings: [],
  currentRecording: null,
  isRecording: false,
  isContinuingRecording: false,
  isAddingAssertion: false,
  selectedStep: null,
  selectedSelectors: ['css', 'xpath'],
  replaySettings: {
    throttling: 'none',
    timeout: 5000,
    stepDelay: 100
  },
  theme: 'light'
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadRecordings();
  initializeEventListeners();
  initializeTheme();
  updateView();
});

// Load recordings from storage
async function loadRecordings() {
  const result = await chrome.storage.local.get(['recordings']);
  state.recordings = result.recordings || [];
  renderRecordingsList();
}

// Save recordings to storage
async function saveRecordings() {
  await chrome.storage.local.set({ recordings: state.recordings });
}

// Event Listeners
function initializeEventListeners() {
  // Navigation
  document.getElementById('createRecordingBtn').addEventListener('click', () => {
    state.currentView = 'create';
    updateView();
  });

  document.getElementById('backToMainBtn').addEventListener('click', () => {
    state.currentView = 'main';
    updateView();
  });

  document.getElementById('backToMainFromPlaybackBtn').addEventListener('click', () => {
    state.currentView = 'main';
    updateView();
    renderRecordingsList();
  });

  // Theme switcher
  const themeSelect = document.getElementById('themeSelect');
  if (themeSelect) {
    themeSelect.addEventListener('change', async (e) => {
      const theme = e.target.value === 'dark' ? 'dark' : 'light';
      state.theme = theme;
      applyTheme(theme);
      try {
        await chrome.storage.sync.set({ qaRecorderTheme: theme });
      } catch (err) {
        console.warn('Failed to save theme', err);
      }
    });
  }

  // Selector checkboxes
  ['CSS', 'ARIA', 'Text', 'XPath', 'Pierce'].forEach(type => {
    const checkbox = document.getElementById(`selector${type}`);
    checkbox.addEventListener('change', (e) => {
      const value = e.target.value;
      if (e.target.checked) {
        if (!state.selectedSelectors.includes(value)) {
          state.selectedSelectors.push(value);
        }
      } else {
        state.selectedSelectors = state.selectedSelectors.filter(s => s !== value);
      }
    });
  });

  // Start recording
  document.getElementById('startRecordingBtn').addEventListener('click', startRecording);

  // Stop recording
  document.getElementById('stopRecordingBtn').addEventListener('click', stopRecording);

  // Element picker (may be absent)
  const elementPickerEl = document.getElementById('elementPickerBtn');
  if (elementPickerEl) {
    elementPickerEl.addEventListener('click', activateElementPicker);
  }

  // Add assertion
  document.getElementById('addAssertionBtn').addEventListener('click', addAssertion);
  
  // Listen for element picked and replay status
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'elementPicked' && state.isAddingAssertion) {
      // Add the picked element to the last waitForElement step
      const lastStep = state.currentRecording.steps[state.currentRecording.steps.length - 1];
      if (lastStep && lastStep.type === 'waitForElement') {
        lastStep.selectors = message.selectors;
        if (message.name) {
          lastStep.name = message.name;
        }
        // Add value assertion if element has a value
        if (message.value) {
          lastStep.value = message.value;
        }
        // Add text assertion if element has text
        if (message.text) {
          lastStep.text = message.text;
        }
        renderStepsList();
        updateCodePreview();
      }
      state.isAddingAssertion = false;
      // Re-enable the Add Assertion button
      const addAssertionBtn = document.getElementById('addAssertionBtn');
      if (addAssertionBtn) {
        addAssertionBtn.disabled = false;
      }
    }
    
    // Handle replay step status updates
    if (message.action === 'replayStepStatus') {
      updateStepStatus(message.stepIndex, message.status, message.error);
    }
    
    // Handle replay stopped
    if (message.action === 'replayStopped' || message.action === 'replayCompleted') {
      document.getElementById('replayBtn').style.display = 'inline-flex';
      document.getElementById('stopReplayBtn').style.display = 'none';
    }
  });

  // Replay settings
  document.getElementById('throttling').addEventListener('change', (e) => {
    state.replaySettings.throttling = e.target.value;
  });

  document.getElementById('timeout').addEventListener('change', (e) => {
    state.replaySettings.timeout = parseInt(e.target.value);
  });

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabName = e.currentTarget.dataset.tab;
      const parentPanel = e.currentTarget.closest('.details-panel');
      switchTab(tabName, parentPanel);
    });
  });

  // Export JSON
  document.getElementById('exportJsonBtn').addEventListener('click', exportRecording);

  // Delete recording
  document.getElementById('deleteRecordingBtn').addEventListener('click', deleteCurrentRecording);

  // Replay button
  document.getElementById('replayBtn').addEventListener('click', () => {
    const speed = document.getElementById('replaySpeed').value;
    const timeout = parseInt(document.getElementById('replayTimeout').value) || 5000;
    const stepDelay = parseInt(document.getElementById('stepDelay').value) || 100;
    // Update replay settings with timeout and stepDelay
    state.replaySettings.timeout = timeout;
    state.replaySettings.stepDelay = stepDelay;
    replayRecording(speed);
    
    // Show Stop Replay button, hide Replay button
    document.getElementById('replayBtn').style.display = 'none';
    document.getElementById('stopReplayBtn').style.display = 'inline-flex';
  });
  
  // Stop Replay button
  document.getElementById('stopReplayBtn').addEventListener('click', async () => {
    const tabId = chrome.devtools.inspectedWindow.tabId;
    await chrome.tabs.sendMessage(tabId, {
      action: 'stopReplay'
    });
    
    // Show Replay button, hide Stop Replay button
    document.getElementById('replayBtn').style.display = 'inline-flex';
    document.getElementById('stopReplayBtn').style.display = 'none';
  });
  
  // Continue Recording button
  document.getElementById('continueRecordingBtn').addEventListener('click', continueRecording);
}

async function initializeTheme() {
  const appRoot = document.getElementById('app');
  const themeSelect = document.getElementById('themeSelect');
  let storedTheme = 'light';

  try {
    const result = await chrome.storage.sync.get(['qaRecorderTheme']);
    if (result.qaRecorderTheme === 'dark' || result.qaRecorderTheme === 'light') {
      storedTheme = result.qaRecorderTheme;
    }
  } catch (err) {
    console.warn('Failed to load theme, using default light', err);
  }

  state.theme = storedTheme;
  applyTheme(storedTheme);

  if (themeSelect) {
    themeSelect.value = storedTheme;
  }
}

function applyTheme(theme) {
  const appRoot = document.getElementById('app');
  if (!appRoot) return;
  if (theme === 'dark') {
    appRoot.classList.add('dark-theme');
  } else {
    appRoot.classList.remove('dark-theme');
  }
}

// Start Recording
async function startRecording() {
  const nameInput = document.getElementById('recordingName');
  const name = nameInput.value.trim();
  
  const suiteNameInput = document.getElementById('suiteName');
  const suiteName = suiteNameInput.value.trim();

  if (!name) {
    alert('Пожалуйста, введите название записи');
    return;
  }

  if (!suiteName) {
    alert('Пожалуйста, введите название TestSuite');
    return;
  }

  if (state.selectedSelectors.length === 0) {
    alert('Выберите хотя бы один тип селектора');
    return;
  }

  // Get viewport info
  const tabId = chrome.devtools.inspectedWindow.tabId;
  
  // Create new recording with empty steps array
  state.currentRecording = {
    id: Date.now(),
    title: name,
    suiteName: suiteName,
    selectorAttribute: 'data-testid',
    createdAt: new Date().toISOString(),
    steps: [],
    selectedSelectors: [...state.selectedSelectors]
  };

  state.isRecording = true;
  state.isAddingAssertion = false;
  state.selectedStep = null;
  state.currentView = 'recording';
  updateView();

  document.getElementById('currentRecordingName').textContent = name;
  
  // Clear the steps list UI immediately
  const stepsContainer = document.getElementById('stepsList');
  if (stepsContainer) {
    stepsContainer.innerHTML = '<div class="step-details-empty"><p>Шаги появятся здесь</p></div>';
  }

  // Listen for recorded events BEFORE starting recording to catch initial events
  chrome.runtime.onMessage.addListener(handleRecordedEvent);

  // Inject content script and start recording
  await chrome.tabs.sendMessage(tabId, {
    action: 'startRecording',
    selectors: state.selectedSelectors
  });
}

// Stop Recording
async function stopRecording() {
  if (!state.isRecording) return;

  const tabId = chrome.devtools.inspectedWindow.tabId;
  await chrome.tabs.sendMessage(tabId, {
    action: 'stopRecording'
  });

  state.isRecording = false;
  
  // Stop listening to recorded events to avoid duplicates on next runs
  try { chrome.runtime.onMessage.removeListener(handleRecordedEvent); } catch (e) {}
  
  // Save or update recording
  if (state.isContinuingRecording) {
    // Update existing recording
    const recordingIndex = state.recordings.findIndex(r => r.id === state.currentRecording.id);
    if (recordingIndex !== -1) {
      state.recordings[recordingIndex] = state.currentRecording;
    }
    state.isContinuingRecording = false;
  } else {
    // Add new recording
    state.recordings.push(state.currentRecording);
  }
  
  await saveRecordings();

  // Switch to playback view
  state.currentView = 'playback';
  updateView();
  renderPlaybackView();
}

// Continue Recording
async function continueRecording() {
  if (!state.currentRecording) return;

  state.isContinuingRecording = true;
  state.isRecording = true;
  state.isAddingAssertion = false;
  state.selectedStep = null;
  state.currentView = 'recording';
  updateView();

  document.getElementById('currentRecordingName').textContent = state.currentRecording.title;
  
  // Render existing steps
  renderStepsList();
  updateCodePreview();

  // Listen for recorded events
  chrome.runtime.onMessage.addListener(handleRecordedEvent);

  // Start recording without adding setViewport and navigate
  const tabId = chrome.devtools.inspectedWindow.tabId;
  await chrome.tabs.sendMessage(tabId, {
    action: 'startRecording',
    selectors: state.currentRecording.selectedSelectors || state.selectedSelectors,
    skipInitialSteps: true  // Flag to skip setViewport and navigate
  });
}

// Handle recorded events from content script
function handleRecordedEvent(message) {
  if (message.action === 'recordedEvent' && state.isRecording) {
    const step = message.event;
    const steps = state.currentRecording.steps;
    
    // Skip setViewport and navigate if continuing recording
    if (state.isContinuingRecording && (step.type === 'setViewport' || step.type === 'navigate')) {
      return;
    }
    
    const last = steps[steps.length - 1];
    if (last && JSON.stringify(last) === JSON.stringify(step)) {
      return; // ignore duplicate
    }
    steps.push(step);
    renderStepsList();
    updateCodePreview();
  }
}

// Activate Element Picker
async function activateElementPicker() {
  const tabId = chrome.devtools.inspectedWindow.tabId;
  await chrome.tabs.sendMessage(tabId, {
    action: 'activateElementPicker'
  });
}

// Add Assertion
async function addAssertion() {
  // Disable the button while picking element
  const addAssertionBtn = document.getElementById('addAssertionBtn');
  if (addAssertionBtn) {
    addAssertionBtn.disabled = true;
  }
  
  const assertion = {
    type: 'waitForElement',
    selectors: [],
    visible: true,
    timeout: 5000,
    target: 'main'
  };

  state.currentRecording.steps.push(assertion);
  state.isAddingAssertion = true;
  renderStepsList();
  updateCodePreview();
  
  // Activate element picker
  await activateElementPicker();
}

// Switch Tab
function switchTab(tabName, parentPanel = document) {
  parentPanel.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  parentPanel.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `${tabName}Tab`);
  });

  if (tabName === 'code' || tabName === 'playbackCode') {
    updateCodePreview();
  }
  
  // If switching to code tab and a step is selected, scroll to it
  if ((tabName === 'code' || tabName === 'playbackCode') && state.selectedStep !== null) {
    setTimeout(() => {
      const previewId = tabName === 'code' ? 'codePreview' : 'playbackCodePreview';
      scrollToStepInCode(state.selectedStep, previewId);
    }, 100);
  }
}

// Render Functions
function renderRecordingsList() {
  const container = document.getElementById('recordingsList');
  
  if (state.recordings.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📹</div>
        <h2>Нет записей</h2>
        <p>Создайте первую запись для начала работы</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.recordings.map(recording => `
    <div class="recording-card" data-id="${recording.id}">
      <div class="recording-card-header">
        <div class="recording-card-title">${recording.title}</div>
        <button class="delete-recording-btn" data-id="${recording.id}" title="Удалить запись">🗑</button>
      </div>
      <div class="recording-card-meta">
        <span>📝 ${recording.steps.length} шагов</span>
        <span>📅 ${new Date(recording.createdAt).toLocaleDateString('ru-RU')}</span>
      </div>
    </div>
  `).join('');

  // Add click handlers
  container.querySelectorAll('.recording-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (!e.target.classList.contains('delete-recording-btn')) {
        const id = parseInt(card.dataset.id);
        openRecording(id);
      }
    });
  });
  
  // Add delete handlers
  container.querySelectorAll('.delete-recording-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      if (confirm('Вы уверены, что хотите удалить эту запись?')) {
        state.recordings = state.recordings.filter(r => r.id !== id);
        await saveRecordings();
        renderRecordingsList();
      }
    });
  });
}

function renderStepsList() {
  const container = document.getElementById('stepsList');
  
  if (!state.currentRecording || state.currentRecording.steps.length === 0) {
    container.innerHTML = '<div class="step-details-empty"><p>Шаги появятся здесь</p></div>';
    return;
  }

  container.innerHTML = state.currentRecording.steps.map((step, index) => `
    <div class="step-item" data-index="${index}">
      <div class="step-number">${index + 1}</div>
      <div class="step-type">${step.type}</div>
      <div class="step-icon">${getStepIcon(step.type)}</div>
      <button class="delete-step-btn" data-index="${index}" title="Удалить шаг">×</button>
    </div>
  `).join('');

  // Add click handlers
  container.querySelectorAll('.step-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (!e.target.classList.contains('delete-step-btn')) {
        const index = parseInt(item.dataset.index);
        selectStep(index);
      }
    });
  });
  
  // Add delete handlers
  container.querySelectorAll('.delete-step-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.index);
      deleteStep(index);
    });
  });
}

function selectStep(index) {
  state.selectedStep = index;
  
  // Update active state
  document.querySelectorAll('.step-item').forEach((item, i) => {
    item.classList.toggle('active', i === index);
  });

  // Check if "Show Code" tab is active
  const codeTab = document.querySelector('.tab-btn[data-tab="code"]');
  const isCodeTabActive = codeTab && codeTab.classList.contains('active');
  
  if (isCodeTabActive) {
    // Navigate to step in JSON code
    setTimeout(() => scrollToStepInCode(index, 'codePreview'), 50);
  } else {
    // Show step details
    const step = state.currentRecording.steps[index];
    renderStepDetails(step);
  }
}

function renderStepDetails(step) {
  const container = document.getElementById('stepDetails');
  
  let selectorsHTML = '';
  if (step.selectors && step.selectors.length > 0) {
    selectorsHTML = `
      <tr>
        <th>Selectors</th>
        <td>
          <ul class="selector-list">
            ${step.selectors.map(s => `<li>${Array.isArray(s) ? s.join(', ') : s}</li>`).join('')}
          </ul>
        </td>
      </tr>
    `;
  }

  let offsetHTML = '';
  if (step.offsetX !== undefined && step.offsetY !== undefined) {
    offsetHTML = `
      <tr>
        <th>OffsetX</th>
        <td>${step.offsetX}</td>
      </tr>
      <tr>
        <th>OffsetY</th>
        <td>${step.offsetY}</td>
      </tr>
    `;
  }

  container.innerHTML = `
    <table class="step-details-table">
      <tr>
        <th>Type</th>
        <td>${step.type}</td>
      </tr>
      ${step.url ? `
        <tr>
          <th>URL</th>
          <td style="word-break: break-all;">${step.url}</td>
        </tr>
      ` : ''}
      ${selectorsHTML}
      ${offsetHTML}
      ${step.name ? `
        <tr>
          <th>Name</th>
          <td>${step.name}</td>
        </tr>
      ` : ''}
      ${step.value !== undefined ? `
        <tr>
          <th>Value</th>
          <td>${step.value}</td>
        </tr>
      ` : ''}
      ${step.text !== undefined ? `
        <tr>
          <th>Text</th>
          <td>${step.text}</td>
        </tr>
      ` : ''}
      ${step.key ? `
        <tr>
          <th>Key</th>
          <td>${step.key}</td>
        </tr>
      ` : ''}
    </table>
  `;
}

function renderPlaybackView() {
  document.getElementById('playbackRecordingName').textContent = state.currentRecording.title;
  
  const container = document.getElementById('playbackStepsList');
  container.innerHTML = state.currentRecording.steps.map((step, index) => `
    <div class="step-item" data-index="${index}" data-step-id="step-${index}">
      <div class="step-number">${index + 1}</div>
      <div class="step-type">${step.type}</div>
      <div class="step-icon">${getStepIcon(step.type)}</div>
      <div class="step-status-icon"></div>
      <button class="delete-step-btn" data-index="${index}" title="Удалить шаг">×</button>
    </div>
  `).join('');

  // Add click handlers
  container.querySelectorAll('.step-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (!e.target.classList.contains('delete-step-btn')) {
        const index = parseInt(item.dataset.index);
        state.selectedStep = index;
        
        // Update active state
        container.querySelectorAll('.step-item').forEach((el, i) => {
          el.classList.toggle('active', i === index);
        });
        
        // Check if "Show Code" tab is active
        const codeTab = document.querySelector('.tab-btn[data-tab="playbackCode"]');
        const isCodeTabActive = codeTab && codeTab.classList.contains('active');
        
        if (isCodeTabActive) {
          // Navigate to step in JSON code
          setTimeout(() => scrollToStepInCode(index, 'playbackCodePreview'), 50);
        } else {
          // Show step details
          const step = state.currentRecording.steps[index];
          renderPlaybackStepDetails(step);
        }
      }
    });
  });
  
  // Add delete handlers
  container.querySelectorAll('.delete-step-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.index);
      deleteStep(index);
    });
  });
  
  // Update code preview
  updateCodePreview();
}

function renderPlaybackStepDetails(step) {
  const container = document.getElementById('playbackStepDetails');
  renderStepDetails.call({ innerHTML: '' }, step);
  container.innerHTML = document.getElementById('stepDetails').innerHTML;
}

function prepareRecordingForExport(recording) {
  if (!recording) return null;

  const { steps = [], ...rest } = recording;
  const normalSteps = steps.filter(step => step.type !== 'waitForElement');
  const checkSteps = steps.filter(step => step.type === 'waitForElement');

  const result = {
    ...rest,
    steps: normalSteps
  };

  if (checkSteps.length > 0) {
    result.checkSteps = checkSteps;
  }

  return result;
}

function updateCodePreview() {
  if (!state.currentRecording) return;
  
  const codePreview = document.getElementById('codePreview');
  const playbackCodePreview = document.getElementById('playbackCodePreview');
  const exportRecording = prepareRecordingForExport(state.currentRecording);
  const jsonStr = JSON.stringify(exportRecording, null, 2);
  
  if (codePreview) codePreview.textContent = jsonStr;
  if (playbackCodePreview) playbackCodePreview.textContent = jsonStr;
}

// Helper Functions
function getStepIcon(type) {
  const icons = {
    navigate: '🌐',
    click: '👆',
    change: '✏️',
    keyDown: '⌨️',
    keyUp: '⌨️',
    setViewport: '📱',
    waitForElement: '⏳'
  };
  return icons[type] || '📍';
}

function updateView() {
  document.querySelectorAll('.view').forEach(view => {
    view.classList.remove('active');
  });

  document.getElementById(`${state.currentView}View`).classList.add('active');
}

async function openRecording(id) {
  state.currentRecording = state.recordings.find(r => r.id === id);
  state.currentView = 'playback';
  updateView();
  renderPlaybackView();
}

async function exportRecording() {
  if (!state.currentRecording) return;

  const exportRecordingData = prepareRecordingForExport(state.currentRecording);
  const dataStr = JSON.stringify(exportRecordingData, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.currentRecording.title}.json`;
  a.click();
  
  URL.revokeObjectURL(url);
}

async function deleteCurrentRecording() {
  if (!state.currentRecording) return;

  if (!confirm('Вы уверены, что хотите удалить эту запись?')) return;

  state.recordings = state.recordings.filter(r => r.id !== state.currentRecording.id);
  await saveRecordings();
  
  // Clear current recording completely
  state.currentRecording = null;
  state.isAddingAssertion = false;
  state.selectedStep = null;
  state.currentView = 'main';
  updateView();
  renderRecordingsList();
}

async function replayRecording(speed) {
  if (!state.currentRecording) return;

  try {
    const tabId = chrome.devtools.inspectedWindow.tabId;
    
    await chrome.tabs.sendMessage(tabId, {
      action: 'replayRecording',
      recording: state.currentRecording,
      speed: speed,
      settings: state.replaySettings
    });
    
    console.log('Replay started with speed:', speed);
  } catch (error) {
    console.error('Error replaying recording:', error);
    alert('Ошибка воспроизведения. Убедитесь, что вы находитесь на правильной странице.');
  }
}

function deleteStep(index) {
  if (!state.currentRecording) return;
  
  if (confirm('Удалить этот шаг?')) {
    state.currentRecording.steps.splice(index, 1);
    renderStepsList();
    updateCodePreview();
    
    if (state.currentView === 'playback') {
      renderPlaybackView();
    }
    
    // Save if not currently recording
    if (!state.isRecording) {
      saveRecordings();
    }
  }
}

function updateStepStatus(stepIndex, status, error) {
  const stepElement = document.querySelector(`[data-step-id="step-${stepIndex}"]`);
  if (!stepElement) return;
  
  // Remove all previous status classes
  stepElement.classList.remove('step-executing', 'step-success', 'step-error');
  
  // Add appropriate status class
  if (status === 'executing') {
    stepElement.classList.add('step-executing');
  } else if (status === 'success') {
    stepElement.classList.add('step-success');
  } else if (status === 'error') {
    stepElement.classList.add('step-error');
    if (error) {
      stepElement.title = `Ошибка: ${error}`;
    }
  }
}

function scrollToStepInCode(stepIndex, previewElementId = 'codePreview') {
  const codePreview = document.getElementById(previewElementId);
  if (!codePreview) return;
  
  const jsonText = codePreview.textContent;
  const lines = jsonText.split('\n');
  
  // Find the line that contains this step in the JSON
  let stepLine = -1;
  let stepsArrayFound = false;
  let stepCount = 0;
  let bracketDepth = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Find "steps": [ array
    if (line.includes('"steps"') && line.includes('[')) {
      stepsArrayFound = true;
      continue;
    }
    
    // Track bracket depth to properly count step objects
    if (stepsArrayFound) {
      if (line.startsWith('{')) {
        if (bracketDepth === 0) {
          // This is a top-level step object
          if (stepCount === stepIndex) {
            stepLine = i;
            break;
          }
          stepCount++;
        }
        bracketDepth++;
      }
      if (line.includes('}')) {
        bracketDepth--;
      }
      // Stop when we reach the end of steps array
      if (line.startsWith(']') && bracketDepth === 0) {
        break;
      }
    }
  }
  
  if (stepLine === -1) return;
  
  // Calculate scroll position based on line height
  const computedStyle = window.getComputedStyle(codePreview);
  const lineHeight = parseFloat(computedStyle.lineHeight) || 20;
  const scrollPosition = stepLine * lineHeight;
  
  // Smooth scroll to the step with offset for better visibility
  codePreview.scrollTo({
    top: Math.max(0, scrollPosition - 100),
    behavior: 'smooth'
  });
}
