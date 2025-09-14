// Copied from raga-analysis PWA and adjusted for baseurl paths.
// See original at raga_python/pwa/app.js

const ui = { startBtn: null, stopBtn: null, status: null, ragaName: null, ragaConf: null, historyList: null, authCard: null, resultCard: null, passwordInput: null, authBtn: null, authStatus: null };
const clientId = Math.floor(1000 + Math.random() * 9000);
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

let authToken = null; 
let isAuthenticated = false;

// const AUTH_SERVER_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') 
//   ? 'http://localhost:8765' 
//   : 'https://dxcc8tiege.us-east-2.awsapprunner.com:8765';

const AUTH_SERVER_URL = "https://raga-server-103463628326.asia-south1.run.app"
// const SERVER_URL = (location.hostname==='localhost'||location.hostname==='127.0.0.1') ? 'ws://localhost:8765/ws' : 'wss://dxcc8tiege.us-east-2.awsapprunner.com:8765/ws';
const SERVER_URL = "wss://raga-server-103463628326.asia-south1.run.app/ws";

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
}

function clearNoResultTimer(){ 
  if(noResultTimerId != null){ 
    clearTimeout(noResultTimerId); 
    noResultTimerId = null; 
  } 
}

function armNoResultTimer(){ 
  clearNoResultTimer(); 
  noResultTimerId = setTimeout(() => { 
    setStatus('Sorry, connection timed out. Please start a new recording'); 
    try { stopRecording(); } catch(_) {} 
    try { closeWebSocket(); } catch(_) {} 
  }, MAX_NO_RESULT_MS); 
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

function resetNoResultTimer(){ 
  if(sending || (websocket && websocket.readyState === WebSocket.OPEN)){ 
    armNoResultTimer(); 
  } else { 
    clearNoResultTimer(); 
  } 
}

const TARGET_SAMPLE_RATE = 44100; const CHUNK_SECONDS = 4.0; let buffer441Mono = new Float32Array(0);
function setStatus(t){ ui.status.textContent=t; }
function setAuthStatus(t){ if(ui.authStatus) ui.authStatus.textContent=t; }
function float32ToBase64(arr){ const bytes=new Uint8Array(arr.buffer); let binary=''; const chunk=0x8000; for(let i=0;i<bytes.length;i+=chunk){ const sub=bytes.subarray(i,i+chunk); binary+=String.fromCharCode.apply(null, sub);} return btoa(binary); }

async function loginWithPassword(password) {
  try {
    const response = await fetch(`${AUTH_SERVER_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.trim() })
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      authToken = data.token;
      isAuthenticated = true;
      showAuthenticatedUI();
      setAuthStatus(`Access granted! Token expires in ${data.expires_in_hours} hours.`);
      return true;
    } else {
      setAuthStatus(`Error: ${data.error || 'Authentication failed'}`);
      return false;
    }
  } catch (error) {
    setAuthStatus(`Error: Unable to connect to server. ${error.message}`);
    return false;
  }
}

function showAuthenticatedUI() {
  if (ui.authCard) ui.authCard.style.display = 'none';
  if (ui.resultCard) ui.resultCard.style.display = 'block';
  if (ui.startBtn) ui.startBtn.disabled = false;
}

async function checkExistingAuth() {
  const storedToken = localStorage.getItem('raga_auth_token');
  if (storedToken) {
    try {
      const response = await fetch(`${AUTH_SERVER_URL}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: storedToken })
      });
      
      const data = await response.json();
      
      if (response.ok && data.valid) {
        authToken = storedToken;
        isAuthenticated = true;
        showAuthenticatedUI();
        setAuthStatus('Welcome back! You are already authenticated.');
      } else {
        console.warn('Stored token is invalid or expired. Please log in again.');
        localStorage.removeItem('raga_auth_token');
        showAuthUI();
      }
    } catch (error) {
      console.error('Failed to verify token with server:', error);
      // Assume offline or server issue, prompt for login
      showAuthUI();
      setAuthStatus('Could not verify token with server. Please log in.');
    }
  } else {
    // No token found, show the auth UI by default
    showAuthUI();
  }
}

async function ensureServiceWorker(){ try{ const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1'; if('serviceWorker' in navigator){ if(isLocalhost){ const regs=await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.unregister())); if('caches' in window){ const keys=await caches.keys(); await Promise.all(keys.map(k=>caches.delete(k))); } } else { await navigator.serviceWorker.register(`${document.baseURI.endsWith('/')?document.baseURI.slice(0,-1):document.baseURI}/service-worker.js`.replace(/\/index\.html$/,'')); } } } catch(e){} }

function connectWebSocket(){ 
  if (!isAuthenticated || !authToken) {
    setStatus('Please authenticate first');
    return Promise.reject('Not authenticated');
  }
  
  if(websocket && (websocket.readyState===WebSocket.OPEN || websocket.readyState===WebSocket.CONNECTING)){ 
    return new Promise((resolve)=>{ if(websocket.readyState===WebSocket.OPEN) return resolve(); websocket.addEventListener('open',()=>resolve(),{once:true}); }); 
  }
  
  websocket = new WebSocket(SERVER_URL);
  websocket.onopen = ()=>{ 
    setStatus('Connected'); 
    // Send auth token first
    websocket.send(JSON.stringify({ auth_token: authToken }));
  };
  websocket.onmessage = (ev)=>{ 
    try{ 
      const data=JSON.parse(ev.data); 
      if(data.status==='authenticated'){
        setStatus('Authenticated and ready');
        // Now that we're authenticated, send the client ID
        websocket.send(JSON.stringify({ client_id: clientId })); 
        ui.stopBtn.disabled=false;
        resetNoResultTimer();
      } else if(data.status==='error'){
        setStatus(`Error: ${data.message}`);
        if(data.message.includes('Authentication')) {
          isAuthenticated = false;
          authToken = null;
          localStorage.removeItem('raga_auth_token');
          showAuthUI();
        }
      } else if(data.status==='inference_result'){ 
        resetNoResultTimer(); 
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
        setStatus(`Accumulating: ${pct}%`); 
      } 
    } catch(_){} 
  };
  websocket.onerror=()=>{}; 
  websocket.onclose=()=>{ setStatus('Disconnected'); stopRecording(); };
  return new Promise((resolve)=>setTimeout(resolve,0));
}

function showAuthUI() {
  if (ui.authCard) ui.authCard.style.display = 'block';
  if (ui.resultCard) ui.resultCard.style.display = 'none';
  if (ui.startBtn) ui.startBtn.disabled = true;
}

function closeWebSocket(){ if(websocket){ try{ websocket.close(); } catch(_){} } }

function convertToMono44100(input, sampleRate, channelCount){ let mono; if(channelCount===1){ mono=input; } else { mono=new Float32Array(input.length/channelCount); for(let i=0,j=0;i<input.length;i+=channelCount,j++){ let sum=0; for(let c=0;c<channelCount;c++) sum+=input[i+c]; mono[j]=sum/channelCount; } } if(sampleRate===TARGET_SAMPLE_RATE) return mono; const ratio=TARGET_SAMPLE_RATE/sampleRate; const newLength=Math.round(mono.length*ratio); const out=new Float32Array(newLength); for(let i=0;i<newLength;i++){ const srcIndex=i/ratio; const idx0=Math.floor(srcIndex); const idx1=Math.min(idx0+1, mono.length-1); const t=srcIndex-idx0; out[i]=mono[idx0]*(1-t)+mono[idx1]*t; } return out; }
function appendToBuffer(existing, chunk){ const out=new Float32Array(existing.length+chunk.length); out.set(existing,0); out.set(chunk, existing.length); return out; }
function flushIfNeeded(){ const targetSamples=Math.floor(CHUNK_SECONDS*TARGET_SAMPLE_RATE); while(buffer441Mono.length>=targetSamples){ const sendChunk=buffer441Mono.subarray(0,targetSamples); const remaining=buffer441Mono.subarray(targetSamples); buffer441Mono=new Float32Array(remaining.length); buffer441Mono.set(remaining,0); if(websocket && websocket.readyState===WebSocket.OPEN){ const audio_data=float32ToBase64(sendChunk); const msg={ client_id: clientId, audio_data }; websocket.send(JSON.stringify(msg)); } } }

async function startRecording(){
  if(sending) return;
  sending=true;
  recordingStartTime = Date.now(); // Track start time
  ui.startBtn.disabled=true;
  ui.stopBtn.disabled=false;
  setStatus('Requesting microphone...');
  
  // Start the absolute recording timer
  armTotalRecordingTimer();
  
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ 
      audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false }, 
      video:false 
    });
    
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
      setStatus('Recording (worklet)');
      
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
      setStatus('Recording (script)');
    }
    
  } catch(e) {
    setStatus(`Error: ${e.message}. Please allow microphone access.`);
    stopRecording();
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
  
  if(!ui.startBtn||!ui.stopBtn||!ui.status||!ui.ragaName||!ui.ragaConf||!ui.historyList){ return; } 
  
  setStatus('Idle'); 
  ui.stopBtn.disabled=true; 
  ui.startBtn.disabled=true;
  
  // Call the new, async checkExistingAuth function here
  await checkExistingAuth();
  
  if (ui.authBtn && ui.passwordInput) {
    ui.authBtn.addEventListener('click', async ()=>{
      const password = ui.passwordInput.value;
      if (!password.trim()) {
        setAuthStatus('Please enter a password');
        return;
      }
      ui.authBtn.disabled = true;
      ui.authBtn.textContent = 'Logging in...';
      const success = await loginWithPassword(password);
      ui.authBtn.disabled = false;
      ui.authBtn.textContent = 'Login';
      if (success) {
        localStorage.setItem('raga_auth_token', authToken);
      }
    });
    
    ui.passwordInput.addEventListener('keypress', (e)=>{
      if (e.key === 'Enter') {
        ui.authBtn.click();
      }
    });
  }
  
  ui.startBtn.addEventListener('click', async ()=>{ 
    if (!isAuthenticated) {
      setStatus('Please authenticate first');
      return;
    }
    await connectWebSocket();
    await startRecording(); 
    resetNoResultTimer(); 
  }); 
  ui.stopBtn.addEventListener('click', ()=>{ stopRecording(); closeWebSocket(); }); 
}


function renderCurrent(){ if(!currentResult||!currentResult.raga||currentResult.pct===null||!isFinite(currentResult.pct)){ ui.ragaName.textContent='—'; ui.ragaConf.textContent='—'; } else { ui.ragaName.textContent=currentResult.raga; ui.ragaConf.textContent=`${currentResult.pct}%`; } }
function renderHistory(){ if(!ui.historyList) return; ui.historyList.innerHTML=''; for(let i=0;i<Math.min(historyResults.length,5);i++){ const item=historyResults[i]; const row=document.createElement('div'); row.style.display='flex'; row.style.justifyContent='space-between'; row.style.alignItems='center'; row.style.border='1px solid rgba(125,125,125,0.25)'; row.style.borderRadius='8px'; row.style.padding='8px 12px'; const left=document.createElement('div'); left.textContent=item.raga||'—'; left.style.fontWeight='600'; const right=document.createElement('div'); right.textContent=(item.pct!=null && isFinite(item.pct))?`${item.pct}%`:'—'; ui.historyList.appendChild(row); row.appendChild(left); row.appendChild(right); } }

(async ()=>{ await ensureServiceWorker(); if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', initUI, { once:true }); } else { initUI(); } })();
window.addEventListener('pagehide', ()=>{ try{ stopRecording(); }catch(_){} try{ closeWebSocket(); }catch(_){} });
window.addEventListener('beforeunload', ()=>{ try{ stopRecording(); }catch(_){} try{ closeWebSocket(); }catch(_){} });