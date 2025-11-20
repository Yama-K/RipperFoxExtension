const apiBase = "http://localhost:5100/api";
let lastState = "idle";
const action = browser.action || browser.browserAction;

// ----------------------------------------------------
// Context Menu
// ----------------------------------------------------
browser.contextMenus.removeAll().then(() => {
  browser.contextMenus.create({
    id: "ripperfox-download",
    title: "RipperFox Download",
    contexts: ["link", "video", "image", "page"]
  });
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    let url = info.linkUrl || info.srcUrl || tab.url;
    if (!url) {
      console.warn("[yt-dlp] No valid URL found in context click");
      return;
    }

    // Handle thumbnails linking to post pages
    if (info.mediaType === "image" && info.linkUrl) {
      console.log("[yt-dlp] Thumbnail detected — using linked post URL:", info.linkUrl);
      url = info.linkUrl;
    }

    const mediaType = detectMediaType(url);
    console.log(`[yt-dlp] Context click → ${url} (${mediaType})`);

    // Show immediate working state
    setEmoji("⚙️", "RipperFox: Starting download...");
    
    const response = await fetch(`${apiBase}/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, mediaType })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Show download started notification
    sendStateNotification("active", 1);
    
  } catch (err) {
    console.error("[yt-dlp] Context menu request failed:", err);
    setEmoji("❌", "RipperFox: Error");
    sendStateNotification("error", 0);
    
    // Reset to idle after error after a delay
    setTimeout(() => {
      if (lastState === "error") {
        lastState = "idle";
        updateEmoji("idle");
      }
    }, 3000);
  }
});

function detectMediaType(url) {
  const lower = url.toLowerCase();
  if (lower.endsWith(".gif")) return "gif";
  if (lower.endsWith(".gifv")) return "gifv";
  if (lower.endsWith(".mp4") || lower.endsWith(".webm")) return "video";
  return "video";
}

// ----------------------------------------------------
// Emoji Icon Poller (fixed state management)
// ----------------------------------------------------
async function checkDownloads() {
  try {
    const res = await fetch(`${apiBase}/status`);
    const jobs = await res.json();
    const jobEntries = Object.values(jobs);
    
    // If no jobs, always show idle
    if (jobEntries.length === 0) {
      if (lastState !== "idle") {
        lastState = "idle";
        updateEmoji("idle");
      }
      return;
    }

    let newState = "idle";
    let hasRunning = false;
    let hasError = false;
    let hasCompleted = false;

    jobEntries.forEach(job => {
      const status = (job.status || "").toLowerCase();
      if (status.includes("running") || status.includes("starting")) {
        hasRunning = true;
      } else if (status.includes("error") || status.includes("failed")) {
        hasError = true;
      } else if (status.includes("completed") || status.includes("finished")) {
        hasCompleted = true;
      }
    });

    // Priority: error > running > completed > idle
    if (hasError) {
      newState = "error";
    } else if (hasRunning) {
      newState = "active";
    } else if (hasCompleted) {
      newState = "done";
    } else {
      newState = "idle";
    }

    if (newState !== lastState) {
      console.log(`[yt-dlp] State change: ${lastState} → ${newState}`);
      lastState = newState;
      updateEmoji(newState);
      
      // Send notifications for state changes
      sendStateNotification(newState, jobEntries.length);
    }
  } catch (err) {
    console.error("[yt-dlp] Poll failed:", err);
    if (lastState !== "error") {
      lastState = "error";
      updateEmoji("error");
    }
  }
}

// Add notification function
function sendStateNotification(state, jobCount) {
  if (!browser.notifications) return;
  
  // Check if notifications are enabled
  let notificationsEnabled = true;
  try {
    notificationsEnabled = localStorage.getItem('showToasts') !== 'false';
  } catch (e) {
    // If we can't access localStorage, default to enabled
    console.log("[yt-dlp] Could not access toast preferences, defaulting to enabled");
  }
  
  if (!notificationsEnabled) return;
  
  switch (state) {
    case "active":
      browser.notifications.create({
        type: "basic",
        iconUrl: "icon.png",
        title: "RipperFox",
        message: `Download started (${jobCount} job${jobCount > 1 ? 's' : ''})`
      });
      break;
    case "done":
      browser.notifications.create({
        type: "basic",
        iconUrl: "icon.png",
        title: "RipperFox",
        message: `Download${jobCount > 1 ? 's' : ''} completed`
      });
      break;
    case "error":
      browser.notifications.create({
        type: "basic",
        iconUrl: "icon.png",
        title: "RipperFox",
        message: "Download error occurred"
      });
      break;
  }
}

function updateEmoji(state) {
  let emoji = "💤";
  let title = "RipperFox: Idle";

  switch (state) {
    case "active":
      emoji = "⚙️";
      title = "RipperFox: Downloading...";
      break;
    case "error":
      emoji = "❌";
      title = "RipperFox: Error";
      break;
    case "done":
      emoji = "✅";
      title = "RipperFox: Done";
      break;
  }

  setEmoji(emoji, title);
}

function setEmoji(emoji, title) {
  if (action.setBadgeText) {
    action.setBadgeText({ text: emoji });
    action.setBadgeBackgroundColor?.({ color: "#2b2b2b" });
  }
  action.setTitle({ title });
}

// Add reset mechanism for stuck states
function resetStuckState() {
  if (lastState === "active") {
    // If we've been in active state for too long, force recheck
    console.log("[yt-dlp] Resetting potentially stuck state");
    checkDownloads();
  }
}

// ----------------------------------------------------
// Poll Loop (minimal, low overhead)
// ----------------------------------------------------
setInterval(checkDownloads, 2000);
// Additional reset for stuck states every 30 seconds
setInterval(resetStuckState, 30000);
updateEmoji("idle");
checkDownloads();