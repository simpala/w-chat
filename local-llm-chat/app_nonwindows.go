//go:build !windows
package main

import "os/exec"

func setHideWindow(cmd *exec.Cmd) {
	// No-op for non-Windows systems
}
