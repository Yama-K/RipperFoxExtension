const API = "http://localhost:5100/api";
let SETTINGS = {};
let previousStatuses = {};

// ---------- tiny utils ----------
const $ = s => document.querySelector(s);
function toast(msg, ok=true){
  if (!$("#showToasts") || !$("#showToasts").checked) return;
  const el = $("#toast");
  el.textContent = msg;
  el.style.borderLeftColor = ok ? "#4caf50" : "#f44336";
  el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"), 2000);
}

// ---------- tabs ----------
function initTabs(){
  const dBtn = $("#tab-downloads");
  const sBtn = $("#tab-settings");
  const dTab = $("#downloads");
  const sTab = $("#settings");
  dBtn.onclick = ()=>{ dBtn.classList.add("active"); sBtn.classList.remove("active"); dTab.classList.add("active"); sTab.classList.remove("active"); };
  sBtn.onclick = ()=>{ sBtn.classList.add("active"); dBtn.classList.remove("active"); sTab.classList.add("active"); dTab.classList.remove("active"); };
}

// ---------- settings load/save ----------
async function loadSettings(){
  try{
    const res = await fetch(`${API}/settings`);
    SETTINGS = await res.json();
    renderSettings(SETTINGS);
    $("#settingsError").style.display = "none";
    
    // Save toast preference to localStorage for background script
    localStorage.setItem('showToasts', SETTINGS.show_toasts !== false);
  }catch(e){
    console.error("[yt-dlp] settings fetch failed", e);
    const box = $("#settingsError");
    box.textContent = "Could not load settings. Is backend running?";
    box.style.display = "";
  }
}

function renderSettings(s){
  $("#genPath").value   = s.yt_dlp_path ?? "yt-dlp";
  $("#genOutput").value = s.default_dir ?? "";
  $("#genArgs").value   = s.default_args ?? "";
  $("#showToasts").checked = s.show_toasts ?? true;
  renderSites(s.download_dirs || {});
}

async function saveGeneral(){
  SETTINGS.yt_dlp_path  = $("#genPath").value.trim() || "yt-dlp";
  SETTINGS.default_dir  = $("#genOutput").value.trim();
  SETTINGS.default_args = $("#genArgs").value.trim();
  SETTINGS.show_toasts  = $("#showToasts").checked;
  
  try{
    await fetch(`${API}/settings`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(SETTINGS)
    });
    
    // Update localStorage for background script access
    localStorage.setItem('showToasts', SETTINGS.show_toasts);
    
    toast("Settings saved");
  }catch(e){
    console.error("[yt-dlp] save general failed", e);
    toast("Failed to save", false);
  }
}
$("#saveGeneral").onclick = saveGeneral;

// ---------- per-site (simple add/edit) ----------
function renderSites(map){
  const wrap = $("#sites");
  wrap.innerHTML = "";
  const entries = Object.entries(map);
  if (!entries.length){
    wrap.innerHTML = `<div class="muted">No sites configured yet.</div>`;
    return;
  }
  for (const [pattern, conf] of entries){
    const card = document.createElement("div");
    card.className = "site";
    card.innerHTML = `
      <div class="field-label">Site pattern(s)</div>
      <input class="pattern" value="${pattern}">
      <div class="field-label">Directory</div>
      <input class="dir" value="${conf.dir ?? ""}">
      <div class="field-label">Extra args</div>
      <textarea class="args">${conf.args ?? ""}</textarea>
      <div class="row">
        <button class="save grow">Save</button>
        <button class="del" style="background:#7b1e1e">Delete</button>
      </div>
    `;
    const f = {
      pattern: card.querySelector(".pattern"),
      dir:     card.querySelector(".dir"),
      args:    card.querySelector(".args"),
      save:    card.querySelector(".save"),
      del:     card.querySelector(".del"),
    };

    f.save.onclick = async ()=>{
      const oldKey = pattern;
      const newKey = f.pattern.value.trim() || oldKey;
      if (newKey !== oldKey) delete SETTINGS.download_dirs[oldKey];
      SETTINGS.download_dirs[newKey] = { dir:f.dir.value.trim(), args:f.args.value.trim() };
      await fetch(`${API}/settings`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify(SETTINGS)
      });
      toast("Site saved");
      renderSites(SETTINGS.download_dirs);
    };

    f.del.onclick = async ()=>{
      delete SETTINGS.download_dirs[pattern];
      await fetch(`${API}/settings`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify(SETTINGS)
      });
      toast("Site deleted");
      renderSites(SETTINGS.download_dirs);
    };

    wrap.appendChild(card);
  }
}

$("#saveSite").onclick = async ()=>{
  const pattern = $("#sitePattern").value.trim();
  if (!pattern){ toast("Pattern missing", false); return; }
  const dir = $("#siteDir").value.trim();
  const args = $("#siteArgs").value.trim();
  if (!SETTINGS.download_dirs) SETTINGS.download_dirs = {};
  SETTINGS.download_dirs[pattern] = { dir, args };
  await fetch(`${API}/settings`, {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify(SETTINGS)
  });
  toast("Site saved");
  renderSites(SETTINGS.download_dirs);
};

// ---------- downloads ----------
function parseStatusAndProgress(job) {
  const status = (job.status || "").toLowerCase();
  let statusType = "idle";
  let progress = 0;
  let progressText = "";

  if (status.includes("error") || status.includes("failed")) {
    statusType = "error";
  } else if (status.includes("recod")) {
    statusType = "recoding";
    const match = status.match(/recod[^%]*(\d+(?:\.\d+)?%)/i);
    if (match) {
      progress = parseFloat(match[1]);
      progressText = `Recoding: ${progress}%`;
    } else {
      progressText = "Recoding video...";
    }
  } else if (status.includes("download")) {
    statusType = "downloading";
    const match = status.match(/(\d+(?:\.\d+)?%)/);
    if (match) {
      progress = parseFloat(match[1]);
      progressText = `Downloading: ${progress}%`;
    } else {
      progressText = "Downloading...";
    }
  } else if (status.includes("complet") || status.includes("done") || status.includes("finish")) {
    statusType = "done";
    progressText = "Done";
  } else if (status.includes("run") || status.includes("start")) {
    statusType = "downloading";
    progressText = "Starting...";
  }

  return { statusType, progress, progressText };
}

async function pollStatus(){
  const stateEl = $("#jobsState");
  const listEl  = $("#jobList");
  try{
    const res = await fetch(`${API}/status`);
    const jobs = await res.json();
    const items = Object.entries(jobs);
    listEl.innerHTML = "";

    if (!items.length){
      stateEl.textContent = "Idle";
      previousStatuses = {};
      return;
    }
    stateEl.textContent = "";

    // newest first (keys are epoch ms)
    items.sort((a,b)=> (parseInt(b[0])||0) - (parseInt(a[0])||0));

    for (const [id, job] of items){
      const div = document.createElement("div");
      const { statusType, progress, progressText } = parseStatusAndProgress(job);
      div.className = "job " + (statusType === "error" ? "err" : statusType === "downloading" || statusType === "recoding" ? "run" : "ok");
      
      const progressBar = progress > 0 ? `
        <div class="progress-container">
          <div class="progress-bar" style="width: ${Math.min(progress, 100)}%"></div>
        </div>
        <div class="progress-text">${progressText}</div>
      ` : "";

      const actionButtons = statusType === "done" ? `
        <div class="job-buttons">
          <button class="job-button open-file" data-job-id="${id}" data-file-path="${job.file_path || ""}">Open File</button>
          <button class="job-button show-dir" data-job-id="${id}" data-dir-path="${job.dir || ""}">Show in Directory</button>
        </div>
      ` : "";

      div.innerHTML = `
        <div class="job-header">
          <b>${job.site || "Unknown site"}</b>
          <span class="job-status-badge ${statusType}">${statusType === "downloading" ? "Downloading" : statusType === "recoding" ? "Recoding" : statusType === "done" ? "Done" : statusType === "error" ? "Error" : "Processing"}</span>
        </div>
        <small class="muted">${job.url || ""}</small>
        ${progressBar}
        <small class="muted">Directory: ${job.dir || ""}</small>
        ${statusType === "error" ? `<div style="color:#ffb3b3;margin-top:6px;font-size:11px">${job.status}</div>` : ""}
        ${actionButtons}
      `;

      listEl.appendChild(div);
      
      // Attach event listeners AFTER appending to DOM
      const openFileBtn = div.querySelector(".open-file");
      const showDirBtn = div.querySelector(".show-dir");
      
      if (openFileBtn) {
        console.log(`[yt-dlp] Attaching click handler to open file button for job ${id}`);
        openFileBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log(`[yt-dlp] Open file button clicked for ${job.file_path}`);
          openFile(id, job.file_path);
        });
      } else {
        console.warn(`[yt-dlp] Could not find open file button for job ${id}`);
      }
      
      if (showDirBtn) {
        console.log(`[yt-dlp] Attaching click handler to show directory button for job ${id}`);
        showDirBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log(`[yt-dlp] Show directory button clicked for ${job.dir}`);
          showInDirectory(id, job.dir);
        });
      } else {
        console.warn(`[yt-dlp] Could not find show directory button for job ${id}`);
      }
      previousStatuses[id] = job.status;
    }
  }catch(e){
    console.error("[yt-dlp] jobs fetch failed", e);
    stateEl.textContent = "Backend unreachable";
    listEl.innerHTML = "";
  }
}

async function openFile(jobId, filePath) {
  if (!filePath) {
    toast("File path not available", false);
    return;
  }
  try {
    console.log(`[yt-dlp] Requesting to open file: ${filePath}`);
    const response = await browser.runtime.sendMessage({
      type: "open-file",
      filePath: filePath
    });
    
    if (response && response.error) {
      console.error(`[yt-dlp] Error response:`, response.error);
      toast(`Failed: ${response.error}`, false);
    } else if (response && response.success) {
      toast("Opening file...");
    } else {
      console.warn(`[yt-dlp] Unexpected response:`, response);
      toast("Opening file...");
    }
  } catch (e) {
    console.error("[yt-dlp] open file failed", e);
    toast(`Error: ${e.message}`, false);
  }
}

async function showInDirectory(jobId, dirPath) {
  if (!dirPath) {
    toast("Directory path not available", false);
    return;
  }
  try {
    console.log(`[yt-dlp] Requesting to show directory: ${dirPath}`);
    const response = await browser.runtime.sendMessage({
      type: "show-directory",
      dirPath: dirPath
    });
    
    if (response && response.error) {
      console.error(`[yt-dlp] Error response:`, response.error);
      toast(`Failed: ${response.error}`, false);
    } else if (response && response.success) {
      toast("Opening directory...");
    } else {
      console.warn(`[yt-dlp] Unexpected response:`, response);
      toast("Opening directory...");
    }
  } catch (e) {
    console.error("[yt-dlp] show directory failed", e);
    toast(`Error: ${e.message}`, false);
  }
}

$("#clearDownloads").onclick = async ()=>{
  try{
    const res = await fetch(`${API}/status`, { method:"DELETE" });
    if (res.ok){
      $("#jobList").innerHTML = "";
      $("#jobsState").textContent = "Cleared.";
      toast("Cleared downloads");
    }
  }catch(e){
    console.error("[yt-dlp] clear failed", e);
  }
};

// ---------- boot ----------
document.addEventListener("DOMContentLoaded", ()=>{
  initTabs();
  // draw immediately
  $("#jobsState").textContent = "Idle";
  $("#jobList").innerHTML = "";
  // load data
  loadSettings();
  pollStatus();                 // first fetch right away
  setInterval(pollStatus, 3000);
});