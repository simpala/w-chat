package main

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// GitHubRelease represents a single release from the GitHub API.
type GitHubRelease struct {
	TagName string  `json:"tag_name"`
	Name    string  `json:"name"`
	Assets  []Asset `json:"assets"`
}

// Asset represents a single downloadable asset within a GitHub release.
type Asset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
	HumanSize          string `json:"human_size"` // Added for frontend convenience
}

// --- Llama.cpp Updater ---

// FetchLlamaCppReleases fetches the latest releases for llama.cpp from GitHub.
func (a *App) FetchLlamaCppReleases() ([]GitHubRelease, error) {
	const url = "https://api.github.com/repos/ggerganov/llama.cpp/releases"
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "local-llm-chat-updater")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	var releases []GitHubRelease
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return nil, err
	}

	var filteredReleases []GitHubRelease
	for _, release := range releases {
		if len(release.Assets) > 0 {
			for i := range release.Assets {
				release.Assets[i].HumanSize = humanizeSize(release.Assets[i].Size)
			}
			filteredReleases = append(filteredReleases, release)
		}
	}

	if len(filteredReleases) > 5 {
		filteredReleases = filteredReleases[:5]
	}

	return filteredReleases, nil
}

// DownloadLlamaCppAsset downloads and extracts a chosen llama.cpp asset.
func (a *App) DownloadLlamaCppAsset(assetURL, assetName, tagName string) {
	go func() {
		downloadPath := filepath.Join(os.TempDir(), assetName)
		if err := a.downloadFileWithProgress(assetURL, downloadPath); err != nil {
			wailsruntime.LogErrorf(a.ctx, "Download failed: %v", err)
			a.emitDownloadError(err.Error())
			return
		}

		exePath, err := os.Executable()
		if err != nil {
			wailsruntime.LogErrorf(a.ctx, "Could not get executable path: %v", err)
			a.emitDownloadError(err.Error())
			return
		}
		appDir := filepath.Dir(exePath)
		destDir := filepath.Join(appDir, fmt.Sprintf("llama.cpp_%s", tagName))

		if err := unzipFile(downloadPath, destDir); err != nil {
			wailsruntime.LogErrorf(a.ctx, "Extraction failed: %v", err)
			a.emitDownloadError(err.Error())
			return
		}

		_ = os.Remove(downloadPath)

		currentSettings, err := a.LoadSettings()
		if err != nil {
			wailsruntime.LogErrorf(a.ctx, "Failed to load settings before update: %v", err)
			a.emitDownloadError("Failed to load settings before update.")
			return
		}

		var config Config
		if err := json.Unmarshal([]byte(currentSettings), &config); err != nil {
			wailsruntime.LogErrorf(a.ctx, "Failed to unmarshal settings for update: %v", err)
			a.emitDownloadError("Failed to parse settings for update.")
			return
		}

		config.LlamaCppDir = destDir

		updatedSettings, err := json.Marshal(config)
		if err != nil {
			wailsruntime.LogErrorf(a.ctx, "Failed to marshal settings for saving: %v", err)
			a.emitDownloadError("Failed to prepare settings for saving.")
			return
		}

		if err := a.SaveSettings(string(updatedSettings)); err != nil {
			wailsruntime.LogErrorf(a.ctx, "Failed to save updated settings: %v", err)
			a.emitDownloadError("Failed to save updated settings.")
			return
		}

		wailsruntime.EventsEmit(a.ctx, "llama-cpp-download-complete", destDir)
	}()
}

func (a *App) downloadFileWithProgress(url, filepath string) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("bad status: %s", resp.Status)
	}

	out, err := os.Create(filepath)
	if err != nil {
		return err
	}
	defer out.Close()

	totalSize := resp.ContentLength
	var downloaded int64

	buf := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			if _, wErr := out.Write(buf[:n]); wErr != nil {
				return wErr
			}
			downloaded += int64(n)
			a.emitDownloadProgress(downloaded, totalSize)
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func unzipFile(src, dest string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()

	if err := os.MkdirAll(dest, 0755); err != nil {
		return err
	}

	for _, f := range r.File {
		fpath := filepath.Join(dest, f.Name)

		if !strings.HasPrefix(fpath, filepath.Clean(dest)+string(os.PathSeparator)) {
			return fmt.Errorf("illegal file path: %s", fpath)
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(fpath, f.Mode())
			continue
		}

		if err := os.MkdirAll(filepath.Dir(fpath), 0755); err != nil {
			return err
		}

		outFile, err := os.OpenFile(fpath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			outFile.Close()
			return err
		}

		_, err = io.Copy(outFile, rc)
		outFile.Close()
		rc.Close()

		if err != nil {
			return err
		}
	}
	return nil
}

func (a *App) emitDownloadProgress(downloaded, total int64) {
	progress := map[string]interface{}{
		"downloaded":       downloaded,
		"total":            total,
		"human_downloaded": humanizeSize(downloaded),
		"human_total":      humanizeSize(total),
	}
	wailsruntime.EventsEmit(a.ctx, "llama-cpp-download-progress", progress)
}

func (a *App) emitDownloadError(errorMessage string) {
	wailsruntime.EventsEmit(a.ctx, "llama-cpp-download-error", errorMessage)
}

func humanizeSize(s int64) string {
	const unit = 1024
	if s < unit {
		return fmt.Sprintf("%d B", s)
	}
	div, exp := int64(unit), 0
	for n := s / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(s)/float64(div), "KMGTPE"[exp])
}
