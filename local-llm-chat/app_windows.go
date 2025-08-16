//go:build windows
package main

import (
	"fmt"
	"os/exec"
	"strconv"
	"syscall"
)

func setHideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}

func shutdownLLM(cmd *exec.Cmd) error {
	if cmd != nil && cmd.Process != nil {
		// On windows we can kill the whole process tree using taskkill
		pid := cmd.Process.Pid
		kill := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(pid))
		err := kill.Run()
		if err != nil {
			return fmt.Errorf("failed to kill process tree: %w", err)
		}
	}
	return nil
}
