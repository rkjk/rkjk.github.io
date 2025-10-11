const ui = { startBtn: null, stopBtn: null, status: null, ragaName: null, ragaConf: null, historyList: null, authCard: null, resultCard: null, passwordInput: null, authBtn: null, authStatus: null, recordingTimer: null, keepRecordingBtn: null, ragasBtn: null, ragasModal: null, ragasModalClose: null, ragasSearch: null, ragasCount: null, ragasList: null, audioSourceSelect: null, refreshDevicesBtn: null, audioModeSelect: null };

// No longer using a global clientId - will be generated per connection
let currentClientId = null;

let websocket = null, mediaStream = null, audioContext = null, processorNode = null, sending = false;

let currentResult = null; 

const historyResults = []; 

// Enhanced timeout constants
const MAX_NO_RESULT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TOTAL_RECORDING_MS = 15 * 60 * 1000; // 15 minutes absolute max
const RECORDING_WARNING_MS = 10 * 60 * 1000; // 10 minutes warning

// Enhanced timer variables
let noResultTimerId = null;
let totalRecordingTimerId = null;
let recordingWarningTimerId = null;
let recordingStartTime = null;
let recordingTimerId = null;
let timerStartTime = 0;

let authToken = null; 
let isAuthenticated = false;
let selectedDeviceId = null; // Track selected audio device
let audioMode = 'microphone'; // 'microphone' or 'system-audio'

// Ragas data
const RAGAS_25 = ["Saveri","Hemavathi","Thodi","Sindhubhairavi","Sankarabharanam","Kambhoji","Kalyani","Bhairavi","Mohanam","Anandabhairavi","Mukhari","Reethigowla","Panthuvarali","Madhyamavathi","Dhanyasi","Mayamalavagowla","Suruti","Kedaragowla","Khamas","Kapi","Begada","Sowrashtram","Karaharapriya","Nata","Atana"];
const RAGAS_25_5 = ["Behag","Yadukulakambhoji","Poorvikalyani","Sri","Sahana"];
const EXP_30_35 = ["Hindolam","Ahiri","Shanmukapriya","Kaanada","Bilahari","Natakurinji","Neelambari","Bowli","Hamsadhwani","Lalitha","Varali","Abhogi","Purvi","Samanta","Arabhi","Sama","Bhoopalam","Kannada","Devagandhari","Huseni","Simhendramadhyamam","Gowla","Keeravani","Asaveri","Chakravakam","Sriranjani","Saranga","Darbar","Vasantha","Harikambhoji","Chenchurutti","Kurinji","Nadanamakriya","Punnagavarali","Yamunakalyani"];
const EXP_65_77 = ["Kunthalavarali","Charukesi","Paadi","Paras","Subhapanthuvarali","Gowrimanohari","Ramakriya","Vachaspathi","Shuddha dhanyasi","Bageshree","Kedaram","Navaroj","Hamirkalyani","Desh","Amrithavarshini","Ranjani","Malayamarutham","Maand","Manji","Revathi","Dharmavathi","Salanganata","Abheri","Gowlipanthu","Dwijavanthi","Saraswathi","Revagupthi","Manirangu","Devamanohari","Hamsanandi","Mandari","Natabhairavi","Thilang","Andolika","Bahudhari","Brindavana saranga","Chalanata","Chandrajyothi","Chandrakowns","Darbari kaanada","Gambheeranata","Ganamoorthi","Hamsanadam","Jaganmohini","Janaranjani","Jayanthashree","Kadanakuthuhalam","Kalavathi","Kalyanavasantham","Kamalamanohari","Kannadagowla","Karnaranjani","Lathangi","Madhuvanthi","Malahari","Mohanakalyani","Nagaswaravali","Nalinakanthi","Nasikabhushani","Navarasa kannada","Nayaki","Neethimathi","Poornachandrika","Poornashadjam","Ramapriya","Rasikapriya","Ratipatipriya","Saramathi","Sarasangi","Shivaranjani","Sumanesaranjani","Sunadhavinodhini","Soorya","Valaji","Varamu","Vasanthi","Vijayanagari"];

const ALL_RAGAS = [...RAGAS_25, ...RAGAS_25_5, ...EXP_30_35, ...EXP_65_77];
const ragasData = ALL_RAGAS.map(name => ({ name })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

const AUTH_SERVER_URL = "https://raga-server-103463628326.asia-south1.run.app"
const SERVER_URL = "wss://raga-server-103463628326.asia-south1.run.app/ws";

// Generate a UUID v4 using native crypto API
function generateUUID() {
  return crypto.randomUUID();
}

// Enhanced timer management functions
function clearAllTimers() {
  if (noResultTimerId != null) { 
    clearTimeout(noResultTimerId); 
    noResultTimerId = null; 
  }
  if (totalRecordingTimerId != null) { 
    clearTimeout(totalRecordingTimerId); 
    totalRecordingTimerId = null; 
  }
  if (recordingWarningTimerId != null) { 
    clearTimeout(recordingWarningTimerId); 
    recordingWarningTimerId = null; 
  }
  stopRealTimeTimer();
}

function clearNoResultTimer(){ 
  if(noResultTimerId != null){ 
    clearTimeout(noResultTimerId); 
    noResultTimerId = null; 
  } 
}

function armNoResultTimer(){ 
  clearNoResultTimer(); 
  noResultTimerId = setTimeout(handleNoResultWarning, MAX_NO_RESULT_MS); 
}

function armTotalRecordingTimer() {
  // Warning timer
  recordingWarningTimerId = setTimeout(() => {
    const remainingMinutes = Math.ceil((MAX_TOTAL_RECORDING_MS - RECORDING_WARNING_MS) / 60000);
    setStatus(`Recording will auto-stop in ${remainingMinutes} minutes. Click stop/start to continue if needed.`);
  }, RECORDING_WARNING_MS);
  
  // Absolute cutoff timer
  totalRecordingTimerId = setTimeout(() => {
    setStatus('Recording stopped automatically after 15 minutes. Click start to begin a new session.');
    try { stopRecording(); } catch(_) {}
    try { closeWebSocket(); } catch(_) {}
  }, MAX_TOTAL_RECORDING_MS);
}

function handleNoResultWarning() {
  setStatus('⚠️ No result received in 5 minutes. Audio quality may be poor - expect lower prediction accuracy.');
}

function resetNoResultTimer(){ 
  if(sending || (websocket && websocket.readyState === WebSocket.OPEN)){ 
    armNoResultTimer(); 
  } else { 
    clearNoResultTimer(); 
  } 
}

function startRealTimeTimer() {
  timerStartTime = Date.now();
  clearInterval(recordingTimerId);
  recordingTimerId = setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - timerStartTime) / 1000);
    const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, '0');
    const seconds = (elapsedSeconds % 60).toString().padStart(2, '0');
    if (ui.recordingTimer) {
      ui.recordingTimer.textContent = `Time: ${minutes}:${seconds}`;
    }
  }, 1000);
}

function stopRealTimeTimer() {
  clearInterval(recordingTimerId);
  if (ui.recordingTimer) {
    ui.recordingTimer.textContent = 'Time: 00:00';
  }
}

const TARGET_SAMPLE_RATE = 44100; const CHUNK_SECONDS = 4.0; let buffer441Mono = new Float32Array(0);
function setStatus(t){ ui.status.textContent=t; }
function setAuthStatus(t){ if(ui.authStatus) ui.authStatus.textContent=t; }
function float32ToBase64(arr){ const bytes=new Uint8Array(arr.buffer); let binary=''; const chunk=0x8000; for(let i=0;i<bytes.length;i+=chunk){ const sub=bytes.subarray(i,i+chunk); binary+=String.fromCharCode.apply(null, sub);} return btoa(binary); }

// Enhanced authentication function with retry logic and loading indicators
async function loginWithPassword(password) {
  const maxRetries = 3;
  const retryDelay = 30000; // 30 seconds
  let attempt = 1;
  
  // Show loading state
  ui.authBtn.disabled = true;
  ui.authBtn.innerHTML = `
    <span class="spinner"></span>
    Connecting... (${attempt}/${maxRetries})
  `;
  
  while (attempt <= maxRetries) {
    try {
      setAuthStatus(`Attempt ${attempt}/${maxRetries}: Connecting to server (Server might take a minute to start up).`);
      
      // Set a timeout for the fetch request (slightly less than retry delay)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000); // 25 seconds timeout
      
      const response = await fetch(`${AUTH_SERVER_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim() }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        authToken = data.token;
        isAuthenticated = true;
        showAuthenticatedUI();
        setAuthStatus(`✅ Access granted! Token expires in ${data.expires_in_hours} hours.`);
        
        // Reset button state
        ui.authBtn.disabled = false;
        ui.authBtn.innerHTML = 'Login';
        
        return true;
      } else {
        // Server responded but authentication failed - don't retry
        setAuthStatus(`❌ ${data.error || 'Authentication failed'}`);
        ui.authBtn.disabled = false;
        ui.authBtn.innerHTML = 'Login';
        return false;
      }
      
    } catch (error) {
      console.warn(`Login attempt ${attempt} failed:`, error);
      
      if (attempt === maxRetries) {
        // Final attempt failed
        const errorMsg = error.name === 'AbortError' 
          ? 'Server is taking too long to respond (cold start). Please try again in a few minutes.'
          : `Unable to connect to server: ${error.message}`;
        
        setAuthStatus(`❌ ${errorMsg}`);
        ui.authBtn.disabled = false;
        ui.authBtn.innerHTML = 'Login';
        return false;
      }
      
      // Show retry countdown
      setAuthStatus(`⏳ Server starting up... Retrying in 30 seconds (attempt ${attempt + 1}/${maxRetries})`);
      
      // Update button with countdown
      for (let i = 30; i >= 1; i--) {
        ui.authBtn.innerHTML = `
          <span class="spinner"></span>
          Retrying in ${i}s... (${attempt + 1}/${maxRetries})
        `;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      attempt++;
    }
  }
  
  return false;
}

function showAuthenticatedUI() {
  if (ui.authCard) ui.authCard.style.display = 'none';
  if (ui.resultCard) ui.resultCard.style.display = 'block';
  if (ui.startBtn) ui.startBtn.disabled = false;
}

// Enhanced checkExistingAuth with better error handling
async function checkExistingAuth() {
  const storedToken = localStorage.getItem('raga_auth_token');
  if (storedToken) {
    try {
      // Show checking status
      setAuthStatus('🔍 Verifying existing authentication...');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout for verification
      
      const response = await fetch(`${AUTH_SERVER_URL}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: storedToken }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      const data = await response.json();
      
      if (response.ok && data.valid) {
        authToken = storedToken;
        isAuthenticated = true;
        showAuthenticatedUI();
        setAuthStatus('✅ Welcome back! You are already authenticated.');
        return;
      } else {
        console.warn('Stored token is invalid or expired. Please log in again.');
        localStorage.removeItem('raga_auth_token');
        showAuthUI();
        setAuthStatus('🔑 Please log in again (token expired).');
        return;
      }
    } catch (error) {
      console.error('Failed to verify token with server:', error);
      showAuthUI();
      if (error.name === 'AbortError') {
        setAuthStatus('⚠️ Server verification timed out. Please log in to continue.');
      } else {
        setAuthStatus('⚠️ Could not verify with server. Please log in.');
      }
      return;
    }
  } else {
    // No token found, show the auth UI by default
    showAuthUI();
    setAuthStatus('🔑 Please enter your password to access the raga analyzer.');
  }
}

async function ensureServiceWorker(){ try{ const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1'; if('serviceWorker' in navigator){ if(isLocalhost){ const regs=await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.unregister())); if('caches' in window){ const keys=await caches.keys(); await Promise.all(keys.map(k=>caches.delete(k))); } } else { await navigator.serviceWorker.register(`${document.baseURI.endsWith('/')?document.baseURI.slice(0,-1):document.baseURI}/service-worker.js`.replace(/\/index\.html$/,'')); } } } catch(e){} }

// Audio device enumeration
async function loadAudioDevices() {
  if (!ui.audioSourceSelect) return;
  
  try {
    // Request permission first to get device labels - but catch the error gracefully
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (permissionError) {
      console.log('Microphone permission not granted yet, showing default options');
    }
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(device => device.kind === 'audioinput');
    
    ui.audioSourceSelect.innerHTML = '';
    
    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Default Microphone';
    ui.audioSourceSelect.appendChild(defaultOption);
    
    // Add all audio input devices
    audioInputs.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Microphone ${index + 1}`;
      ui.audioSourceSelect.appendChild(option);
    });
    
    // Restore previously selected device if any
    if (selectedDeviceId) {
      ui.audioSourceSelect.value = selectedDeviceId;
    }
    
    console.log(`Found ${audioInputs.length} audio input device(s)`);
  } catch (error) {
    console.error('Error enumerating audio devices:', error);
    // Don't show error to user if devices can't be enumerated yet
  }
}

// Update UI based on audio mode selection
function updateAudioModeUI() {
  if (!ui.audioSourceSelect || !ui.refreshDevicesBtn) return;
  
  if (audioMode === 'system-audio') {
    // Disable microphone selection when using system audio
    ui.audioSourceSelect.disabled = true;
    ui.refreshDevicesBtn.disabled = true;
    ui.audioSourceSelect.style.opacity = '0.5';
    ui.refreshDevicesBtn.style.opacity = '0.5';
  } else {
    // Enable microphone selection
    ui.audioSourceSelect.disabled = false;
    ui.refreshDevicesBtn.disabled = false;
    ui.audioSourceSelect.style.opacity = '1';
    ui.refreshDevicesBtn.style.opacity = '1';
  }
}

// Enhanced WebSocket connection with better cold start handling
function connectWebSocket(){ 
  if (!isAuthenticated || !authToken) {
    setStatus('Please authenticate first');
    return Promise.reject('Not authenticated');
  }
  
  // Generate a NEW client ID for each connection
  currentClientId = generateUUID();
  console.log('Generated new client ID:', currentClientId);
  
  if(websocket && (websocket.readyState===WebSocket.OPEN || websocket.readyState===WebSocket.CONNECTING)){ 
    return new Promise((resolve)=>{ 
      if(websocket.readyState===WebSocket.OPEN) return resolve(); 
      websocket.addEventListener('open',()=>resolve(),{once:true}); 
    }); 
  }
  
  setStatus('🔌 Connecting to analysis server...');
  
  websocket = new WebSocket(SERVER_URL);
  
  // Add connection timeout
  const connectionTimeout = setTimeout(() => {
    if (websocket.readyState === WebSocket.CONNECTING) {
      websocket.close();
      setStatus('❌ Connection timed out. Please try again.');
    }
  }, 15000); // 15 second connection timeout
  
  websocket.onopen = ()=>{ 
    clearTimeout(connectionTimeout);
    setStatus('🔐 Authenticating with server...'); 
    // Send auth token first
    websocket.send(JSON.stringify({ auth_token: authToken }));
  };
  
  websocket.onmessage = (ev)=>{ 
    try{ 
      const data=JSON.parse(ev.data); 
      if(data.status==='authenticated'){
        setStatus('✅ Connected and ready to analyze');
        // Now that we're authenticated, send the NEW client ID
        websocket.send(JSON.stringify({ client_id: currentClientId })); 
        ui.stopBtn.disabled=false;
        resetNoResultTimer();
      } else if(data.status==='error'){
        setStatus(`❌ Server error: ${data.message}`);
        if(data.message.includes('Authentication')) {
          isAuthenticated = false;
          authToken = null;
          localStorage.removeItem('raga_auth_token');
          showAuthUI();
          setAuthStatus('🔑 Session expired. Please log in again.');
        }
      } else if(data.status==='inference_result'){ 
        resetNoResultTimer(); 
        startRealTimeTimer();
        const prob = typeof data.probability==='number' ? data.probability : Number(data.probability||0); 
        const pct = Math.floor(prob*100); 
        if(currentResult && currentResult.raga){ 
          historyResults.unshift(currentResult); 
          if(historyResults.length>5) historyResults.length=5; 
          renderHistory(); 
        } 
        currentResult={ raga: data.raga??'—', pct: isFinite(pct)?pct:null }; 
        renderCurrent(); 
      } else if(data.status==='accumulating'){ 
        const pct = Number(data.percentage||0).toFixed(2); 
        setStatus(`🎵 Analyzing audio: ${pct}%`); 
      } 
    } catch(_){} 
  };
  
  websocket.onerror=()=>{
    clearTimeout(connectionTimeout);
    setStatus('❌ Connection error occurred');
  }; 
  
  websocket.onclose=()=>{ 
    clearTimeout(connectionTimeout);
    setStatus('🔌 Disconnected from server'); 
    stopRecording(); 
  };
  
  return new Promise((resolve)=>setTimeout(resolve,0));
}

function showAuthUI() {
  if (ui.authCard) ui.authCard.style.display = 'block';
  if (ui.resultCard) ui.resultCard.style.display = 'none';
  if (ui.startBtn) ui.startBtn.disabled = true;
}

function closeWebSocket(){ if(websocket){ try{ websocket.close(); } catch(_){} } }

function convertToMono44100(input, sampleRate, channelCount){
  let mono;
  if(channelCount===1){
    mono=input;
  } else {
    mono=new Float32Array(input.length/channelCount);
    for(let i=0,j=0;i<input.length;i+=channelCount,j++){
      let sum=0;
      for(let c=0;c<channelCount;c++)
        sum+=input[i+c];
      mono[j]=sum/channelCount;
    }
  }
  if(sampleRate===TARGET_SAMPLE_RATE)
    return mono;
  const ratio=TARGET_SAMPLE_RATE/sampleRate;
  const newLength=Math.round(mono.length*ratio);
  const out=new Float32Array(newLength);
  for(let i=0;i<newLength;i++){
    const srcIndex=i/ratio;
    const idx0=Math.floor(srcIndex);
    const idx1=Math.min(idx0+1, mono.length-1);
    const t=srcIndex-idx0;
    out[i]=mono[idx0]*(1-t)+mono[idx1]*t;
  }
  return out;
}

function appendToBuffer(existing, chunk){
  const out=new Float32Array(existing.length+chunk.length);
  out.set(existing,0);
  out.set(chunk, existing.length);
  return out;
}

function flushIfNeeded(){
  const targetSamples = Math.floor(CHUNK_SECONDS*TARGET_SAMPLE_RATE);
  while(buffer441Mono.length>=targetSamples){
    const sendChunk=buffer441Mono.subarray(0,targetSamples);
    const remaining=buffer441Mono.subarray(targetSamples);
    buffer441Mono=new Float32Array(remaining.length);
    buffer441Mono.set(remaining,0);
    if(websocket && websocket.readyState===WebSocket.OPEN){
      const audio_data=float32ToBase64(sendChunk);
      const msg={
        client_id: currentClientId,
        audio_data
        };
      websocket.send(JSON.stringify(msg));
    }
  }
}

async function startRecording(){
  if(sending) return;
  sending=true;
  recordingStartTime = Date.now();
  ui.startBtn.disabled=true;
  ui.stopBtn.disabled=false;
  setStatus('Requesting audio access...');
  
  // Start the absolute recording timer
  armTotalRecordingTimer();
  startRealTimeTimer();
  
  try {
    // Choose audio source based on mode
    if (audioMode === 'system-audio') {
      // Use getDisplayMedia for system audio capture
      await startSystemAudioRecording();
    } else {
      // Use getUserMedia for microphone
      await startMicrophoneRecording();
    }
    
  } catch(e) {
    const modeText = audioMode === 'system-audio' ? 'system audio' : 'microphone';
    setStatus(`Error: ${e.message}. Please allow ${modeText} access.`);
    stopRecording();
  }
}

async function startMicrophoneRecording() {
  // Get the selected device ID
  const deviceId = ui.audioSourceSelect ? ui.audioSourceSelect.value : null;
  selectedDeviceId = deviceId;
  
  // Build audio constraints
  const audioConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  };
  
  // Add device ID if specified
  if (deviceId) {
    audioConstraints.deviceId = { exact: deviceId };
  }
  
  mediaStream = await navigator.mediaDevices.getUserMedia({ 
    audio: audioConstraints, 
    video: false 
  });
  
  await setupAudioProcessing('Microphone');
}

async function startSystemAudioRecording() {
  // Check if getDisplayMedia is supported
  if (!navigator.mediaDevices.getDisplayMedia) {
    throw new Error('System audio capture not supported in this browser. Try Chrome or Edge.');
  }
  
  // Request screen/tab sharing with audio
  mediaStream = await navigator.mediaDevices.getDisplayMedia({
    video: true, // Required by spec, but we'll ignore the video
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      suppressLocalAudioPlayback: false
    }
  });
  
  // Check if audio track exists
  const audioTracks = mediaStream.getAudioTracks();
  if (audioTracks.length === 0) {
    throw new Error('No audio track in the shared content. Make sure to check "Share audio" when selecting.');
  }
  
  // Stop and remove video track since we don't need it
  const videoTracks = mediaStream.getVideoTracks();
  videoTracks.forEach(track => track.stop());
  
  await setupAudioProcessing('System Audio');
}

async function setupAudioProcessing(sourceLabel) {
  audioContext = new (window.AudioContext||window.webkitAudioContext)();
  
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
  
  const source = audioContext.createMediaStreamSource(mediaStream);
  
  try {
    await audioContext.audioWorklet.addModule(`${new URL('worklet-processor.js', document.baseURI)}`);
    processorNode = new AudioWorkletNode(audioContext, 'mic-capture-processor', { numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[1] });
    processorNode.port.onmessage = (event) => {
      if (!sending) return;
      const { samples } = event.data;
      const converted = convertToMono44100(samples, audioContext.sampleRate, 1);
      buffer441Mono = appendToBuffer(buffer441Mono, converted);
      flushIfNeeded();
    };
    source.connect(processorNode);
    processorNode.connect(audioContext.destination);
    setStatus(`Recording from ${sourceLabel} (worklet)`);
    
  } catch(err) {
    console.warn('AudioWorklet failed, falling back to ScriptProcessor.', err);
    const bufferSize = 2048;
    const scriptNode = audioContext.createScriptProcessor(bufferSize, 1, 1);
    processorNode = scriptNode;
    scriptNode.onaudioprocess = (e) => {
      if (!sending) return;
      const input = e.inputBuffer.getChannelData(0);
      const copied = new Float32Array(input.length);
      copied.set(input);
      const converted = convertToMono44100(copied, audioContext.sampleRate, 1);
      buffer441Mono = appendToBuffer(buffer441Mono, converted);
      flushIfNeeded();
    };
    source.connect(scriptNode);
    scriptNode.connect(audioContext.destination);
    setStatus(`Recording from ${sourceLabel} (script)`);
  }
}

function stopRecording(){ 
  if(!sending) return; 
  sending=false; 
  recordingStartTime = null;
  
  setStatus('Stopped'); 
  
  // Clear all timers
  clearAllTimers();
  
  try{ if(processorNode) processorNode.disconnect(); }catch(_){} 
  try{ if(audioContext) audioContext.close(); }catch(_){} 
  processorNode=null; 
  audioContext=null; 
  if(mediaStream){ 
    for(const track of mediaStream.getTracks()) track.stop(); 
    mediaStream=null; 
  } 
  buffer441Mono=new Float32Array(0); 
  if(currentResult && currentResult.raga){ 
    historyResults.unshift(currentResult); 
    if(historyResults.length>5) historyResults.length=5; 
  } 
  currentResult=null; 
  renderCurrent(); 
  renderHistory(); 
  ui.startBtn.disabled=false; 
  ui.stopBtn.disabled=true; 
}

// Inject spinner CSS if it doesn't exist
if (!document.querySelector('style[data-spinner-css]')) {
  const style = document.createElement('style');
  style.setAttribute('data-spinner-css', 'true');
  style.innerHTML = `
.spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid #f3f3f3;
  border-top: 2px solid #333;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-right: 6px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
  `;
  document.head.appendChild(style);
}

async function initUI(){ 
  ui.startBtn=document.getElementById('startBtn'); 
  ui.stopBtn=document.getElementById('stopBtn'); 
  ui.status=document.getElementById('status'); 
  ui.ragaName=document.getElementById('ragaName'); 
  ui.ragaConf=document.getElementById('ragaConf'); 
  ui.historyList=document.getElementById('historyList');
  ui.authCard=document.getElementById('authCard');
  ui.resultCard=document.getElementById('resultCard');
  ui.passwordInput=document.getElementById('passwordInput');
  ui.authBtn=document.getElementById('authBtn');
  ui.authStatus=document.getElementById('authStatus');
  ui.recordingTimer=document.getElementById('recordingTimer');
  ui.ragasBtn=document.getElementById('ragasBtn');
  ui.ragasModal=document.getElementById('ragasModal');
  ui.ragasModalClose=document.getElementById('ragasModalClose');
  ui.ragasSearch=document.getElementById('ragasSearch');
  ui.ragasCount=document.getElementById('ragasCount');
  ui.ragasList=document.getElementById('ragasList');
  ui.audioSourceSelect=document.getElementById('audioSourceSelect');
  ui.refreshDevicesBtn=document.getElementById('refreshDevicesBtn');
  ui.audioModeSelect=document.getElementById('audioModeSelect');
  
  if(!ui.startBtn||!ui.stopBtn||!ui.status||!ui.ragaName||!ui.ragaConf||!ui.historyList){ return; } 
  
  setStatus('🔧 Initializing...'); 
  ui.stopBtn.disabled=true; 
  ui.startBtn.disabled=true;
  
  // Call the enhanced checkExistingAuth function
  await checkExistingAuth();
  
  // Load audio devices after auth check
  if (isAuthenticated && ui.audioSourceSelect) {
    await loadAudioDevices();
  }
  
  if (ui.authBtn && ui.passwordInput) {
    ui.authBtn.addEventListener('click', async ()=>{
      const password = ui.passwordInput.value;
      if (!password.trim()) {
        setAuthStatus('⚠️ Please enter a password');
        ui.passwordInput.focus();
        return;
      }
      
      const success = await loginWithPassword(password);
      if (success) {
        localStorage.setItem('raga_auth_token', authToken);
        ui.passwordInput.value = ''; // Clear password field
        // Load audio devices after successful login
        await loadAudioDevices();
      }
    });
    
    ui.passwordInput.addEventListener('keypress', (e)=>{
      if (e.key === 'Enter') {
        ui.authBtn.click();
      }
    });
    
    // Clear any error messages when user starts typing
    ui.passwordInput.addEventListener('input', ()=>{
      if (ui.authStatus.textContent.includes('❌') || ui.authStatus.textContent.includes('⚠️')) {
        setAuthStatus('');
      }
    });
  }
  
  // Audio mode selection
  if (ui.audioModeSelect) {
    ui.audioModeSelect.addEventListener('change', (e) => {
      audioMode = e.target.value;
      updateAudioModeUI();
      console.log('Audio mode changed to:', audioMode);
      
      // Update status message
      if (audioMode === 'system-audio') {
        setStatus('💻 System audio mode selected. Click start to share a tab/screen with audio.');
      } else {
        setStatus('🎤 Microphone mode selected. Ready to record.');
      }
    });
    
    // Set initial UI state
    updateAudioModeUI();
  }
  
  // Audio device selection listeners
  if (ui.audioSourceSelect) {
    ui.audioSourceSelect.addEventListener('change', (e) => {
      selectedDeviceId = e.target.value;
      console.log('Selected audio device:', selectedDeviceId || 'default');
    });
  }
  
  if (ui.refreshDevicesBtn) {
    ui.refreshDevicesBtn.addEventListener('click', async () => {
      await loadAudioDevices();
      setStatus('🔄 Audio devices refreshed');
    });
  }
  
  ui.startBtn.addEventListener('click', async ()=>{ 
    if (!isAuthenticated) {
      setStatus('⚠️ Please authenticate first');
      return;
    }
    
    try {
      await connectWebSocket();
      await startRecording(); 
      resetNoResultTimer();
    } catch (error) {
      setStatus(`❌ Failed to start: ${error.message || error}`);
    }
  }); 
  
  ui.stopBtn.addEventListener('click', ()=>{ 
    stopRecording(); 
    closeWebSocket(); 
  }); 
  
  // Set initial status
  if (isAuthenticated) {
    setStatus('✅ Ready to analyze ragas');
  } else {
    setStatus('🔑 Please log in to continue');
  }
  
  // Modal event listeners
  if (ui.ragasBtn) {
    ui.ragasBtn.addEventListener('click', openRagasModal);
  }
  
  if (ui.ragasModalClose) {
    ui.ragasModalClose.addEventListener('click', closeRagasModal);
  }
  
  if (ui.ragasModal) {
    // Close modal when clicking outside the content
    ui.ragasModal.addEventListener('click', (e) => {
      if (e.target === ui.ragasModal) {
        closeRagasModal();
      }
    });
    
    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && ui.ragasModal.style.display === 'flex') {
        closeRagasModal();
      }
    });
  }
  
  if (ui.ragasSearch) {
    ui.ragasSearch.addEventListener('input', (e) => {
      renderRagasList(e.target.value);
    });
  }
}

function renderCurrent(){ 
  if(!currentResult||!currentResult.raga||currentResult.pct===null||!isFinite(currentResult.pct)){ 
    ui.ragaName.textContent='—'; 
    ui.ragaConf.textContent='—'; 
  } else { 
    ui.ragaName.textContent=currentResult.raga; 
    ui.ragaConf.textContent=`${currentResult.pct}%`; 
  }
}

function renderHistory(){ 
  if(!ui.historyList) return; 
  ui.historyList.innerHTML=''; 
  for(let i=0;i<Math.min(historyResults.length,5);i++){ 
    const item=historyResults[i]; 
    const row=document.createElement('div'); 
    row.style.display='flex'; 
    row.style.justifyContent='space-between'; 
    row.style.alignItems='center'; 
    row.style.border='1px solid rgba(125,125,125,0.25)'; 
    row.style.borderRadius='8px'; 
    row.style.padding='8px 12px'; 
    const left=document.createElement('div'); 
    left.textContent=item.raga||'—'; 
    left.style.fontWeight='600'; 
    const right=document.createElement('div'); 
    right.textContent=(item.pct!=null && isFinite(item.pct))?`${item.pct}%`:'—'; 
    ui.historyList.appendChild(row); 
    row.appendChild(left); 
    row.appendChild(right); 
  } 
}

// Modal functions
function openRagasModal() {
  if (ui.ragasModal) {
    ui.ragasModal.style.display = 'flex';
    renderRagasList('');
    if (ui.ragasSearch) {
      ui.ragasSearch.focus();
    }
  }
}

function closeRagasModal() {
  if (ui.ragasModal) {
    ui.ragasModal.style.display = 'none';
    if (ui.ragasSearch) {
      ui.ragasSearch.value = '';
    }
  }
}

function renderRagasList(filter) {
  if (!ui.ragasList || !ui.ragasCount) return;
  
  const searchTerm = (filter || '').trim().toLowerCase();
  const filteredRagas = searchTerm 
    ? ragasData.filter(raga => raga.name.toLowerCase().includes(searchTerm))
    : ragasData;
  
  ui.ragasList.innerHTML = '';
  filteredRagas.forEach(raga => {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.textContent = raga.name;
    row.appendChild(cell);
    ui.ragasList.appendChild(row);
  });
  
  ui.ragasCount.textContent = `${filteredRagas.length} of ${ragasData.length}`;
}

(async ()=>{ await ensureServiceWorker(); if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', initUI, { once:true }); } else { initUI(); } })();

window.addEventListener('pagehide', ()=>{ try{ stopRecording(); }catch(_){} try{ closeWebSocket(); }catch(_){} });
window.addEventListener('beforeunload', ()=>{ try{ stopRecording(); }catch(_){} try{ closeWebSocket(); }catch(_){} });
