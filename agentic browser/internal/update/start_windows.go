package update

import (
	"os/exec"
	"strconv"
	"syscall"
)

const createNoWindow = 0x08000000

// startDetached starts a program that outlives this one, with no window of its own.
var startDetached = func(path string, args ...string) error {
	run := exec.Command(path, args...)
	run.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	if err := run.Start(); err != nil {
		return err
	}
	return run.Process.Release()
}

// Install starts the installer, which waits for this program to end, replaces it and opens the
// new version. The caller should end straight away.
func (r *Ready) Install(pid int) error {
	if err := r.config.NoteTry(r.Manifest.Version); err != nil {
		return err
	}
	return startDetached(r.Setup, "-update", "-wait-pid", strconv.Itoa(pid))
}
