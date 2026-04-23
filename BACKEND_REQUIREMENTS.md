# Backend Integration Requirements

This document outlines the changes needed in the RipperFox backend to support the new UI features in the Firefox extension.

## Job Status Response Format

The `/api/status` endpoint should return job objects with the following enhanced structure:

```json
{
  "job_id_timestamp": {
    "site": "example.com",
    "url": "https://example.com/video.mp4",
    "status": "Downloading 45%",
    "dir": "/home/user/downloads",
    "file_path": "/home/user/downloads/video.mp4",
    "created_at": 1234567890
  }
}
```

### Key Fields:
- **status** (string): Current job status with progress information
  - "Downloading 45%" - Shows download progress with percentage
  - "Recoding video 30%" - Shows video recoding/encoding progress
  - "Completed" or "Done" - Indicates successful completion
  - "Error: <error_message>" - Error information

- **file_path** (string, optional): Full path to the downloaded/processed file
  - Include this only when the file is ready (download completed)
  - Required for "Open File" button to work

## New API Endpoints

### POST /api/open-file
Opens a file with the system's default application.

**Request:**
```json
{
  "file_path": "/home/user/downloads/video.mp4"
}
```

**Response:**
```json
{
  "success": true
}
```

**Implementation Notes:**
- **Windows**: Use `subprocess` to run `start "" "file_path"`
- **Linux**: Use `subprocess` to run `xdg-open "file_path"`
- **macOS**: Use `subprocess` to run `open "file_path"`

### POST /api/show-directory
Opens a directory in the system's file explorer and optionally selects a file.

**Request:**
```json
{
  "dir_path": "/home/user/downloads"
}
```

**Response:**
```json
{
  "success": true
}
```

**Implementation Notes:**
- **Windows**: Use `subprocess` to run `explorer.exe /select,"file_path"` if file available, else just `explorer.exe "dir_path"`
- **Linux**: Use `subprocess` to run `xdg-open "dir_path"`
- **macOS**: Use `subprocess` to run `open "dir_path"`

## Status Format Best Practices

When updating job status, use these formats for better UI representation:

1. **Initial state**: "Starting..."
2. **Downloading**: "Downloading 0%" → "Downloading 50%" → "Downloading 100%"
3. **Processing/Recoding**: "Recoding video 0%" → "Recoding video 75%" → "Recoding video 100%"
4. **Completion**: "Completed" or "Done"
5. **Error**: "Error: <specific error message>"

The frontend parser (`parseStatusAndProgress()` in popup.js) looks for:
- Percentage signs (%) to extract progress
- Keywords: "download", "recod", "complet", "done", "finish", "error", "failed"

## Example Implementation (Python Backend)

```python
import subprocess
import platform
import os

@app.post("/api/open-file")
def open_file(request):
    file_path = request.json.get("file_path")
    
    try:
        system = platform.system()
        if system == "Windows":
            os.startfile(file_path)
        elif system == "Darwin":  # macOS
            subprocess.Popen(["open", file_path])
        else:  # Linux
            subprocess.Popen(["xdg-open", file_path])
        return {"success": True}
    except Exception as e:
        return {"error": str(e)}, 500

@app.post("/api/show-directory")
def show_directory(request):
    dir_path = request.json.get("dir_path")
    
    try:
        system = platform.system()
        if system == "Windows":
            subprocess.Popen(["explorer.exe", dir_path])
        elif system == "Darwin":  # macOS
            subprocess.Popen(["open", dir_path])
        else:  # Linux
            subprocess.Popen(["xdg-open", dir_path])
        return {"success": True}
    except Exception as e:
        return {"error": str(e)}, 500
```

## Frontend Features Enabled

Once these backend changes are implemented, the Firefox extension will have:

1. ✅ **Progress Bars**: Visual progress indicators for downloads and recoding
2. ✅ **Status Badges**: Clear status indicators (Downloading, Recoding, Done, Error)
3. ✅ **Open File Button**: Opens completed files with default application
4. ✅ **Show in Directory Button**: Opens file explorer/directory
5. ✅ **Error Display**: Shows error messages in job cards
6. ✅ **Responsive UI**: Buttons only appear when jobs are completed

## Testing Checklist

- [ ] Job status updates reflect progress correctly
- [ ] Progress bars show for downloads
- [ ] Progress bars show for video recoding
- [ ] "Open File" button opens files successfully
- [ ] "Show in Directory" button opens explorer/file manager
- [ ] Status indicators display correct badges (Downloading/Recoding/Done)
- [ ] Error messages display in the UI
- [ ] Buttons disappear when job is not completed
- [ ] Test on Windows
- [ ] Test on Linux
- [ ] Test on macOS (if available)
