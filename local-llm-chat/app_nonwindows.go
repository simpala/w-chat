//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

func setHideWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}

func shutdownLLM(cmd *exec.Cmd) error {
	if cmd != nil && cmd.Process != nil {
		// On non-windows system we can kill the whole process group by sending a signal to -PID
		pid := cmd.Process.Pid
		if err := syscall.Kill(-pid, syscall.SIGTERM); err != nil {
			return err
		}
	}
	return nil
}
