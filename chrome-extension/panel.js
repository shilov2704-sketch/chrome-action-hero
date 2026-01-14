// State Management
const state = {
  currentView: 'main',
  recordings: [],
  folders: [],
  currentFolder: null,
  currentRecording: null,
  isRecording: false,
  isContinuingRecording: false,
  isAddingAssertion: false,
  selectedStep: null,
  selectedSelectors: ['css', 'xpath'],
  replaySettings: {
    throttling: 'none',
    timeout: 5000
  },
  theme: 'light',
  selectedItems: [], // {type: 'recording'|'folder', id: number}
  isPlayingFolder: false,
  folderPlayQueue: [],
  currentFolderPlayIndex: 0,
  playingFolderId: null,
  folderPlayResults: {}, // {recordingId: 'success' | 'error'}
  folderStepResults: {}, // {recordingId: {stepIndex: 'success' | 'error'}}
  currentPlayingRecordingId: null,
  folderPlaybackCompleted: false
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
  const result = await chrome.storage.local.get(['recordings', 'folders']);
  state.recordings = result.recordings || [];
  state.folders = result.folders || [];
  renderRecordingsList();
}

// Save recordings to storage
async function saveRecordings() {
  await chrome.storage.local.set({ recordings: state.recordings });
}

// Save folders to storage
async function saveFolders() {
  await chrome.storage.local.set({ folders: state.folders });
}


// Event Listeners
function initializeEventListeners() {
  // Navigation
  document.getElementById('createRecordingBtn').addEventListener('click', () => {
    state.currentView = 'create';
    updateView();
  });
  
  // Create folder
  document.getElementById('createFolderBtn').addEventListener('click', createFolder);

  document.getElementById('backToMainBtn').addEventListener('click', () => {
    state.currentView = 'main';
    state.currentFolder = null;
    updateView();
  });

  document.getElementById('backToMainFromPlaybackBtn').addEventListener('click', () => {
    state.currentView = 'main';
    updateView();
    renderRecordingsList();
  });

  // Import dropdown
  document.getElementById('importRecordingBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = document.getElementById('importDropdownMenu');
    dropdown.classList.toggle('show');
  });
  
  document.getElementById('importRecordingOption').addEventListener('click', () => {
    document.getElementById('importDropdownMenu').classList.remove('show');
    document.getElementById('importFileInput').click();
  });
  
  document.getElementById('importFolderOption').addEventListener('click', () => {
    document.getElementById('importDropdownMenu').classList.remove('show');
    document.getElementById('importFolderInput').click();
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    document.getElementById('importDropdownMenu').classList.remove('show');
  });

  document.getElementById('importFileInput').addEventListener('change', handleImportFiles);
  document.getElementById('importFolderInput').addEventListener('change', handleImportFolder);
  
  // Bulk actions
  document.getElementById('bulkExportBtn').addEventListener('click', handleBulkExport);
  document.getElementById('bulkDeleteBtn').addEventListener('click', handleBulkDelete);
  document.getElementById('bulkCancelBtn').addEventListener('click', clearSelection);
  document.getElementById('bulkSelectAllBtn').addEventListener('click', selectAll);
  
  // Reset results button
  document.getElementById('resetResultsBtn').addEventListener('click', resetFolderResults);

  // Rename recording
  document.getElementById('renameRecordingBtn').addEventListener('click', renameCurrentRecording);
  document.getElementById('playbackRecordingName').addEventListener('click', renameCurrentRecording);

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
    // Update replay settings with timeout
    state.replaySettings.timeout = timeout;
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
    alert('Пожалуйста, выберите TestSuite');
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
  
  // Get recordings for current view (folder or root)
  let displayRecordings;
  let displayFolders;
  
  if (state.currentFolder) {
    // Inside a folder - show only recordings in this folder
    displayRecordings = state.recordings.filter(r => r.folderId === state.currentFolder.id);
    displayFolders = [];
  } else {
    // Root view - show folders and recordings without folder
    displayRecordings = state.recordings.filter(r => !r.folderId);
    displayFolders = state.folders;
  }
  
  if (displayRecordings.length === 0 && displayFolders.length === 0 && !state.currentFolder) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📹</div>
        <h2>Нет записей</h2>
        <p>Создайте первую запись для начала работы</p>
      </div>
    `;
    return;
  }
  
  let html = '';
  
  // If inside a folder, show back button and folder name
  if (state.currentFolder) {
    html += `
      <div class="folder-header">
        <button class="btn btn-ghost back-to-root-btn">
          <span class="icon">←</span> Назад
        </button>
        <div class="folder-title-container">
          <span class="folder-title">${state.currentFolder.name}</span>
          <button class="btn btn-ghost btn-small rename-folder-btn" title="Переименовать папку">✏️</button>
        </div>
      </div>
    `;
  }
  
  // Render folders
  html += displayFolders.map(folder => {
    const recordingsInFolder = state.recordings.filter(r => r.folderId === folder.id);
    const isSelected = state.selectedItems.some(s => s.type === 'folder' && s.id === folder.id);
    return `
      <div class="folder-card ${isSelected ? 'selected' : ''}" data-folder-id="${folder.id}">
        <div class="folder-card-header">
          <input type="checkbox" class="bulk-checkbox folder-checkbox" data-folder-id="${folder.id}" ${isSelected ? 'checked' : ''}>
          <div class="folder-icon">📁</div>
          <div class="folder-card-title">${folder.name}</div>
          <button class="play-folder-btn ${recordingsInFolder.length === 0 ? 'disabled' : ''}" 
                  data-folder-id="${folder.id}" 
                  title="Воспроизвести все записи"
                  ${recordingsInFolder.length === 0 ? 'disabled' : ''}>▶️</button>
          <button class="delete-folder-btn" data-folder-id="${folder.id}" title="Удалить папку">🗑</button>
        </div>
        <div class="folder-card-meta">
          <span>📝 ${recordingsInFolder.length} записей</span>
        </div>
      </div>
    `;
  }).join('');

  // Render recordings
  html += displayRecordings.map(recording => {
    const isSelected = state.selectedItems.some(s => s.type === 'recording' && s.id === recording.id);
    const playResult = state.folderPlayResults[recording.id];
    const isCurrentlyPlaying = state.isPlayingFolder && state.currentPlayingRecordingId === recording.id;
    let resultClass = '';
    if (isCurrentlyPlaying) resultClass = 'play-in-progress';
    else if (playResult === 'success') resultClass = 'play-success';
    else if (playResult === 'error') resultClass = 'play-error';
    return `
      <div class="recording-card ${isSelected ? 'selected' : ''} ${resultClass}" data-id="${recording.id}">
        <div class="recording-card-header">
          <input type="checkbox" class="bulk-checkbox recording-checkbox" data-id="${recording.id}" ${isSelected ? 'checked' : ''}>
          <div class="recording-card-title">${recording.title}</div>
          <div class="recording-card-actions">
            ${state.currentFolder ? `<button class="move-to-root-btn" data-id="${recording.id}" title="Переместить в общий список">📤</button>` : `<button class="move-to-folder-btn" data-id="${recording.id}" title="Переместить в папку">📁</button>`}
            <button class="delete-recording-btn" data-id="${recording.id}" title="Удалить запись">🗑</button>
          </div>
        </div>
        <div class="recording-card-meta">
          <span>📝 ${recording.steps.length} шагов</span>
          <span>📅 ${new Date(recording.createdAt).toLocaleDateString('ru-RU')}</span>
        </div>
      </div>
    `;
  }).join('');
  
  if (state.currentFolder && displayRecordings.length === 0) {
    html += `
      <div class="empty-state">
        <div class="empty-icon">📂</div>
        <h2>Папка пуста</h2>
        <p>Добавьте записи в эту папку</p>
      </div>
    `;
  }
  
  container.innerHTML = html;

  // Add checkbox handlers
  container.querySelectorAll('.bulk-checkbox').forEach(checkbox => {
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      const isFolder = e.target.classList.contains('folder-checkbox');
      const id = parseInt(isFolder ? e.target.dataset.folderId : e.target.dataset.id);
      const type = isFolder ? 'folder' : 'recording';
      
      if (e.target.checked) {
        state.selectedItems.push({ type, id });
      } else {
        state.selectedItems = state.selectedItems.filter(s => !(s.type === type && s.id === id));
      }
      
      updateBulkActionsBar();
      renderRecordingsList();
    });
  });

  // Add folder click handlers
  container.querySelectorAll('.folder-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (!e.target.classList.contains('delete-folder-btn') && 
          !e.target.classList.contains('bulk-checkbox') &&
          !e.target.classList.contains('play-folder-btn')) {
        const folderId = parseInt(card.dataset.folderId);
        openFolder(folderId);
      }
    });
  });
  
  // Add play folder handlers
  container.querySelectorAll('.play-folder-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const folderId = parseInt(btn.dataset.folderId);
      await playFolder(folderId);
    });
  });
  
  // Add delete folder handlers
  container.querySelectorAll('.delete-folder-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const folderId = parseInt(btn.dataset.folderId);
      await deleteFolder(folderId);
    });
  });
  
  // Add back to root handler
  const backBtn = container.querySelector('.back-to-root-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      state.currentFolder = null;
      renderRecordingsList();
    });
  }
  
  // Add rename folder handler
  const renameBtn = container.querySelector('.rename-folder-btn');
  if (renameBtn) {
    renameBtn.addEventListener('click', renameCurrentFolder);
  }

  // Add click handlers for recordings
  container.querySelectorAll('.recording-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (!e.target.classList.contains('delete-recording-btn') && 
          !e.target.classList.contains('move-to-folder-btn') &&
          !e.target.classList.contains('move-to-root-btn') &&
          !e.target.classList.contains('bulk-checkbox')) {
        const id = parseInt(card.dataset.id);
        openRecording(id);
      }
    });
  });
  
  // Add delete recording handlers
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
  
  // Add move to folder handlers
  container.querySelectorAll('.move-to-folder-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const recordingId = parseInt(btn.dataset.id);
      await showMoveToFolderDialog(recordingId);
    });
  });
  
  // Add move to root handlers
  container.querySelectorAll('.move-to-root-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const recordingId = parseInt(btn.dataset.id);
      await moveRecordingToRoot(recordingId);
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

function renderStepDetails(step, isPlayback = false) {
  const containerId = isPlayback ? 'playbackStepDetails' : 'stepDetails';
  const container = document.getElementById(containerId);
  if (!container) return;
  
  // Find XPath selector if exists
  let xpathSelector = '';
  if (step.selectors && step.selectors.length > 0) {
    for (const selector of step.selectors) {
      const selectorStr = Array.isArray(selector) ? selector[0] : selector;
      if (typeof selectorStr === 'string' && selectorStr.startsWith('xpath/')) {
        let xpath = selectorStr.replace('xpath/', '');
        // Ensure XPath starts with //
        if (xpath.startsWith('/') && !xpath.startsWith('//')) {
          xpath = '/' + xpath;
        }
        xpathSelector = xpath;
        break;
      }
    }
  }
  
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
  
  // XPath edit section
  let xpathEditHTML = '';
  if (xpathSelector) {
    xpathEditHTML = `
      <tr>
        <th>XPath</th>
        <td>
          <div class="xpath-edit-container">
            <input type="text" class="xpath-input input" value="${xpathSelector}" placeholder="XPath выражение" readonly>
            <div class="xpath-actions">
              <button class="btn btn-small btn-copy-xpath" title="Скопировать XPath">📋 Копировать</button>
            </div>
          </div>
        </td>
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
      ${xpathEditHTML}
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
  
  // Add event listeners for XPath buttons
  const copyBtn = container.querySelector('.btn-copy-xpath');
  const xpathInput = container.querySelector('.xpath-input');
  
  if (copyBtn && xpathInput) {
    copyBtn.addEventListener('click', async () => {
      const xpath = xpathInput.value;
      try {
        // Try modern API first
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(xpath);
        } else {
          // Fallback for extensions
          const textArea = document.createElement('textarea');
          textArea.value = xpath;
          textArea.style.position = 'fixed';
          textArea.style.left = '-9999px';
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
        }
        copyBtn.textContent = '✓ Скопировано';
        setTimeout(() => {
          copyBtn.textContent = '📋 Копировать';
        }, 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
        // Fallback method
        const textArea = document.createElement('textarea');
        textArea.value = xpath;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
          copyBtn.textContent = '✓ Скопировано';
          setTimeout(() => {
            copyBtn.textContent = '📋 Копировать';
          }, 2000);
        } catch (e) {
          alert('Не удалось скопировать в буфер обмена');
        }
        document.body.removeChild(textArea);
      }
    });
  }
}

function renderPlaybackView() {
  document.getElementById('playbackRecordingName').textContent = state.currentRecording.title;
  
  const container = document.getElementById('playbackStepsList');
  const recordingId = state.currentRecording.id;
  const stepResults = state.folderStepResults[recordingId] || {};
  
  container.innerHTML = state.currentRecording.steps.map((step, index) => {
    const stepResult = stepResults[index];
    let stepResultClass = '';
    if (stepResult === 'success') stepResultClass = 'step-success';
    else if (stepResult === 'error') stepResultClass = 'step-error';
    
    return `
      <div class="step-item ${stepResultClass}" data-index="${index}" data-step-id="step-${index}">
        <div class="step-number">${index + 1}</div>
        <div class="step-type">${step.type}</div>
        <div class="step-icon">${getStepIcon(step.type)}</div>
        <div class="step-status-icon"></div>
        <button class="delete-step-btn" data-index="${index}" title="Удалить шаг">×</button>
      </div>
    `;
  }).join('');

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
  renderStepDetails(step, true);
}

function formatWaitForElementStep(step) {
  // Extract the primary xpath selector
  let selector = '';
  if (step.selectors && step.selectors.length > 0) {
    for (const selectorGroup of step.selectors) {
      if (selectorGroup[0] && selectorGroup[0].startsWith('xpath//')) {
        // Handle xpath// prefix (keeps the //)
        selector = selectorGroup[0].replace('xpath/', '');
        break;
      } else if (selectorGroup[0] && selectorGroup[0].startsWith('xpath/')) {
        // Handle xpath/ prefix (add extra /)
        selector = '/' + selectorGroup[0].replace('xpath/', '');
        break;
      }
    }
  }
  
  // Get the expected text (from value or text field)
  const expectedText = step.value || step.text || '';
  
  return `expected element ${selector} contain text - ${expectedText}`;
}

function prepareRecordingForExport(recording) {
  if (!recording) return null;

  const { steps = [], ...rest } = recording;
  
  // Process steps: group consecutive waitForElement into checkSteps arrays
  // while preserving the chronological order
  const processedSteps = [];
  let currentCheckSteps = [];
  
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    
    if (step.type === 'waitForElement') {
      // Add to current checkSteps group
      currentCheckSteps.push(formatWaitForElementStep(step));
    } else {
      // If we have accumulated checkSteps, flush them first
      if (currentCheckSteps.length > 0) {
        processedSteps.push({ checkSteps: currentCheckSteps });
        currentCheckSteps = [];
      }
      // Add the regular step
      processedSteps.push(step);
    }
  }
  
  // Don't forget any remaining checkSteps at the end
  if (currentCheckSteps.length > 0) {
    processedSteps.push({ checkSteps: currentCheckSteps });
  }

  const result = {
    ...rest,
    steps: processedSteps
  };

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
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
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
    
    // Attach debugger before starting replay for real clicks
    try {
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'attachDebugger',
          tabId: tabId
        }, (response) => {
          if (response && response.success) {
            resolve();
          } else {
            console.warn('Could not attach debugger:', response?.error);
            resolve(); // Continue anyway, will fall back to synthetic clicks
          }
        });
      });
    } catch (e) {
      console.warn('Debugger attach failed:', e);
    }
    
    await chrome.tabs.sendMessage(tabId, {
      action: 'replayRecording',
      recording: state.currentRecording,
      speed: speed,
      settings: { ...state.replaySettings, tabId: tabId }
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
  
  // Create a temporary span to measure exact character position
  const textContent = codePreview.textContent;
  const linesUpToStep = lines.slice(0, stepLine);
  const charsBeforeStep = linesUpToStep.join('\n').length;
  
  // Use a range to find the exact position
  const textNode = codePreview.firstChild;
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    const range = document.createRange();
    try {
      range.setStart(textNode, Math.min(charsBeforeStep, textNode.length));
      range.setEnd(textNode, Math.min(charsBeforeStep + 1, textNode.length));
      const rect = range.getBoundingClientRect();
      const containerRect = codePreview.getBoundingClientRect();
      const scrollTop = rect.top - containerRect.top + codePreview.scrollTop - 50;
      
      codePreview.scrollTo({
        top: Math.max(0, scrollTop),
        behavior: 'smooth'
      });
      return;
    } catch (e) {
      console.warn('Range scroll failed, using fallback', e);
    }
  }
  
  // Fallback: Calculate scroll position based on line height
  const computedStyle = window.getComputedStyle(codePreview);
  const lineHeight = parseFloat(computedStyle.lineHeight) || 20;
  const scrollPosition = stepLine * lineHeight;
  
  codePreview.scrollTo({
    top: Math.max(0, scrollPosition - 50),
    behavior: 'smooth'
  });
}

// Import JSON files
async function handleImportFiles(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  let importedCount = 0;
  let errorCount = 0;

  for (const file of files) {
    try {
      const text = await file.text();
      const recording = JSON.parse(text);

      // Support both formats: {steps} and {steps + checkSteps}
      if (!recording.steps) recording.steps = [];
      if (recording.checkSteps && Array.isArray(recording.checkSteps)) {
        if (!Array.isArray(recording.steps)) recording.steps = [];
        recording.steps = [...recording.steps, ...recording.checkSteps];
        delete recording.checkSteps;
      }

      // Validate required fields
      if (!recording.title || !Array.isArray(recording.steps)) {
        console.error('Invalid recording format:', file.name);
        errorCount++;
        continue;
      }

      // Generate new ID and update timestamp
      recording.id = Date.now() + importedCount;
      recording.createdAt = recording.createdAt || new Date().toISOString();

      state.recordings.push(recording);
      importedCount++;
    } catch (err) {
      console.error('Error importing file:', file.name, err);
      errorCount++;
    }
  }

  if (importedCount > 0) {
    await saveRecordings();
    renderRecordingsList();
  }

  // Clear input for re-import
  event.target.value = '';

  if (importedCount === 0 && errorCount === 0) {
    return;
  }

  if (errorCount > 0) {
    alert(`Импортировано: ${importedCount}, ошибок: ${errorCount}`);
  } else {
    alert(`Успешно импортировано: ${importedCount} записей`);
  }
}

// Rename current recording
async function renameCurrentRecording() {
  if (!state.currentRecording) return;
  
  const newName = prompt('Введите новое название записи:', state.currentRecording.title);
  if (newName === null || newName.trim() === '') return;
  
  state.currentRecording.title = newName.trim();
  
  // Update in recordings array
  const recordingIndex = state.recordings.findIndex(r => r.id === state.currentRecording.id);
  if (recordingIndex !== -1) {
    state.recordings[recordingIndex].title = newName.trim();
  }
  
  await saveRecordings();
  
  // Update UI
  document.getElementById('playbackRecordingName').textContent = newName.trim();
  updateCodePreview();
}

// Update XPath in step
function updateStepXPath(stepIndex, newXpath) {
  if (!state.currentRecording || stepIndex === null || stepIndex === undefined) return;
  
  const step = state.currentRecording.steps[stepIndex];
  if (!step || !step.selectors) return;
  
  // Find and update XPath selector
  let xpathFound = false;
  for (let i = 0; i < step.selectors.length; i++) {
    const selector = step.selectors[i];
    const selectorStr = Array.isArray(selector) ? selector[0] : selector;
    
    if (typeof selectorStr === 'string' && selectorStr.startsWith('xpath/')) {
      // Update existing XPath
      if (Array.isArray(step.selectors[i])) {
        step.selectors[i][0] = 'xpath/' + newXpath;
      } else {
        step.selectors[i] = 'xpath/' + newXpath;
      }
      xpathFound = true;
      break;
    }
  }
  
  // Add new XPath selector if not found
  if (!xpathFound && newXpath) {
    step.selectors.push('xpath/' + newXpath);
  }
  
  // Update in recordings array
  const recordingIndex = state.recordings.findIndex(r => r.id === state.currentRecording.id);
  if (recordingIndex !== -1) {
    state.recordings[recordingIndex] = state.currentRecording;
  }
  
  // Save if not currently recording
  if (!state.isRecording) {
    saveRecordings();
  }
  
  updateCodePreview();
}

// Folder Functions
async function createFolder() {
  const name = prompt('Введите название папки:');
  if (!name || !name.trim()) return;
  
  const folder = {
    id: Date.now(),
    name: name.trim(),
    createdAt: new Date().toISOString()
  };
  
  state.folders.push(folder);
  await saveFolders();
  renderRecordingsList();
}

function openFolder(folderId) {
  const folder = state.folders.find(f => f.id === folderId);
  if (folder) {
    state.currentFolder = folder;
    renderRecordingsList();
  }
}

async function deleteFolder(folderId) {
  const recordingsInFolder = state.recordings.filter(r => r.folderId === folderId);
  
  if (recordingsInFolder.length > 0) {
    if (!confirm('При удалении папки будут удалены все записи, которые в нее добавлены. Вы уверены?')) {
      return;
    }
    // Delete all recordings in the folder
    state.recordings = state.recordings.filter(r => r.folderId !== folderId);
    await saveRecordings();
  }
  
  state.folders = state.folders.filter(f => f.id !== folderId);
  await saveFolders();
  renderRecordingsList();
}

async function renameCurrentFolder() {
  if (!state.currentFolder) return;
  
  const newName = prompt('Введите новое название папки:', state.currentFolder.name);
  if (!newName || !newName.trim() || newName.trim() === state.currentFolder.name) return;
  
  state.currentFolder.name = newName.trim();
  
  const folderIndex = state.folders.findIndex(f => f.id === state.currentFolder.id);
  if (folderIndex !== -1) {
    state.folders[folderIndex] = state.currentFolder;
  }
  
  await saveFolders();
  renderRecordingsList();
}

async function showMoveToFolderDialog(recordingId) {
  if (state.folders.length === 0) {
    alert('Сначала создайте папку');
    return;
  }
  
  const folderNames = state.folders.map((f, i) => `${i + 1}. ${f.name}`).join('\n');
  const choice = prompt(`Выберите папку (введите номер):\n${folderNames}`);
  
  if (!choice) return;
  
  const folderIndex = parseInt(choice) - 1;
  if (isNaN(folderIndex) || folderIndex < 0 || folderIndex >= state.folders.length) {
    alert('Неверный номер папки');
    return;
  }
  
  const targetFolder = state.folders[folderIndex];
  const recording = state.recordings.find(r => r.id === recordingId);
  
  if (recording) {
    recording.folderId = targetFolder.id;
    await saveRecordings();
    renderRecordingsList();
  }
}

async function moveRecordingToRoot(recordingId) {
  const recording = state.recordings.find(r => r.id === recordingId);
  
  if (recording) {
    delete recording.folderId;
    await saveRecordings();
    renderRecordingsList();
  }
}

// Bulk Actions
function updateBulkActionsBar() {
  const bar = document.getElementById('bulkActionsBar');
  const count = document.getElementById('bulkCount');
  
  if (state.selectedItems.length > 0) {
    bar.style.display = 'flex';
    count.textContent = `${state.selectedItems.length} выбрано`;
  } else {
    bar.style.display = 'none';
  }
}

function clearSelection() {
  state.selectedItems = [];
  updateBulkActionsBar();
  renderRecordingsList();
}

async function handleBulkExport() {
  if (state.selectedItems.length === 0) return;

  const selectedFolders = state.selectedItems.filter(s => s.type === 'folder');
  const selectedRecordings = state.selectedItems.filter(s => s.type === 'recording');

  // ZIP library is only needed for exporting folders
  const zipLib = typeof fflate !== 'undefined' ? fflate : (typeof globalThis !== 'undefined' ? globalThis.fflate : null);
  if (selectedFolders.length > 0 && !zipLib) {
    alert('Не удалось загрузить библиотеку ZIP. Проверьте, что подключен lib/fflate.min.js');
    return;
  }

  // Export folders as zip
  for (const item of selectedFolders) {
    const folder = state.folders.find(f => f.id === item.id);
    if (!folder) continue;

    const recordingsInFolder = state.recordings.filter(r => r.folderId === folder.id);
    await exportFolderAsZip(folder, recordingsInFolder);
  }

  // Export individual recordings as JSON
  for (const item of selectedRecordings) {
    const recording = state.recordings.find(r => r.id === item.id);
    if (!recording) continue;

    const exportData = prepareRecordingForExport(recording);
    const dataStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${recording.title}.json`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  }

  clearSelection();
}

async function exportFolderAsZip(folder, recordings) {
  const zipLib = typeof fflate !== 'undefined' ? fflate : (typeof globalThis !== 'undefined' ? globalThis.fflate : null);
  if (!zipLib) {
    alert('Не удалось загрузить библиотеку ZIP. Проверьте, что подключен lib/fflate.min.js');
    return;
  }

  const files = {};

  // Create zip file even if empty
  if (!recordings || recordings.length === 0) {
    files['.keep'] = zipLib.strToU8('');
  } else {
    for (const recording of recordings) {
      const exportData = prepareRecordingForExport(recording);
      const dataStr = JSON.stringify(exportData, null, 2);
      files[`${recording.title}.json`] = zipLib.strToU8(dataStr);
    }
  }

  const zipData = await new Promise((resolve, reject) => {
    zipLib.zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)));
  });

  const blob = new Blob([zipData], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${folder.name}.zip`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

async function handleBulkDelete() {
  if (state.selectedItems.length === 0) return;
  
  const hasFolders = state.selectedItems.some(s => s.type === 'folder');
  const foldersWithRecordings = state.selectedItems
    .filter(s => s.type === 'folder')
    .some(s => state.recordings.some(r => r.folderId === s.id));
  
  let confirmMessage = 'Вы уверены, что хотите удалить выбранные элементы?';
  if (foldersWithRecordings) {
    confirmMessage = 'При удалении папки будут удалены все записи, которые в нее добавлены. Вы уверены?';
  }
  
  if (!confirm(confirmMessage)) return;
  
  // Delete selected folders and their recordings
  for (const item of state.selectedItems.filter(s => s.type === 'folder')) {
    state.recordings = state.recordings.filter(r => r.folderId !== item.id);
    state.folders = state.folders.filter(f => f.id !== item.id);
  }
  
  // Delete selected recordings
  for (const item of state.selectedItems.filter(s => s.type === 'recording')) {
    state.recordings = state.recordings.filter(r => r.id !== item.id);
  }
  
  await saveRecordings();
  await saveFolders();
  clearSelection();
}

// Import folder from ZIP
async function handleImportFolder(event) {
  const file = event.target.files[0];
  if (!file) return;

  const zipLib = typeof fflate !== 'undefined' ? fflate : (typeof globalThis !== 'undefined' ? globalThis.fflate : null);
  if (!zipLib) {
    alert('Не удалось загрузить библиотеку ZIP. Проверьте, что подключен lib/fflate.min.js');
    event.target.value = '';
    return;
  }

  try {
    const zipBytes = new Uint8Array(await file.arrayBuffer());
    const entries = await new Promise((resolve, reject) => {
      zipLib.unzip(zipBytes, (err, data) => (err ? reject(err) : resolve(data)));
    });

    // Remove .zip extension (handle both .zip and .ZIP)
    const folderName = file.name.replace(/\.zip$/i, '');

    // Create new folder
    const folder = {
      id: Date.now(),
      name: folderName,
      createdAt: new Date().toISOString()
    };

    state.folders.push(folder);

    let importedCount = 0;

    for (const [filename, bytes] of Object.entries(entries)) {
      // Skip non-JSON files
      if (!filename.toLowerCase().endsWith('.json')) continue;

      try {
        const content = zipLib.strFromU8(bytes);
        const recording = JSON.parse(content);

        // Support both formats: {steps} and {steps + checkSteps}
        if (!recording.steps) recording.steps = [];
        if (recording.checkSteps && Array.isArray(recording.checkSteps)) {
          if (!Array.isArray(recording.steps)) recording.steps = [];
          recording.steps = [...recording.steps, ...recording.checkSteps];
          delete recording.checkSteps;
        }

        if (!recording.title || !Array.isArray(recording.steps)) {
          console.warn('Skipping invalid recording file:', filename);
          continue;
        }

        recording.id = Date.now() + importedCount;
        recording.folderId = folder.id;
        recording.createdAt = recording.createdAt || new Date().toISOString();

        state.recordings.push(recording);
        importedCount++;
      } catch (err) {
        console.error('Error importing file from ZIP:', filename, err);
      }
    }

    await saveRecordings();
    await saveFolders();
    renderRecordingsList();

    alert(`Папка "${folderName}" импортирована. Записей: ${importedCount}`);
  } catch (err) {
    console.error('Error importing folder:', err);
    const message = err && err.message ? err.message : String(err);
    alert('Ошибка при импорте ZIP архива: ' + message);
  }

  event.target.value = '';
}

// Play all recordings in folder
async function playFolder(folderId) {
  const folder = state.folders.find(f => f.id === folderId);
  if (!folder) return;
  
  const recordings = state.recordings.filter(r => r.folderId === folderId);
  if (recordings.length === 0) return;
  
  state.isPlayingFolder = true;
  state.playingFolderId = folderId;
  state.folderPlayQueue = recordings;
  state.currentFolderPlayIndex = 0;
  state.folderPlayResults = {};
  state.folderStepResults = {};
  state.currentPlayingRecordingId = null;
  state.folderPlaybackCompleted = false;
  
  // Navigate to folder view
  state.currentFolder = folder;
  renderRecordingsList();
  
  // Show playback bar and disable create button
  updateFolderPlaybackUI();
  
  await playNextInFolder();
}

// Reset folder playback results
function resetFolderResults() {
  state.folderPlayResults = {};
  state.folderStepResults = {};
  state.folderPlaybackCompleted = false;
  state.currentPlayingRecordingId = null;
  
  const resetBtn = document.getElementById('resetResultsBtn');
  if (resetBtn) resetBtn.style.display = 'none';
  
  renderRecordingsList();
}

function updateFolderPlaybackUI() {
  const playbackBar = document.getElementById('folderPlaybackBar');
  const createBtn = document.getElementById('createRecordingBtn');
  const folderText = document.getElementById('folderPlaybackText');
  const folderProgress = document.getElementById('folderPlaybackProgress');
  const resetBtn = document.getElementById('resetResultsBtn');
  
  if (state.isPlayingFolder) {
    if (playbackBar) playbackBar.style.display = 'flex';
    if (createBtn) createBtn.disabled = true;
    if (folderText && state.currentFolder) {
      folderText.textContent = `Воспроизведение папки "${state.currentFolder.name}"`;
    }
    if (folderProgress) {
      folderProgress.textContent = `${state.currentFolderPlayIndex}/${state.folderPlayQueue.length}`;
    }
    if (resetBtn) resetBtn.style.display = 'none';
  } else {
    if (playbackBar) playbackBar.style.display = 'none';
    if (createBtn) createBtn.disabled = false;
    // Show reset button if playback completed
    if (resetBtn && state.folderPlaybackCompleted) {
      resetBtn.style.display = 'inline-flex';
    }
  }
}

async function playNextInFolder() {
  if (!state.isPlayingFolder || state.currentFolderPlayIndex >= state.folderPlayQueue.length) {
    state.isPlayingFolder = false;
    state.playingFolderId = null;
    state.folderPlayQueue = [];
    state.currentFolderPlayIndex = 0;
    state.currentPlayingRecordingId = null;
    state.folderPlaybackCompleted = true;
    updateFolderPlaybackUI();
    renderRecordingsList();
    alert('Воспроизведение папки завершено');
    return;
  }
  
  const recording = state.folderPlayQueue[state.currentFolderPlayIndex];
  state.currentRecording = recording;
  state.currentPlayingRecordingId = recording.id;
  state.currentFolderPlayIndex++;
  
  // Initialize step results for this recording
  state.folderStepResults[recording.id] = {};
  
  // Update progress and re-render to show yellow highlight
  updateFolderPlaybackUI();
  renderRecordingsList();
  
  console.log(`Playing recording ${state.currentFolderPlayIndex}/${state.folderPlayQueue.length}: ${recording.title}`);
  
  try {
    const tabId = chrome.devtools.inspectedWindow.tabId;
    
    // Attach debugger
    try {
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'attachDebugger',
          tabId: tabId
        }, (response) => {
          resolve();
        });
      });
    } catch (e) {
      console.warn('Debugger attach failed:', e);
    }
    
    // Track if there was an error
    let hadError = false;
    
    // Set up listener for replay step status
    const stepStatusListener = (message) => {
      if (message.action === 'replayStepStatus') {
        const stepIndex = message.stepIndex !== undefined ? message.stepIndex : (message.actualIndex !== undefined ? message.actualIndex : null);
        if (stepIndex !== null) {
          if (message.status === 'error') {
            hadError = true;
            state.folderStepResults[recording.id][stepIndex] = 'error';
          } else if (message.status === 'success') {
            state.folderStepResults[recording.id][stepIndex] = 'success';
          }
        }
      }
    };
    
    chrome.runtime.onMessage.addListener(stepStatusListener);
    
    // Set up listener for replay completion
    const replayCompletedListener = (message) => {
      if (message.action === 'replayCompleted' || message.action === 'replayStopped') {
        chrome.runtime.onMessage.removeListener(replayCompletedListener);
        chrome.runtime.onMessage.removeListener(stepStatusListener);
        
        // Mark result
        state.folderPlayResults[recording.id] = hadError ? 'error' : 'success';
        state.currentPlayingRecordingId = null;
        renderRecordingsList();
        
        // Wait a bit before playing next
        setTimeout(() => {
          playNextInFolder();
        }, 1000);
      }
    };
    
    chrome.runtime.onMessage.addListener(replayCompletedListener);
    
    await chrome.tabs.sendMessage(tabId, {
      action: 'replayRecording',
      recording: recording,
      speed: 'normal',
      settings: { ...state.replaySettings, tabId: tabId }
    });
  } catch (error) {
    console.error('Error replaying recording:', error);
    state.folderPlayResults[recording.id] = 'error';
    state.currentPlayingRecordingId = null;
    renderRecordingsList();
    // Try to continue with next recording
    setTimeout(() => {
      playNextInFolder();
    }, 1000);
  }
}

// Select all visible items
function selectAll() {
  // Get all visible items based on current folder
  let items = [];
  
  if (state.currentFolder) {
    // Inside folder - select all recordings in this folder
    const recordings = state.recordings.filter(r => r.folderId === state.currentFolder.id);
    items = recordings.map(r => ({ type: 'recording', id: r.id }));
  } else {
    // Root view - select all folders and root recordings
    const folders = state.folders.map(f => ({ type: 'folder', id: f.id }));
    const recordings = state.recordings.filter(r => !r.folderId).map(r => ({ type: 'recording', id: r.id }));
    items = [...folders, ...recordings];
  }
  
  state.selectedItems = items;
  updateBulkActionsBar();
  renderRecordingsList();
}

// JSZip is now loaded via script tag in panel.html
